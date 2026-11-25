"use strict";

const { rowOf, rowsOf, asId, sqlString } = require("./http");
const { emitJobEvent } = require("./at-home-beauty-events");
const { recordWhatsappNotification } = require("./whatsapp-notification-store");
const { NOTIFICATION_MAX_ATTEMPTS } = require("./professional-lifecycle-config");

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

const PARTNER_EVENT_LABELS = {
  PROFESSIONAL_JOB_ASSIGNED: "New job assigned",
  PROFESSIONAL_JOB_CANCELLED: "Job cancelled",
  PROFESSIONAL_JOB_RESCHEDULED: "Job rescheduled",
  PROFESSIONAL_JOB_NO_SHOW: "Customer no-show recorded",
  PROFESSIONAL_SUPPORT_TICKET: "Support request received",
  PROFESSIONAL_JOB_DELAYED: "Job running late",
};

async function insertPartnerNotification(app, row) {
  try {
    const inserted = await app.datastore().table("Partner_Notifications").insertRow({
      partner_row_id: String(row.partner_row_id),
      notification_type: String(row.notification_type || "GENERAL").slice(0, 40),
      title: String(row.title || "").slice(0, 120),
      body: String(row.body || "").slice(0, 512),
      reference_type: row.reference_type ? String(row.reference_type).slice(0, 20) : "",
      reference_id: row.reference_id ? String(row.reference_id) : "",
      professional_job_row_id: row.professional_job_row_id
        ? String(row.professional_job_row_id)
        : "",
      delivery_status: String(row.delivery_status || "DELIVERED").slice(0, 20),
      read_at: null,
      created_at: nowSql(),
    });
    return { ROWID: inserted.ROWID || inserted.rowid, ...row };
  } catch (_) {
    return null;
  }
}

async function recordPartnerWhatsappAudit(req, app, {
  partnerRowId,
  partnerPhone,
  notificationType,
  referenceType,
  referenceId,
  templateName,
  deliveryStatus,
  templateVariables,
}) {
  const row = {
    user_id: "dp_" + String(partnerRowId),
    notification_type: notificationType,
    reference_type: referenceType || "PROFESSIONAL_JOB",
    reference_id: referenceId || partnerRowId,
    template_name: templateName || "",
    template_variables: templateVariables || [],
    delivery_status: deliveryStatus || "PENDING",
    provider_message_id: "",
    mobile: partnerPhone || "",
  };
  if (req) {
    await recordWhatsappNotification(req, row);
    return;
  }
  try {
    await app.datastore().table("WhatsApp_Notifications").insertRow({
      user_id: row.user_id,
      notification_type: row.notification_type,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      template_name: row.template_name,
      template_variables: JSON.stringify(row.template_variables).slice(0, 255),
      delivery_status: row.delivery_status,
      provider_message_id: "",
      mobile: row.mobile,
    });
  } catch (_) {}
}

async function notifyPartnerWithRetry(app, req, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= NOTIFICATION_MAX_ATTEMPTS; attempt += 1) {
    try {
      const inbox = await insertPartnerNotification(app, {
        partner_row_id: payload.partner_row_id,
        notification_type: payload.event,
        title: payload.title,
        body: payload.body,
        reference_type: payload.reference_type,
        reference_id: payload.reference_id,
        professional_job_row_id: payload.professional_job_row_id,
        delivery_status: "DELIVERED",
      });
      await recordPartnerWhatsappAudit(req, app, {
        partnerRowId: payload.partner_row_id,
        partnerPhone: payload.partner_phone,
        notificationType: payload.event,
        referenceType: payload.reference_type,
        referenceId: payload.reference_id || payload.professional_job_row_id,
        templateName: payload.template_name || "",
        deliveryStatus: inbox ? "RECORDED" : "FAILED",
        templateVariables: payload.template_variables,
      });
      return { ok: true, attempts: attempt, inbox_id: inbox?.ROWID || "" };
    } catch (error) {
      lastError = error;
    }
  }
  await recordPartnerWhatsappAudit(req, app, {
    partnerRowId: payload.partner_row_id,
    partnerPhone: payload.partner_phone,
    notificationType: payload.event,
    referenceType: payload.reference_type,
    referenceId: payload.reference_id || payload.professional_job_row_id,
    deliveryStatus: "FAILED",
  });
  return { ok: false, attempts: NOTIFICATION_MAX_ATTEMPTS, error: lastError?.message || "notify failed" };
}

async function emitProfessionalLifecycleEvent(app, req, {
  event,
  job,
  partnerRowId,
  partnerPhone,
  customerUserId,
  serviceJobId,
  note,
  metadata,
}) {
  const label = PARTNER_EVENT_LABELS[event] || event;
  const body = note || label;

  let partnerNotify = { ok: false, skipped: true };
  if (partnerRowId) {
    partnerNotify = await notifyPartnerWithRetry(app, req, {
      event,
      partner_row_id: partnerRowId,
      partner_phone: partnerPhone,
      title: label,
      body,
      reference_type: job?.reference_type || "PROFESSIONAL_JOB",
      reference_id: job?.reference_row_id || job?.id,
      professional_job_row_id: job?.id,
      template_name: "",
      template_variables: metadata ? [JSON.stringify(metadata).slice(0, 200)] : [],
    });
  }

  let customerEvent = null;
  if (serviceJobId && customerUserId) {
    try {
      customerEvent = await emitJobEvent(app, {
        jobId: serviceJobId,
        userId: customerUserId,
        providerId: partnerRowId,
        event,
        status: event,
        note: body,
      });
    } catch (_) {}
  }

  return {
    partner_notification: partnerNotify,
    customer_event: customerEvent,
    event,
    label,
  };
}

async function countUnreadPartnerNotifications(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT COUNT(ROWID) AS total FROM Partner_Notifications WHERE partner_row_id = " +
          asId(partnerRowId, "partner_id") +
          " AND read_at IS NULL"
      ),
      "Partner_Notifications"
    );
    return Number(row?.total ?? row?.["COUNT(ROWID)"] ?? 0) || 0;
  } catch (_) {
    return 0;
  }
}

async function listPartnerNotifications(zcql, partnerRowId, { limit = 20 } = {}) {
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, notification_type, title, body, reference_type, reference_id, professional_job_row_id, delivery_status, read_at, created_at FROM Partner_Notifications WHERE partner_row_id = " +
          asId(partnerRowId, "partner_id") +
          " ORDER BY created_at DESC LIMIT " +
          Math.min(Math.max(Number(limit) || 20, 1), 50)
      ),
      "Partner_Notifications"
    );
    return rows.map((row) => ({
      id: String(row.ROWID),
      type: row.notification_type || "",
      title: row.title || "",
      body: row.body || "",
      reference_type: row.reference_type || "",
      reference_id: row.reference_id != null ? String(row.reference_id) : "",
      professional_job_row_id:
        row.professional_job_row_id != null ? String(row.professional_job_row_id) : "",
      read: Boolean(row.read_at),
      read_at: row.read_at || "",
      created_at: row.created_at || "",
    }));
  } catch (_) {
    return [];
  }
}

async function markPartnerNotificationsRead(app, partnerRowId, notificationIds) {
  const ids = (notificationIds || []).map((id) => String(id)).filter(Boolean);
  if (!ids.length) {
    return { updated: 0 };
  }
  const readAt = nowSql();
  let updated = 0;
  for (const id of ids) {
    try {
      await app.datastore().table("Partner_Notifications").updateRow({
        ROWID: id,
        read_at: readAt,
      });
      updated += 1;
    } catch (_) {}
  }
  return { updated, read_at: readAt };
}

module.exports = {
  PARTNER_EVENT_LABELS,
  insertPartnerNotification,
  notifyPartnerWithRetry,
  emitProfessionalLifecycleEvent,
  countUnreadPartnerNotifications,
  listPartnerNotifications,
  markPartnerNotificationsRead,
};
