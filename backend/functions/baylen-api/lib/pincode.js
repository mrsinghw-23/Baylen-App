"use strict";

const { rowOf, sqlString, isTruthy, num } = require("./http");

const PIN_CACHE_TTL_HOURS = 1;

function normalizePincode(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 6) {
    const error = new Error("Enter a valid 6-digit PIN code");
    error.status = 400;
    error.code = "INVALID_PINCODE";
    throw error;
  }
  return digits;
}

function mapServiceableRow(row, pincode) {
  if (!row) {
    return {
      pincode,
      serviceable: false,
      city: "",
      state: "",
      country: "India",
      estimated_delivery_days: 0,
      delivery_zone: "",
      eta_label: "",
      message: "Sorry, delivery is currently unavailable at this location.",
    };
  }
  const active = isTruthy(row.is_active);
  const days = Math.max(0, Math.round(num(row.estimated_delivery_days) || 3));
  if (!active) {
    return {
      pincode,
      serviceable: false,
      city: row.city || "",
      state: row.state || "",
      country: row.country || "India",
      estimated_delivery_days: days,
      delivery_zone: row.delivery_zone || "",
      eta_label: "",
      message: "Sorry, delivery is currently unavailable at this location.",
    };
  }
  return {
    pincode,
    serviceable: true,
    city: row.city || "",
    state: row.state || "",
    country: row.country || "India",
    estimated_delivery_days: days,
    delivery_zone: row.delivery_zone || "",
    eta_label: days <= 1 ? "Get it tomorrow" : "Get it in " + days + " days",
    message: "Delivery available",
  };
}

async function readCache(app, key) {
  try {
    const raw = await app.cache().segment().getValue(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function writeCache(app, key, value) {
  try {
    await app.cache().segment().put(key, JSON.stringify(value), PIN_CACHE_TTL_HOURS);
  } catch (_) {}
}

async function lookupServiceablePincode(app, rawPincode, options) {
  const pincode = normalizePincode(rawPincode);
  const skipCache = options && options.skipCache === true;
  const cacheKey = "pin:" + pincode;
  if (!skipCache) {
    const cached = await readCache(app, cacheKey);
    if (cached && cached.pincode === pincode) {
      return cached;
    }
  }
  const zcql = app.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, pincode, city, state, country, estimated_delivery_days, delivery_zone, is_active FROM Serviceable_Pincodes WHERE pincode = " +
        sqlString(pincode)
    ),
    "Serviceable_Pincodes"
  );
  const mapped = mapServiceableRow(row, pincode);
  if (!skipCache) {
    await writeCache(app, cacheKey, mapped);
  }
  return mapped;
}

async function requireServiceablePincode(app, rawPincode) {
  const result = await lookupServiceablePincode(app, rawPincode, { skipCache: true });
  if (!result.serviceable) {
    const error = new Error(
      result.message || "Sorry, delivery is currently unavailable at this location."
    );
    error.status = 409;
    error.code = "UNSERVICEABLE_PINCODE";
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  normalizePincode,
  lookupServiceablePincode,
  requireServiceablePincode,
  mapServiceableRow,
};
