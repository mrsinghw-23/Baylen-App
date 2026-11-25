"use strict";

const { rowOf, rowsOf, asId, optionalText } = require("./http");
const { JOB_STATUS, normalizeJobStatus } = require("./professional-job-fsm");
const {
  findJobByRowId,
  transitionProfessionalJob,
  appendStatusHistory,
  JOB_TYPES,
  REFERENCE_TYPES,
} = require("./professional-job-engine");
const { loadPartnerBySession } = require("./professional-job-offer-engine");
const {
  assertPartnerJobMutationAccess,
  assertPartnerExecutionAllowed,
} = require("./professional-partner-guard");
const { dispatchProfessionalJob } = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const { emitProfessionalLifecycleEvent } = require("./professional-partner-notify");
const {
  NO_SHOW_WAIT_MINUTES,
  PARTNER_CANCEL_REASONS,
  SUPPORT_CATEGORIES,
  PARTNER_CANCEL_HOME_STATUSES,
  PARTNER_CANCEL_PRODUCT_STATUSES,
  TERMINAL_PROFESSIONAL_STATUSES,
} = require("./professional-lifecycle-config");

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function nextTicketNumber(partnerRowId) {
  const suffix = String(partnerRowId || "").slice(-6).padStart(6, "0");
  return ("PS" + new Date().getFullYear() + suffix + Date.now().toString().slice(-4)).slice(0, 30);
}

function normalizeCancelReason(value) {
  const code = String(value || "OTHER")
    .trim()
    .toUpperCase();
  return PARTNER_CANCEL_REASONS.has(code) ? code : "OTHER";
}

function normalizeSupportCategory(value) {
  const code = String(value || "OTHER")
    .trim()
    .toUpperCase();
  return SUPPORT_CATEGORIES.has(code) ? code : "OTHER";
}

function partnerCancelAllowedStatuses(job) {
  return job.job_type === JOB_TYPES.PRODUCT_DELIVERY
    ? PARTNER_CANCEL_PRODUCT_STATUSES
    : PARTNER_CANCEL_HOME_STATUSES;
}

async function assertPartnerOwnsJob(job, partner) {
  assertPartnerJobMutationAccess(job, partner);
}

async function findJobByReference(zcql, referenceType, referenceRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, job_number, job_type, reference_type, reference_row_id, delivery_partner_row_id, outlet_row_id, job_status, job_priority, idempotency_key, assigned_at, accepted_at, offer_expires_at, started_at, completed_at, metadata_json FROM Professional_Jobs WHERE reference_type = " +
        sqlString(String(referenceType).toUpperCase()) +
        " AND reference_row_id = " +
        asId(referenceRowId, "reference_id") +
        " ORDER BY CREATEDTIME DESC LIMIT 1"
    ),
    "Professional_Jobs"
  );
  return findJobByRowId(zcql, row?.ROWID);
}

function sqlString(value) {
  return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}

async function loadPartnerPhone(zcql, partnerRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT phone FROM Delivery_Partners WHERE ROWID = " + asId(partnerRowId, "partner_id")
    ),
    "Delivery_Partners"
  );
  return row?.phone || "";
}

async function loadServiceJobContext(zcql, serviceJobRowId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, status, provider_id, booking_number FROM Service_Jobs WHERE ROWID = " +
        asId(serviceJobRowId, "service_job_id")
    ),
    "Service_Jobs"
  );
}

async function loadOrderContext(zcql, orderRowId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, status, order_number FROM Orders WHERE ROWID = " +
        asId(orderRowId, "order_id")
    ),
    "Orders"
  );
}

async function syncReferenceCancelled(app, job, reason) {
  if (job.reference_type === REFERENCE_TYPES.SERVICE_JOB) {
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: job.reference_row_id,
      status: "CANCELLED",
    });
    await app.datastore().table("Job_Timeline").insertRow({
      job_id: job.reference_row_id,
      status: "CANCELLED",
      note: reason || "Professional job cancelled",
      happened_at: nowSql(),
    });
    return;
  }
  if (job.reference_type === REFERENCE_TYPES.ORDER) {
    try {
      await app.datastore().table("Orders").updateRow({
        ROWID: job.reference_row_id,
        status: "CANCELLED",
      });
    } catch (_) {}
  }
}

async function syncReferenceNoShow(app, serviceJobRowId, note) {
  await app.datastore().table("Service_Jobs").updateRow({
    ROWID: serviceJobRowId,
    status: "NO_SHOW",
  });
  await app.datastore().table("Job_Timeline").insertRow({
    job_id: serviceJobRowId,
    status: "NO_SHOW",
    note: note || "Customer no-show",
    happened_at: nowSql(),
  });
}

async function getArrivedAtFromHistory(zcql, jobRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT happened_at FROM Job_Status_History WHERE professional_job_row_id = " +
        asId(jobRowId, "professional_job_id") +
        " AND new_status = 'ARRIVED' ORDER BY happened_at DESC LIMIT 1"
    ),
    "Job_Status_History"
  );
  return row?.happened_at || "";
}

function parseSqlTimestamp(value) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  const local = new Date(text);
  if (!Number.isNaN(local.getTime())) {
    return local;
  }
  const ist = new Date(text + "+05:30");
  return Number.isNaN(ist.getTime()) ? null : ist;
}

async function getNoShowEligibility(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerExecutionAllowed(partner);
  const job = await findJobByRowId(zcql, jobRowId);
  await assertPartnerOwnsJob(job, partner);
  if (job.job_type !== JOB_TYPES.HOME_SERVICE) {
    return { eligible: false, reason: "NO_SHOW_HOME_ONLY" };
  }
  const status = normalizeJobStatus(job.status);
  if (status !== JOB_STATUS.ARRIVED) {
    return { eligible: false, reason: "JOB_NOT_ARRIVED", status };
  }
  const arrivedAt = await getArrivedAtFromHistory(zcql, jobRowId);
  let arrivedDate = parseSqlTimestamp(arrivedAt);
  if (!arrivedDate && NO_SHOW_WAIT_MINUTES <= 0) {
    arrivedDate = new Date(Date.now() - 1000);
  }
  if (!arrivedDate) {
    return { eligible: false, reason: "ARRIVAL_TIME_UNKNOWN", status };
  }
  const waitMs = NO_SHOW_WAIT_MINUTES * 60 * 1000;
  const eligibleAt = new Date(arrivedDate.getTime() + waitMs);
  const now = new Date();
  const remainingSeconds = Math.max(0, Math.ceil((eligibleAt.getTime() - now.getTime()) / 1000));
  return {
    eligible: remainingSeconds === 0,
    status,
    arrived_at: arrivedAt,
    wait_minutes: NO_SHOW_WAIT_MINUTES,
    remaining_seconds: remainingSeconds,
    eligible_at: eligibleAt.toISOString(),
  };
}

async function cancelProfessionalJob(app, jobRowId, {
  actorId,
  actorRole,
  reason,
  reasonCode,
  req = null,
  syncReference = true,
}) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const job = await findJobByRowId(zcql, jobRowId);
    if (!job) {
      const error = new Error("Professional job not found");
      error.status = 404;
      throw error;
    }
    const status = normalizeJobStatus(job.status);
    if (TERMINAL_PROFESSIONAL_STATUSES.has(status)) {
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        status,
      };
    }

    const partnerRowId = job.delivery_partner_row_id;
    const partnerPhone = partnerRowId ? await loadPartnerPhone(zcql, partnerRowId) : "";
    let customerUserId = "";
    let serviceJobId = "";

    if (job.reference_type === REFERENCE_TYPES.SERVICE_JOB) {
      const serviceJob = await loadServiceJobContext(zcql, job.reference_row_id);
      customerUserId = serviceJob?.user_id ? String(serviceJob.user_id) : "";
      serviceJobId = job.reference_row_id;
    } else if (job.reference_type === REFERENCE_TYPES.ORDER) {
      const order = await loadOrderContext(zcql, job.reference_row_id);
      customerUserId = order?.user_id ? String(order.user_id) : "";
    }

    const updated = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.CANCELLED, {
      actorId,
      actorRole,
      reason: reason || reasonCode || "JOB_CANCELLED",
      metadata: { reason_code: reasonCode || "OTHER" },
    });

    if (syncReference) {
      await syncReferenceCancelled(app, job, reason);
    }

    const notification = await emitProfessionalLifecycleEvent(app, req, {
      event: "PROFESSIONAL_JOB_CANCELLED",
      job: updated,
      partnerRowId,
      partnerPhone,
      customerUserId,
      serviceJobId,
      note: reason || "Job cancelled",
      metadata: { reason_code: reasonCode || "OTHER", actor_role: actorRole },
    });

    return {
      success: true,
      idempotent: false,
      professional_job_id: updated.id,
      status: updated.status,
      notification,
    };
  });
}

async function cancelProfessionalJobByPartner(app, jobRowId, partnerSession, payload = {}, req = null) {
  const zcql = app.zcql();
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerExecutionAllowed(partner);
  const job = await findJobByRowId(zcql, jobRowId);
  await assertPartnerOwnsJob(job, partner);
  const status = normalizeJobStatus(job.status);
  if (!partnerCancelAllowedStatuses(job).has(status)) {
    const error = new Error("This job cannot be cancelled at the current stage");
    error.status = 409;
    error.code = "CANCEL_NOT_ALLOWED";
    throw error;
  }
  const reasonCode = normalizeCancelReason(payload.reason_code || payload.reason);
  const reason = optionalText(payload.note || payload.reason, "note", 255) || reasonCode;
  return cancelProfessionalJob(app, jobRowId, {
    actorId: partner.delivery_partner_id,
    actorRole: "PROFESSIONAL",
    reason,
    reasonCode,
    req,
    syncReference: true,
  });
}

async function cancelProfessionalJobForReference(app, referenceType, referenceRowId, options = {}) {
  const zcql = app.zcql();
  const job = await findJobByReference(zcql, referenceType, referenceRowId);
  if (!job) {
    return { cancelled: false, reason: "NO_PROFESSIONAL_JOB" };
  }
  const result = await cancelProfessionalJob(app, job.id, {
    actorId: options.actorId || "system",
    actorRole: options.actorRole || "CUSTOMER",
    reason: options.reason || "Reference cancelled",
    reasonCode: options.reasonCode || "CUSTOMER_REQUEST",
    req: options.req || null,
    syncReference: false,
  });
  return { cancelled: true, ...result };
}

async function reportProfessionalJobNoShow(app, jobRowId, partnerSession, payload = {}, req = null) {
  const eligibility = await getNoShowEligibility(app, jobRowId, partnerSession);
  if (!eligibility.eligible) {
    const error = new Error("No-show is not available yet");
    error.status = 409;
    error.code = "NO_SHOW_NOT_ELIGIBLE";
    error.details = eligibility;
    throw error;
  }

  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partner = await loadPartnerBySession(zcql, partnerSession);
    const job = await findJobByRowId(zcql, jobRowId);
    await assertPartnerOwnsJob(job, partner);
    const note = optionalText(payload.note, "note", 255) || "Customer no-show";

    await syncReferenceNoShow(app, job.reference_row_id, note);
    const updated = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.CANCELLED, {
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "NO_SHOW",
      metadata: { no_show: true, arrived_at: eligibility.arrived_at },
    });

    const serviceJob = await loadServiceJobContext(zcql, job.reference_row_id);
    const notification = await emitProfessionalLifecycleEvent(app, req, {
      event: "PROFESSIONAL_JOB_NO_SHOW",
      job: updated,
      partnerRowId: partner.row_id,
      partnerPhone: partner.phone || "",
      customerUserId: serviceJob?.user_id ? String(serviceJob.user_id) : "",
      serviceJobId: job.reference_row_id,
      note,
      metadata: { no_show: true },
    });

    return {
      success: true,
      professional_job_id: updated.id,
      status: updated.status,
      service_job_status: "NO_SHOW",
      notification,
    };
  });
}

async function handleServiceJobReschedule(app, serviceJobRowId, { scheduledAt, req = null } = {}) {
  const zcql = app.zcql();
  const job = await findJobByReference(zcql, REFERENCE_TYPES.SERVICE_JOB, serviceJobRowId);
  if (!job) {
    return { handled: false, reason: "NO_PROFESSIONAL_JOB" };
  }
  const status = normalizeJobStatus(job.status);
  if (TERMINAL_PROFESSIONAL_STATUSES.has(status)) {
    return { handled: false, reason: "JOB_TERMINAL", status };
  }

  const partnerRowId = job.delivery_partner_row_id;
  const partnerPhone = partnerRowId ? await loadPartnerPhone(zcql, partnerRowId) : "";
  const serviceJob = await loadServiceJobContext(zcql, serviceJobRowId);

  await appendStatusHistory(app, {
    professionalJobRowId: job.id,
    oldStatus: status,
    newStatus: status,
    actorId: "customer",
    actorRole: "CUSTOMER",
    reason: "RESCHEDULED",
    metadata: { scheduled_at: scheduledAt || serviceJob?.scheduled_at || "" },
  });

  const notification = await emitProfessionalLifecycleEvent(app, req, {
    event: "PROFESSIONAL_JOB_RESCHEDULED",
    job,
    partnerRowId,
    partnerPhone,
    customerUserId: serviceJob?.user_id ? String(serviceJob.user_id) : "",
    serviceJobId: serviceJobRowId,
    note: scheduledAt ? "Rescheduled to " + scheduledAt : "Booking rescheduled",
    metadata: { scheduled_at: scheduledAt || "" },
  });

  if (status === JOB_STATUS.ASSIGNED || status === JOB_STATUS.ACCEPTED) {
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: job.id,
      delivery_partner_row_id: null,
      accepted_at: null,
      assigned_at: null,
      offer_expires_at: null,
      job_status: JOB_STATUS.ASSIGNMENT_PENDING,
    });
    await appendStatusHistory(app, {
      professionalJobRowId: job.id,
      oldStatus: status,
      newStatus: JOB_STATUS.ASSIGNMENT_PENDING,
      actorId: "system",
      actorRole: "SYSTEM",
      reason: "RESCHEDULE_RELEASE",
    });
    const dispatch = await dispatchProfessionalJob(app, job.id, { req });
    const refreshed = await findJobByRowId(zcql, job.id);
    return {
      handled: true,
      released: true,
      redispatched: dispatch.dispatched === true,
      professional_job_id: refreshed.id,
      status: refreshed.status,
      notification,
    };
  }

  return {
    handled: true,
    released: false,
    professional_job_id: job.id,
    status,
    notification,
  };
}

async function createPartnerSupportTicket(app, partnerSession, payload = {}) {
  const zcql = app.zcql();
  const partner = await loadPartnerBySession(zcql, partnerSession);
  const category = normalizeSupportCategory(payload.category);
  const message = optionalText(payload.message, "message", 512);
  if (!message) {
    const error = new Error("message is required");
    error.status = 422;
    throw error;
  }
  const professionalJobRowId = payload.professional_job_id || payload.job_id || "";
  const ticketNumber = nextTicketNumber(partner.row_id);
  const row = {
    ticket_number: ticketNumber,
    partner_row_id: String(partner.row_id),
    professional_job_row_id: professionalJobRowId ? String(professionalJobRowId) : "",
    category,
    message,
    status: "OPEN",
    metadata_json: JSON.stringify({
      reference_type: payload.reference_type || "",
      reference_id: payload.reference_id || "",
    }).slice(0, 512),
    created_at: nowSql(),
    updated_at: nowSql(),
  };
  const inserted = await app.datastore().table("Partner_Support_Tickets").insertRow(row);
  await emitProfessionalLifecycleEvent(app, null, {
    event: "PROFESSIONAL_SUPPORT_TICKET",
    job: professionalJobRowId ? { id: professionalJobRowId } : null,
    partnerRowId: partner.row_id,
    partnerPhone: partner.phone || "",
    note: "Support ticket " + ticketNumber + " created",
    metadata: { category, ticket_number: ticketNumber },
  });
  return {
    ticket_id: String(inserted.ROWID || inserted.rowid),
    ticket_number: ticketNumber,
    status: "OPEN",
    category,
  };
}

async function listPartnerSupportTickets(zcql, partnerRowId, { limit = 20 } = {}) {
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, ticket_number, professional_job_row_id, category, message, status, created_at, updated_at FROM Partner_Support_Tickets WHERE partner_row_id = " +
          asId(partnerRowId, "partner_id") +
          " ORDER BY created_at DESC LIMIT " +
          Math.min(Math.max(Number(limit) || 20, 1), 50)
      ),
      "Partner_Support_Tickets"
    );
    return rows.map((row) => ({
      id: String(row.ROWID),
      ticket_number: row.ticket_number || "",
      professional_job_row_id:
        row.professional_job_row_id != null ? String(row.professional_job_row_id) : "",
      category: row.category || "",
      message: row.message || "",
      status: row.status || "",
      created_at: row.created_at || "",
      updated_at: row.updated_at || "",
    }));
  } catch (_) {
    return [];
  }
}

module.exports = {
  findJobByReference,
  getNoShowEligibility,
  cancelProfessionalJob,
  cancelProfessionalJobByPartner,
  cancelProfessionalJobForReference,
  reportProfessionalJobNoShow,
  handleServiceJobReschedule,
  createPartnerSupportTicket,
  listPartnerSupportTickets,
  partnerCancelAllowedStatuses,
};
