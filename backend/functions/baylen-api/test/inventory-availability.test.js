"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  availableOf,
  aggregateAvailable,
  availableInWarehouses,
} = require("../lib/inventory-ops");
const { pickWarehouseWithStock, centralWarehouses } = require("../lib/fulfillment-engine");
const { resolveCheckoutPlan } = require("../lib/hybrid-checkout");
const { mapProductModeFlags } = require("../lib/product-availability");

describe("inventory availability helpers", () => {
  it("availableOf subtracts reserved and committed", () => {
    assert.equal(
      availableOf({
        quantity_on_hand: 10,
        quantity_reserved: 3,
        quantity_committed: 2,
      }),
      5
    );
  });

  it("aggregateAvailable sums rows using the authoritative formula", () => {
    const total = aggregateAvailable([
      { quantity_on_hand: 5, quantity_reserved: 1, quantity_committed: 0 },
      { quantity_on_hand: 8, quantity_reserved: 2, quantity_committed: 1 },
    ]);
    assert.equal(total, 9);
  });

  it("availableInWarehouses scopes stock to selected warehouses", () => {
    const rows = [
      { warehouse_id: "1", quantity_on_hand: 10, quantity_reserved: 0, quantity_committed: 0 },
      { warehouse_id: "2", quantity_on_hand: 20, quantity_reserved: 5, quantity_committed: 0 },
    ];
    assert.equal(availableInWarehouses(rows, ["2"]), 15);
    assert.equal(availableInWarehouses(rows, ["1"]), 10);
  });
});

describe("pickWarehouseWithStock", () => {
  const stock = {
    HQ: 80,
    "WH-RNC-001": 0,
    "WH-RNC-002": 5,
  };

  it("picks the first central warehouse with enough Standard stock", () => {
    assert.equal(pickWarehouseWithStock(stock, ["HQ", "WH-RNC-001"], 1), "HQ");
    assert.equal(pickWarehouseWithStock(stock, ["HQ", "WH-RNC-001"], 80), "HQ");
  });

  it("returns null when Standard stock is insufficient at scoped warehouses", () => {
    assert.equal(pickWarehouseWithStock(stock, ["WH-RNC-001"], 1), null);
    assert.equal(pickWarehouseWithStock(stock, ["HQ"], 100), null);
  });
});

describe("centralWarehouses", () => {
  it("prefers default or HQ warehouses for Standard fulfillment", () => {
    const central = centralWarehouses([
      { ROWID: "1", code: "WH-RNC-001", is_default: false },
      { ROWID: "2", code: "WH-BAN01", is_default: true },
    ]);
    assert.equal(central.length, 1);
    assert.equal(String(central[0].ROWID), "2");
  });
});

describe("resolveCheckoutPlan warehouse propagation", () => {
  const cartLines = [
    {
      product_id: "101",
      variant_id: "",
      product_name: "Serum",
      quantity: 1,
      line_total: 499,
    },
  ];

  it("pins Standard E-Commerce reservation to the engine-selected warehouse", () => {
    const evaluation = {
      options: [
        {
          mode: "E_COMMERCE",
          available: true,
          label: "Standard Delivery",
          eta_label: "2–3 days",
          items: [
            {
              product_id: "101",
              variant_id: null,
              quantity: 1,
              fulfillment_type: "E_COMMERCE",
              warehouse_id: "HQ",
            },
          ],
        },
      ],
      items: [
        {
          product_id: "101",
          quick_commerce: { available: false },
          standard_ecommerce: { available: true, warehouse_id: "HQ" },
        },
      ],
    };
    const plan = resolveCheckoutPlan(evaluation, "E_COMMERCE", cartLines);
    assert.equal(plan.groups[0].warehouse_id, "HQ");
    assert.equal(plan.groups[0].lines[0].fulfillment_warehouse_id, "HQ");
  });

  it("pins Quick Commerce reservation to the selected dark-store warehouse", () => {
    const evaluation = {
      options: [
        {
          mode: "QUICK_COMMERCE",
          available: true,
          label: "Quick Commerce",
          eta_label: "15–20 minutes",
          fulfillment_store: {
            store_id: "501",
            warehouse_id: "WH-RNC-001",
          },
          items: [
            {
              product_id: "101",
              variant_id: null,
              quantity: 1,
              fulfillment_type: "QUICK_COMMERCE",
              store: {
                store_id: "501",
                warehouse_id: "WH-RNC-001",
              },
            },
          ],
        },
      ],
      items: [
        {
          product_id: "101",
          quick_commerce: {
            available: true,
            store: { store_id: "501", warehouse_id: "WH-RNC-001" },
          },
          standard_ecommerce: { available: false },
        },
      ],
    };
    const plan = resolveCheckoutPlan(evaluation, "QUICK_COMMERCE", cartLines);
    assert.equal(plan.groups[0].warehouse_id, "WH-RNC-001");
    assert.equal(plan.groups[0].lines[0].fulfillment_warehouse_id, "WH-RNC-001");
  });
});

describe("product mode flags", () => {
  it("defaults null flags to enabled for backward compatibility", () => {
    const flags = mapProductModeFlags({});
    assert.equal(flags.quick_commerce_enabled, true);
    assert.equal(flags.ecommerce_enabled, true);
  });

  it("honours explicit disable flags", () => {
    const flags = mapProductModeFlags({
      quick_commerce_enabled: false,
      ecommerce_enabled: "false",
    });
    assert.equal(flags.quick_commerce_enabled, false);
    assert.equal(flags.ecommerce_enabled, false);
  });
});

describe("fulfillment scenario matrix (pure stock math)", () => {
  const hqOnly = [
    { warehouse_id: "HQ", quantity_on_hand: 10, quantity_reserved: 0, quantity_committed: 0 },
  ];
  const qcOnly = [
    {
      warehouse_id: "WH-RNC-001",
      quantity_on_hand: 4,
      quantity_reserved: 0,
      quantity_committed: 0,
    },
  ];
  const both = hqOnly.concat(qcOnly);
  const committed = [
    { warehouse_id: "HQ", quantity_on_hand: 10, quantity_reserved: 2, quantity_committed: 3 },
  ];

  it("A HQ only → Standard stock exists, Quick pool empty at QC warehouses", () => {
    assert.equal(availableInWarehouses(hqOnly, ["HQ"]), 10);
    assert.equal(availableInWarehouses(hqOnly, ["WH-RNC-001"]), 0);
  });

  it("B Ranchi QC only → Quick pool has stock, Standard central empty", () => {
    assert.equal(availableInWarehouses(qcOnly, ["WH-RNC-001"]), 4);
    assert.equal(availableInWarehouses(qcOnly, ["HQ"]), 0);
  });

  it("C both stocks → both pools available", () => {
    assert.equal(availableInWarehouses(both, ["HQ"]), 10);
    assert.equal(availableInWarehouses(both, ["WH-RNC-001"]), 4);
  });

  it("D no stock → both pools zero", () => {
    assert.equal(aggregateAvailable([]), 0);
  });

  it("E Quick zero, Standard still works", () => {
    assert.equal(availableInWarehouses(hqOnly, ["WH-RNC-001"]), 0);
    assert.equal(availableInWarehouses(hqOnly, ["HQ"]), 10);
  });

  it("F Standard zero, Quick still works", () => {
    assert.equal(availableInWarehouses(qcOnly, ["HQ"]), 0);
    assert.equal(availableInWarehouses(qcOnly, ["WH-RNC-001"]), 4);
  });

  it("G committed stock reduces available quantity", () => {
    assert.equal(availableOf(committed[0]), 5);
    assert.equal(aggregateAvailable(committed), 5);
  });
});
