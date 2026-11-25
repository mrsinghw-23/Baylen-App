"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  inventoryIdentityKey,
  pickCanonicalInventoryRow,
  groupDuplicateInventoryRows,
  loadInventoryRowsByIdentity,
} = require("../lib/inventory-identity");
const { ensureInventoryRow, loadInventoryRow, reserveStock, setAbsoluteStock } = require("../lib/inventory-ops");

function buildIdentityMockApp(state = {}) {
  const tables = state.tables || {
    Warehouses: [{ ROWID: "10", code: "WH-A", is_active: true }],
    Inventory: state.initialInventory || [],
    Stock_Movements: [],
  };

  return {
    tables,
    zcql() {
      return {
        async executeZCQLQuery(query) {
          if (query.includes("FROM Inventory WHERE ROWID =")) {
            const match = query.match(/ROWID = (\d+)/);
            const row = tables.Inventory.find((item) => String(item.ROWID) === match[1]);
            return row ? [{ Inventory: row }] : [];
          }
          if (query.includes("FROM Inventory WHERE")) {
            const rows = tables.Inventory.filter((item) => {
              if (query.includes("is_active = true") && item.is_active === false) return false;
              if (query.includes("status = 'ACTIVE'") && item.status && item.status !== "ACTIVE") {
                return false;
              }
              const whMatch = query.match(/warehouse_id = (\d+)/);
              if (whMatch && String(item.warehouse_id) !== whMatch[1]) return false;
              const prodMatch = query.match(/product_id = (\d+)/);
              if (prodMatch && String(item.product_id) !== prodMatch[1]) return false;
              if (query.includes("variant_id IS NULL")) {
                return !item.variant_id;
              }
              const varMatch = query.match(/variant_id = (\d+)/);
              if (varMatch && String(item.variant_id) !== varMatch[1]) return false;
              return true;
            });
            return rows.map((row) => ({ Inventory: row }));
          }
          if (query.includes("FROM Warehouses")) {
            return tables.Warehouses.map((row) => ({ Warehouses: row }));
          }
          if (query.includes("FROM Stock_Movements")) {
            return tables.Stock_Movements.map((row) => ({ Stock_Movements: row }));
          }
          return [];
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async insertRow(payload) {
              const row = {
                ROWID: String((tables[name]?.length || 0) + 500 + Math.floor(Math.random() * 3)),
                status: "ACTIVE",
                is_active: true,
                quantity_on_hand: 0,
                quantity_reserved: 0,
                quantity_committed: 0,
                ...payload,
              };
              tables[name] = tables[name] || [];
              tables[name].push(row);
              return { ROWID: row.ROWID };
            },
            async updateRow(payload) {
              const row = tables[name].find((item) => String(item.ROWID) === String(payload.ROWID));
              if (row) Object.assign(row, payload);
              return payload;
            },
          };
        },
      };
    },
  };
}

describe("inventory identity helpers", () => {
  it("builds warehouse + product + variant identity keys", () => {
    assert.equal(inventoryIdentityKey("10", "100", "200"), "10|100|200");
    assert.equal(inventoryIdentityKey("10", "100", null), "10|100|NULL");
    assert.equal(inventoryIdentityKey("10", "100", ""), "10|100|NULL");
  });

  it("picks the oldest canonical inventory row when duplicates exist", () => {
    const row = pickCanonicalInventoryRow([
      { ROWID: "20", is_active: true, status: "ACTIVE" },
      { ROWID: "10", is_active: true, status: "ACTIVE" },
    ]);
    assert.equal(String(row.ROWID), "10");
  });

  it("groups duplicate inventory rows by composite identity", () => {
    const groups = groupDuplicateInventoryRows([
      { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: "200" },
      { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: "200" },
      { ROWID: "3", warehouse_id: "11", product_id: "100", variant_id: "200" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].duplicate_count, 2);
    assert.equal(groups[0].warehouse_id, "10");
  });

  it("treats null variant_id as distinct from variant rows", () => {
    const groups = groupDuplicateInventoryRows([
      { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: null },
      { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: "200" },
    ]);
    assert.equal(groups.length, 0);
  });
});

describe("ensureInventoryRow duplicate protection", () => {
  it("returns one row for same warehouse + product + variant", async () => {
    const app = buildIdentityMockApp({});
    const first = await ensureInventoryRow(app, {
      warehouseId: "10",
      productId: "100",
      variantId: "200",
    });
    const second = await ensureInventoryRow(app, {
      warehouseId: "10",
      productId: "100",
      variantId: "200",
    });
    assert.equal(String(first.ROWID), String(second.ROWID));
    assert.equal(app.tables.Inventory.length, 1);
  });

  it("allows same SKU identity in different warehouses", async () => {
    const app = buildIdentityMockApp({
      tables: {
        Warehouses: [
          { ROWID: "10", code: "WH-A", is_active: true },
          { ROWID: "11", code: "WH-B", is_active: true },
        ],
        Inventory: [],
        Stock_Movements: [],
      },
    });
    await ensureInventoryRow(app, { warehouseId: "10", productId: "100", variantId: "200" });
    await ensureInventoryRow(app, { warehouseId: "11", productId: "100", variantId: "200" });
    assert.equal(app.tables.Inventory.length, 2);
  });

  it("allows different variants in the same warehouse", async () => {
    const app = buildIdentityMockApp({});
    await ensureInventoryRow(app, { warehouseId: "10", productId: "100", variantId: "200" });
    await ensureInventoryRow(app, { warehouseId: "10", productId: "100", variantId: "201" });
    assert.equal(app.tables.Inventory.length, 2);
  });

  it("supports product-level inventory with null variant_id", async () => {
    const app = buildIdentityMockApp({});
    const row = await ensureInventoryRow(app, {
      warehouseId: "10",
      productId: "100",
      variantId: null,
    });
    assert.equal(row.variant_id, null);
    const rows = await loadInventoryRowsByIdentity(app.zcql(), {
      warehouseId: "10",
      productId: "100",
      variantId: null,
    });
    assert.equal(rows.length, 1);
  });

  it("returns canonical row when duplicate rows already exist", async () => {
    const app = buildIdentityMockApp({
      initialInventory: [
        {
          ROWID: "501",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 4,
          is_active: true,
          status: "ACTIVE",
        },
        {
          ROWID: "502",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 9,
          is_active: true,
          status: "ACTIVE",
        },
      ],
    });
    const row = await loadInventoryRow(app.zcql(), {
      warehouseId: "10",
      productId: "100",
      variantId: "200",
    });
    assert.equal(String(row.ROWID), "501");
    const ensured = await ensureInventoryRow(app, {
      warehouseId: "10",
      productId: "100",
      variantId: "200",
    });
    assert.equal(String(ensured.ROWID), "501");
    assert.equal(app.tables.Inventory.length, 2);
  });
});

describe("warehouse-scoped stock operations", () => {
  it("reserves stock only from the requested warehouse", async () => {
    const app = buildIdentityMockApp({
      initialInventory: [
        {
          ROWID: "501",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 5,
          quantity_reserved: 0,
          quantity_committed: 0,
          is_active: true,
          status: "ACTIVE",
        },
        {
          ROWID: "502",
          warehouse_id: "11",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 20,
          quantity_reserved: 0,
          quantity_committed: 0,
          is_active: true,
          status: "ACTIVE",
        },
      ],
    });
    const result = await reserveStock(app, {
      productId: "100",
      variantId: "200",
      quantity: 2,
      warehouseId: "10",
      referenceId: "9001",
    });
    assert.equal(result.quantity, 2);
    assert.equal(result.reserved.length, 1);
    assert.equal(String(result.reserved[0].warehouse_id), "10");
    const untouched = app.tables.Inventory.find((row) => String(row.ROWID) === "502");
    assert.equal(Number(untouched.quantity_reserved), 0);
  });

  it("writes stock movements against the canonical inventory row", async () => {
    const app = buildIdentityMockApp({});
    await setAbsoluteStock(
      app,
      {
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 12,
      },
      "TEST"
    );
    assert.equal(app.tables.Stock_Movements.length, 1);
    assert.equal(String(app.tables.Stock_Movements[0].warehouse_id), "10");
    assert.equal(String(app.tables.Stock_Movements[0].product_id), "100");
    assert.equal(String(app.tables.Stock_Movements[0].variant_id), "200");
  });
});

describe("concurrent ensureInventoryRow mitigation", () => {
  it("converges on one canonical row after parallel create attempts", async () => {
    const app = buildIdentityMockApp({});
    const identity = { warehouseId: "10", productId: "100", variantId: "200" };
    const results = await Promise.all([
      ensureInventoryRow(app, identity),
      ensureInventoryRow(app, identity),
    ]);
    assert.equal(String(results[0].ROWID), String(results[1].ROWID));
    const rows = await loadInventoryRowsByIdentity(app.zcql(), identity);
    assert.ok(rows.length >= 1);
    assert.equal(pickCanonicalInventoryRow(rows).ROWID, results[0].ROWID);
  });
});
