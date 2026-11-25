"use strict";

const { rowOf } = require("./http");
const { requireCoordinates } = require("./geo-coords");
const { parseDeliveryPartnerId } = require("./delivery-partner");
const { normalizeOnlineStatus, ONLINE_STATUS } = require("./partner-dashboard");

const CACHE_TTL_MINUTES = 20;

function cacheKey(partnerRowId) {
  return "partner_avail_loc:" + String(partnerRowId);
}

function validateCapturedAt(capturedAt) {
  const normalized = String(capturedAt || "").trim().replace(" ", "T");
  const withZone = /[zZ]$/.test(normalized) || /[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : normalized + "Z";
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) {
    const error = new Error("captured_at must be a valid timestamp");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }
  return date.toISOString();
}

async function loadPartnerRow(zcql, deliveryPartnerId) {
  const rowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!rowId) return null;
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, online_status FROM Delivery_Partners WHERE ROWID = " + rowId
    ),
    "Delivery_Partners"
  );
}

async function recordPartnerAvailabilityLocationForSession(app, deliveryPartnerId, body = {}) {
  const partnerRow = await loadPartnerRow(app.zcql(), deliveryPartnerId);
  return recordPartnerAvailabilityLocation(app, partnerRow, body);
}

async function recordPartnerAvailabilityLocation(app, partnerRow, body = {}) {
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const status = normalizeOnlineStatus(partnerRow.online_status);
  if (status !== ONLINE_STATUS.ONLINE_AVAILABLE) {
    const error = new Error("Location ping accepted only while online and available");
    error.status = 409;
    error.code = "PARTNER_OFFLINE";
    throw error;
  }

  const coords = requireCoordinates(body.latitude, body.longitude);
  const capturedAt = validateCapturedAt(body.captured_at || new Date().toISOString());
  const accuracyM =
    body.accuracy_m != null && body.accuracy_m !== "" ? Number(body.accuracy_m) : null;
  if (accuracyM != null && (!Number.isFinite(accuracyM) || accuracyM < 0)) {
    const error = new Error("accuracy_m must be a non-negative number");
    error.status = 422;
    error.code = "LOCATION_INVALID";
    throw error;
  }

  const payload = {
    partner_row_id: String(partnerRow.ROWID),
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy_m: accuracyM,
    captured_at: capturedAt,
    received_at: new Date().toISOString(),
  };

  try {
    await app.cache().segment().put(
      cacheKey(partnerRow.ROWID),
      JSON.stringify(payload),
      CACHE_TTL_MINUTES
    );
  } catch (_) {}

  return { recorded: true, captured_at: capturedAt };
}

async function readPartnerAvailabilityLocation(app, partnerRowId) {
  try {
    const raw = await app.cache().segment().getValue(cacheKey(partnerRowId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  recordPartnerAvailabilityLocation,
  recordPartnerAvailabilityLocationForSession,
  readPartnerAvailabilityLocation,
};
