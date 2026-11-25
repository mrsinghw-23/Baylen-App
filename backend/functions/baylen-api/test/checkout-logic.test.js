"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  normalizePincode,
  mapServiceableRow,
} = require("../lib/pincode");
const {
  normalizePaymentMethod,
  gatewayProviderFor,
} = require("../lib/checkout-engine");

describe("pincode", () => {
  it("normalizes Indian PIN codes and keeps leading zeroes as text digits", () => {
    assert.equal(normalizePincode("834001"), "834001");
    assert.equal(normalizePincode(" 834001 "), "834001");
    assert.equal(normalizePincode("012345"), "012345");
    assert.throws(() => normalizePincode("123"), /6-digit/);
    assert.throws(() => normalizePincode("abc"), /6-digit/);
  });

  it("maps serviceable, inactive, and missing pincodes", () => {
    const available = mapServiceableRow(
      {
        city: "Ranchi",
        state: "Jharkhand",
        country: "India",
        estimated_delivery_days: 3,
        delivery_zone: "EAST",
        is_active: true,
      },
      "834001"
    );
    assert.equal(available.serviceable, true);
    assert.match(available.eta_label, /days/);
    assert.equal(available.city, "Ranchi");

    const inactive = mapServiceableRow(
      { city: "Ranchi", state: "Jharkhand", is_active: false, estimated_delivery_days: 3 },
      "834001"
    );
    assert.equal(inactive.serviceable, false);
    assert.match(inactive.message, /unavailable/);

    const missing = mapServiceableRow(null, "999999");
    assert.equal(missing.serviceable, false);
  });
});

describe("payment methods", () => {
  it("normalizes COD and online methods", () => {
    assert.equal(normalizePaymentMethod("cod"), "COD");
    assert.equal(normalizePaymentMethod("UPI"), "UPI");
    assert.equal(normalizePaymentMethod("card"), "CARD");
    assert.equal(gatewayProviderFor("UPI"), "RAZORPAY");
    assert.equal(gatewayProviderFor("COD"), "");
  });

  it("rejects unsupported methods", () => {
    assert.throws(() => normalizePaymentMethod("BITCOIN"), /Unsupported/);
  });
});
