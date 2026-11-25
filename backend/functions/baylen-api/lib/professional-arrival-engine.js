"use strict";

const { rowOf, asId } = require("./http");
const { haversineKm } = require("./salon-engine");
const {
  JOB_STATUS,
  assertJobTransition,
  normalizeJobStatus,
} = require("./professional-job-fsm");
const {
  findJobByRowId,
  appendStatusHistory,
  JOB_TYPES,
  REFERENCE_TYPES,
} = require("./professional-job-engine");

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
const {
  loadPartnerBySession,
  assertPartnerCanRespond,
} = require("./professional-job-offer-engine");
const { loadJobDispatchContext } = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const { assertProviderTransition } = require("./at-home-beauty-fsm");
const {
  readProfessionalLocationCache,
  parseTimestamp,
} = require("./professional-location-cache");
const {
  LOCATION_STALE_SECONDS,
  MAX_ACCURACY_METERS,
} = require("./professional-location-config");
const {
  ARRIVAL_RADIUS_METERS,
  ARRIVAL_MIN_ACCURACY_METERS,
  OTP_RESEND_COOLDOWN_SECONDS,
} = require("./professional-arrival-config");
const {
  issueArrivalOtp,
  verifyArrivalOtp,
  readArrivalOtpState,
} = require("./at-home-beauty-otp");
const { assertPartnerJobMutationAccess } = require("./professional-partner-guard");

const TERMINAL_STATUSES = new Set(["COMPLETED", "DELIVERED", "CANCELLED", "CLOSED"]);

function otpResendCacheKey(serviceJobId) {
  return "beauty_job_otp_resend:" + String(serviceJobId);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  return Math.round(haversineKm(lat1, lng1, lat2, lng2) * 1000);
}

async function assertPartnerOwnsJob(job, partner) {
  assertPartnerJobMutationAccess(job, partner);
}

function assertHomeServiceJob(job) {
  if (job.job_type !== JOB_TYPES.HOME_SERVICE && job.reference_type !== REFERENCE_TYPES.SERVICE_JOB) {
    const error = new Error("Arrival verification is only supported for home service jobs");
    error.status = 409;
    error.code = "JOB_NOT_SUPPORTED";
    throw error;
  }
}

function validateLatestLocationForArrival(cached) {
  if (!cached || cached.latitude == null || cached.longitude == null) {
    const error = new Error("Latest professional location is unavailable");
    error.status = 409;
    error.code = "LOCATION_UNAVAILABLE";
    throw error;
  }
  const ref = cached.captured_at || cached.received_at;
  const parsed = parseTimestamp(ref);
  if (!parsed) {
    const error = new Error("Latest professional location is unavailable");
    error.status = 409;
    error.code = "LOCATION_UNAVAILABLE";
    throw error;
  }
  const ageSeconds = (Date.now() - parsed.getTime()) / 1000;
  if (ageSeconds > LOCATION_STALE_SECONDS) {
    const error = new Error("Latest professional location is stale");
    error.status = 409;
    error.code = "LOCATION_STALE";
    throw error;
  }
  const accuracy = cached.accuracy_m != null ? Number(cached.accuracy_m) : null;
  const maxAccuracy = Math.min(MAX_ACCURACY_METERS, ARRIVAL_MIN_ACCURACY_METERS);
  if (accuracy != null && Number.isFinite(accuracy) && accuracy > maxAccuracy) {
    const error = new Error("Latest GPS accuracy is too low for arrival confirmation");
    error.status = 409;
    error.code = "LOCATION_ACCURACY_TOO_LOW";
    throw error;
  }
  return {
    latitude: Number(cached.latitude),
    longitude: Number(cached.longitude),
    accuracy_m: accuracy,
    captured_at: cached.captured_at || parsed.toISOString(),
    age_seconds: Math.max(0, Math.round(ageSeconds)),
  };
}

function resolveDestination(context) {
  const destination = context?.destination;
  if (!destination || destination.latitude == null || destination.longitude == null) {
    const error = new Error("Service destination coordinates are unavailable");
    error.status = 409;
    error.code = "DESTINATION_LOCATION_UNAVAILABLE";
    throw error;
  }
  return {
    latitude: Number(destination.latitude),
    longitude: Number(destination.longitude),
  };
}

async function loadValidatedArrivalContext(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerCanRespond(partner, { requireOnline: false });

  const job = await findJobByRowId(zcql, jobRowId);
  await assertPartnerOwnsJob(job, partner);
  assertHomeServiceJob(job);

  if (TERMINAL_STATUSES.has(normalizeJobStatus(job.status))) {
    const error = new Error("Job is no longer active");
    error.status = 409;
    error.code = "JOB_NOT_TRACKABLE";
    throw error;
  }

  const context = await loadJobDispatchContext(zcql, job);
  const destination = resolveDestination(context);
  const cached = await readProfessionalLocationCache(app, jobRowId);
  const location = validateLatestLocationForArrival(cached);
  const distanceMeters = haversineMeters(
    location.latitude,
    location.longitude,
    destination.latitude,
    destination.longitude
  );

  return {
    zcql,
    partner,
    job,
    context,
    destination,
    location,
    distanceMeters,
  };
}

async function getProfessionalJobArrivalPreview(app, jobRowId, partnerSession) {
  const ctx = await loadValidatedArrivalContext(app, jobRowId, partnerSession);
  const status = normalizeJobStatus(ctx.job.status);
  const eligible =
    status === JOB_STATUS.EN_ROUTE && ctx.distanceMeters <= ARRIVAL_RADIUS_METERS;

  return {
    professional_job_id: ctx.job.id,
    job_status: ctx.job.status,
    distance_meters: ctx.distanceMeters,
    arrival_radius_meters: ARRIVAL_RADIUS_METERS,
    eligible,
    location_status: "LIVE",
    location_age_seconds: ctx.location.age_seconds,
    accuracy_m: ctx.location.accuracy_m,
    destination: ctx.destination,
    drop_address: ctx.context?.drop_address || "",
  };
}

async function syncServiceJobArrived(app, job, partner) {
  const zcql = app.zcql();
  const serviceJob = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status FROM Service_Jobs WHERE ROWID = " +
        asId(job.reference_row_id, "service_job_id")
    ),
    "Service_Jobs"
  );
  if (!serviceJob) {
    return;
  }
  let from = String(serviceJob.status || "").toUpperCase();
  if (from === "ARRIVED" || from === "STARTED" || from === "COMPLETED") {
    return;
  }
  if (from === "ACCEPTED" || from === "ASSIGNED") {
    assertProviderTransition(from, "EN_ROUTE");
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: job.reference_row_id,
      status: "EN_ROUTE",
      delivery_partner_row_id: job.delivery_partner_row_id,
    });
    from = "EN_ROUTE";
  }
  if (from === "EN_ROUTE") {
    assertProviderTransition(from, "ARRIVED");
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: job.reference_row_id,
      status: "ARRIVED",
      delivery_partner_row_id: job.delivery_partner_row_id,
    });
    try {
      await app.datastore().table("Job_Timeline").insertRow({
        job_id: job.reference_row_id,
        provider_id: partner.legacy_provider_id || partner.row_id,
        status: "ARRIVED",
        note: "Professional has arrived",
        happened_at: nowSql(),
      });
    } catch (_) {}
  }
}

async function confirmProfessionalJobArrival(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const ctx = await loadValidatedArrivalContext(app, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(ctx.job.status);

    if (currentStatus === JOB_STATUS.ARRIVED || currentStatus === JOB_STATUS.OTP_VERIFIED) {
      const otpState = await readArrivalOtpState(app, ctx.job.reference_row_id);
      return {
        success: true,
        idempotent: true,
        professional_job_id: ctx.job.id,
        status: ctx.job.status,
        distance_meters: ctx.distanceMeters,
        arrival_radius_meters: ARRIVAL_RADIUS_METERS,
        arrived_at: ctx.job.arrived_at || "",
        otp_required: currentStatus === JOB_STATUS.ARRIVED,
        otp_verified: currentStatus === JOB_STATUS.OTP_VERIFIED,
      };
    }

    if (currentStatus !== JOB_STATUS.EN_ROUTE) {
      const error = new Error("Job must be en route before confirming arrival");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }

    if (ctx.distanceMeters > ARRIVAL_RADIUS_METERS) {
      const error = new Error("You are too far from the customer location");
      error.status = 409;
      error.code = "ARRIVAL_TOO_FAR";
      error.distance_meters = ctx.distanceMeters;
      error.arrival_radius_meters = ARRIVAL_RADIUS_METERS;
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.ARRIVED, JOB_TYPES.HOME_SERVICE);
    const arrivedAt = nowSql();
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.ARRIVED,
    });
    await syncServiceJobArrived(app, ctx.job, ctx.partner);
    await issueArrivalOtp(app, ctx.job.reference_row_id);
    try {
      await app.cache().segment().put(
        otpResendCacheKey(ctx.job.reference_row_id),
        JSON.stringify({ sent_at: new Date().toISOString() }),
        30
      );
    } catch (_) {}

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.ARRIVED,
      actorId: ctx.partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "ARRIVAL_CONFIRMED",
      metadata: {
        event: "ARRIVAL_CONFIRMED",
        distance_meters: ctx.distanceMeters,
        arrival_radius_meters: ARRIVAL_RADIUS_METERS,
      },
    });

    return {
      success: true,
      idempotent: false,
      professional_job_id: ctx.job.id,
      status: JOB_STATUS.ARRIVED,
      distance_meters: ctx.distanceMeters,
      arrival_radius_meters: ARRIVAL_RADIUS_METERS,
      arrived_at: arrivedAt,
      otp_required: true,
    };
  });
}

async function verifyProfessionalJobOtp(app, jobRowId, partnerSession, otp) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    assertPartnerCanRespond(partner, { requireOnline: false });

    const job = await findJobByRowId(zcql, jobRowId);
    await assertPartnerOwnsJob(job, partner);
    assertHomeServiceJob(job);

    const currentStatus = normalizeJobStatus(job.status);
    if (currentStatus === JOB_STATUS.OTP_VERIFIED) {
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        status: JOB_STATUS.OTP_VERIFIED,
      };
    }

    if (currentStatus !== JOB_STATUS.ARRIVED) {
      const error = new Error("Job must be arrived before OTP verification");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }

    let verifyResult;
    try {
      verifyResult = await verifyArrivalOtp(app, job.reference_row_id, otp);
    } catch (error) {
      if (error.code === "OTP_INVALID") {
        await appendStatusHistory(app, {
          professionalJobRowId: jobRowId,
          oldStatus: currentStatus,
          newStatus: currentStatus,
          actorId: partner.delivery_partner_id,
          actorRole: "PROFESSIONAL",
          reason: "OTP_VERIFICATION_FAILED",
          metadata: { event: "OTP_VERIFICATION_FAILED" },
        });
      }
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.OTP_VERIFIED, JOB_TYPES.HOME_SERVICE);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.OTP_VERIFIED,
    });

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.OTP_VERIFIED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "OTP_VERIFICATION_SUCCESS",
      metadata: {
        event: "OTP_VERIFICATION_SUCCESS",
        already_verified: verifyResult.already_verified === true,
      },
    });

    return {
      success: true,
      idempotent: verifyResult.already_verified === true,
      professional_job_id: job.id,
      status: JOB_STATUS.OTP_VERIFIED,
    };
  });
}

async function resendProfessionalJobOtp(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    assertPartnerCanRespond(partner, { requireOnline: false });

    const job = await findJobByRowId(zcql, jobRowId);
    await assertPartnerOwnsJob(job, partner);
    assertHomeServiceJob(job);

    const currentStatus = normalizeJobStatus(job.status);
    if (currentStatus !== JOB_STATUS.ARRIVED) {
      const error = new Error("OTP can only be resent after arrival");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }

    let lastSentAt = 0;
    try {
      const raw = await app.cache().segment().getValue(otpResendCacheKey(job.reference_row_id));
      if (raw) {
        const parsed = JSON.parse(raw);
        lastSentAt = Date.parse(parsed.sent_at || "") || 0;
      }
    } catch (_) {}

    const elapsed = (Date.now() - lastSentAt) / 1000;
    if (lastSentAt && elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      const error = new Error("Please wait before requesting another OTP");
      error.status = 429;
      error.code = "OTP_RESEND_COOLDOWN";
      error.retry_after_seconds = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed);
      throw error;
    }

    await issueArrivalOtp(app, job.reference_row_id);
    try {
      await app.cache().segment().put(
        otpResendCacheKey(job.reference_row_id),
        JSON.stringify({ sent_at: new Date().toISOString() }),
        30
      );
    } catch (_) {}

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: currentStatus,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "OTP_RESENT",
      metadata: { event: "OTP_RESENT" },
    });

    return {
      success: true,
      professional_job_id: job.id,
      status: currentStatus,
      resent: true,
      cooldown_seconds: OTP_RESEND_COOLDOWN_SECONDS,
    };
  });
}

module.exports = {
  ARRIVAL_RADIUS_METERS,
  haversineMeters,
  getProfessionalJobArrivalPreview,
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
  resendProfessionalJobOtp,
  loadValidatedArrivalContext,
};
