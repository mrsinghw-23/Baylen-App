"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  findNearestQuickStoreForCart,
  buildDarkStoreCandidatesFromTopology,
  evaluateFulfillmentLine,
} = require("../lib/fulfillment-engine");
const { availableOf: inventoryAvailableOf, reserveStock } = require("../lib/inventory-ops");
const { indexOutletsById } = require("../lib/fulfillment-topology");

describe("Quick Commerce inventory formula", () => {
  it("available = on_hand - reserved - committed, never negative", () => {
    const row = {
      quantity_on_hand: 10,
      quantity_reserved: 3,
      quantity_committed: 0,
    };
    assert.equal(inventoryAvailableOf(row), 7);
    assert.equal(
      inventoryAvailableOf({
        quantity_on_hand: 5,
        quantity_reserved: 4,
        quantity_committed: 3,
      }),
      0
    );
  });
});

describe("findNearestQuickStoreForCart", () => {
  const darkStores = [
    {
      store_id: "A",
      warehouse_id: "wh-a",
      distance_km: 1,
      serviceable: true,
    },
    {
      store_id: "B",
      warehouse_id: "wh-b",
      distance_km: 2,
      serviceable: true,
    },
  ];

  it("skips nearer store when it cannot fulfill full requested quantity", () => {
    const lines = [{ product_id: "100", quantity: 5 }];
    const stockMaps = [{ "wh-a": 2, "wh-b": 10 }];
    const picked = findNearestQuickStoreForCart(lines, darkStores, stockMaps);
    assert.equal(picked.warehouse_id, "wh-b");
    assert.equal(picked.distance_km, 2);
  });

  it("requires one warehouse to fulfill every cart line", () => {
    const lines = [
      { product_id: "100", quantity: 1 },
      { product_id: "101", quantity: 1 },
    ];
    const stockMaps = [
      { "wh-a": 5, "wh-b": 0 },
      { "wh-a": 0, "wh-b": 5 },
    ];
    assert.equal(findNearestQuickStoreForCart(lines, darkStores, stockMaps), null);
  });

  it("selects nearest store when it can fulfill all lines", () => {
    const lines = [
      { product_id: "100", quantity: 1 },
      { product_id: "101", quantity: 2 },
    ];
    const stockMaps = [
      { "wh-a": 5, "wh-b": 5 },
      { "wh-a": 5, "wh-b": 5 },
    ];
    const picked = findNearestQuickStoreForCart(lines, darkStores, stockMaps);
    assert.equal(picked.warehouse_id, "wh-a");
  });
});

describe("service radius boundary", () => {
  const topology = {
    warehouses: [{ ROWID: "10", code: "WH-RNC-001", outlet_id: "501", is_default: false }],
    centralWarehouseIds: ["11"],
    outletsById: indexOutletsById([
      {
        ROWID: "501",
        latitude: 23.3782,
        longitude: 85.3315,
        opening_time: "10:00 AM",
        closing_time: "9:00 PM",
        delivery_enabled: true,
        service_radius_km: 3,
        store_type: "RETAIL",
        is_active: true,
      },
    ]),
    centralWarehouses: [{ ROWID: "11", code: "WH-BAN01" }],
    qcWarehouses: [{ ROWID: "10" }],
  };

  it("uses inclusive boundary: distance <= radius is serviceable", () => {
    const openAt = new Date("2026-09-03T14:00:00+05:30");
    const outlet = topology.outletsById.get("501");
    const atStore = buildDarkStoreCandidatesFromTopology(
      topology,
      outlet.latitude,
      outlet.longitude,
      { now: openAt }
    );
    assert.equal(atStore.length, 1);
    assert.equal(atStore[0].serviceable, true);
    assert.equal(atStore[0].distance_km, 0);
  });

  it("rejects Quick Commerce when nearest store is outside configured radius", () => {
    const darkStores = [
      {
        warehouse_id: "10",
        warehouse_code: "WH-RNC-001",
        store_id: "501",
        store_name: "Ranchi",
        distance_km: 3.2,
        service_radius_km: 3,
        serviceable: false,
        is_open: true,
        delivery_enabled: true,
      },
    ];
    const line = evaluateFulfillmentLine({
      product: {
        status: "ACTIVE",
        name: "Serum",
        sku: "MIN-NIA10-30ML",
        quick_commerce_enabled: true,
        ecommerce_enabled: true,
      },
      productId: "100",
      variantId: "200",
      quantity: 1,
      hasLocation: true,
      darkStores,
      topology,
      invRows: [
        {
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 10,
          quantity_reserved: 0,
          quantity_committed: 0,
        },
      ],
      latitude: 23.3782,
      longitude: 85.3315,
    });
    assert.equal(line.quick_commerce.available, false);
  });
});

describe("reservation failure", () => {
  function buildReserveMockApp(onHand, reserved) {
    const inventory = {
      ROWID: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity_on_hand: onHand,
      quantity_reserved: reserved,
      quantity_committed: 0,
      is_active: true,
      status: "ACTIVE",
    };
    return {
      tables: { Inventory: [inventory], Stock_Movements: [] },
      zcql() {
        const tables = this.tables;
        return {
          async executeZCQLQuery(query) {
            const sql = String(query);
            if (sql.includes("FROM Inventory WHERE ROWID")) {
              return [{ Inventory: inventory }];
            }
            if (sql.includes("FROM Inventory")) {
              return [{ Inventory: inventory }];
            }
            if (sql.includes("FROM Stock_Movements")) {
              return [];
            }
            return [];
          },
        };
      },
      datastore() {
        const tables = this.tables;
        return {
          table(name) {
            return {
              async updateRow(payload) {
                Object.assign(inventory, payload);
                return payload;
              },
              async insertRow(payload) {
                tables.Stock_Movements.push({ ROWID: "m1", ...payload });
                return { ROWID: "m1" };
              },
            };
          },
        };
      },
    };
  }

  it("rejects reservation when available < requested", async () => {
    const app = buildReserveMockApp(10, 8);
    await assert.rejects(
      () =>
        reserveStock(app, {
          productId: "100",
          variantId: "200",
          quantity: 3,
          warehouseId: "10",
          referenceId: "9001",
        }),
      (error) => error.code === "INSUFFICIENT_STOCK"
    );
    assert.equal(Number(app.tables.Inventory[0].quantity_reserved), 8);
  });
});
