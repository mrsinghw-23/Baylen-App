"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  computeLowStockStatus,
  mapLowStockRow,
  summarizeLowStockRows,
} = require("../lib/low-stock-engine");
const { recordLowStockTransition, readLastAlertStatus } = require("../lib/low-stock-alerts");

describe("low-stock status rules", () => {
  const base = {
    quantity_on_hand: 10,
    quantity_reserved: 0,
    quantity_committed: 0,
    reorder_level: 5,
    safety_stock: 2,
  };

  it("OUT_OF_STOCK when available <= 0", () => {
    assert.equal(computeLowStockStatus({ ...base, quantity_on_hand: 0 }), "OUT_OF_STOCK");
    assert.equal(computeLowStockStatus({ ...base, quantity_reserved: 10 }), "OUT_OF_STOCK");
  });

  it("CRITICAL when available <= safety_stock and > 0", () => {
    assert.equal(computeLowStockStatus({ ...base, quantity_on_hand: 2 }), "CRITICAL");
  });

  it("LOW_STOCK when available <= reorder_level and > safety_stock", () => {
    assert.equal(computeLowStockStatus({ ...base, quantity_on_hand: 4 }), "LOW_STOCK");
  });

  it("IN_STOCK when available > reorder_level", () => {
    assert.equal(computeLowStockStatus({ ...base, quantity_on_hand: 10 }), "IN_STOCK");
  });

  it("does not use global hardcoded <=5 rule", () => {
    assert.equal(
      computeLowStockStatus({
        quantity_on_hand: 6,
        quantity_reserved: 0,
        quantity_committed: 0,
        reorder_level: 3,
        safety_stock: 1,
      }),
      "IN_STOCK"
    );
  });
});

describe("low-stock row mapping", () => {
  it("maps per warehouse product variant fields", () => {
    const row = mapLowStockRow(
      {
        ROWID: "1",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 10,
        quantity_reserved: 3,
        quantity_committed: 0,
        reorder_level: 5,
        reorder_quantity: 20,
        safety_stock: 2,
      },
      { warehouse_code: "WH-RNC-001", sku: "MIN-NIA10-30ML" }
    );
    assert.equal(row.available, 7);
    assert.equal(row.status, "IN_STOCK");
    assert.equal(row.warehouse_code, "WH-RNC-001");
  });
});

describe("low-stock alert deduplication", () => {
  it("emits only on status transition", async () => {
    const cache = new Map();
    const app = {
      cache() {
        return {
          segment() {
            return {
              async getValue(key) {
                return cache.get(key) || null;
              },
              async put(key, value) {
                cache.set(key, value);
              },
            };
          },
        };
      },
      datastore() {
        return {
          table() {
            return { async insertRow() {} };
          },
        };
      },
    };

    const row = mapLowStockRow(
      {
        ROWID: "1",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 4,
        quantity_reserved: 0,
        quantity_committed: 0,
        reorder_level: 5,
        reorder_quantity: 10,
        safety_stock: 2,
      },
      { sku: "SKU" }
    );

    const first = await recordLowStockTransition(app, row);
    assert.equal(first.emitted, true);
    const second = await recordLowStockTransition(app, row);
    assert.equal(second.emitted, false);

    const recovered = mapLowStockRow(
      {
        ROWID: "1",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 20,
        quantity_reserved: 0,
        quantity_committed: 0,
        reorder_level: 5,
        reorder_quantity: 10,
        safety_stock: 2,
      },
      { sku: "SKU" }
    );
    await recordLowStockTransition(app, recovered);
    const lowAgain = mapLowStockRow(
      {
        ROWID: "1",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 4,
        quantity_reserved: 0,
        quantity_committed: 0,
        reorder_level: 5,
        reorder_quantity: 10,
        safety_stock: 2,
      },
      { sku: "SKU" }
    );
    const third = await recordLowStockTransition(app, lowAgain);
    assert.equal(third.emitted, true);

    const last = await readLastAlertStatus(app, row.identity_key);
    assert.equal(last, "LOW_STOCK");
  });
});

describe("low-stock summary", () => {
  it("aggregates status counts", () => {
    const summary = summarizeLowStockRows([
      { status: "IN_STOCK" },
      { status: "LOW_STOCK" },
      { status: "CRITICAL" },
      { status: "OUT_OF_STOCK" },
    ]);
    assert.equal(summary.total_rows, 4);
    assert.equal(summary.low_stock, 1);
    assert.equal(summary.critical, 1);
  });
});
