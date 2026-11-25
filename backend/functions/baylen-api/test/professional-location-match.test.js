"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  placesMatch,
  evaluateLocationEligibility,
} = require("../lib/professional-location-match");
const { normalizeOrderSource, normalizeInboundOrder, validateNormalizedOrder, ORDER_SOURCES } = require("../lib/order-source");

describe("location matching", () => {
  it("matches equivalent state and district names", () => {
    assert.equal(placesMatch("Jharkhand", "jharkhand"), true);
    assert.equal(placesMatch("Ranchi", "ranchi district"), true);
  });

  it("rejects a different state", () => {
    const result = evaluateLocationEligibility(
      { state: "Jharkhand", district: "Ranchi", city: "Ranchi", pincode: "834001" },
      { visit_state: "Bihar", visit_district: "Patna", pincode: "800001" }
    );
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("LOCATION_STATE_MISMATCH"));
  });

  it("accepts same state and district", () => {
    const result = evaluateLocationEligibility(
      { state: "Jharkhand", district: "Ranchi", city: "Ranchi", postal_code: "834001" },
      { visit_state: "Jharkhand", visit_district: "Ranchi", pincode: "834001" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.pincode_match, true);
    assert.equal(result.district_match, true);
  });

  it("allows same-state partners across districts", () => {
    const result = evaluateLocationEligibility(
      { state: "Maharashtra", district: "Pune", city: "Pune", pincode: "411001" },
      { visit_state: "Maharashtra", visit_district: "Mumbai", pincode: "400001" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.district_match, false);
  });

  it("does not reject legacy city-only jobs when partner location is empty", () => {
    const result = evaluateLocationEligibility(
      { state: "", district: "", city: "" },
      { visit_city: "Ranchi" }
    );
    assert.equal(result.ok, true);
  });

  it("accepts matching service zones", () => {
    const result = evaluateLocationEligibility(
      {
        country: "India",
        state: "Jharkhand",
        district: "Ranchi",
        service_zone: "North Ranchi",
      },
      {
        country: "India",
        visit_state: "Jharkhand",
        visit_district: "Ranchi",
        service_zone: "north ranchi",
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.service_zone_match, true);
  });
});

describe("order source abstraction", () => {
  it("normalizes third-party payloads without creating dummy data", () => {
    assert.equal(normalizeOrderSource("third_party"), ORDER_SOURCES.THIRD_PARTY);
    const order = normalizeInboundOrder({
      external_order_id: "EXT-1",
      state: "Jharkhand",
      district: "Ranchi",
      pincode: "834001",
      items: [{ name: "Serum", quantity: 2 }],
    });
    assert.equal(order.order_source, ORDER_SOURCES.THIRD_PARTY);
    assert.equal(validateNormalizedOrder(order).ok, true);
  });
});
