"use strict";

const { haversineKm } = require("./salon-engine");

const AVERAGE_CITY_SPEED_KMH = 22;

function estimateTravelMinutes(distanceKm, speedKmh) {
  const km = Number(distanceKm);
  const speed = Number(speedKmh) || AVERAGE_CITY_SPEED_KMH;
  if (!Number.isFinite(km) || km <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((km / speed) * 60));
}

function buildRouteSummary(fromLat, fromLng, toLat, toLng, speedKmh) {
  const distanceKm =
    fromLat != null && fromLng != null && toLat != null && toLng != null
      ? Math.round(haversineKm(fromLat, fromLng, toLat, toLng) * 10) / 10
      : null;
  const etaMinutes =
    distanceKm != null ? estimateTravelMinutes(distanceKm, speedKmh) : null;
  return {
    distance_km: distanceKm,
    eta_minutes: etaMinutes,
    eta_label:
      etaMinutes != null && etaMinutes > 0 ? etaMinutes + " min away" : null,
    routing_source: "haversine_estimate",
  };
}

module.exports = {
  AVERAGE_CITY_SPEED_KMH,
  estimateTravelMinutes,
  buildRouteSummary,
};
