"use strict";

function validateCoordinateRange(latitude, longitude) {
  if (latitude == null || latitude === "" || longitude == null || longitude === "") {
    return false;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat < -90 || lat > 90) {
    return false;
  }
  if (lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

function parseLocation(latitude, longitude) {
  const lat = latitude != null && latitude !== "" ? Number(latitude) : null;
  const lng = longitude != null && longitude !== "" ? Number(longitude) : null;
  if (!validateCoordinateRange(lat, lng)) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

function requireCoordinates(
  latitude,
  longitude,
  { latName = "latitude", lngName = "longitude" } = {}
) {
  const lat = latitude != null && latitude !== "" ? Number(latitude) : NaN;
  const lng = longitude != null && longitude !== "" ? Number(longitude) : NaN;
  if (!Number.isFinite(lat)) {
    const error = new Error(latName + " is required");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(lng)) {
    const error = new Error(lngName + " is required");
    error.status = 400;
    throw error;
  }
  if (!validateCoordinateRange(lat, lng)) {
    const error = new Error("Invalid geographic coordinates");
    error.status = 400;
    error.code = "INVALID_COORDINATES";
    throw error;
  }
  return { latitude: lat, longitude: lng };
}

module.exports = {
  validateCoordinateRange,
  parseLocation,
  requireCoordinates,
};
