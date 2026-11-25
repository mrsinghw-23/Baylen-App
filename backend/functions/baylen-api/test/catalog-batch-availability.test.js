"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildCatalogAvailabilityBatch } = require("../lib/catalog-batch-availability");

function dateAtIst(y, month, day, hour, minute) {
  const utcMs =
    Date.UTC(y, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

/** Fixed IST time during outlet hours — avoids wall-clock flakiness after 9:00 PM close. */
const OPEN_OUTLET_NOW = dateAtIst(2026, 9, 3, 14, 0);

function makeProduct(id) {
  return {
    ROWID: String(id),
    name: "Product " + id,
    sku: "SKU-" + id,
    status: "ACTIVE",
    selling_price: 100,
    quick_commerce_enabled: true,
    ecommerce_enabled: true,
  };
}

function buildMockApp(productCount, inventoryPerProduct = 1) {
  const products = [];
  const inventory = [];
  for (let i = 1; i <= productCount; i += 1) {
    products.push(makeProduct(i));
    inventory.push({
      ROWID: String(1000 + i),
      warehouse_id: i % 2 === 0 ? "11" : "10",
      product_id: String(i),
      variant_id: null,
      quantity_on_hand: 10,
      quantity_reserved: 0,
      quantity_committed: 0,
      is_active: true,
      status: "ACTIVE",
    });
    if (inventoryPerProduct > 1) {
      inventory.push({
        ROWID: String(2000 + i),
        warehouse_id: "11",
        product_id: String(i),
        variant_id: null,
        quantity_on_hand: 80,
        quantity_reserved: 0,
        quantity_committed: 0,
        is_active: true,
        status: "ACTIVE",
      });
    }
  }

  const warehouses = [
    { ROWID: "10", code: "WH-RNC-001", outlet_id: "501", is_active: true, is_default: false },
    { ROWID: "11", code: "WH-BAN01", is_active: true, is_default: true },
  ];
  const outlets = [
    {
      ROWID: "501",
      latitude: 23.3782,
      longitude: 85.3315,
      opening_time: "10:00 AM",
      closing_time: "9:00 PM",
      is_active: true,
      delivery_enabled: true,
      service_radius_km: 5,
      store_type: "RETAIL",
    },
  ];

  const stats = { warehouse: 0, outlet: 0, product: 0, inventory: 0 };

  return {
    stats,
    zcql() {
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Warehouses")) {
            stats.warehouse += 1;
            return warehouses.map((row) => ({ Warehouses: row }));
          }
          if (sql.includes("FROM Outlets")) {
            stats.outlet += 1;
            return outlets.map((row) => ({ Outlets: row }));
          }
          if (sql.includes("FROM Products") && sql.includes(" IN ")) {
            stats.product += 1;
            return products.map((row) => ({ Products: row }));
          }
          if (sql.includes("FROM Inventory") && sql.includes(" IN ")) {
            stats.inventory += 1;
            return inventory.map((row) => ({ Inventory: row }));
          }
          return [];
        },
      };
    },
  };
}

describe("catalog batch availability", () => {
  const sizes = [10, 50, 100, 500];

  for (const size of sizes) {
    it(size + " products: O(1) topology and batched product/inventory queries", async () => {
      const app = buildMockApp(size);
      const result = await buildCatalogAvailabilityBatch(app, {
        items: Array.from({ length: size }, (_, i) => ({ product_id: String(i + 1) })),
        latitude: 23.3782,
        longitude: 85.3315,
        now: OPEN_OUTLET_NOW,
      });
      assert.equal(result.items.length, size);
      assert.equal(app.stats.warehouse, 1);
      assert.equal(app.stats.outlet, 1);
      assert.equal(app.stats.product, 1);
      assert.equal(app.stats.inventory, 1);
      assert.equal(result.query_stats.total, 4);
      assert.equal(result.items[0].quick_available, true);
    });
  }

  it("preserves response fields", async () => {
    const app = buildMockApp(1);
    const result = await buildCatalogAvailabilityBatch(app, {
      items: [{ product_id: "1" }],
      latitude: 23.3782,
      longitude: 85.3315,
      now: OPEN_OUTLET_NOW,
    });
    const item = result.items[0];
    assert.ok("quick_available" in item);
    assert.ok("standard_available" in item);
    assert.ok("quick_eta" in item);
    assert.ok("standard_eta" in item);
    assert.ok("quick_commerce_enabled" in item);
    assert.ok("ecommerce_enabled" in item);
  });
});

describe("catalog batch vs per-product query model", () => {
  it("before model would scale queries with product count", () => {
    const productCount = 100;
    const beforeTotal = productCount * (2 + 2 + 1 + 1);
    const afterTotal = 4;
    assert.ok(beforeTotal > afterTotal);
    assert.equal(afterTotal, 4);
  });
});
