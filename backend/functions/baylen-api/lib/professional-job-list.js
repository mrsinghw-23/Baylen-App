"use strict";

const { rowsOf, rowOf, asId, num } = require("./http");
const { parseDeliveryPartnerId } = require("./delivery-partner");
const {
  PJ_SELECT,
  mapProfessionalJob,
  findJobByRowId,
  JOB_TYPES,
} = require("./professional-job-engine");
const { JOB_STATUS } = require("./professional-job-fsm");
const {
  loadJobDispatchContext,
} = require("./professional-dispatch-engine");
const { buildOfferCapabilities, isOfferExpired } = require("./professional-job-offer-engine");
const {
  getProfessionalJobExecution,
  computeProgressPercent,
  ensureExecutionState,
} = require("./professional-execution-engine");
const { partnerHasEligibleOffer, parseJobMetadata } = require("./professional-job-engine");

function parseView(value) {
  const view = String(value || "offered").trim().toLowerCase();
  if (view === "active" || view === "completed" || view === "offered" || view === "cancelled") {
    return view;
  }
  const error = new Error("view must be offered, active, completed, or cancelled");
  error.status = 400;
  error.code = "VALIDATION_ERROR";
  throw error;
}

function parseJobTypeFilter(value) {
  if (!value) {
    return "";
  }
  const type = String(value).trim().toUpperCase();
  if (type === "PRODUCT_DELIVERY" || type === "HOME_SERVICE") {
    return type;
  }
  const error = new Error("job_type must be PRODUCT_DELIVERY or HOME_SERVICE");
  error.status = 400;
  throw error;
}

function buildPartnerJobsQuery(partnerRowId, view, jobType) {
  let query =
    "SELECT " +
    PJ_SELECT +
    " FROM Professional_Jobs WHERE delivery_partner_row_id = " +
    asId(partnerRowId, "partner_id");

  if (view === "offered") {
    query += " AND job_status = 'ASSIGNED'";
  } else if (view === "active") {
    query +=
      " AND job_status IN ('ACCEPTED','GOING_TO_PICKUP','ARRIVED_PICKUP','PICKUP_VERIFIED','PICKED_UP','EN_ROUTE','ARRIVED','DELIVERY_VERIFIED','DELIVERED','OTP_VERIFIED','STARTED','IN_PROGRESS')";
  } else if (view === "completed") {
    query += " AND job_status IN ('COMPLETED','DELIVERED')";
  } else if (view === "cancelled") {
    query += " AND job_status IN ('CANCELLED','REASSIGNMENT_REQUIRED')";
  }

  if (jobType) {
    query += " AND job_type = '" + jobType + "'";
  }

  query += " ORDER BY CREATEDTIME DESC LIMIT 100";
  return query;
}

function mapListItem(job, context, route) {
  const isDelivery = job.job_type === JOB_TYPES.PRODUCT_DELIVERY;
  return {
    professional_job_id: job.id,
    job_number: job.job_number,
    job_type: job.job_type,
    job_status: job.status,
    priority: job.priority,
    reference_type: job.reference_type,
    reference_row_id: job.reference_row_id,
    outlet_row_id: job.outlet_row_id || context?.outlet_row_id || "",
    title: isDelivery
      ? "Product delivery · " + (context?.order_number || job.job_number)
      : context?.service_name || "Home service",
    subtitle: isDelivery
      ? context?.drop_address || ""
      : [context?.booking_number, context?.visit_city].filter(Boolean).join(" · "),
    amount: context?.amount ?? 0,
    currency: context?.currency || "INR",
    customer_name: context?.customer_name || "Customer",
    customer_phone_masked: context?.customer_phone_masked || "",
    pickup_title: context?.pickup_title || "",
    pickup_address: context?.pickup_address || "",
    drop_title: context?.drop_title || "",
    drop_address: context?.drop_address || "",
    scheduled_at: context?.scheduled_at || "",
    duration_minutes: context?.duration_minutes || null,
    distance_km: route?.distance_km ?? null,
    eta_minutes: route?.eta_minutes ?? null,
    routing_source: route?.routing_source || null,
    destination_latitude: context?.destination?.latitude ?? null,
    destination_longitude: context?.destination?.longitude ?? null,
    pickup_latitude: context?.pickup?.latitude ?? null,
    pickup_longitude: context?.pickup?.longitude ?? null,
    created_at: job.created_at,
    assigned_at: job.assigned_at || "",
    expires_at: job.offer_expires_at || "",
    offer_expired: isOfferExpired(job),
    metadata: job.metadata_json ? tryParseJson(job.metadata_json) : {},
  };
}

function mapDetail(job, context, route, items, checklist, partnerRowId) {
  const list = mapListItem(job, context, route);
  const capabilities = partnerRowId ? buildOfferCapabilities(job, partnerRowId) : {};
  return {
    ...list,
    ...capabilities,
    notes: "",
    items: items || [],
    checklist: checklist || [],
    phase: capabilities.service_completed
      ? "completed"
      : capabilities.service_in_progress && job.job_type === JOB_TYPES.PRODUCT_DELIVERY
        ? capabilities.tracking_active
          ? "en_route"
          : job.status === JOB_STATUS.GOING_TO_PICKUP ||
                job.status === JOB_STATUS.ARRIVED_PICKUP ||
                job.status === JOB_STATUS.PICKUP_VERIFIED
              ? "pickup"
              : job.status === JOB_STATUS.PICKED_UP
                ? "picked_up"
                : job.status === JOB_STATUS.DELIVERED || job.status === JOB_STATUS.DELIVERY_VERIFIED
                  ? "delivered"
                  : "accepted"
        : capabilities.service_in_progress
          ? "in_progress"
          : capabilities.tracking_active
            ? "en_route"
            : job.status === JOB_STATUS.ARRIVED
              ? "arrived"
              : job.status === JOB_STATUS.OTP_VERIFIED
                ? "otp_verified"
                : capabilities.accepted
                  ? "accepted"
                  : capabilities.can_accept
                    ? "offered"
                    : job.status.toLowerCase(),
  };
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

async function enrichJobContext(zcql, job) {
  return loadJobDispatchContext(zcql, job);
}

async function listOfferedJobsForPartner(zcql, partnerRowId, jobType) {
  const partnerRef = String(partnerRowId);
  const assignedRows = rowsOf(
    await zcql.executeZCQLQuery(buildPartnerJobsQuery(partnerRowId, "offered", jobType)),
    "Professional_Jobs"
  );

  let pendingQuery =
    "SELECT " +
    PJ_SELECT +
    " FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING'";
  if (jobType) {
    pendingQuery += " AND job_type = '" + jobType + "'";
  }
  pendingQuery += " ORDER BY CREATEDTIME DESC LIMIT 100";
  const pendingRows = rowsOf(await zcql.executeZCQLQuery(pendingQuery), "Professional_Jobs");
  const pendingEligible = pendingRows.filter((row) =>
    partnerHasEligibleOffer(row.metadata_json, partnerRef)
  );

  const seen = new Set();
  const merged = [];
  for (const row of [...assignedRows, ...pendingEligible]) {
    const id = String(row.ROWID);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(row);
  }

  const jobs = [];
  for (const row of merged) {
    const job = mapProfessionalJob(row);
    const context = await enrichJobContext(zcql, job);
    let route = null;
    if (context?.destination && context?.pickup) {
      const { buildRouteSummary } = require("./geo-routing");
      route = buildRouteSummary(
        context.pickup.latitude,
        context.pickup.longitude,
        context.destination.latitude,
        context.destination.longitude
      );
    }
    const capabilities = buildOfferCapabilities(job, partnerRef);
    jobs.push({
      ...mapListItem(job, context, route),
      ...capabilities,
      phase: capabilities.can_accept ? "offered" : job.status.toLowerCase(),
    });
  }
  return {
    view: "offered",
    job_type: jobType || null,
    jobs,
    total: jobs.length,
  };
}

async function listPartnerJobs(zcql, partnerRowId, { view, jobType } = {}) {
  const normalizedView = parseView(view);
  const normalizedType = parseJobTypeFilter(jobType);
  if (normalizedView === "offered") {
    return listOfferedJobsForPartner(zcql, partnerRowId, normalizedType);
  }
  const rows = rowsOf(
    await zcql.executeZCQLQuery(buildPartnerJobsQuery(partnerRowId, normalizedView, normalizedType)),
    "Professional_Jobs"
  );
  const jobs = [];
  for (const row of rows) {
    const job = mapProfessionalJob(row);
    const context = await enrichJobContext(zcql, job);
    let route = null;
    if (context?.destination && context?.pickup) {
      const { buildRouteSummary } = require("./geo-routing");
      route = buildRouteSummary(
        context.pickup.latitude,
        context.pickup.longitude,
        context.destination.latitude,
        context.destination.longitude
      );
    }
    jobs.push(mapListItem(job, context, route));
  }
  return {
    view: normalizedView,
    job_type: normalizedType || null,
    jobs,
    total: jobs.length,
  };
}

async function getPartnerJobDetail(zcql, partnerRowId, jobRowId, app = null) {
  const job = await findJobByRowId(zcql, jobRowId);
  if (!job) {
    const error = new Error("Professional job not found");
    error.status = 404;
    throw error;
  }
  if (
    String(job.delivery_partner_row_id) !== String(partnerRowId) &&
    !(
      job.status === JOB_STATUS.ASSIGNMENT_PENDING &&
      partnerHasEligibleOffer(job.metadata_json, partnerRowId)
    )
  ) {
    const error = new Error("Professional job not found");
    error.status = 404;
    throw error;
  }
  const context = await enrichJobContext(zcql, job);
  let route = null;
  if (context?.destination && context?.pickup) {
    const { buildRouteSummary } = require("./geo-routing");
    route = buildRouteSummary(
      context.pickup.latitude,
      context.pickup.longitude,
      context.destination.latitude,
      context.destination.longitude
    );
  }
  let items = [];
  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY) {
    const orderItems = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT product_name, quantity FROM Order_Items WHERE order_id = " + asId(job.reference_row_id, "order_id")
      ),
      "Order_Items"
    );
    items = orderItems.map((row) => ({
      name: row.product_name || "Item",
      quantity: num(row.quantity) || 1,
    }));
  } else if (context?.items) {
    items = context.items.map((row) => ({
      name: row.service_name || "Service",
      quantity: num(row.quantity) || 1,
    }));
  }
  let checklist = [];
  let progressPercent = 0;
  let serviceStartedAt = job.started_at || "";
  if (app && job.job_type === JOB_TYPES.HOME_SERVICE) {
    try {
      const state = await ensureExecutionState(app, job, context);
      checklist = (state.checklist || []).map((item) => ({
        id: item.id,
        label: item.label,
        done: item.done === true,
        mandatory: item.mandatory === true,
        completed_at: item.completed_at || "",
      }));
      progressPercent = computeProgressPercent(state.checklist);
      serviceStartedAt = job.started_at || state.service_started_at || "";
    } catch (_) {}
  }
  const detail = mapDetail(job, context, route, items, checklist, partnerRowId);
  return {
    ...detail,
    progress_percent: progressPercent,
    service_started_at: serviceStartedAt,
    duration_minutes: context?.duration_minutes || detail.duration_minutes || null,
  };
}

async function countQuery(zcql, partnerRowId, extra) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT COUNT(ROWID) AS total FROM Professional_Jobs WHERE delivery_partner_row_id = " +
          asId(partnerRowId, "partner_id") +
          extra
      ),
      "Professional_Jobs"
    );
    return num(row && (row.total ?? row["COUNT(ROWID)"]));
  } catch (_) {
    return 0;
  }
}

async function countPendingEligibleOffers(zcql, partnerRowId, jobType) {
  const partnerRef = String(partnerRowId);
  let query =
    "SELECT ROWID, metadata_json FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING'";
  if (jobType) {
    query += " AND job_type = '" + jobType + "'";
  }
  query += " LIMIT 100";
  try {
    const rows = rowsOf(await zcql.executeZCQLQuery(query), "Professional_Jobs");
    return rows.filter((row) => partnerHasEligibleOffer(row.metadata_json, partnerRef)).length;
  } catch (_) {
    return 0;
  }
}

async function countPartnerJobsByStatus(zcql, partnerRowId) {
  const counts = {
    offered: 0,
    assigned: 0,
    active: 0,
    completed: 0,
    cancelled: 0,
    home_service_active: 0,
    home_service_completed: 0,
    home_service_cancelled: 0,
    delivery_offered: 0,
    delivery_active: 0,
    delivery_completed: 0,
    home_service_offered: 0,
  };
  const activeFilter =
    " AND job_status IN ('ACCEPTED','GOING_TO_PICKUP','ARRIVED_PICKUP','PICKUP_VERIFIED','PICKED_UP','EN_ROUTE','ARRIVED','DELIVERY_VERIFIED','DELIVERED','OTP_VERIFIED','STARTED','IN_PROGRESS')";
  counts.home_service_offered =
    (await countQuery(
      zcql,
      partnerRowId,
      " AND job_status = 'ASSIGNED' AND job_type = 'HOME_SERVICE'"
    )) + (await countPendingEligibleOffers(zcql, partnerRowId, "HOME_SERVICE"));
  counts.delivery_offered =
    (await countQuery(
      zcql,
      partnerRowId,
      " AND job_status = 'ASSIGNED' AND job_type = 'PRODUCT_DELIVERY'"
    )) + (await countPendingEligibleOffers(zcql, partnerRowId, "PRODUCT_DELIVERY"));
  counts.offered = counts.delivery_offered + counts.home_service_offered;
  counts.assigned = counts.offered;
  counts.active = await countQuery(zcql, partnerRowId, activeFilter);
  counts.completed = await countQuery(zcql, partnerRowId, " AND job_status IN ('COMPLETED','DELIVERED')");
  counts.cancelled = await countQuery(zcql, partnerRowId, " AND job_status IN ('CANCELLED','REASSIGNMENT_REQUIRED')");
  counts.delivery_active = await countQuery(zcql, partnerRowId, activeFilter + " AND job_type = 'PRODUCT_DELIVERY'");
  counts.delivery_completed = await countQuery(
    zcql,
    partnerRowId,
    " AND job_status IN ('COMPLETED','DELIVERED') AND job_type = 'PRODUCT_DELIVERY'"
  );
  counts.home_service_active = await countQuery(zcql, partnerRowId, activeFilter + " AND job_type = 'HOME_SERVICE'");
  counts.home_service_completed = await countQuery(
    zcql,
    partnerRowId,
    " AND job_status IN ('COMPLETED','DELIVERED') AND job_type = 'HOME_SERVICE'"
  );
  counts.home_service_cancelled = await countQuery(
    zcql,
    partnerRowId,
    " AND job_status IN ('CANCELLED','REASSIGNMENT_REQUIRED') AND job_type = 'HOME_SERVICE'"
  );
  return counts;
}

function partnerRowIdFromSession(partner) {
  return parseDeliveryPartnerId(partner.delivery_partner_id);
}

module.exports = {
  parseView,
  parseJobTypeFilter,
  buildPartnerJobsQuery,
  listPartnerJobs,
  getPartnerJobDetail,
  countPartnerJobsByStatus,
  partnerRowIdFromSession,
  mapListItem,
};
