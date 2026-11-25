"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  standardGeoRoutingEnabled,
  resolveStandardWarehouseList,
  evaluateFulfillmentLine,
  buildDarkStoreCandidatesFromTopology,
} = require("../lib/fulfillment-engine");
const { indexOutletsById } = require("../lib/fulfillment-topology");

const ORIGINAL = process.env.STANDARD_GEO_ROUTING_ENABLED;

beforeEach(() => {
  delete process.env.STANDARD_GEO_ROUTING_ENABLED;
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.STANDARD_GEO_ROUTING_ENABLED;
  else process.env.STANDARD_GEO_ROUTING_ENABLED = ORIGINAL;
});

describe("standard geo routing feature flag", () => {
  it("defaults to disabled", () => {
    assert.equal(standardGeoRoutingEnabled(), false);
  });

  it("enables when STANDARD_GEO_ROUTING_ENABLED=true", () => {
    process.env.STANDARD_GEO_ROUTING_ENABLED = "true";
    assert.equal(standardGeoRoutingEnabled(), true);
  });
});

describe("resolveStandardWarehouseList", () => {
  const topology = {
    warehouses: [
      { ROWID: "10", code: "WH-RNC-001", outlet_id: "501", is_default: false },
      { ROWID: "11", code: "WH-BAN01", outlet_id: null, is_default: true },
      { ROWID: "12", code: "WH-REG01", outlet_id: null, is_default: false },
    ],
    centralWarehouseIds: ["11"],
    outletsById: indexOutletsById([]),
    centralWarehouses: [{ ROWID: "11", code: "WH-BAN01" }],
    qcWarehouses: [{ ROWID: "10" }],
  };

  it("flag OFF returns central warehouses only", () => {
    assert.deepEqual(resolveStandardWarehouseList(topology, 23.3782, 85.3315), ["11"]);
  });

  it("flag ON includes regional non-QC warehouses before central fallback", () => {
    process.env.STANDARD_GEO_ROUTING_ENABLED = "true";
    const list = resolveStandardWarehouseList(topology, 23.3782, 85.3315);
    assert.equal(list[0], "12");
    assert.equal(list[list.length - 1], "11");
    assert.equal(list.includes("10"), false);
  });
});

describe("standard geo fulfillment line regression", () => {
  const topology = {
    warehouses: [
      { ROWID: "10", code: "WH-RNC-001", outlet_id: "501", is_default: false },
      { ROWID: "11", code: "WH-BAN01", outlet_id: null, is_default: true },
    ],
    centralWarehouseIds: ["11"],
    outletsById: indexOutletsById([
      {
        ROWID: "501",
        latitude: 23.3782,
        longitude: 85.3315,
        opening_time: "10:00 AM",
        closing_time: "9:00 PM",
        delivery_enabled: true,
        service_radius_km: 5,
        store_type: "RETAIL",
      },
    ]),
    centralWarehouses: [{ ROWID: "11", code: "WH-BAN01" }],
    qcWarehouses: [{ ROWID: "10" }],
  };

  it("flag OFF: Standard uses WH-BAN01 central stock", () => {
    const darkStores = buildDarkStoreCandidatesFromTopology(topology, 23.3782, 85.3315, {
      now: new Date("2026-09-03T10:30:00+05:30"),
    });
    const line = evaluateFulfillmentLine({
      product: { status: "ACTIVE", name: "Serum", sku: "MIN-NIA10-30ML", quick_commerce_enabled: true, ecommerce_enabled: true },
      productId: "100",
      variantId: null,
      quantity: 1,
      hasLocation: true,
      darkStores,
      topology,
      invRows: [
        { warehouse_id: "10", product_id: "100", quantity_on_hand: 10, quantity_reserved: 3, quantity_committed: 0 },
        { warehouse_id: "11", product_id: "100", quantity_on_hand: 80, quantity_reserved: 0, quantity_committed: 0 },
      ],
      latitude: 23.3782,
      longitude: 85.3315,
    });
    assert.equal(line.quick_commerce.available, true);
    assert.equal(line.quick_commerce.store.warehouse_code, "WH-RNC-001");
    assert.equal(line.standard_ecommerce.available, true);
    assert.equal(line.standard_ecommerce.warehouse_id, "11");
  });
});
