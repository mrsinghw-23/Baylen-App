"use strict";

const { rowOf, rowsOf, asId, num, sqlString } = require("./http");
const { parseDeliveryPartnerId } = require("./delivery-partner");
const { JOB_STATUS, assertJobTransition, normalizeJobStatus } = require("./professional-job-fsm");

const JOB_TYPES = {
  PRODUCT_DELIVERY: "PRODUCT_DELIVERY",
  HOME_SERVICE: "HOME_SERVICE",
};

const REFERENCE_TYPES = {
  ORDER: "ORDER",
  SERVICE_JOB: "SERVICE_JOB",
};

const PJ_SELECT =
  "ROWID, job_number, job_type, reference_type, reference_row_id, delivery_partner_row_id, outlet_row_id, job_status, job_priority, idempotency_key, assigned_at, accepted_at, offer_expires_at, started_at, completed_at, metadata_json, CREATEDTIME, MODIFIEDTIME";

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function offerTtlMinutes() {
  const configured = num(process.env.PROFESSIONAL_OFFER_TTL_MINUTES);
  return configured > 0 ? configured : 15;
}

function computeOfferExpiresAt(fromDate = new Date()) {
  return nowSql(new Date(fromDate.getTime() + offerTtlMinutes() * 60000));
}

function parseJobMetadata(json) {
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

function rejectedPartnerIdsFromMetadata(metadataJson) {
  const meta = parseJobMetadata(metadataJson);
  const ids = meta.rejected_partner_row_ids;
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.map((id) => String(id)).filter(Boolean);
}

function eligiblePartnerIdsFromMetadata(metadataJson) {
  const meta = parseJobMetadata(metadataJson);
  const ids = meta.eligible_partner_row_ids;
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids.map((id) => String(id)).filter(Boolean);
}

function partnerHasEligibleOffer(metadataJson, partnerRowId) {
  const partnerRef = String(partnerRowId);
  const eligible = eligiblePartnerIdsFromMetadata(metadataJson);
  if (!eligible.includes(partnerRef)) {
    return false;
  }
  return !rejectedPartnerIdsFromMetadata(metadataJson).includes(partnerRef);
}

function normalizeJobType(value) {
  const jobType = String(value || "")
    .trim()
    .toUpperCase();
  if (!Object.values(JOB_TYPES).includes(jobType)) {
    const error = new Error("job_type must be PRODUCT_DELIVERY or HOME_SERVICE");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return jobType;
}

function normalizeReferenceType(value) {
  const refType = String(value || "")
    .trim()
    .toUpperCase();
  if (!Object.values(REFERENCE_TYPES).includes(refType)) {
    const error = new Error("reference_type must be ORDER or SERVICE_JOB");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return refType;
}

function normalizeRowId(value, field) {
  return asId(value, field);
}

function buildProductDeliveryIdempotencyKey(orderRowId) {
  return "product_delivery:order:" + String(orderRowId);
}

function buildHomeServiceIdempotencyKey(serviceJobRowId) {
  return "home_service:service_job:" + String(serviceJobRowId);
}

function nextJobNumber(referenceRowId) {
  const suffix = String(referenceRowId || "").slice(-6).padStart(6, "0");
  return ("PJ" + new Date().getFullYear() + suffix + Date.now().toString().slice(-4)).slice(0, 30);
}

function mapProfessionalJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.ROWID),
    job_number: row.job_number || "",
    job_type: row.job_type || "",
    reference_type: row.reference_type || "",
    reference_row_id: row.reference_row_id != null ? String(row.reference_row_id) : "",
    delivery_partner_row_id:
      row.delivery_partner_row_id != null && row.delivery_partner_row_id !== ""
        ? String(row.delivery_partner_row_id)
        : "",
    outlet_row_id:
      row.outlet_row_id != null && row.outlet_row_id !== "" ? String(row.outlet_row_id) : "",
    status: normalizeJobStatus(row.job_status || row.status),
    priority: num(row.job_priority != null ? row.job_priority : row.priority),
    idempotency_key: row.idempotency_key || "",
    assigned_at: row.assigned_at || "",
    accepted_at: row.accepted_at || "",
    offer_expires_at: row.offer_expires_at || "",
    started_at: row.started_at || "",
    completed_at: row.completed_at || "",
    metadata_json: row.metadata_json || "",
    created_at: row.CREATEDTIME || "",
    updated_at: row.MODIFIEDTIME || "",
  };
}

async function findJobByIdempotencyKey(zcql, idempotencyKey) {
  if (!idempotencyKey) {
    return null;
  }
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " +
        PJ_SELECT +
        " FROM Professional_Jobs WHERE idempotency_key = " +
        sqlString(idempotencyKey) +
        " LIMIT 1"
    ),
    "Professional_Jobs"
  );
  return mapProfessionalJob(row);
}

async function findJobByRowId(zcql, jobRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + PJ_SELECT + " FROM Professional_Jobs WHERE ROWID = " + normalizeRowId(jobRowId, "professional_job_id")
    ),
    "Professional_Jobs"
  );
  return mapProfessionalJob(row);
}

async function appendStatusHistory(app, {
  professionalJobRowId,
  oldStatus,
  newStatus,
  actorId,
  actorRole,
  reason,
  metadata,
}) {
  await app.datastore().table("Job_Status_History").insertRow({
    professional_job_row_id: professionalJobRowId,
    old_status: oldStatus || null,
    new_status: newStatus,
    actor_id: actorId ? String(actorId).slice(0, 40) : null,
    actor_role: actorRole ? String(actorRole).slice(0, 20) : null,
    reason: reason ? String(reason).slice(0, 255) : null,
    metadata_json: metadata ? JSON.stringify(metadata).slice(0, 512) : null,
    happened_at: nowSql(),
  });
}

async function resolveOrderReference(zcql, orderRowId, { userId } = {}) {
  const rowId = normalizeRowId(orderRowId, "order_id");
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, order_number, status, payment_status, payment_method, fulfillment_mode, fulfillment_store_id, parent_order_id FROM Orders WHERE ROWID = " +
        rowId
    ),
    "Orders"
  );
  if (!row) {
    const error = new Error("Order reference not found");
    error.status = 404;
    error.code = "REFERENCE_NOT_FOUND";
    throw error;
  }
  if (userId && String(row.user_id) !== String(userId)) {
    const error = new Error("Order reference not found");
    error.status = 404;
    error.code = "REFERENCE_NOT_FOUND";
    throw error;
  }
  if (String(row.status || "").toUpperCase() === "CANCELLED") {
    const error = new Error("Cancelled orders cannot create professional jobs");
    error.status = 409;
    error.code = "INVALID_REFERENCE_STATE";
    throw error;
  }
  const children = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Orders WHERE parent_order_id = " + rowId + " LIMIT 1"
    ),
    "Orders"
  );
  if (children.length) {
    const error = new Error("Split parent orders must use child order references");
    error.status = 422;
    error.code = "INVALID_REFERENCE_STATE";
    throw error;
  }
  const paymentStatus = String(row.payment_status || "").toUpperCase();
  const paymentMethod = String(row.payment_method || "").toUpperCase();
  const paidOnline = paymentStatus === "PAID";
  const codEligible = paymentMethod === "COD" && paymentStatus !== "FAILED";
  if (!paidOnline && !codEligible) {
    const error = new Error("Order is not eligible for product delivery job creation");
    error.status = 409;
    error.code = "INVALID_REFERENCE_STATE";
    throw error;
  }
  return {
    reference_type: REFERENCE_TYPES.ORDER,
    reference_row_id: String(row.ROWID),
    outlet_row_id: row.fulfillment_store_id ? String(row.fulfillment_store_id) : "",
    metadata: {
      order_number: row.order_number || "",
      order_status: row.status || "",
      payment_status: row.payment_status || "",
      payment_method: row.payment_method || "",
      fulfillment_mode: row.fulfillment_mode || "",
      parent_order_id: row.parent_order_id != null ? String(row.parent_order_id) : "",
    },
  };
}

async function resolveServiceJobReference(zcql, serviceJobRowId, { userId } = {}) {
  const rowId = normalizeRowId(serviceJobRowId, "service_job_id");
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, booking_number, status, payment_status, outlet_id, outlet_row_id, delivery_partner_row_id FROM Service_Jobs WHERE ROWID = " +
        rowId
    ),
    "Service_Jobs"
  );
  if (!row) {
    const error = new Error("Service job reference not found");
    error.status = 404;
    error.code = "REFERENCE_NOT_FOUND";
    throw error;
  }
  if (userId && String(row.user_id) !== String(userId)) {
    const error = new Error("Service job reference not found");
    error.status = 404;
    error.code = "REFERENCE_NOT_FOUND";
    throw error;
  }
  if (String(row.status || "").toUpperCase() === "CANCELLED") {
    const error = new Error("Cancelled service jobs cannot create professional jobs");
    error.status = 409;
    error.code = "INVALID_REFERENCE_STATE";
    throw error;
  }
  const serviceStatus = String(row.status || "").toUpperCase();
  const eligibleHomeService = new Set([
    "CONFIRMED",
    "ASSIGNED",
    "ACCEPTED",
    "EN_ROUTE",
    "ARRIVED",
    "STARTED",
    "COMPLETED",
  ]);
  if (!eligibleHomeService.has(serviceStatus)) {
    const error = new Error("Service job must be confirmed before creating a professional job");
    error.status = 409;
    error.code = "INVALID_REFERENCE_STATE";
    throw error;
  }
  const outletRowId =
    row.outlet_row_id != null && row.outlet_row_id !== ""
      ? String(row.outlet_row_id)
      : row.outlet_id != null && row.outlet_id !== ""
        ? String(row.outlet_id)
        : "";
  return {
    reference_type: REFERENCE_TYPES.SERVICE_JOB,
    reference_row_id: String(row.ROWID),
    outlet_row_id: outletRowId,
    delivery_partner_row_id:
      row.delivery_partner_row_id != null && row.delivery_partner_row_id !== ""
        ? String(row.delivery_partner_row_id)
        : "",
    metadata: {
      booking_number: row.booking_number || "",
      service_job_status: row.status || "",
      payment_status: row.payment_status || "",
    },
  };
}

async function resolveReference(zcql, jobType, referenceRowId, options = {}) {
  const normalizedType = normalizeJobType(jobType);
  if (normalizedType === JOB_TYPES.PRODUCT_DELIVERY) {
    return resolveOrderReference(zcql, referenceRowId, options);
  }
  return resolveServiceJobReference(zcql, referenceRowId, options);
}

async function linkReferenceJob(app, referenceType, referenceRowId, professionalJobRowId) {
  if (referenceType !== REFERENCE_TYPES.ORDER) {
    return;
  }
  try {
    await app.datastore().table("Orders").updateRow({
      ROWID: referenceRowId,
      professional_job_row_id: professionalJobRowId,
    });
  } catch (_) {}
}

async function transitionProfessionalJob(
  app,
  jobRowId,
  nextStatus,
  { actorId = "system", actorRole = "system", reason = "", metadata = null } = {}
) {
  const zcql = app.zcql();
  const current = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, job_status, job_type FROM Professional_Jobs WHERE ROWID = " +
        normalizeRowId(jobRowId, "professional_job_id")
    ),
    "Professional_Jobs"
  );
  if (!current) {
    const error = new Error("Professional job not found");
    error.status = 404;
    throw error;
  }
  const fromStatus = normalizeJobStatus(current.job_status || current.status);
  const toStatus = normalizeJobStatus(nextStatus);
  if (fromStatus === toStatus) {
    return findJobByRowId(zcql, current.ROWID);
  }
  assertJobTransition(fromStatus, toStatus, current.job_type || JOB_TYPES.HOME_SERVICE);
  await app.datastore().table("Professional_Jobs").updateRow({
    ROWID: current.ROWID,
    job_status: toStatus,
  });
  await appendStatusHistory(app, {
    professionalJobRowId: current.ROWID,
    oldStatus: fromStatus,
    newStatus: toStatus,
    actorId,
    actorRole,
    reason,
    metadata,
  });
  return findJobByRowId(zcql, current.ROWID);
}

async function createProfessionalJob(
  app,
  {
    jobType,
    referenceRowId,
    idempotencyKey,
    actorId = "system",
    actorRole = "system",
    userId,
    deliveryPartnerRowId,
    outletRowId,
    metadata = null,
  }
) {
  const zcql = app.zcql();
  const normalizedType = normalizeJobType(jobType);
  const key = String(idempotencyKey || "").trim();
  if (!key) {
    const error = new Error("idempotency_key is required");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  const existing = await findJobByIdempotencyKey(zcql, key);
  if (existing) {
    return { job: existing, created: false, idempotent: true };
  }

  const resolved = await resolveReference(zcql, normalizedType, referenceRowId, { userId });
  const partnerRowId = deliveryPartnerRowId || resolved.delivery_partner_row_id || null;
  const outletRef = outletRowId || resolved.outlet_row_id || null;
  const mergedMetadata = Object.assign({}, resolved.metadata || {}, metadata || {});

  const inserted = await app.datastore().table("Professional_Jobs").insertRow({
    job_number: nextJobNumber(resolved.reference_row_id),
    job_type: normalizedType,
    reference_type: resolved.reference_type,
    reference_row_id: resolved.reference_row_id,
    delivery_partner_row_id: partnerRowId,
    outlet_row_id: outletRef,
    job_status: JOB_STATUS.CREATED,
    job_priority: 0,
    idempotency_key: key,
    metadata_json: Object.keys(mergedMetadata).length
      ? JSON.stringify(mergedMetadata).slice(0, 512)
      : null,
  });

  const jobRowId =
    inserted && inserted.ROWID
      ? String(inserted.ROWID)
      : inserted &&
          typeof inserted === "object" &&
          inserted.Professional_Jobs &&
          inserted.Professional_Jobs.ROWID
        ? String(inserted.Professional_Jobs.ROWID)
        : "";

  if (!jobRowId) {
    const raced = await findJobByIdempotencyKey(zcql, key);
    if (raced) {
      return { job: raced, created: false, idempotent: true };
    }
    const error = new Error("Could not create professional job");
    error.status = 500;
    throw error;
  }

  await appendStatusHistory(app, {
    professionalJobRowId: jobRowId,
    oldStatus: "",
    newStatus: JOB_STATUS.CREATED,
    actorId,
    actorRole,
    reason: "Professional job created",
    metadata: mergedMetadata,
  });

  const pending = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.ASSIGNMENT_PENDING, {
    actorId,
    actorRole,
    reason: "Awaiting partner assignment",
    metadata: mergedMetadata,
  });

  await linkReferenceJob(app, resolved.reference_type, resolved.reference_row_id, jobRowId);

  setImmediate(() => {
    try {
      const { tryDispatchAfterCreation } = require("./professional-dispatch-engine");
      tryDispatchAfterCreation(app, jobRowId).catch(() => {});
    } catch (_) {}
  });

  return { job: pending, created: true, idempotent: false };
}

async function ensureProductDeliveryJob(
  app,
  orderRowId,
  { actorId = "system", actorRole = "system", userId } = {}
) {
  const rowId = normalizeRowId(orderRowId, "order_id");
  return createProfessionalJob(app, {
    jobType: JOB_TYPES.PRODUCT_DELIVERY,
    referenceRowId: rowId,
    idempotencyKey: buildProductDeliveryIdempotencyKey(rowId),
    actorId,
    actorRole,
    userId,
  });
}

async function ensureHomeServiceJob(
  app,
  serviceJobRowId,
  { actorId = "system", actorRole = "system", userId } = {}
) {
  const rowId = normalizeRowId(serviceJobRowId, "service_job_id");
  return createProfessionalJob(app, {
    jobType: JOB_TYPES.HOME_SERVICE,
    referenceRowId: rowId,
    idempotencyKey: buildHomeServiceIdempotencyKey(rowId),
    actorId,
    actorRole,
    userId,
  });
}

function resolveCheckoutOrderTargets({ createdOrderIds, masterOrderId, planMode }) {
  const ids = (createdOrderIds || []).map((id) => String(id));
  if (String(planMode || "").toUpperCase() === "SPLIT" && masterOrderId) {
    return ids.filter((id) => id !== String(masterOrderId));
  }
  return ids;
}

async function ensureProductDeliveryJobsForCheckout(
  app,
  { createdOrderIds, masterOrderId, planMode, actorId, actorRole, userId }
) {
  const targets = resolveCheckoutOrderTargets({ createdOrderIds, masterOrderId, planMode });
  const results = [];
  for (const orderId of targets) {
    try {
      const result = await ensureProductDeliveryJob(app, orderId, {
        actorId,
        actorRole,
        userId,
      });
      results.push({ order_id: orderId, ...result });
    } catch (error) {
      console.error("[professional-jobs] checkout hook failed", orderId, error.message);
    }
  }
  return results;
}

async function ensureProductDeliveryJobsForPaidOrder(
  app,
  orderRowId,
  { actorId = "system", actorRole = "system", userId } = {}
) {
  const zcql = app.zcql();
  const rowId = normalizeRowId(orderRowId, "order_id");
  let children = [];
  try {
    children = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Orders WHERE parent_order_id = " + rowId
      ),
      "Orders"
    );
  } catch (_) {
    children = [];
  }
  const targets = children.length
    ? children.map((row) => String(row.ROWID))
    : [String(rowId)];
  const results = [];
  for (const targetId of targets) {
    try {
      const result = await ensureProductDeliveryJob(app, targetId, {
        actorId,
        actorRole,
        userId,
      });
      results.push({ order_id: targetId, ...result });
    } catch (error) {
      console.error("[professional-jobs] paid order hook failed", targetId, error.message);
    }
  }
  return results;
}

async function loadPartnerOutletRowId(zcql, deliveryPartnerId) {
  const partnerRowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!partnerRowId) {
    return "";
  }
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, outlet_id, outlet_row_id FROM Delivery_Partners WHERE ROWID = " + partnerRowId
    ),
    "Delivery_Partners"
  );
  if (!row) {
    return "";
  }
  if (row.outlet_row_id != null && row.outlet_row_id !== "") {
    return String(row.outlet_row_id);
  }
  if (row.outlet_id != null && row.outlet_id !== "") {
    return String(row.outlet_id);
  }
  return "";
}

module.exports = {
  JOB_TYPES,
  REFERENCE_TYPES,
  PJ_SELECT,
  JOB_STATUS,
  normalizeJobType,
  normalizeReferenceType,
  buildProductDeliveryIdempotencyKey,
  buildHomeServiceIdempotencyKey,
  mapProfessionalJob,
  findJobByIdempotencyKey,
  findJobByRowId,
  resolveOrderReference,
  resolveServiceJobReference,
  resolveReference,
  createProfessionalJob,
  transitionProfessionalJob,
  ensureProductDeliveryJob,
  ensureHomeServiceJob,
  ensureProductDeliveryJobsForCheckout,
  ensureProductDeliveryJobsForPaidOrder,
  resolveCheckoutOrderTargets,
  loadPartnerOutletRowId,
  appendStatusHistory,
  offerTtlMinutes,
  computeOfferExpiresAt,
  parseJobMetadata,
  rejectedPartnerIdsFromMetadata,
  eligiblePartnerIdsFromMetadata,
  partnerHasEligibleOffer,
};
