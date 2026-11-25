"use strict";

const { CACHE_TTL_MINUTES } = require("./professional-location-config");

function cacheKey(professionalJobRowId) {
  return "professional_job_loc:" + String(professionalJobRowId);
}

function referenceCacheKey(referenceType, referenceRowId) {
  if (referenceType === "SERVICE_JOB") {
    return "beauty_provider_loc:" + String(referenceRowId);
  }
  if (referenceType === "ORDER") {
    return "professional_order_loc:" + String(referenceRowId);
  }
  return null;
}

function parseTimestamp(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim().replace(" ", "T");
  const withZone = /[zZ]$/.test(normalized) || /[+-]\d{2}:\d{2}$/.test(normalized)
    ? normalized
    : normalized + "Z";
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isNewerLocation(incoming, cached) {
  if (!cached || !cached.captured_at) {
    return true;
  }
  const incomingAt = parseTimestamp(incoming.captured_at);
  const cachedAt = parseTimestamp(cached.captured_at);
  if (!incomingAt || !cachedAt) {
    return true;
  }
  return incomingAt.getTime() >= cachedAt.getTime();
}

async function writeProfessionalLocationCache(app, professionalJobRowId, payload, options = {}) {
  const key = cacheKey(professionalJobRowId);
  let existing = null;
  try {
    const raw = await app.cache().segment().getValue(key);
    if (raw) {
      existing = JSON.parse(raw);
    }
  } catch (_) {}

  if (existing && !isNewerLocation(payload, existing)) {
    return { written: false, reason: "STALE_UPDATE", cached: existing };
  }

  const record = {
    ...payload,
    professional_job_id: String(professionalJobRowId),
    received_at: new Date().toISOString(),
  };

  try {
    await app.cache().segment().put(key, JSON.stringify(record), CACHE_TTL_MINUTES);
  } catch (_) {
    return { written: false, reason: "CACHE_WRITE_FAILED", cached: existing };
  }

  const refKey = referenceCacheKey(options.reference_type, options.reference_row_id);
  if (refKey) {
    try {
      const refPayload = {
        job_id: String(options.reference_row_id),
        provider_id: payload.professional_row_id ? String(payload.professional_row_id) : "",
        latitude: payload.latitude,
        longitude: payload.longitude,
        heading: payload.heading,
        speed: payload.speed_mps,
        status: "EN_ROUTE",
        recorded_at: payload.captured_at,
        cached_at: record.received_at,
      };
      await app.cache().segment().put(refKey, JSON.stringify(refPayload), CACHE_TTL_MINUTES);
    } catch (_) {}
  }

  return { written: true, cached: record };
}

async function readProfessionalLocationCache(app, professionalJobRowId) {
  try {
    const raw = await app.cache().segment().getValue(cacheKey(professionalJobRowId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  cacheKey,
  referenceCacheKey,
  parseTimestamp,
  isNewerLocation,
  writeProfessionalLocationCache,
  readProfessionalLocationCache,
};
