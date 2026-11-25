"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const { evaluateLocationEligibility } = require("../lib/professional-location-match");
const { resolveDispatchCoordinates } = require("../lib/dispatch-location-coords");
const {
  isAllIndiaDispatchEnabled,
  productPincodeGateMode,
} = require("../lib/dispatch-all-india-config");
const { isDeliveryPincodeDispatchable } = require("../lib/dispatch-pincode-gate");
const { evaluatePartnerEligibility } = require("../lib/professional-dispatch-engine");

function mockZcql(handlers = {}) {
  return {
    async executeZCQLQuery(sql) {
      for (const [pattern, fn] of Object.entries(handlers)) {
        if (sql.includes(pattern)) {
          return fn(sql);
        }
      }
      return [];
    },
  };
}

describe("all-India dispatch config", () => {
  const originalAllIndia = process.env.BAYLEN_ALL_INDIA_DISPATCH;
  const originalGate = process.env.DISPATCH_PINCODE_GATE_MODE;

  afterEach(() => {
    if (originalAllIndia === undefined) {
      delete process.env.BAYLEN_ALL_INDIA_DISPATCH;
    } else {
      process.env.BAYLEN_ALL_INDIA_DISPATCH = originalAllIndia;
    }
    if (originalGate === undefined) {
      delete process.env.DISPATCH_PINCODE_GATE_MODE;
    } else {
      process.env.DISPATCH_PINCODE_GATE_MODE = originalGate;
    }
  });

  it("defaults all-India dispatch to enabled", () => {
    delete process.env.BAYLEN_ALL_INDIA_DISPATCH;
    delete process.env.DISPATCH_PINCODE_GATE_MODE;
    assert.equal(isAllIndiaDispatchEnabled(), true);
    assert.equal(productPincodeGateMode(), "national");
  });

  it("supports strict pincode gate when all-India is disabled", () => {
    process.env.BAYLEN_ALL_INDIA_DISPATCH = "false";
    delete process.env.DISPATCH_PINCODE_GATE_MODE;
    assert.equal(isAllIndiaDispatchEnabled(), false);
    assert.equal(productPincodeGateMode(), "strict");
  });
});

describe("dispatch location coordinates", () => {
  it("resolves state centroids for nationwide distance ranking", () => {
    const coords = resolveDispatchCoordinates({ state: "Karnataka" });
    assert.ok(coords);
    assert.equal(coords.source, "state_centroid");
    assert.ok(coords.latitude > 0);
  });

  it("prefers explicit GPS coordinates when present", () => {
    const coords = resolveDispatchCoordinates({
      latitude: 12.9716,
      longitude: 77.5946,
    });
    assert.equal(coords.source, "gps");
    assert.equal(coords.latitude, 12.9716);
  });
});

describe("all-India location matching", () => {
  it("rejects service zone mismatch when job requires a zone", () => {
    const result = evaluateLocationEligibility(
      {
        country: "India",
        state: "Jharkhand",
        district: "Ranchi",
        city: "Ranchi",
        pincode: "834001",
        service_zone: "Zone B",
      },
      {
        country: "India",
        visit_state: "Jharkhand",
        visit_district: "Ranchi",
        pincode: "834001",
        service_zone: "Zone A",
      }
    );
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("LOCATION_SERVICE_ZONE_MISMATCH"));
  });

  it("accepts cross-district partners in the same state", () => {
    const result = evaluateLocationEligibility(
      {
        country: "India",
        state: "Maharashtra",
        district: "Pune",
        city: "Pune",
        pincode: "411001",
      },
      {
        country: "India",
        visit_state: "Maharashtra",
        visit_district: "Mumbai",
        pincode: "400001",
      }
    );
    assert.equal(result.ok, true);
  });
});

describe("all-India dispatch eligibility", () => {
  it("allows independent partners without legacy provider bridge", async () => {
    const zcql = mockZcql({
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const result = await evaluatePartnerEligibility(
      zcql,
      {
        row_id: "36851000001234567",
        status: "active",
        online_status: "ONLINE_AVAILABLE",
        outlet_row_id: "",
        legacy_provider_id: "",
        rating: 4.2,
        availability_schedule: "",
        state: "Karnataka",
        district: "Bengaluru",
        city: "Bengaluru",
        pincode: "560001",
        country: "India",
      },
      {
        id: "36851000009876543",
        job_type: "HOME_SERVICE",
        outlet_row_id: "1001",
      },
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Bengaluru",
        visit_state: "Karnataka",
        visit_district: "Bengaluru",
        pincode: "560001",
        country: "India",
        destination: { latitude: 12.9716, longitude: 77.5946, source: "gps" },
        scheduled_at: "",
        duration_minutes: 60,
      }
    );
    assert.equal(result.eligible, true);
    assert.ok(result.distance_km != null);
  });

  it("allows product delivery for any valid pincode in national gate mode", async () => {
    process.env.DISPATCH_PINCODE_GATE_MODE = "national";
    const zcql = mockZcql({
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const dispatchable = await isDeliveryPincodeDispatchable(zcql, "110001", "Delhi");
    assert.equal(dispatchable, true);

    const result = await evaluatePartnerEligibility(
      zcql,
      {
        row_id: "36851000001234567",
        status: "active",
        online_status: "ONLINE_AVAILABLE",
        outlet_row_id: "1001",
        legacy_rider_id: "901",
        rating: 4.0,
        availability_schedule: "",
        state: "Delhi",
        district: "New Delhi",
        city: "New Delhi",
        pincode: "110001",
      },
      {
        id: "36851000009876543",
        job_type: "PRODUCT_DELIVERY",
        outlet_row_id: "1001",
      },
      {
        kind: "PRODUCT_DELIVERY",
        status: "CONFIRMED",
        payment_status: "PAID",
        payment_method: "ONLINE",
        pincode: "110001",
        visit_state: "Delhi",
        outlet_row_id: "1001",
        destination: { latitude: 28.6139, longitude: 77.209, source: "state_centroid" },
        pickup: { latitude: 28.7041, longitude: 77.1025, source: "outlet" },
        scheduled_at: "",
        duration_minutes: 45,
      }
    );
    assert.equal(result.eligible, true);
    delete process.env.DISPATCH_PINCODE_GATE_MODE;
  });
});
