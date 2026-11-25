"use strict";

const { normalizePincode } = require("./pincode");

const POSTAL_API_BASE = "https://api.postalpincode.in/pincode/";
const CACHE_TTL_HOURS = 24;

function pickBestOffice(offices) {
  if (!Array.isArray(offices) || offices.length === 0) {
    return null;
  }
  const deliveryHead = offices.find(function (office) {
    return (
      String(office.BranchType || "") === "Head Post Office" &&
      String(office.DeliveryStatus || "") === "Delivery"
    );
  });
  if (deliveryHead) {
    return deliveryHead;
  }
  const delivery = offices.find(function (office) {
    return String(office.DeliveryStatus || "") === "Delivery";
  });
  if (delivery) {
    return delivery;
  }
  return offices[0];
}

function mapOfficeToLocation(pincode, office) {
  if (!office) {
    return null;
  }
  const district = String(office.District || "").trim();
  const block = String(office.Block || "").trim();
  const region = String(office.Region || "").trim();
  const city = block || district || region || String(office.Name || "").trim();
  return {
    pincode,
    city,
    state: String(office.State || "").trim(),
    district,
    area: String(office.Name || "").trim(),
    delivery_status: String(office.DeliveryStatus || "").trim(),
    source: "postal_api",
  };
}

async function readCache(app, key) {
  if (!app || !app.cache) {
    return null;
  }
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
  if (!app || !app.cache) {
    return;
  }
  try {
    await app.cache().segment().put(key, JSON.stringify(value), CACHE_TTL_HOURS);
  } catch (_) {}
}

async function lookupFromPostalApi(pincode) {
  const response = await fetch(POSTAL_API_BASE + pincode, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    const error = new Error("PIN lookup service is temporarily unavailable");
    error.status = 502;
    throw error;
  }
  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : null;
  const offices = result && Array.isArray(result.PostOffice) ? result.PostOffice : [];
  if (!result || result.Status !== "Success" || offices.length === 0) {
    return null;
  }
  return mapOfficeToLocation(pincode, pickBestOffice(offices));
}

async function lookupFromDatabase(zcql, pincode) {
  if (!zcql) {
    return null;
  }
  try {
    const { findServiceableByPincode } = require("./serviceability-admin");
    const row = await findServiceableByPincode(zcql, pincode);
    if (!row) {
      return null;
    }
    const city = String(row.city || "").trim();
    const state = String(row.state || "").trim();
    if (!city && !state) {
      return null;
    }
    return {
      pincode,
      city: city || state,
      state,
      district: city,
      area: "",
      delivery_status: row.is_active ? "Delivery" : "",
      source: "database",
    };
  } catch (_) {
    return null;
  }
}

async function lookupPostalPincode(app, rawPincode, options) {
  const opts = options || {};
  const pincode = normalizePincode(rawPincode);
  const cacheKey = "postal:" + pincode;

  if (!opts.skipCache) {
    const cached = await readCache(app, cacheKey);
    if (cached && cached.pincode === pincode) {
      return cached;
    }
  }

  let mapped = null;
  try {
    mapped = await lookupFromPostalApi(pincode);
  } catch (error) {
    if (opts.strict) {
      throw error;
    }
  }

  if (!mapped && app && typeof app.zcql === "function") {
    mapped = await lookupFromDatabase(app.zcql(), pincode);
  }

  if (!mapped) {
    const error = new Error("Invalid or unknown PIN code");
    error.status = 404;
    throw error;
  }

  if (!opts.skipCache) {
    await writeCache(app, cacheKey, mapped);
  }
  return mapped;
}

module.exports = {
  lookupPostalPincode,
  lookupFromPostalApi,
  pickBestOffice,
  mapOfficeToLocation,
};
