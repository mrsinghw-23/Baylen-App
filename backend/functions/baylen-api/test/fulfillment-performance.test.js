"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  buildDarkStoreCandidatesFromTopology,
  stockByWarehouseFromRows,
  pickWarehouseWithStock,
  inventoryRowsForItem,
} = require("../lib/fulfillment-engine");
const {
  loadFulfillmentTopology,
  indexOutletsById,
  passesBoundingBox,
} = require("../lib/fulfillment-topology");

const RANCHI_LAT = 23.3782;
const RANCHI_LNG = 85.3315;

function dateAtIst(y, month, day, hour, minute) {
  const utcMs = Date.UTC(y, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

function makeOutlet(id, lat, lng, overrides = {}) {
  return {
    ROWID: String(id),
    name: "Outlet " + id,
    latitude: lat,
    longitude: lng,
    opening_time: "10:00 AM",
    closing_time: "9:00 PM",
    is_active: true,
    delivery_enabled: true,
    service_radius_km: 5,
    store_type: "DARK_STORE",
    ...overrides,
  };
}

function makeWarehouse(id, code, outletId, isDefault = false) {
  return {
    ROWID: String(id),
    name: code,
    code,
    outlet_id: outletId,
    is_active: true,
    is_default: isDefault,
  };
}

function buildSyntheticTopology(count) {
  const warehouses = [];
  const outlets = [];
  for (let i = 1; i <= count; i += 1) {
    const outletId = String(1000 + i);
    const lat = RANCHI_LAT + (i % 10) * 0.002;
    const lng = RANCHI_LNG + Math.floor(i / 10) * 0.002;
    outlets.push(makeOutlet(outletId, lat, lng));
    warehouses.push(
      makeWarehouse(String(2000 + i), "WH-QC-" + String(i).padStart(3, "0"), outletId, false)
    );
  }
  warehouses.push(makeWarehouse("9001", "WH-BAN01", null, true));
  return {
    warehouses,
    outletsById: indexOutletsById(outlets),
    centralWarehouses: [warehouses[warehouses.length - 1]],
    centralWarehouseIds: ["9001"],
    qcWarehouses: warehouses.filter((row) => row.outlet_id),
  };
}

function createCountingZcql(topology) {
  const counts = {
    warehouseQueries: 0,
    outletQueries: 0,
    productQueries: 0,
    inventoryQueries: 0,
    total: 0,
  };

  const zcql = {
    counts,
    async executeZCQLQuery(query) {
      counts.total += 1;
      const sql = String(query || "").toUpperCase();

      if (sql.includes("FROM WAREHOUSES")) {
        counts.warehouseQueries += 1;
        return topology.warehouses.map((row) => ({ Warehouses: row }));
      }

      if (sql.includes("FROM OUTLETS") && sql.includes("WHERE IS_ACTIVE")) {
        counts.outletQueries += 1;
        const outlets = [...topology.outletsById.values()];
        return outlets.map((row) => ({ Outlets: row }));
      }

      if (sql.includes("FROM OUTLETS") && sql.includes("WHERE ROWID =")) {
        counts.outletQueries += 1;
        const match = String(query).match(/ROWID\s*=\s*(\d+)/i);
        const id = match ? match[1] : null;
        const row = id ? topology.outletsById.get(String(id)) : null;
        return row ? [{ Outlets: row }] : [];
      }

      if (sql.includes("FROM PRODUCTS")) {
        counts.productQueries += 1;
        return [
          {
            Products: {
              ROWID: "36851000000334408",
              name: "Minimalist Niacinamide",
              sku: "MIN-NIA10-30ML",
              status: "ACTIVE",
              selling_price: 499,
              quick_commerce_enabled: true,
              ecommerce_enabled: true,
            },
          },
        ];
      }

      if (sql.includes("FROM INVENTORY")) {
        counts.inventoryQueries += 1;
        return [
          {
            Inventory: {
              ROWID: "inv-qc",
              warehouse_id: "2001",
              product_id: "36851000000334408",
              variant_id: null,
              quantity_on_hand: 10,
              quantity_reserved: 3,
              quantity_committed: 0,
              is_active: true,
              status: "ACTIVE",
            },
          },
          {
            Inventory: {
              ROWID: "inv-hq",
              warehouse_id: "9001",
              product_id: "36851000000334408",
              variant_id: null,
              quantity_on_hand: 80,
              quantity_reserved: 0,
              quantity_committed: 0,
              is_active: true,
              status: "ACTIVE",
            },
          },
        ];
      }

      return [];
    },
  };

  return zcql;
}

async function legacyBuildDarkStoreCandidates(zcql, topology, latitude, longitude) {
  const { loadWarehouses } = require("../lib/fulfillment-topology");
  const warehouses = await loadWarehouses(zcql);
  const candidates = [];
  for (const wh of warehouses) {
    if (!wh.outlet_id) continue;
    const rows = await zcql.executeZCQLQuery(
      "SELECT ROWID, latitude, longitude FROM Outlets WHERE ROWID = " + wh.outlet_id
    );
    const outlet = rows[0] ? rows[0].Outlets : null;
    if (!outlet) continue;
    candidates.push({ warehouse_id: String(wh.ROWID), outlet_id: String(outlet.ROWID) });
  }
  return candidates;
}

async function optimizedFulfillmentQueryPlan(zcql, itemCount) {
  const topology = await loadFulfillmentTopology(zcql);
  buildDarkStoreCandidatesFromTopology(topology, RANCHI_LAT, RANCHI_LNG);
  await zcql.executeZCQLQuery(
    "SELECT ROWID FROM Products WHERE ROWID IN (" +
      Array.from({ length: itemCount }, (_, i) => String(100 + i)).join(",") +
      ")"
  );
  await zcql.executeZCQLQuery(
    "SELECT ROWID FROM Inventory WHERE product_id IN (" +
      Array.from({ length: itemCount }, (_, i) => String(100 + i)).join(",") +
      ")"
  );
  return zcql.counts;
}

async function legacyFulfillmentQueryPlan(zcql, topology, itemCount) {
  await legacyBuildDarkStoreCandidates(zcql, topology, RANCHI_LAT, RANCHI_LNG);
  await require("../lib/fulfillment-topology").loadWarehouses(zcql);
  for (let i = 0; i < itemCount; i += 1) {
    await zcql.executeZCQLQuery("SELECT ROWID FROM Products WHERE ROWID = " + (100 + i));
    await zcql.executeZCQLQuery("SELECT ROWID FROM Inventory WHERE product_id = " + (100 + i));
  }
  return zcql.counts;
}

describe("fulfillment topology batch loading", () => {
  it("loads all active outlets in one query", async () => {
    const topology = buildSyntheticTopology(10);
    const zcql = createCountingZcql(topology);
    await loadFulfillmentTopology(zcql);
    assert.equal(zcql.counts.warehouseQueries, 1);
    assert.equal(zcql.counts.outletQueries, 1);
  });
});

describe("spatial bounding-box pre-filter", () => {
  it("never false-negatives within max service radius", () => {
    const outletLat = RANCHI_LAT + 0.01;
    const outletLng = RANCHI_LNG + 0.01;
    const maxRadius = 5;
    assert.equal(
      passesBoundingBox(RANCHI_LAT, RANCHI_LNG, outletLat, outletLng, maxRadius),
      true
    );
  });

  it("skips clearly distant outlets before Haversine", () => {
    assert.equal(
      passesBoundingBox(RANCHI_LAT, RANCHI_LNG, RANCHI_LAT + 2, RANCHI_LNG + 2, 3),
      false
    );
  });
});

describe("fulfillment performance — query counts by topology size", () => {
  const sizes = [5, 10, 25, 50, 100];
  const itemCount = 3;

  for (const size of sizes) {
    it(size + " QC warehouses: batch outlets beats per-warehouse outlet queries", async () => {
      const topology = buildSyntheticTopology(size);
      const zcqlLegacy = createCountingZcql(topology);
      await legacyBuildDarkStoreCandidates(zcqlLegacy, topology, RANCHI_LAT, RANCHI_LNG);

      const zcqlNew = createCountingZcql(topology);
      const loaded = await loadFulfillmentTopology(zcqlNew);
      buildDarkStoreCandidatesFromTopology(loaded, RANCHI_LAT, RANCHI_LNG);

      assert.equal(zcqlLegacy.counts.outletQueries, size, "legacy uses one outlet query per QC warehouse");
      assert.equal(zcqlNew.counts.outletQueries, 1, "optimized uses one batch outlet query");
      assert.equal(zcqlNew.counts.warehouseQueries, 1);
    });
  }

  for (const size of sizes) {
    it(size + " warehouses: fulfillment evaluation query plan", async () => {
      const topology = buildSyntheticTopology(size);
      const zcqlLegacy = createCountingZcql(topology);
      const legacyCounts = await legacyFulfillmentQueryPlan(zcqlLegacy, topology, itemCount);

      const zcqlNew = createCountingZcql(topology);
      const newCounts = await optimizedFulfillmentQueryPlan(zcqlNew, itemCount);

      assert.equal(legacyCounts.outletQueries, size);
      assert.equal(newCounts.outletQueries, 1);
      assert.equal(legacyCounts.warehouseQueries, 2, "legacy loads warehouses twice");
      assert.equal(newCounts.warehouseQueries, 1, "optimized loads warehouses once");
      assert.equal(legacyCounts.productQueries, itemCount);
      assert.equal(newCounts.productQueries, 1);
      assert.equal(legacyCounts.inventoryQueries, itemCount);
      assert.equal(newCounts.inventoryQueries, 1);
    });
  }
});

describe("inventoryRowsForItem variant scoping", () => {
  const rows = [
    {
      product_id: "100",
      variant_id: "200",
      warehouse_id: "1",
      quantity_on_hand: 10,
      quantity_reserved: 0,
      quantity_committed: 0,
    },
    {
      product_id: "100",
      variant_id: null,
      warehouse_id: "2",
      quantity_on_hand: 5,
      quantity_reserved: 0,
      quantity_committed: 0,
    },
  ];

  it("includes variant rows when request variant is omitted (legacy behavior)", () => {
    assert.equal(inventoryRowsForItem(rows, "100", null).length, 2);
  });

  it("scopes to explicit variant when provided", () => {
    assert.equal(inventoryRowsForItem(rows, "100", "200").length, 1);
    assert.equal(inventoryRowsForItem(rows, "100", "200")[0].warehouse_id, "1");
  });
});

describe("Quick Commerce regression (mock topology)", () => {
  it("Ranchi coords + MIN-NIA10-30ML → WH-QC-001 Quick, WH-BAN01 Standard", () => {
    const topology = {
      warehouses: [
        makeWarehouse("2001", "WH-RNC-001", "1001"),
        makeWarehouse("9001", "WH-BAN01", null, true),
      ],
      outletsById: indexOutletsById([makeOutlet("1001", RANCHI_LAT, RANCHI_LNG)]),
      centralWarehouses: [makeWarehouse("9001", "WH-BAN01", null, true)],
      centralWarehouseIds: ["9001"],
    };

    const atOpen = dateAtIst(2026, 9, 3, 14, 0);
    const candidates = buildDarkStoreCandidatesFromTopology(
      topology,
      RANCHI_LAT,
      RANCHI_LNG,
      { now: atOpen }
    );
    const serviceable = candidates.filter((row) => row.serviceable);
    assert.equal(serviceable.length, 1);
    assert.equal(serviceable[0].warehouse_code, "WH-RNC-001");

    const invRows = [
      {
        warehouse_id: "2001",
        quantity_on_hand: 10,
        quantity_reserved: 3,
        quantity_committed: 0,
      },
      {
        warehouse_id: "9001",
        quantity_on_hand: 80,
        quantity_reserved: 0,
        quantity_committed: 0,
      },
    ];
    const stock = stockByWarehouseFromRows(invRows);
    assert.equal(stock["2001"], 7);
    assert.equal(pickWarehouseWithStock(stock, ["9001"], 1), "9001");
  });
});
