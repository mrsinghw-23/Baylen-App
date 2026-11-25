"use strict";

/**
 * All-India dispatch toggles.
 * BAYLEN_ALL_INDIA_DISPATCH=false opts back into legacy salon-bridge-only matching.
 * DISPATCH_PINCODE_GATE_MODE: strict | state | national (product delivery pincode gate).
 */
function isAllIndiaDispatchEnabled() {
  return String(process.env.BAYLEN_ALL_INDIA_DISPATCH || "true").toLowerCase() !== "false";
}

function productPincodeGateMode() {
  const explicit = String(process.env.DISPATCH_PINCODE_GATE_MODE || "").trim().toLowerCase();
  if (explicit === "strict" || explicit === "state" || explicit === "national") {
    return explicit;
  }
  return isAllIndiaDispatchEnabled() ? "national" : "strict";
}

/** Max km from job destination when partner has a fresh live GPS ping. */
function dispatchMaxRadiusKm() {
  const parsed = Number(process.env.DISPATCH_MAX_RADIUS_KM);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
}

module.exports = {
  isAllIndiaDispatchEnabled,
  productPincodeGateMode,
  dispatchMaxRadiusKm,
};
