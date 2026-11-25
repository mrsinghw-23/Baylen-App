"use strict";

const { rowOf, sqlString, isTruthy } = require("./http");
const { productPincodeGateMode } = require("./dispatch-all-india-config");

async function isPincodeListedActive(zcql, pincode) {
  if (!pincode || pincode.length !== 6) {
    return false;
  }
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, is_active FROM Serviceable_Pincodes WHERE pincode = " +
          sqlString(pincode) +
          " LIMIT 1"
      ),
      "Serviceable_Pincodes"
    );
    return Boolean(row && isTruthy(row.is_active));
  } catch (_) {
    return false;
  }
}

async function stateHasActiveServiceablePincodes(zcql, state) {
  const normalized = String(state || "").trim();
  if (!normalized) {
    return false;
  }
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Serviceable_Pincodes WHERE is_active = true AND state = " +
          sqlString(normalized) +
          " LIMIT 1"
      ),
      "Serviceable_Pincodes"
    );
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

/**
 * Product-delivery pincode gate with all-India modes:
 * - strict: pincode must be listed in Serviceable_Pincodes
 * - state: listed pincode OR any active pincode exists for destination state
 * - national: any valid 6-digit Indian pincode
 */
async function isDeliveryPincodeDispatchable(zcql, pincode, state) {
  const digits = String(pincode || "").replace(/\D/g, "").slice(0, 6);
  if (digits.length !== 6) {
    return false;
  }
  const mode = productPincodeGateMode();
  if (mode === "national") {
    return true;
  }
  if (await isPincodeListedActive(zcql, digits)) {
    return true;
  }
  if (mode === "state") {
    return stateHasActiveServiceablePincodes(zcql, state);
  }
  return false;
}

module.exports = {
  isPincodeListedActive,
  stateHasActiveServiceablePincodes,
  isDeliveryPincodeDispatchable,
};
