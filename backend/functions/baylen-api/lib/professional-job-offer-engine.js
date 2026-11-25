"use strict";

/**
 * PP-004 — Professional job offer accept, reject, expiry, and reassignment.
 */

const { rowOf, rowsOf, asId, num, sqlString } = require("./http");
const { mapDeliveryPartner, DP_SELECT } = require("./delivery-partner");
const { isPartnerOperational, normalizePartnerStatus } = require("./delivery-partner-kyc");
const {
  JOB_STATUS,
  normalizeJobStatus,
  assertJobTransition,
} = require("./professional-job-fsm");
const {
  PJ_SELECT,
  mapProfessionalJob,
  findJobByRowId,
  transitionProfessionalJob,
  appendStatusHistory,
  REFERENCE_TYPES,
  JOB_TYPES,
  computeOfferExpiresAt,
  parseJobMetadata,
  rejectedPartnerIdsFromMetadata,
  partnerHasEligibleOffer,
} = require("./professional-job-engine");
const {
  loadJobDispatchContext,
  isJobReferenceDispatchable,
  dispatchProfessionalJob,
  assignJobToPartner,
} = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const { recordWhatsappNotification } = require("./whatsapp-notification-store");

const REJECTION_REASONS = Object.freeze([
  "TOO_FAR",
  "NOT_AVAILABLE",
  "WRONG_SERVICE",
  "VEHICLE_ISSUE",
  "PERSONAL_REASON",
  "OTHER",
]);

const ONLINE_STATUS = {
  OFFLINE: "OFFLINE",
  ONLINE_AVAILABLE: "ONLINE_AVAILABLE",
  ONLINE_BUSY: "ONLINE_BUSY",
};

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseSqlDate(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(/[zZ]$/.test(normalized) ? normalized : normalized + "Z");
  return Number.isNaN(date.getTime()) ? null : date;
}

function offerTtlMinutes() {
  const configured = num(process.env.PROFESSIONAL_OFFER_TTL_MINUTES);
  return configured > 0 ? configured : 15;
}

function computeOfferExpiresAtLocal(fromDate = new Date()) {
  return computeOfferExpiresAt(fromDate);
}

function parseMetadata(json) {
  if (!json) {
    return {};
  }
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeRejectionReason(value) {
  const reason = String(value || "")
    .trim()
    .toUpperCase();
  if (!REJECTION_REASONS.includes(reason)) {
    const error = new Error("reason must be one of: " + REJECTION_REASONS.join(", "));
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return reason;
}

function normalizeOnlineStatus(value) {
  const status = String(value || ONLINE_STATUS.OFFLINE)
    .trim()
    .toUpperCase();
  return Object.values(ONLINE_STATUS).includes(status) ? status : ONLINE_STATUS.OFFLINE;
}

function isOfferExpired(job) {
  const expiresAt = parseSqlDate(job.offer_expires_at);
  if (!expiresAt) {
    return false;
  }
  return Date.now() >= expiresAt.getTime();
}

function rejectedPartnerIds(metadata) {
  return rejectedPartnerIdsFromMetadata(metadata);
}

function withRejectedPartner(metadata, partnerRowId, reason) {
  const meta = parseJobMetadata(metadata);
  const existing = rejectedPartnerIds(meta);
  const partnerRef = String(partnerRowId);
  if (!existing.includes(partnerRef)) {
    existing.push(partnerRef);
  }
  return {
    ...meta,
    rejected_partner_row_ids: existing,
    last_rejection_reason: reason,
    last_rejected_partner_row_id: partnerRef,
  };
}

async function loadPartnerRow(zcql, partnerRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE ROWID = " + asId(partnerRowId, "partner_id")
    ),
    "Delivery_Partners"
  );
  return mapDeliveryPartner(row);
}

async function loadPartnerBySession(zcql, partnerSession) {
  const partnerRowId = asId(
    String(partnerSession.delivery_partner_id || "").replace(/^dp_/, ""),
    "delivery_partner_id"
  );
  const partner = await loadPartnerRow(zcql, partnerRowId);
  if (!partner) {
    const error = new Error("Delivery partner not found");
    error.status = 404;
    error.code = "PARTNER_NOT_FOUND";
    throw error;
  }
  return partner;
}

function assertPartnerCanRespond(partner, { requireOnline = true } = {}) {
  if (!isPartnerOperational(partner.status)) {
    const error = new Error("Partner is not operational");
    error.status = 403;
    error.code = "PARTNER_NOT_OPERATIONAL";
    throw error;
  }
  const status = normalizePartnerStatus(partner.status);
  if (status === "suspended" || status === "kyc_rejected" || status === "pending_kyc") {
    const error = new Error("Partner cannot respond to offers");
    error.status = 403;
    error.code = "PARTNER_NOT_APPROVED";
    throw error;
  }
  if (requireOnline) {
    const online = normalizeOnlineStatus(partner.online_status);
    if (online !== ONLINE_STATUS.ONLINE_AVAILABLE && online !== ONLINE_STATUS.ONLINE_BUSY) {
      const error = new Error("Partner must be online to respond to offers");
      error.status = 409;
      error.code = "PARTNER_OFFLINE";
      throw error;
    }
  }
}

async function validateOfferForPartner(zcql, job, partner, { allowExpired = false } = {}) {
  if (!job) {
    const error = new Error("Professional job not found");
    error.status = 404;
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  const pendingOffer =
    job.status === JOB_STATUS.ASSIGNMENT_PENDING &&
    partnerHasEligibleOffer(job.metadata_json, partner.row_id);
  if (pendingOffer) {
    if (!allowExpired && isOfferExpired(job)) {
      const error = new Error("Offer has expired");
      error.status = 409;
      error.code = "OFFER_EXPIRED";
      throw error;
    }
    const context = await loadJobDispatchContext(zcql, job);
    const refCheck = isJobReferenceDispatchable(context);
    if (!refCheck.ok) {
      const error = new Error("Job reference is no longer dispatchable");
      error.status = 409;
      error.code = refCheck.reason;
      throw error;
    }
    return { idempotent: false, job, context, pendingOffer: true };
  }
  if (String(job.delivery_partner_row_id) !== String(partner.row_id)) {
    const error = new Error("Service already assigned.");
    error.status = 409;
    error.code = "JOB_ALREADY_ASSIGNED";
    throw error;
  }
  if (job.status === JOB_STATUS.ACCEPTED) {
    if (String(job.delivery_partner_row_id) === String(partner.row_id)) {
      return { idempotent: true, job };
    }
    const error = new Error("Service already assigned.");
    error.status = 409;
    error.code = "JOB_ALREADY_ASSIGNED";
    throw error;
  }
  if (job.status !== JOB_STATUS.ASSIGNED) {
    const error = new Error("Job is not available for acceptance");
    error.status = 409;
    error.code = job.status === JOB_STATUS.REASSIGNMENT_REQUIRED ? "OFFER_EXPIRED" : "JOB_NOT_OFFERED";
    throw error;
  }
  if (!allowExpired && isOfferExpired(job)) {
    const error = new Error("Offer has expired");
    error.status = 409;
    error.code = "OFFER_EXPIRED";
    throw error;
  }
  const context = await loadJobDispatchContext(zcql, job);
  const refCheck = isJobReferenceDispatchable(context);
  if (!refCheck.ok) {
    const error = new Error("Job reference is no longer dispatchable");
    error.status = 409;
    error.code = refCheck.reason;
    throw error;
  }
  return { idempotent: false, job, context };
}

async function syncAcceptanceToSource(app, job) {
  if (job.reference_type === REFERENCE_TYPES.SERVICE_JOB || job.job_type === JOB_TYPES.HOME_SERVICE) {
    try {
      await app.datastore().table("Service_Jobs").updateRow({
        ROWID: job.reference_row_id,
        status: "ACCEPTED",
        delivery_partner_row_id: job.delivery_partner_row_id,
      });
    } catch (_) {}
    return;
  }
  if (job.reference_type === REFERENCE_TYPES.ORDER || job.job_type === JOB_TYPES.PRODUCT_DELIVERY) {
    const partner = await loadPartnerRow(app.zcql(), job.delivery_partner_row_id);
    const riderId = partner?.legacy_rider_id;
    if (riderId && /^\d+$/.test(String(riderId)) && String(riderId).length <= 9) {
      try {
        await app.datastore().table("Orders").updateRow({
          ROWID: job.reference_row_id,
          fulfillment_rider_id: riderId,
        });
      } catch (_) {}
    }
  }
}

async function clearSourceAssignment(app, job) {
  const zcql = app.zcql();
  if (job.reference_type === REFERENCE_TYPES.SERVICE_JOB || job.job_type === JOB_TYPES.HOME_SERVICE) {
    try {
      await zcql.executeZCQLQuery(
        "UPDATE Service_Jobs SET delivery_partner_row_id = NULL WHERE ROWID = " +
          asId(job.reference_row_id, "service_job_id")
      );
    } catch (_) {}
    return;
  }
  if (job.reference_type === REFERENCE_TYPES.ORDER || job.job_type === JOB_TYPES.PRODUCT_DELIVERY) {
    try {
      await zcql.executeZCQLQuery(
        "UPDATE Orders SET fulfillment_rider_id = NULL WHERE ROWID = " + asId(job.reference_row_id, "order_id")
      );
    } catch (_) {}
  }
}

async function clearJobAssignmentFields(app, jobRowId) {
  const zcql = app.zcql();
  try {
    await zcql.executeZCQLQuery(
      "UPDATE Professional_Jobs SET delivery_partner_row_id = NULL, assigned_at = NULL, offer_expires_at = NULL WHERE ROWID = " +
        asId(jobRowId, "professional_job_id")
    );
  } catch (_) {}
}

function mapAcceptResponse(job, partner, previousStatus) {
  return {
    success: true,
    professional_job_id: job.id,
    job_number: job.job_number,
    job_type: job.job_type,
    previous_status: previousStatus,
    new_status: job.status,
    delivery_partner_id: partner.delivery_partner_id,
    delivery_partner_row_id: partner.row_id,
    accepted_at: job.accepted_at,
    next_action: "READY_FOR_FULFILLMENT",
  };
}

async function acceptProfessionalJobOffer(app, jobRowId, partnerSession, req = null) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    assertPartnerCanRespond(partner);

    let job = await findJobByRowId(zcql, jobRowId);
    assertPartnerCanRespond(partner);

    let validation = await validateOfferForPartner(zcql, job, partner);
    if (validation.pendingOffer) {
      const assignResult = await assignJobToPartner(
        app,
        jobRowId,
        partner.row_id,
        {
          reason: "Accepted from eligible offer pool",
          skipNotify: true,
        },
        req
      );
      if (!assignResult.assigned) {
        const error = new Error("Service already assigned.");
        error.status = 409;
        error.code =
          assignResult.reason === "ALREADY_ASSIGNED" ? "JOB_ALREADY_ASSIGNED" : "JOB_NOT_OFFERED";
        throw error;
      }
      job = assignResult.job || (await findJobByRowId(zcql, jobRowId));
      validation = await validateOfferForPartner(zcql, job, partner);
    }
    if (validation.idempotent) {
      return mapAcceptResponse(validation.job, partner, JOB_STATUS.ASSIGNED);
    }
    job = validation.job;

    const previousStatus = job.status;
    const acceptedAt = nowSql();
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      accepted_at: acceptedAt,
    });
    try {
      await zcql.executeZCQLQuery(
        "UPDATE Professional_Jobs SET offer_expires_at = NULL WHERE ROWID = " + asId(jobRowId, "professional_job_id")
      );
    } catch (_) {}

    const updated = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.ACCEPTED, {
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "ACCEPTED",
      metadata: { delivery_partner_row_id: partner.row_id },
    });

    await syncAcceptanceToSource(app, updated);
    return mapAcceptResponse(updated, partner, previousStatus);
  });
}

async function beginReassignment(app, jobRowId, {
  actorId,
  actorRole,
  reason,
  metadata = {},
  clearAssignment = true,
}) {
  const zcql = app.zcql();
  const current = await findJobByRowId(zcql, jobRowId);
  if (!current) {
    const error = new Error("Professional job not found");
    error.status = 404;
    throw error;
  }

  const fromStatus = current.status;
  if (fromStatus === JOB_STATUS.REASSIGNMENT_REQUIRED) {
    return current;
  }
  if (fromStatus !== JOB_STATUS.ASSIGNED) {
    const error = new Error("Job is not in an offered state");
    error.status = 409;
    error.code = "JOB_NOT_OFFERED";
    throw error;
  }

  assertJobTransition(fromStatus, JOB_STATUS.REASSIGNMENT_REQUIRED, current.job_type);
  await app.datastore().table("Professional_Jobs").updateRow({
    ROWID: jobRowId,
    job_status: JOB_STATUS.REASSIGNMENT_REQUIRED,
  });
  await appendStatusHistory(app, {
    professionalJobRowId: jobRowId,
    oldStatus: fromStatus,
    newStatus: JOB_STATUS.REASSIGNMENT_REQUIRED,
    actorId,
    actorRole,
    reason,
    metadata,
  });

  if (clearAssignment) {
    await clearSourceAssignment(app, current);
    await clearJobAssignmentFields(app, jobRowId);
  }

  assertJobTransition(JOB_STATUS.REASSIGNMENT_REQUIRED, JOB_STATUS.ASSIGNMENT_PENDING, current.job_type);
  await app.datastore().table("Professional_Jobs").updateRow({
    ROWID: jobRowId,
    job_status: JOB_STATUS.ASSIGNMENT_PENDING,
  });
  await appendStatusHistory(app, {
    professionalJobRowId: jobRowId,
    oldStatus: JOB_STATUS.REASSIGNMENT_REQUIRED,
    newStatus: JOB_STATUS.ASSIGNMENT_PENDING,
    actorId: actorRole === "PROFESSIONAL" ? actorId : "dispatch",
    actorRole: actorRole === "PROFESSIONAL" ? "PROFESSIONAL" : "SYSTEM",
    reason: "REDISPATCH_PENDING",
    metadata,
  });

  return findJobByRowId(zcql, jobRowId);
}

async function rejectProfessionalJobOffer(app, jobRowId, partnerSession, reasonCode, req = null) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    assertPartnerCanRespond(partner);
    const reason = normalizeRejectionReason(reasonCode);

    const job = await findJobByRowId(zcql, jobRowId);
    if (!job) {
      const error = new Error("Professional job not found");
      error.status = 404;
      error.code = "JOB_NOT_FOUND";
      throw error;
    }

    const pendingPoolOffer =
      job.status === JOB_STATUS.ASSIGNMENT_PENDING &&
      partnerHasEligibleOffer(job.metadata_json, partner.row_id);
    if (pendingPoolOffer) {
      const metadata = withRejectedPartner(job.metadata_json, partner.row_id, reason);
      metadata.eligible_partner_row_ids = (metadata.eligible_partner_row_ids || [])
        .map(String)
        .filter((id) => id !== String(partner.row_id));
      await app.datastore().table("Professional_Jobs").updateRow({
        ROWID: jobRowId,
        metadata_json: JSON.stringify(metadata).slice(0, 4000),
      });
      let redispatched = false;
      if (!(metadata.eligible_partner_row_ids || []).length) {
        const dispatch = await dispatchProfessionalJob(app, jobRowId, {
          req,
          excludePartnerRowIds: metadata.rejected_partner_row_ids,
        });
        redispatched = dispatch.dispatched === true;
      }
      const refreshed = await findJobByRowId(zcql, jobRowId);
      return {
        success: true,
        professional_job_id: refreshed.id,
        job_number: refreshed.job_number,
        previous_status: JOB_STATUS.ASSIGNMENT_PENDING,
        new_status: refreshed.status,
        rejection_reason: reason,
        redispatched,
        assigned_partner_row_id: refreshed.delivery_partner_row_id || null,
      };
    }

    if (String(job.delivery_partner_row_id) !== String(partner.row_id)) {
      const error = new Error("Professional job not found");
      error.status = 404;
      error.code = "JOB_NOT_FOUND";
      throw error;
    }
    if (job.status === JOB_STATUS.REASSIGNMENT_REQUIRED || job.status === JOB_STATUS.ASSIGNMENT_PENDING) {
      const error = new Error("Job is no longer offered to this partner");
      error.status = 409;
      error.code = "JOB_NOT_OFFERED";
      throw error;
    }
    if (job.status === JOB_STATUS.ACCEPTED) {
      const error = new Error("Job has already been accepted");
      error.status = 409;
      error.code = "JOB_ALREADY_ACCEPTED";
      throw error;
    }
    if (job.status !== JOB_STATUS.ASSIGNED) {
      const error = new Error("Job is not available for rejection");
      error.status = 409;
      error.code = "JOB_NOT_OFFERED";
      throw error;
    }

    const metadata = withRejectedPartner(job.metadata_json, partner.row_id, reason);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      metadata_json: JSON.stringify(metadata).slice(0, 512),
    });

    await beginReassignment(app, jobRowId, {
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason,
      metadata: { rejected_partner_row_id: partner.row_id, rejection_reason: reason },
    });

    const dispatch = await dispatchProfessionalJob(app, jobRowId, {
      req,
      excludePartnerRowIds: metadata.rejected_partner_row_ids,
    });

    const refreshed = await findJobByRowId(zcql, jobRowId);
    return {
      success: true,
      professional_job_id: refreshed.id,
      job_number: refreshed.job_number,
      previous_status: JOB_STATUS.ASSIGNED,
      new_status: refreshed.status,
      rejection_reason: reason,
      redispatched: dispatch.dispatched === true,
      assigned_partner_row_id: dispatch.partner_row_id || refreshed.delivery_partner_row_id || null,
    };
  });
}

async function expireProfessionalJobOffer(app, jobRowId, req = null) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const job = await findJobByRowId(zcql, jobRowId);
    if (!job) {
      return { expired: false, reason: "JOB_NOT_FOUND" };
    }
    if (job.status === JOB_STATUS.ACCEPTED) {
      return { expired: false, reason: "ALREADY_ACCEPTED" };
    }
    if (job.status !== JOB_STATUS.ASSIGNED) {
      return { expired: false, reason: "NOT_OFFERED", status: job.status };
    }
    if (!isOfferExpired(job)) {
      return { expired: false, reason: "NOT_EXPIRED" };
    }

    const expiredPartnerRowId = job.delivery_partner_row_id;
    const metadata = withRejectedPartner(job.metadata_json, expiredPartnerRowId, "OFFER_EXPIRED");
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      metadata_json: JSON.stringify(metadata).slice(0, 512),
    });

    await beginReassignment(app, jobRowId, {
      actorId: "dispatch",
      actorRole: "SYSTEM",
      reason: "OFFER_EXPIRED",
      metadata: {
        expired_partner_row_id: expiredPartnerRowId,
        offer_expires_at: job.offer_expires_at,
      },
    });

    const dispatch = await dispatchProfessionalJob(app, jobRowId, {
      req,
      excludePartnerRowIds: metadata.rejected_partner_row_ids,
    });

    const refreshed = await findJobByRowId(zcql, jobRowId);
    return {
      expired: true,
      job_row_id: String(jobRowId),
      redispatched: dispatch.dispatched === true,
      assigned_partner_row_id: dispatch.partner_row_id || refreshed.delivery_partner_row_id || null,
      status: refreshed.status,
    };
  });
}

async function processExpiredProfessionalOffers(app, limit = 20, req = null) {
  const zcql = app.zcql();
  const now = nowSql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Professional_Jobs WHERE job_status = 'ASSIGNED' AND offer_expires_at IS NOT NULL AND offer_expires_at <= " +
        sqlString(now) +
        " ORDER BY offer_expires_at ASC LIMIT " +
        Math.min(Math.max(limit, 1), 100)
    ),
    "Professional_Jobs"
  );
  const results = [];
  for (const row of rows) {
    results.push({
      job_row_id: String(row.ROWID),
      ...(await expireProfessionalJobOffer(app, row.ROWID, req)),
    });
  }
  return results;
}

function buildOfferCapabilities(job, partnerRowId) {
  const assignedToPartner =
    job.delivery_partner_row_id &&
    String(job.delivery_partner_row_id) === String(partnerRowId);
  const expired = isOfferExpired(job);
  const pendingPoolOffer =
    job.status === JOB_STATUS.ASSIGNMENT_PENDING &&
    partnerHasEligibleOffer(job.metadata_json, partnerRowId);
  const offered =
    (job.status === JOB_STATUS.ASSIGNED && assignedToPartner && !expired) ||
    (pendingPoolOffer && !expired);
  const isProduct = job.job_type === JOB_TYPES.PRODUCT_DELIVERY;
  const accepted = job.status === JOB_STATUS.ACCEPTED && assignedToPartner;
  const goingToPickup = job.status === JOB_STATUS.GOING_TO_PICKUP && assignedToPartner;
  const arrivedPickup = job.status === JOB_STATUS.ARRIVED_PICKUP && assignedToPartner;
  const pickupVerified = job.status === JOB_STATUS.PICKUP_VERIFIED && assignedToPartner;
  const pickedUp = job.status === JOB_STATUS.PICKED_UP && assignedToPartner;
  const enRoute = job.status === JOB_STATUS.EN_ROUTE && assignedToPartner;
  const arrived = job.status === JOB_STATUS.ARRIVED && assignedToPartner;
  const deliveryVerified = job.status === JOB_STATUS.DELIVERY_VERIFIED && assignedToPartner;
  const delivered = job.status === JOB_STATUS.DELIVERED && assignedToPartner;
  const otpVerified = job.status === JOB_STATUS.OTP_VERIFIED && assignedToPartner;
  const serviceStarted =
    (job.status === JOB_STATUS.STARTED || job.status === JOB_STATUS.IN_PROGRESS) &&
    assignedToPartner;
  const serviceCompleted = job.status === JOB_STATUS.COMPLETED && assignedToPartner;
  const productCompleted = isProduct && serviceCompleted;
  const base = {
    can_accept: offered,
    can_reject: offered,
    offer_expired: expired,
    job_status: job.status,
    expires_at: job.offer_expires_at || "",
  };
  if (isProduct) {
    return {
      ...base,
      can_start_pickup: accepted,
      can_confirm_pickup_arrival: goingToPickup,
      can_verify_pickup: arrivedPickup,
      can_confirm_picked_up: pickupVerified,
      can_start_delivery: pickedUp,
      can_confirm_delivery_arrival: enRoute,
      can_verify_delivery_otp: arrived,
      can_confirm_delivered: deliveryVerified,
      can_complete_delivery: delivered,
      can_start_travel: false,
      can_confirm_arrival: false,
      can_verify_otp: false,
      can_start_service: false,
      can_complete_service: false,
      tracking_active: goingToPickup || enRoute,
      otp_verified: deliveryVerified,
      service_in_progress: pickedUp || enRoute || arrived || deliveryVerified,
      service_completed: productCompleted,
      accepted:
        accepted ||
        goingToPickup ||
        arrivedPickup ||
        pickupVerified ||
        pickedUp ||
        enRoute ||
        arrived ||
        deliveryVerified ||
        delivered,
    };
  }
  return {
    ...base,
    can_start_travel: accepted,
    can_confirm_arrival: enRoute,
    can_verify_otp: arrived,
    can_start_service: otpVerified,
    can_complete_service: serviceStarted,
    tracking_active: enRoute,
    otp_verified: otpVerified,
    service_in_progress: serviceStarted,
    service_completed: serviceCompleted,
    accepted: accepted || enRoute || arrived || otpVerified || serviceStarted,
  };
}

module.exports = {
  REJECTION_REASONS,
  offerTtlMinutes,
  computeOfferExpiresAt,
  normalizeRejectionReason,
  isOfferExpired,
  rejectedPartnerIds,
  acceptProfessionalJobOffer,
  rejectProfessionalJobOffer,
  expireProfessionalJobOffer,
  processExpiredProfessionalOffers,
  buildOfferCapabilities,
  beginReassignment,
  parseMetadata,
  loadPartnerBySession,
  assertPartnerCanRespond,
};
