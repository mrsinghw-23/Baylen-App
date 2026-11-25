"use strict";

const { rowOf, asId, num } = require("./http");
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
const {
  loadPartnerBySession,
  assertPartnerCanRespond,
} = require("./professional-job-offer-engine");
const {
  assertPartnerJobMutationAccess,
  assertPartnerExecutionAllowed,
} = require("./professional-partner-guard");
const { loadJobDispatchContext } = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const {
  readProfessionalLocationCache,
  parseTimestamp,
} = require("./professional-location-cache");
const {
  LOCATION_STALE_SECONDS,
  MAX_ACCURACY_METERS,
} = require("./professional-location-config");
const {
  PROFESSIONAL_PICKUP_RADIUS_METERS,
  PROFESSIONAL_DELIVERY_RADIUS_METERS,
  PINCODE_COORD_FALLBACK,
} = require("./professional-delivery-config");
const {
  issuePickupOtp,
  verifyPickupOtp,
  readPickupOtpState,
  issueDeliveryOtp,
  verifyDeliveryOtp,
  readDeliveryOtpState,
} = require("./delivery-otp");
const { setOrderStatus } = require("./commerce-ops");
const { settleProfessionalJobFinance, getProfessionalJobFinanceSummary } = require("./professional-finance-engine");

const TERMINAL_STATUSES = new Set(["COMPLETED", "DELIVERED", "CANCELLED", "CLOSED"]);
const TRACKABLE_PRODUCT_STATUSES = new Set([
  JOB_STATUS.GOING_TO_PICKUP,
  JOB_STATUS.EN_ROUTE,
]);

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  return Math.round(haversineKm(lat1, lng1, lat2, lng2) * 1000);
}

async function assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession, options = {}) {
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerExecutionAllowed(partner);
  assertPartnerCanRespond(partner, { requireOnline: false });

  const job = await findJobByRowId(zcql, jobRowId);
  if (!job) {
    const error = new Error("Professional job not found");
    error.status = 404;
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  assertPartnerJobMutationAccess(job, partner);
  if (job.job_type !== JOB_TYPES.PRODUCT_DELIVERY && job.reference_type !== REFERENCE_TYPES.ORDER) {
    const error = new Error("Delivery execution is only supported for product delivery jobs");
    error.status = 409;
    error.code = "JOB_NOT_SUPPORTED";
    throw error;
  }
  const status = normalizeJobStatus(job.status);
  if (TERMINAL_STATUSES.has(status)) {
    const allowCompleted =
      options.allowCompleted === true &&
      (status === JOB_STATUS.COMPLETED || status === JOB_STATUS.DELIVERED);
    if (!allowCompleted) {
      const error = new Error("Job is no longer active");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }
  }

  const context = await loadJobDispatchContext(zcql, job);
  const order = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, order_number, status, payment_status, payment_method, grand_total, currency, shipping_postal_code, fulfillment_store_id FROM Orders WHERE ROWID = " +
        asId(job.reference_row_id, "order_id")
    ),
    "Orders"
  );
  return { partner, job, context, order };
}

function resolvePickupLocation(context) {
  const pickup = context?.pickup;
  if (!pickup || pickup.latitude == null || pickup.longitude == null) {
    const error = new Error("Pickup location coordinates are unavailable");
    error.status = 409;
    error.code = "PICKUP_LOCATION_UNAVAILABLE";
    throw error;
  }
  return pickup;
}

function resolveDeliveryLocation(context, order) {
  const destination = context?.destination;
  if (destination && destination.latitude != null && destination.longitude != null) {
    return destination;
  }
  const pin = String(order?.shipping_postal_code || context?.pincode || "")
    .replace(/\D/g, "")
    .slice(0, 6);
  const fallback = PINCODE_COORD_FALLBACK[pin];
  if (fallback) {
    return { latitude: fallback.latitude, longitude: fallback.longitude, source: "pincode_fallback" };
  }
  const error = new Error("Delivery destination coordinates are unavailable");
  error.status = 409;
  error.code = "DESTINATION_LOCATION_UNAVAILABLE";
  throw error;
}

function validateLocationForGeofence(cached, maxAccuracy) {
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
  if (accuracy != null && Number.isFinite(accuracy) && accuracy > maxAccuracy) {
    const error = new Error("Latest GPS accuracy is too low");
    error.status = 409;
    error.code = "LOCATION_ACCURACY_TOO_LOW";
    throw error;
  }
  return {
    latitude: Number(cached.latitude),
    longitude: Number(cached.longitude),
    age_seconds: Math.max(0, Math.round(ageSeconds)),
  };
}

async function syncOrderOnAccept(app, order, partner) {
  if (!order) return;
  const status = String(order.status || "").toUpperCase();
  const assignable = new Set(["CONFIRMED", "PACKED", "RIDER_SEARCHING", "PROCESSING", "STORE_ASSIGNED"]);
  if (assignable.has(status)) {
    await setOrderStatus(app, order, "RIDER_ASSIGNED", "Professional assigned", "PROFESSIONAL", {
      fulfillment_rider_id: partner.legacy_rider_id || partner.row_id,
    });
  }
}

async function startProfessionalJobPickup(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.GOING_TO_PICKUP) {
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        status: job.status,
        tracking_active: true,
      };
    }
    if (currentStatus !== JOB_STATUS.ACCEPTED) {
      const error = new Error("Job must be accepted before going to pickup");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.GOING_TO_PICKUP, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.GOING_TO_PICKUP,
    });
    await syncOrderOnAccept(app, order, partner);
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.GOING_TO_PICKUP,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "GOING_TO_PICKUP",
      metadata: { event: "pickup_started" },
    });

    return {
      success: true,
      idempotent: false,
      professional_job_id: job.id,
      status: JOB_STATUS.GOING_TO_PICKUP,
      tracking_active: true,
    };
  });
}

async function getProfessionalJobPickupPreview(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const { job, context } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
  const pickup = resolvePickupLocation(context);
  const cached = await readProfessionalLocationCache(app, jobRowId);
  const location = validateLocationForGeofence(cached, MAX_ACCURACY_METERS);
  const distanceMeters = haversineMeters(
    location.latitude,
    location.longitude,
    pickup.latitude,
    pickup.longitude
  );
  const status = normalizeJobStatus(job.status);
  return {
    professional_job_id: job.id,
    job_status: job.status,
    distance_meters: distanceMeters,
    arrival_radius_meters: PROFESSIONAL_PICKUP_RADIUS_METERS,
    eligible: status === JOB_STATUS.GOING_TO_PICKUP && distanceMeters <= PROFESSIONAL_PICKUP_RADIUS_METERS,
    pickup,
  };
}

async function confirmProfessionalJobPickupArrival(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.ARRIVED_PICKUP || currentStatus === JOB_STATUS.PICKUP_VERIFIED) {
      return { success: true, idempotent: true, status: job.status, professional_job_id: job.id };
    }
    if (currentStatus !== JOB_STATUS.GOING_TO_PICKUP) {
      const error = new Error("Job must be going to pickup");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const pickup = resolvePickupLocation(context);
    const cached = await readProfessionalLocationCache(app, jobRowId);
    const location = validateLocationForGeofence(cached, MAX_ACCURACY_METERS);
    const distanceMeters = haversineMeters(
      location.latitude,
      location.longitude,
      pickup.latitude,
      pickup.longitude
    );
    if (distanceMeters > PROFESSIONAL_PICKUP_RADIUS_METERS) {
      const error = new Error("You are too far from the pickup location");
      error.status = 409;
      error.code = "ARRIVAL_TOO_FAR";
      error.distance_meters = distanceMeters;
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.ARRIVED_PICKUP, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.ARRIVED_PICKUP,
    });
    await issuePickupOtp(app, job.reference_row_id);
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.ARRIVED_PICKUP,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "ARRIVED_PICKUP",
      metadata: { distance_meters: distanceMeters },
    });

    return {
      success: true,
      professional_job_id: job.id,
      status: JOB_STATUS.ARRIVED_PICKUP,
      distance_meters: distanceMeters,
      pickup_otp_required: true,
    };
  });
}

async function verifyProfessionalJobPickup(app, jobRowId, partnerSession, otp) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.PICKUP_VERIFIED || currentStatus === JOB_STATUS.PICKED_UP) {
      return { success: true, idempotent: true, status: job.status };
    }
    if (currentStatus !== JOB_STATUS.ARRIVED_PICKUP) {
      const error = new Error("Pickup must be confirmed before verification");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    await verifyPickupOtp(app, job.reference_row_id, otp);
    assertJobTransition(currentStatus, JOB_STATUS.PICKUP_VERIFIED, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.PICKUP_VERIFIED,
    });
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.PICKUP_VERIFIED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "PICKUP_VERIFIED",
    });

    return { success: true, status: JOB_STATUS.PICKUP_VERIFIED, professional_job_id: job.id };
  });
}

async function confirmProfessionalJobPickedUp(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.PICKED_UP) {
      return { success: true, idempotent: true, status: job.status, professional_job_id: job.id };
    }
    if (currentStatus !== JOB_STATUS.PICKUP_VERIFIED) {
      const error = new Error("Pickup must be verified before collection");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const pickupState = await readPickupOtpState(app, job.reference_row_id);
    if (!pickupState || !pickupState.verified) {
      const error = new Error("Pickup verification is incomplete");
      error.status = 409;
      error.code = "OTP_NOT_VERIFIED";
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.PICKED_UP, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.PICKED_UP,
    });
    if (order) {
      await setOrderStatus(app, order, "PICKED_UP", "Order picked up", "PROFESSIONAL");
    }
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.PICKED_UP,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "PICKED_UP",
    });

    return { success: true, status: JOB_STATUS.PICKED_UP, professional_job_id: job.id };
  });
}

async function startProfessionalJobDelivery(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.EN_ROUTE) {
      return {
        success: true,
        idempotent: true,
        status: job.status,
        professional_job_id: job.id,
        tracking_active: true,
      };
    }
    if (currentStatus !== JOB_STATUS.PICKED_UP) {
      const error = new Error("Order must be picked up before delivery");
      error.status = 409;
      error.code = "JOB_NOT_TRACKABLE";
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.EN_ROUTE, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.EN_ROUTE,
    });
    if (order) {
      await setOrderStatus(app, order, "OUT_FOR_DELIVERY", "Out for delivery", "PROFESSIONAL");
    }
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.EN_ROUTE,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "DELIVERY_STARTED",
      metadata: { event: "delivery_tracking_started" },
    });

    return {
      success: true,
      status: JOB_STATUS.EN_ROUTE,
      professional_job_id: job.id,
      tracking_active: true,
    };
  });
}

async function getProfessionalJobDeliveryPreview(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const { job, context, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
  const destination = resolveDeliveryLocation(context, order);
  const cached = await readProfessionalLocationCache(app, jobRowId);
  const location = validateLocationForGeofence(cached, MAX_ACCURACY_METERS);
  const distanceMeters = haversineMeters(
    location.latitude,
    location.longitude,
    destination.latitude,
    destination.longitude
  );
  const status = normalizeJobStatus(job.status);
  return {
    professional_job_id: job.id,
    job_status: job.status,
    distance_meters: distanceMeters,
    arrival_radius_meters: PROFESSIONAL_DELIVERY_RADIUS_METERS,
    eligible: status === JOB_STATUS.EN_ROUTE && distanceMeters <= PROFESSIONAL_DELIVERY_RADIUS_METERS,
    destination,
  };
}

async function confirmProfessionalJobDeliveryArrival(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context, order } = await assertPartnerOwnsProductJob(
      zcql,
      jobRowId,
      partnerSession
    );
    const currentStatus = normalizeJobStatus(job.status);

    if (
      currentStatus === JOB_STATUS.ARRIVED ||
      currentStatus === JOB_STATUS.DELIVERY_VERIFIED ||
      currentStatus === JOB_STATUS.DELIVERED
    ) {
      return { success: true, idempotent: true, status: job.status, professional_job_id: job.id };
    }
    if (currentStatus !== JOB_STATUS.EN_ROUTE) {
      const error = new Error("Job must be en route before confirming arrival");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const destination = resolveDeliveryLocation(context, order);
    const cached = await readProfessionalLocationCache(app, jobRowId);
    const location = validateLocationForGeofence(cached, MAX_ACCURACY_METERS);
    const distanceMeters = haversineMeters(
      location.latitude,
      location.longitude,
      destination.latitude,
      destination.longitude
    );
    if (distanceMeters > PROFESSIONAL_DELIVERY_RADIUS_METERS) {
      const error = new Error("You are too far from the delivery location");
      error.status = 409;
      error.code = "ARRIVAL_TOO_FAR";
      error.distance_meters = distanceMeters;
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.ARRIVED, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.ARRIVED,
    });
    await issueDeliveryOtp(app, job.reference_row_id);
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.ARRIVED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "DELIVERY_ARRIVED",
      metadata: { distance_meters: distanceMeters },
    });

    return {
      success: true,
      status: JOB_STATUS.ARRIVED,
      professional_job_id: job.id,
      distance_meters: distanceMeters,
      delivery_otp_required: true,
    };
  });
}

async function verifyProfessionalJobDeliveryOtp(app, jobRowId, partnerSession, otp) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (
      currentStatus === JOB_STATUS.DELIVERY_VERIFIED ||
      currentStatus === JOB_STATUS.DELIVERED ||
      currentStatus === JOB_STATUS.COMPLETED
    ) {
      return { success: true, idempotent: true, status: job.status };
    }
    if (currentStatus !== JOB_STATUS.ARRIVED) {
      const error = new Error("Arrival must be confirmed before OTP verification");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    await verifyDeliveryOtp(app, job.reference_row_id, otp);
    assertJobTransition(currentStatus, JOB_STATUS.DELIVERY_VERIFIED, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.DELIVERY_VERIFIED,
    });
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.DELIVERY_VERIFIED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "DELIVERY_VERIFIED",
    });

    return { success: true, status: JOB_STATUS.DELIVERY_VERIFIED, professional_job_id: job.id };
  });
}

async function confirmProfessionalJobDelivered(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession);
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.DELIVERED || currentStatus === JOB_STATUS.COMPLETED) {
      return { success: true, idempotent: true, status: job.status, professional_job_id: job.id };
    }
    if (currentStatus !== JOB_STATUS.DELIVERY_VERIFIED) {
      const error = new Error("Delivery must be verified before marking delivered");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const deliveryState = await readDeliveryOtpState(app, job.reference_row_id);
    if (!deliveryState || !deliveryState.verified) {
      const error = new Error("Delivery OTP must be verified");
      error.status = 409;
      error.code = "OTP_NOT_VERIFIED";
      throw error;
    }

    assertJobTransition(currentStatus, JOB_STATUS.DELIVERED, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.DELIVERED,
    });
    if (order) {
      await setOrderStatus(app, order, "DELIVERED", "Order delivered", "PROFESSIONAL");
    }
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.DELIVERED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "DELIVERED",
    });

    return {
      success: true,
      status: JOB_STATUS.DELIVERED,
      professional_job_id: job.id,
      payment_status: order?.payment_status || "",
    };
  });
}

async function completeProfessionalJobDelivery(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession, {
      allowCompleted: true,
    });
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.COMPLETED) {
      const finance = await getProfessionalJobFinanceSummary(app, job.id);
      return {
        success: true,
        idempotent: true,
        status: JOB_STATUS.COMPLETED,
        professional_job_id: job.id,
        grand_total: num(order?.grand_total),
        payment_status: order?.payment_status || "",
        ...finance,
      };
    }
    if (currentStatus !== JOB_STATUS.DELIVERED) {
      const error = new Error("Order must be delivered before completion");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const completedAt = nowSql();
    assertJobTransition(currentStatus, JOB_STATUS.COMPLETED, JOB_TYPES.PRODUCT_DELIVERY);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.COMPLETED,
      completed_at: completedAt,
    });
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.COMPLETED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "DELIVERY_COMPLETED",
    });

    let finance = {};
    try {
      finance = await settleProfessionalJobFinance(app, { job, partner });
    } catch (error) {
      console.error("[professional-finance] product delivery settlement failed", {
        professional_job_row_id: job.id,
        message: error.message,
      });
      finance = { finance_settled: false, finance_error: error.code || "FINANCE_SETTLEMENT_FAILED" };
    }

    return {
      success: true,
      idempotent: false,
      status: JOB_STATUS.COMPLETED,
      professional_job_id: job.id,
      service_completed_at: completedAt,
      grand_total: num(order?.grand_total),
      payment_status: order?.payment_status || "",
      ...finance,
    };
  });
}

async function getProfessionalJobDeliveryExecution(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const { job, context, order } = await assertPartnerOwnsProductJob(zcql, jobRowId, partnerSession, {
    allowCompleted: true,
  });
  const status = normalizeJobStatus(job.status);
  return {
    professional_job_id: job.id,
    job_status: job.status,
    order_number: context?.order_number || "",
    payment_status: order?.payment_status || context?.payment_status || "",
    payment_method: order?.payment_method || context?.payment_method || "",
    amount: context?.amount ?? num(order?.grand_total),
    currency: context?.currency || order?.currency || "INR",
    pickup: context?.pickup || null,
    destination: context?.destination || null,
    can_start_pickup: status === JOB_STATUS.ACCEPTED,
    can_confirm_pickup_arrival: status === JOB_STATUS.GOING_TO_PICKUP,
    can_verify_pickup: status === JOB_STATUS.ARRIVED_PICKUP,
    can_confirm_picked_up: status === JOB_STATUS.PICKUP_VERIFIED,
    can_start_delivery: status === JOB_STATUS.PICKED_UP,
    can_confirm_delivery_arrival: status === JOB_STATUS.EN_ROUTE,
    can_verify_delivery_otp: status === JOB_STATUS.ARRIVED,
    can_confirm_delivered: status === JOB_STATUS.DELIVERY_VERIFIED,
    can_complete_delivery: status === JOB_STATUS.DELIVERED,
    tracking_active: TRACKABLE_PRODUCT_STATUSES.has(status),
    phase:
      status === JOB_STATUS.COMPLETED
        ? "completed"
        : status === JOB_STATUS.EN_ROUTE || status === JOB_STATUS.ARRIVED
          ? "en_route"
          : status === JOB_STATUS.GOING_TO_PICKUP ||
              status === JOB_STATUS.ARRIVED_PICKUP ||
              status === JOB_STATUS.PICKUP_VERIFIED
            ? "pickup"
            : status === JOB_STATUS.PICKED_UP
              ? "picked_up"
              : status === JOB_STATUS.DELIVERED || status === JOB_STATUS.DELIVERY_VERIFIED
                ? "delivered"
                : status.toLowerCase(),
  };
}

module.exports = {
  TRACKABLE_PRODUCT_STATUSES,
  startProfessionalJobPickup,
  getProfessionalJobPickupPreview,
  confirmProfessionalJobPickupArrival,
  verifyProfessionalJobPickup,
  confirmProfessionalJobPickedUp,
  startProfessionalJobDelivery,
  getProfessionalJobDeliveryPreview,
  confirmProfessionalJobDeliveryArrival,
  verifyProfessionalJobDeliveryOtp,
  confirmProfessionalJobDelivered,
  completeProfessionalJobDelivery,
  getProfessionalJobDeliveryExecution,
};
