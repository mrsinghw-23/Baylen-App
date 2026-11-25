"use strict";

const { optionalText } = require("./http");

function jsonText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return JSON.stringify(value).slice(0, 255);
  } catch (_) {
    return null;
  }
}

function clientIp(req) {
  return (
    optionalText(req.headers && req.headers["x-forwarded-for"], "x-forwarded-for", 120) ||
    optionalText(req.headers && req.headers["x-real-ip"], "x-real-ip", 80) ||
    optionalText(req.ip, "ip_address", 120) ||
    null
  );
}

async function writeCustomerAudit(req, userId, action, entityType, entityId, before, after) {
  try {
    await req.catalystApp.datastore().table("Audit_Logs").insertRow({
      actor_user_id: userId ? String(userId) : null,
      actor_type: "CUSTOMER",
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      before_json: jsonText(before),
      after_json: jsonText(after),
      ip_address: clientIp(req),
    });
  } catch (_) {
    // Audit logging must never fail login or account recovery.
  }
}

async function writeAdminAudit(app, actor, action, entityType, entityId, before, after, ipAddress) {
  try {
    await app.datastore().table("Audit_Logs").insertRow({
      actor_user_id: null,
      actor_type: actor ? String(actor).slice(0, 120) : "ADMIN",
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      before_json: jsonText(before),
      after_json: jsonText(after),
      ip_address: ipAddress || null,
    });
  } catch (_) {
    // Audit logging must never break the admin action it is recording.
  }
}

async function writeDeliveryPartnerAudit(req, deliveryPartnerId, action, entityType, entityId, before, after) {
  try {
    await req.catalystApp.datastore().table("Audit_Logs").insertRow({
      actor_user_id: deliveryPartnerId ? String(deliveryPartnerId).slice(0, 120) : null,
      actor_type: "DELIVERY_PARTNER",
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      before_json: jsonText(before),
      after_json: jsonText(after),
      ip_address: clientIp(req),
    });
  } catch (_) {
    // Audit logging must never break delivery partner flows.
  }
}

module.exports = {
  writeCustomerAudit,
  writeAdminAudit,
  writeDeliveryPartnerAudit,
};
