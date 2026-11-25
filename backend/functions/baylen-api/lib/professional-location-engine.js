"use strict";

const { rowsOf, rowOf, asId, num, nowSql } = require("./http");
const { requireCoordinates } = require("./geo-coords");
const { buildRouteSummary } = require("./geo-routing");
const {
  JOB_STATUS,
  assertJobTransition,
  normalizeJobStatus,
} = require("./professional-job-fsm");
const {
  findJobByRowId,
  mapProfessionalJob,
  appendStatusHistory,
  JOB_TYPES,
  REFERENCE_TYPES,
} = require("./professional-job-engine");
const {
  loadPartnerBySession,
  assertPartnerCanRespond,
} = require("./professional-job-offer-engine");
const { loadJobDispatchContext } = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const {
  assertProviderTransition,
  canAcceptLocationPing,
  canShowLiveTracking,
} = require("./at-home-beauty-fsm");
const {
  writeProfessionalLocationCache,
  readProfessionalLocationCache,
  parseTimestamp,
} = require("./professional-location-cache");
const {
  LOCATION_STALE_SECONDS,
  MAX_CAPTURE_AGE_SECONDS,
  MAX_FUTURE_SKEW_SECONDS,
  MAX_ACCURACY_METERS,
} = require("./professional-location-config");
const { assertPartnerJobMutationAccess } = require("./professional-partner-guard");

const TRACKABLE_HOME_STATUSES = new Set(["EN_ROUTE"]);
const TRACKABLE_PRODUCT_STATUSES = new Set(["GOING_TO_PICKUP", "EN_ROUTE"]);
const TERMINAL_PROFESSIONAL_STATUSES = new Set([
  "COMPLETED",
  "DELIVERED",
  "CANCELLED",
  "CLOSED",
]);

function isProductDeliveryJob(job) {
  return job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER;
}

function canAcceptProfessionalLocationPing(status, jobType) {
  const normalized = normalizeJobStatus(status);
  if (String(jobType || "").toUpperCase() === JOB_TYPES.PRODUCT_DELIVERY) {
    return TRACKABLE_PRODUCT_STATUSES.has(normalized);
  }
  return TRACKABLE_HOME_STATUSES.has(normalized);
}

function canCustomerViewProfessionalTracking(status, jobType) {
  return canAcceptProfessionalLocationPing(status, jobType);
}

const TRACKABLE_PROFESSIONAL_STATUSES = new Set([
  ...TRACKABLE_HOME_STATUSES,
  ...TRACKABLE_PRODUCT_STATUSES,
]);

function validateCapturedAt(capturedAt) {
  const parsed = parseTimestamp(capturedAt);
  if (!parsed) {
    const error = new Error("captured_at is required and must be a valid timestamp");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  const now = Date.now();
  const ageSeconds = (now - parsed.getTime()) / 1000;
  if (ageSeconds > MAX_CAPTURE_AGE_SECONDS) {
    const error = new Error("Location timestamp is too old");
    error.status = 409;
    error.code = "LOCATION_UPDATE_TOO_OLD";
    throw error;
  }
  const futureSeconds = (parsed.getTime() - now) / 1000;
  if (futureSeconds > MAX_FUTURE_SKEW_SECONDS) {
    const error = new Error("Location timestamp is in the future");
    error.status = 409;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  return parsed.toISOString();
}

function validateAccuracy(accuracyM) {
  if (accuracyM == null || accuracyM === "") {
    return null;
  }
  const value = Number(accuracyM);
  if (!Number.isFinite(value) || value < 0) {
    const error = new Error("accuracy_m must be a non-negative number");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  if (value > MAX_ACCURACY_METERS) {
    const error = new Error("Location accuracy is too poor");
    error.status = 409;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  return value;
}

function computeLocationStatus(cached) {
  if (!cached) {
    return "UNAVAILABLE";
  }
  const ref = cached.captured_at || cached.received_at;
  const parsed = parseTimestamp(ref);
  if (!parsed) {
    return "UNAVAILABLE";
  }
  const ageSeconds = (Date.now() - parsed.getTime()) / 1000;
  if (ageSeconds > LOCATION_STALE_SECONDS) {
    return "STALE";
  }
  return "LIVE";
}

function computeAgeSeconds(cached) {
  if (!cached) {
    return null;
  }
  const ref = cached.captured_at || cached.received_at;
  const parsed = parseTimestamp(ref);
  if (!parsed) {
    return null;
  }
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / 1000));
}

async function assertPartnerOwnsJob(zcql, job, partner) {
  assertPartnerJobMutationAccess(job, partner);
}

async function syncTravelToReference(app, job) {
  const zcql = app.zcql();
  if (job.job_type === JOB_TYPES.HOME_SERVICE || job.reference_type === REFERENCE_TYPES.SERVICE_JOB) {
    const serviceJob = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, status, provider_id FROM Service_Jobs WHERE ROWID = " +
          asId(job.reference_row_id, "service_job_id")
      ),
      "Service_Jobs"
    );
    if (serviceJob) {
      const from = String(serviceJob.status || "").toUpperCase();
      if (from === "ACCEPTED" || from === "ASSIGNED") {
        assertProviderTransition(from, "EN_ROUTE");
        await app.datastore().table("Service_Jobs").updateRow({
          ROWID: job.reference_row_id,
          status: "EN_ROUTE",
          delivery_partner_row_id: job.delivery_partner_row_id,
        });
      }
    }
    return;
  }
  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER) {
    const order = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, status FROM Orders WHERE ROWID = " + asId(job.reference_row_id, "order_id")
      ),
      "Orders"
    );
    if (order) {
      const status = String(order.status || "").toUpperCase();
      const travelable = new Set([
        "CONFIRMED",
        "PROCESSING",
        "STORE_ASSIGNED",
        "PICKING",
        "PACKED",
        "RIDER_SEARCHING",
        "RIDER_ASSIGNED",
        "PICKED_UP",
      ]);
      if (travelable.has(status)) {
        try {
          await app.datastore().table("Orders").updateRow({
            ROWID: job.reference_row_id,
            status: "OUT_FOR_DELIVERY",
          });
        } catch (_) {}
      }
    }
  }
}

async function startProfessionalJobTravel(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    assertPartnerCanRespond(partner);

    const job = await findJobByRowId(zcql, jobRowId);
    await assertPartnerOwnsJob(zcql, job, partner);

    const currentStatus = normalizeJobStatus(job.status);
    if (currentStatus === JOB_STATUS.EN_ROUTE) {
      await syncTravelToReference(app, job);
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        new_status: JOB_STATUS.EN_ROUTE,
        tracking_active: true,
      };
    }
    if (TERMINAL_PROFESSIONAL_STATUSES.has(currentStatus)) {
      const error = new Error("Job is no longer trackable");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }
    if (currentStatus !== JOB_STATUS.ACCEPTED) {
      const error = new Error("Job must be accepted before starting travel");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }
    if (isProductDeliveryJob(job)) {
      const error = new Error("Use start pickup for product delivery jobs");
      error.status = 409;
      error.code = "USE_START_PICKUP";
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.EN_ROUTE, job.job_type || JOB_TYPES.HOME_SERVICE);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.EN_ROUTE,
    });
    await syncTravelToReference(app, job);
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.EN_ROUTE,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "TRAVEL_STARTED",
      metadata: { event: "tracking_started" },
    });

    const refreshed = await findJobByRowId(zcql, jobRowId);
    return {
      success: true,
      idempotent: false,
      professional_job_id: refreshed.id,
      job_number: refreshed.job_number,
      previous_status: currentStatus,
      new_status: refreshed.status,
      tracking_active: true,
    };
  });
}

async function recordProfessionalJobLocation(app, jobRowId, partnerSession, payload) {
  const coords = requireCoordinates(payload.latitude, payload.longitude, {
    latName: "latitude",
    lngName: "longitude",
  });
  const capturedAt = validateCapturedAt(payload.captured_at);
  const accuracyM = validateAccuracy(payload.accuracy_m != null ? payload.accuracy_m : payload.accuracy);
  const speedMps =
    payload.speed_mps != null && payload.speed_mps !== ""
      ? Number(payload.speed_mps)
      : payload.speed != null && payload.speed !== ""
        ? Number(payload.speed)
        : null;
  const heading =
    payload.heading != null && payload.heading !== "" ? Number(payload.heading) : null;

  if (speedMps != null && (!Number.isFinite(speedMps) || speedMps < 0)) {
    const error = new Error("speed_mps must be a non-negative number");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  if (heading != null && (!Number.isFinite(heading) || heading < 0 || heading > 360)) {
    const error = new Error("heading must be between 0 and 360");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }

  const zcql = app.zcql();
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerCanRespond(partner, { requireOnline: false });

  const job = await findJobByRowId(zcql, jobRowId);
  await assertPartnerOwnsJob(zcql, job, partner);

  if (!canAcceptProfessionalLocationPing(job.status, job.job_type)) {
    const error = new Error("Live location is only accepted while en route");
    error.status = 409;
    error.code = "TRACKING_NOT_ALLOWED";
    throw error;
  }

  const cachePayload = {
    professional_row_id: String(partner.row_id),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy_m: accuracyM,
    speed_mps: speedMps,
    heading,
    captured_at: capturedAt,
  };

  const cacheResult = await writeProfessionalLocationCache(app, jobRowId, cachePayload, {
    reference_type: job.reference_type,
    reference_row_id: job.reference_row_id,
  });

  if (!cacheResult.written && cacheResult.reason === "STALE_UPDATE") {
    return {
      recorded: false,
      ignored: true,
      reason: "STALE_UPDATE",
      location_status: computeLocationStatus(cacheResult.cached),
    };
  }

  if (job.job_type === JOB_TYPES.HOME_SERVICE || job.reference_type === REFERENCE_TYPES.SERVICE_JOB) {
    try {
      await app.datastore().table("Live_Locations").insertRow({
        job_id: job.reference_row_id,
        provider_id: partner.legacy_provider_id || partner.row_id,
        latitude: coords.latitude,
        longitude: coords.longitude,
        heading,
        speed: speedMps,
        status: "EN_ROUTE",
        recorded_at: nowSql(),
      });
    } catch (_) {}
  }

  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER) {
    try {
      await app.datastore().table("Delivery_Tracking").insertRow({
        order_id: job.reference_row_id,
        latitude: coords.latitude,
        longitude: coords.longitude,
        status: "EN_ROUTE",
        recorded_at: nowSql(),
      });
      await app.datastore().table("Orders").updateRow({
        ROWID: job.reference_row_id,
        rider_latitude: coords.latitude,
        rider_longitude: coords.longitude,
      });
    } catch (_) {}
  }

  return {
    recorded: true,
    ignored: false,
    location_status: "LIVE",
    captured_at: capturedAt,
  };
}

async function resolveProfessionalJobForCustomer(zcql, { professionalJobId, orderId, serviceJobId, userId }) {
  let job = null;
  if (professionalJobId) {
    job = await findJobByRowId(zcql, professionalJobId);
  } else if (orderId) {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Professional_Jobs WHERE reference_type = 'ORDER' AND reference_row_id = " +
          asId(orderId, "order_id") +
          " ORDER BY CREATEDTIME DESC LIMIT 1"
      ),
      "Professional_Jobs"
    );
    if (row) {
      job = await findJobByRowId(zcql, row.ROWID);
    }
  } else if (serviceJobId) {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Professional_Jobs WHERE reference_type = 'SERVICE_JOB' AND reference_row_id = " +
          asId(serviceJobId, "service_job_id") +
          " ORDER BY CREATEDTIME DESC LIMIT 1"
      ),
      "Professional_Jobs"
    );
    if (row) {
      job = await findJobByRowId(zcql, row.ROWID);
    }
  }
  if (!job) {
    const error = new Error("Professional job not found");
    error.status = 404;
    error.code = "JOB_NOT_FOUND";
    throw error;
  }

  const context = await loadJobDispatchContext(zcql, job);
  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER) {
    const order = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, user_id FROM Orders WHERE ROWID = " + asId(job.reference_row_id, "order_id")
      ),
      "Orders"
    );
    if (!order || String(order.user_id) !== String(userId)) {
      const error = new Error("Professional job not found");
      error.status = 404;
      error.code = "JOB_NOT_FOUND";
      throw error;
    }
  } else {
    const serviceJob = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, user_id FROM Service_Jobs WHERE ROWID = " +
          asId(job.reference_row_id, "service_job_id")
      ),
      "Service_Jobs"
    );
    if (!serviceJob || String(serviceJob.user_id) !== String(userId)) {
      const error = new Error("Professional job not found");
      error.status = 404;
      error.code = "JOB_NOT_FOUND";
      throw error;
    }
  }

  return { job, context };
}

async function getCustomerProfessionalTracking(app, { userId, professionalJobId, orderId, serviceJobId }) {
  const zcql = app.zcql();
  const { job, context } = await resolveProfessionalJobForCustomer(zcql, {
    professionalJobId,
    orderId,
    serviceJobId,
    userId,
  });

  const isProduct = isProductDeliveryJob(job);
  const jobStatus = normalizeJobStatus(job.status);
  const arrived = isProduct
    ? jobStatus === JOB_STATUS.ARRIVED ||
      jobStatus === JOB_STATUS.DELIVERY_VERIFIED ||
      jobStatus === JOB_STATUS.DELIVERED
    : jobStatus === JOB_STATUS.ARRIVED || jobStatus === JOB_STATUS.OTP_VERIFIED;
  const otpVerified = isProduct
    ? jobStatus === JOB_STATUS.DELIVERY_VERIFIED ||
      jobStatus === JOB_STATUS.DELIVERED ||
      jobStatus === JOB_STATUS.COMPLETED
    : jobStatus === JOB_STATUS.OTP_VERIFIED ||
      jobStatus === JOB_STATUS.STARTED ||
      jobStatus === JOB_STATUS.IN_PROGRESS ||
      jobStatus === JOB_STATUS.COMPLETED;
  const serviceStarted =
    !isProduct &&
    (jobStatus === JOB_STATUS.STARTED ||
      jobStatus === JOB_STATUS.IN_PROGRESS ||
      jobStatus === JOB_STATUS.COMPLETED);
  const serviceCompleted = jobStatus === JOB_STATUS.COMPLETED;
  const trackingAllowed =
    canCustomerViewProfessionalTracking(job.status, job.job_type) &&
    (!serviceStarted || isProduct);
  const cached = trackingAllowed ? await readProfessionalLocationCache(app, job.id) : null;
  const locationStatus = trackingAllowed ? computeLocationStatus(cached) : "UNAVAILABLE";

  let route = null;
  const routeTarget =
    isProduct && jobStatus === JOB_STATUS.GOING_TO_PICKUP ? context?.pickup : context?.destination;
  if (cached && routeTarget && routeTarget.latitude != null && !arrived) {
    route = buildRouteSummary(
      cached.latitude,
      cached.longitude,
      routeTarget.latitude,
      routeTarget.longitude
    );
  }

  return {
    tracking_allowed: trackingAllowed,
    location_status: locationStatus,
    professional_job_id: job.id,
    job_status: job.status,
    arrived,
    otp_verified: otpVerified,
    service_started: serviceStarted,
    service_completed: serviceCompleted,
    latitude: trackingAllowed ? cached?.latitude ?? null : null,
    longitude: trackingAllowed ? cached?.longitude ?? null : null,
    accuracy_m: trackingAllowed ? cached?.accuracy_m ?? null : null,
    speed_mps: trackingAllowed ? cached?.speed_mps ?? null : null,
    heading: trackingAllowed ? cached?.heading ?? null : null,
    captured_at: trackingAllowed ? cached?.captured_at ?? null : null,
    received_at: trackingAllowed ? cached?.received_at ?? null : null,
    age_seconds: trackingAllowed ? computeAgeSeconds(cached) : null,
    destination: context?.destination || null,
    drop_address: context?.drop_address || "",
    route: arrived
      ? null
      : route
        ? {
            distance_km: route.distance_km,
            eta_minutes: route.eta_minutes,
            eta_label: route.eta_label,
            routing_source: route.routing_source,
          }
        : null,
  };
}

module.exports = {
  TRACKABLE_PROFESSIONAL_STATUSES,
  TERMINAL_PROFESSIONAL_STATUSES,
  canAcceptProfessionalLocationPing,
  canCustomerViewProfessionalTracking,
  validateCapturedAt,
  validateAccuracy,
  computeLocationStatus,
  computeAgeSeconds,
  startProfessionalJobTravel,
  recordProfessionalJobLocation,
  getCustomerProfessionalTracking,
  resolveProfessionalJobForCustomer,
};
