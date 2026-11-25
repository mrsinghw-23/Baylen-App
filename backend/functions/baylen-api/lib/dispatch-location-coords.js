"use strict";

const { normalizePincode } = require("./professional-location-match");
const { PINCODE_COORD_FALLBACK } = require("./professional-delivery-config");

/** Approximate state centroids for nationwide distance ranking when GPS is unavailable. */
const INDIAN_STATE_CENTROIDS = Object.freeze({
  "andhra pradesh": { latitude: 15.9129, longitude: 79.74 },
  "arunachal pradesh": { latitude: 28.218, longitude: 94.7278 },
  assam: { latitude: 26.2006, longitude: 92.9376 },
  bihar: { latitude: 25.0961, longitude: 85.3131 },
  chhattisgarh: { latitude: 21.2787, longitude: 81.8661 },
  goa: { latitude: 15.2993, longitude: 74.124 },
  gujarat: { latitude: 22.2587, longitude: 71.1924 },
  haryana: { latitude: 29.0588, longitude: 76.0856 },
  "himachal pradesh": { latitude: 31.1048, longitude: 77.1734 },
  jharkhand: { latitude: 23.6102, longitude: 85.2799 },
  karnataka: { latitude: 15.3173, longitude: 75.7139 },
  kerala: { latitude: 10.8505, longitude: 76.2711 },
  "madhya pradesh": { latitude: 22.9734, longitude: 78.6569 },
  maharashtra: { latitude: 19.7515, longitude: 75.7139 },
  manipur: { latitude: 24.6637, longitude: 93.9063 },
  meghalaya: { latitude: 25.467, longitude: 91.3662 },
  mizoram: { latitude: 23.1645, longitude: 92.9376 },
  nagaland: { latitude: 26.1584, longitude: 94.5624 },
  odisha: { latitude: 20.9517, longitude: 85.0985 },
  orissa: { latitude: 20.9517, longitude: 85.0985 },
  punjab: { latitude: 31.1471, longitude: 75.3412 },
  rajasthan: { latitude: 27.0238, longitude: 74.2179 },
  sikkim: { latitude: 27.533, longitude: 88.5122 },
  "tamil nadu": { latitude: 11.1271, longitude: 78.6569 },
  telangana: { latitude: 18.1124, longitude: 79.0193 },
  tripura: { latitude: 23.9408, longitude: 91.9882 },
  "uttar pradesh": { latitude: 26.8467, longitude: 80.9462 },
  uttarakhand: { latitude: 30.0668, longitude: 79.0193 },
  "west bengal": { latitude: 22.9868, longitude: 87.855 },
  delhi: { latitude: 28.7041, longitude: 77.1025 },
  "jammu and kashmir": { latitude: 33.7782, longitude: 76.5762 },
  ladakh: { latitude: 34.1526, longitude: 77.5771 },
  puducherry: { latitude: 11.9416, longitude: 79.8083 },
  chandigarh: { latitude: 30.7333, longitude: 76.7794 },
});

function normalizeStateKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDispatchCoordinates(location = {}) {
  const lat = location.latitude ?? location.lat;
  const lng = location.longitude ?? location.lng;
  if (lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
    return {
      latitude: Number(lat),
      longitude: Number(lng),
      source: location.source || "gps",
    };
  }

  const pincode = normalizePincode(location.pincode || location.postal_code);
  if (pincode && PINCODE_COORD_FALLBACK[pincode]) {
    return {
      latitude: PINCODE_COORD_FALLBACK[pincode].latitude,
      longitude: PINCODE_COORD_FALLBACK[pincode].longitude,
      source: "pincode_fallback",
    };
  }

  const stateKey = normalizeStateKey(location.state || location.visit_state);
  if (stateKey && INDIAN_STATE_CENTROIDS[stateKey]) {
    return {
      latitude: INDIAN_STATE_CENTROIDS[stateKey].latitude,
      longitude: INDIAN_STATE_CENTROIDS[stateKey].longitude,
      source: "state_centroid",
    };
  }

  return null;
}

module.exports = {
  INDIAN_STATE_CENTROIDS,
  normalizeStateKey,
  resolveDispatchCoordinates,
};
