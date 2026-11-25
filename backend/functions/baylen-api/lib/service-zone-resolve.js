"use strict";

const { rowOf, rowsOf, sqlString } = require("./http");
const { citiesMatch } = require("./salon-engine");
const { normalizePincode } = require("./professional-location-match");

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zoneRowMatches(zone, location) {
  if (!zone || zone.is_active === false || zone.is_active === "false") {
    return false;
  }
  const pincode = normalizePincode(location.pincode);
  const prefix = String(zone.pincode_prefix || "").trim();
  if (prefix && pincode && !pincode.startsWith(prefix)) {
    return false;
  }
  const zoneCity = String(zone.city || "").trim();
  const zoneState = String(zone.state || "").trim();
  const city = String(location.city || location.visit_city || "").trim();
  const state = String(location.state || location.visit_state || "").trim();
  if (zoneCity && city && !citiesMatch(city, zoneCity)) {
    return false;
  }
  if (zoneState && state && normalizeSearch(zoneState) !== normalizeSearch(state)) {
    return false;
  }
  return Boolean(zoneCity || prefix);
}

function buildZoneLabel(zone, location) {
  const city = String(zone?.city || location.city || location.visit_city || "").trim();
  const district = String(location.district || location.visit_district || "").trim();
  const prefix = String(zone?.pincode_prefix || "").trim();
  const pincode = normalizePincode(location.pincode);
  if (prefix) {
    return [city, "PIN " + prefix].filter(Boolean).join(" · ");
  }
  if (district && city && normalizeSearch(district) !== normalizeSearch(city)) {
    return [city, district].filter(Boolean).join(" · ");
  }
  if (city && pincode) {
    return [city, "PIN " + pincode.slice(0, 3) + "xx"].filter(Boolean).join(" · ");
  }
  return city || district || "";
}

function pickZoneLabelFromRows(zones, location) {
  const matched = (zones || []).filter((zone) => zoneRowMatches(zone, location));
  if (!matched.length) {
    return buildZoneLabel(null, location);
  }
  matched.sort((a, b) => {
    const aPrefix = String(a.pincode_prefix || "").length;
    const bPrefix = String(b.pincode_prefix || "").length;
    return bPrefix - aPrefix;
  });
  return buildZoneLabel(matched[0], location);
}

async function loadBeautyServiceZones(zcql) {
  try {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, outlet_id, city, state, pincode_prefix, max_radius_km, is_active FROM Beauty_Service_Zones WHERE is_active = true"
      ),
      "Beauty_Service_Zones"
    );
  } catch (_) {
    return [];
  }
}

async function loadPincodeDeliveryZone(zcql, pincode) {
  const digits = normalizePincode(pincode);
  if (!digits) {
    return "";
  }
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT delivery_zone, city, state FROM Serviceable_Pincodes WHERE pincode = " +
          sqlString(digits) +
          " LIMIT 1"
      ),
      "Serviceable_Pincodes"
    );
    if (!row) {
      return "";
    }
    return String(row.delivery_zone || row.city || "").trim();
  } catch (_) {
    return "";
  }
}

/**
 * Resolve a human-readable service zone label for dispatch matching.
 * Priority: Serviceable_Pincodes.delivery_zone → Beauty_Service_Zones → district/city fallback.
 */
async function resolveServiceZoneLabel(zcql, location = {}) {
  const normalized = {
    city: location.city || location.visit_city || "",
    state: location.state || location.visit_state || "",
    district: location.district || location.visit_district || "",
    pincode: location.pincode || "",
    visit_city: location.visit_city || location.city || "",
    visit_state: location.visit_state || location.state || "",
    visit_district: location.visit_district || location.district || "",
  };

  const deliveryZone = await loadPincodeDeliveryZone(zcql, normalized.pincode);
  if (deliveryZone) {
    return deliveryZone;
  }

  const zones = await loadBeautyServiceZones(zcql);
  const label = pickZoneLabelFromRows(zones, normalized);
  return label || buildZoneLabel(null, normalized);
}

module.exports = {
  normalizeSearch,
  zoneRowMatches,
  buildZoneLabel,
  pickZoneLabelFromRows,
  resolveServiceZoneLabel,
};
