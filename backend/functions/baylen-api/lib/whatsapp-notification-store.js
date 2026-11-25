"use strict";

function serializeTemplateVariables(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }
  try {
    return JSON.stringify(values.map((value) => String(value ?? "").slice(0, 256))).slice(0, 255);
  } catch (_) {
    return "";
  }
}

async function recordWhatsappNotification(req, row) {
  try {
    await req.catalystApp.datastore().table("WhatsApp_Notifications").insertRow({
      user_id: row.user_id,
      notification_type: row.notification_type,
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      template_name: String(row.template_name || "").slice(0, 100),
      template_variables: serializeTemplateVariables(row.template_variables),
      delivery_status: String(row.delivery_status || "PENDING").slice(0, 40),
      provider_message_id: String(row.provider_message_id || "").slice(0, 120),
      mobile: String(row.mobile || "").slice(0, 20),
    });
  } catch (_) {}
}

module.exports = {
  serializeTemplateVariables,
  recordWhatsappNotification,
};
