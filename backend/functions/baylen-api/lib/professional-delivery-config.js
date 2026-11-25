"use strict";

const PROFESSIONAL_PICKUP_RADIUS_METERS = Number(
  process.env.PROFESSIONAL_PICKUP_RADIUS_METERS || 100
);
const PROFESSIONAL_DELIVERY_RADIUS_METERS = Number(
  process.env.PROFESSIONAL_DELIVERY_RADIUS_METERS || 100
);

/** Dev/test fallback when Orders have no geocoded delivery coordinates. */
const PINCODE_COORD_FALLBACK = {
  "834001": { latitude: 23.3505, longitude: 85.3205 },
};

module.exports = {
  PROFESSIONAL_PICKUP_RADIUS_METERS,
  PROFESSIONAL_DELIVERY_RADIUS_METERS,
  PINCODE_COORD_FALLBACK,
};
