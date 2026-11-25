"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  inventoryIdentityKey,
  pickCanonicalInventoryRow,
  dedupeToCanonicalInventoryRows,
  groupDuplicateInventoryRows,
  buildInventoryDuplicateReport,
} = require("../lib/inventory-identity");
const { planDuplicateRemediation } = require("../lib/inventory-remediation");
const {
  ensureInventoryRow,
  loadInventoryRow,
  reserveStock,
  releaseReservation,
  commitReservation,
  setAbsoluteStock,
  adjustStock,
  transferStock,
  availableOf,
} = require("../lib/inventory-ops");
const {
  stockByWarehouseFromRows,
  pickWarehouseWithStock,
  centralWarehouses,
} = require("../lib/fulfillment-engine");
const { resolveCheckoutPlan } = require("../lib/hybrid-checkout");
const { inventoryRowIdentity } = require("../lib/inventory-csv-contract");

function buildHardeningMockApp(state = {}) {
  const tables = state.tables || {
    Warehouses: [
      { ROWID: "10", code: "WH-RNC-001", is_active: true, is_default: false },
      { ROWID: "11", code: "WH-BAN01", is_active: true, is_default: true },
    ],
    Products: [
      { ROWID: "100", sku: "MIN-NIA10-30ML", status: "ACTIVE" },
      { ROWID: "101", sku: "LOR-EOHS-100ML", status: "ACTIVE" },
    ],
    Product_Variants: [{ ROWID: "200", product_id: "100", sku: "MIN-NIA10-30ML" }],
    Inventory: state.initialInventory || [],
    Stock_Movements: [],
  };

  return {
    tables,
    zcql() {
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Inventory WHERE ROWID =")) {
            const match = sql.match(/ROWID = (\d+)/);
            const row = tables.Inventory.find((item) => String(item.ROWID) === match[1]);
            return row ? [{ Inventory: row }] : [];
          }
          if (sql.includes("FROM Inventory")) {
            const rows = tables.Inventory.filter((item) => {
              if (sql.includes("is_active = true") && item.is_active === false) return false;
              if (sql.includes("status = 'ACTIVE'") && item.status && item.status !== "ACTIVE") {
                return false;
              }
              const whMatch = sql.match(/warehouse_id = (\d+)/);
              if (whMatch && String(item.warehouse_id) !== whMatch[1]) return false;
              const whIn = sql.match(/warehouse_id IN \(([^)]+)\)/);
              if (whIn) {
                const ids = whIn[1].split(",").map((part) => part.trim());
                if (!ids.includes(String(item.warehouse_id))) return false;
              }
              const prodMatch = sql.match(/product_id = (\d+)/);
              if (prodMatch && String(item.product_id) !== prodMatch[1]) return false;
              const prodIn = sql.match(/product_id IN \(([^)]+)\)/);
              if (prodIn) {
                const ids = prodIn[1].split(",").map((part) => part.trim());
                if (!ids.includes(String(item.product_id))) return false;
              }
              if (sql.includes("variant_id IS NULL")) {
                return !item.variant_id;
              }
              const varMatch = sql.match(/variant_id = (\d+)/);
              if (varMatch && String(item.variant_id) !== varMatch[1]) return false;
              return true;
            });
            return rows.map((row) => ({ Inventory: row }));
          }
          if (sql.includes("FROM Warehouses")) {
            const idMatch = sql.match(/ROWID = (\d+)/);
            const codeMatch = sql.match(/code = '([^']+)'/);
            let rows = tables.Warehouses.filter((row) => row.is_active !== false);
            if (idMatch) {
              rows = rows.filter((row) => String(row.ROWID) === idMatch[1]);
            } else if (codeMatch) {
              rows = rows.filter((row) => String(row.code) === codeMatch[1]);
            } else if (sql.includes("is_default = true")) {
              rows = rows.filter((row) => row.is_default === true);
            }
            return rows.map((row) => ({ Warehouses: row }));
          }
          if (sql.includes("FROM Products")) {
            return tables.Products.map((row) => ({ Products: row }));
          }
          if (sql.includes("FROM Product_Variants")) {
            return tables.Product_Variants.map((row) => ({ Product_Variants: row }));
          }
          if (sql.includes("FROM Stock_Movements")) {
            let rows = tables.Stock_Movements;
            const refMatch = sql.match(/reference_id = (\d+)/);
            if (refMatch) {
              rows = rows.filter((row) => String(row.reference_id) === refMatch[1]);
            }
            if (sql.includes("movement_type = 'ORDER_RELEASE'")) {
              rows = rows.filter((row) => row.movement_type === "ORDER_RELEASE");
            } else if (sql.includes("movement_type = 'SALE'")) {
              rows = rows.filter((row) => row.movement_type === "SALE");
            } else if (sql.includes("movement_type = 'COMMIT_PENDING'")) {
              rows = rows.filter((row) => row.movement_type === "COMMIT_PENDING");
            } else if (
              sql.includes("movement_type = 'ORDER_RESERVATION'") ||
              sql.includes("movement_type = 'RESERVE'")
            ) {
              rows = rows.filter(
                (row) => row.movement_type === "ORDER_RESERVATION" || row.movement_type === "RESERVE"
              );
            }
            const columns = sql.slice(7, sql.indexOf(" FROM ")).split(",").map(value => value.trim());
            return rows.map((row) => ({ Stock_Movements:
              Object.fromEntries(columns.map(column => [column, row[column]])) }));
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
                ROWID: String(Math.max(499, ...(tables[name] || []).map(row => Number(row.ROWID))) + 1),
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

describe("Phase 5.5 canonical identity", () => {
  it("generates stable warehouse + product + variant keys", () => {
    assert.equal(inventoryIdentityKey("10", "100", "200"), "10|100|200");
    assert.equal(inventoryIdentityKey("10", "100", null), "10|100|NULL");
  });

  it("supports product-level inventory identity", () => {
    const groups = groupDuplicateInventoryRows([
      { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: null },
      { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: null },
    ]);
    assert.equal(groups.length, 1);
  });

  it("supports variant-level inventory identity", () => {
    const groups = groupDuplicateInventoryRows([
      { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: "200" },
      { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: "201" },
    ]);
    assert.equal(groups.length, 0);
  });

  it("allows same SKU in different warehouses", async () => {
    const app = buildHardeningMockApp({});
    await ensureInventoryRow(app, { warehouseId: "10", productId: "100", variantId: "200" });
    await ensureInventoryRow(app, { warehouseId: "11", productId: "100", variantId: "200" });
    assert.equal(app.tables.Inventory.length, 2);
  });

  it("dedupes duplicate rows for read aggregation", () => {
    const rows = dedupeToCanonicalInventoryRows([
      {
        ROWID: "502",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 9,
        quantity_reserved: 0,
        quantity_committed: 0,
        is_active: true,
        status: "ACTIVE",
      },
      {
        ROWID: "501",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 4,
        quantity_reserved: 0,
        quantity_committed: 0,
        is_active: true,
        status: "ACTIVE",
      },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0].ROWID), "501");
    const stock = stockByWarehouseFromRows([
      {
        ROWID: "501",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 4,
        quantity_reserved: 0,
        quantity_committed: 0,
      },
      {
        ROWID: "502",
        warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity_on_hand: 9,
        quantity_reserved: 0,
        quantity_committed: 0,
      },
    ]);
    assert.equal(stock["10"], 4);
  });
});

describe("Phase 5.5 duplicate detection and remediation design", () => {
  it("detects duplicate identity groups", () => {
    const groups = groupDuplicateInventoryRows([
      { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: "200" },
      { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: "200" },
    ]);
    assert.equal(groups[0].duplicate_count, 2);
  });

  it("builds enriched duplicate scan report", async () => {
    const app = buildHardeningMockApp({
      initialInventory: [
        { ROWID: "1", warehouse_id: "10", product_id: "100", variant_id: "200", is_active: true, status: "ACTIVE" },
        { ROWID: "2", warehouse_id: "10", product_id: "100", variant_id: "200", is_active: true, status: "ACTIVE" },
        { ROWID: "3", warehouse_id: "11", product_id: "101", variant_id: "201", is_active: true, status: "ACTIVE" },
      ],
    });
    const report = await buildInventoryDuplicateReport(app.zcql());
    assert.equal(report.total_rows, 3);
    assert.equal(report.unique_identities, 2);
    assert.equal(report.duplicate_group_count, 1);
    assert.equal(report.affected_warehouse_ids[0], "10");
  });

  it("plans remediation without auto-executing merge", () => {
    const plan = planDuplicateRemediation(
      [
        {
          ROWID: "501",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 4,
          quantity_reserved: 1,
          quantity_committed: 0,
          is_active: true,
          status: "ACTIVE",
        },
        {
          ROWID: "502",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 2,
          quantity_reserved: 0,
          quantity_committed: 0,
          is_active: true,
          status: "ACTIVE",
        },
      ],
      { warehouse_code: "WH-RNC-001", sku: "MIN-NIA10-30ML" }
    );
    assert.equal(plan.auto_execute, false);
    assert.equal(plan.requires_admin_confirmation, true);
    assert.equal(plan.canonical_row_id, "501");
    assert.equal(plan.proposed_canonical_update.quantity_on_hand, 6);
    assert.equal(plan.proposed_canonical_update.quantity_reserved, 1);
    assert.deepEqual(plan.orphan_row_ids, ["502"]);
  });
});

describe("Phase 5.5 race-safe ensureInventoryRow", () => {
  it("converges on canonical row after concurrent create attempts", async () => {
    const app = buildHardeningMockApp({});
    const identity = { warehouseId: "10", productId: "100", variantId: "200" };
    const results = await Promise.all([
      ensureInventoryRow(app, identity),
      ensureInventoryRow(app, identity),
      ensureInventoryRow(app, identity),
    ]);
    assert.equal(String(results[0].ROWID), String(results[1].ROWID));
    assert.equal(String(results[1].ROWID), String(results[2].ROWID));
  });
});

describe("Phase 5.5 import identity", () => {
  it("uses warehouse_code + sku file identity", () => {
    assert.equal(inventoryRowIdentity("WH-RNC-001", "MIN-NIA10-30ML"), "WH-RNC-001|MIN-NIA10-30ML");
    assert.notEqual(
      inventoryRowIdentity("WH-RNC-001", "MIN-NIA10-30ML"),
      inventoryRowIdentity("WH-BAN01", "MIN-NIA10-30ML")
    );
  });

  it("resolves import updates through canonical inventory row", async () => {
    const app = buildHardeningMockApp({
      initialInventory: [
        {
          ROWID: "501",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 8,
          quantity_reserved: 0,
          quantity_committed: 0,
          is_active: true,
          status: "ACTIVE",
        },
        {
          ROWID: "502",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 99,
          quantity_reserved: 0,
          quantity_committed: 0,
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
    await setAbsoluteStock(
      app,
      { warehouse_id: "10", product_id: "100", variant_id: "200", quantity_on_hand: 12 },
      "IMPORT"
    );
    const updated = app.tables.Inventory.find((item) => String(item.ROWID) === "501");
    assert.equal(Number(updated.quantity_on_hand), 12);
    const orphan = app.tables.Inventory.find((item) => String(item.ROWID) === "502");
    assert.equal(Number(orphan.quantity_on_hand), 99);
  });
});

describe("Phase 5.5 warehouse-isolated stock operations", () => {
  const baseInventory = [
    {
      ROWID: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity_on_hand: 10,
      quantity_reserved: 3,
      quantity_committed: 0,
      is_active: true,
      status: "ACTIVE",
    },
    {
      ROWID: "502",
      warehouse_id: "11",
      product_id: "100",
      variant_id: "200",
      quantity_on_hand: 80,
      quantity_reserved: 0,
      quantity_committed: 0,
      is_active: true,
      status: "ACTIVE",
    },
  ];

  it("absolute stock update stays warehouse-isolated", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    await setAbsoluteStock(
      app,
      { warehouse_id: "10", product_id: "100", variant_id: "200", quantity_on_hand: 15 },
      "TEST"
    );
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    const central = app.tables.Inventory.find((row) => String(row.ROWID) === "502");
    assert.equal(Number(qc.quantity_on_hand), 15);
    assert.equal(Number(central.quantity_on_hand), 80);
  });

  it("stock adjustment stays warehouse-isolated", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    await adjustStock(
      app,
      { warehouse_id: "10", product_id: "100", variant_id: "200", quantity: -2 },
      "TEST"
    );
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    const central = app.tables.Inventory.find((row) => String(row.ROWID) === "502");
    assert.equal(Number(qc.quantity_on_hand), 8);
    assert.equal(Number(central.quantity_on_hand), 80);
  });

  it("reservation stays warehouse-isolated", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    await reserveStock(app, {
      productId: "100",
      variantId: "200",
      quantity: 2,
      warehouseId: "10",
      referenceId: "9001",
    });
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    const central = app.tables.Inventory.find((row) => String(row.ROWID) === "502");
    assert.equal(Number(qc.quantity_reserved), 5);
    assert.equal(Number(central.quantity_reserved), 0);
  });

  it("release stays on canonical reserved row", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    app.tables.Stock_Movements.push({
      ROWID: "900",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 2,
      reference_type: "ORDER",
      reference_id: "777",
      movement_type: "ORDER_RESERVATION",
    });
    await releaseReservation(app, "777");
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    assert.equal(Number(qc.quantity_reserved), 1);
  });

  it("commit stays on canonical reserved row", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    app.tables.Stock_Movements.push({
      ROWID: "901",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 2,
      reference_type: "ORDER",
      reference_id: "778",
      movement_type: "ORDER_RESERVATION",
    });
    await commitReservation(app, "778");
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    assert.equal(Number(qc.quantity_on_hand), 8);
    assert.equal(Number(qc.quantity_reserved), 1);
    assert.equal(Number(qc.quantity_committed), 2);
  });

  it("release is idempotent", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    app.tables.Stock_Movements.push({
      ROWID: "900",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 2,
      reference_type: "ORDER",
      reference_id: "888",
      movement_type: "ORDER_RESERVATION",
    });
    await releaseReservation(app, "888");
    const afterFirst = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    assert.equal(Number(afterFirst.quantity_reserved), 1);
    const movementCount = app.tables.Stock_Movements.length;
    const again = await releaseReservation(app, "888");
    assert.equal(again.already_released, true);
    assert.equal(app.tables.Stock_Movements.length, movementCount);
    assert.equal(Number(afterFirst.quantity_reserved), 1);
  });

  it("commit is idempotent", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    app.tables.Stock_Movements.push({
      ROWID: "901",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 2,
      reference_type: "ORDER",
      reference_id: "889",
      movement_type: "ORDER_RESERVATION",
    });
    await commitReservation(app, "889");
    const afterFirst = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    assert.equal(Number(afterFirst.quantity_on_hand), 8);
    assert.equal(Number(afterFirst.quantity_committed), 2);
    const movementCount = app.tables.Stock_Movements.length;
    const again = await commitReservation(app, "889");
    assert.equal(again.already_committed, true);
    assert.equal(app.tables.Stock_Movements.length, movementCount);
    assert.equal(Number(afterFirst.quantity_on_hand), 8);
  });

  it("resumes unfinished inventory rows after a partial multi-item commit", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    const stock = app.tables.Inventory.find(row => row.ROWID === "501");
    const second = { ...stock, ROWID: "999", product_id: "101" };
    app.tables.Inventory.push(second);
    for (const inventory of [stock, second]) {
      app.tables.Stock_Movements.push({ ROWID: "r" + inventory.ROWID, inventory_id: inventory.ROWID,
        warehouse_id: inventory.warehouse_id, product_id: inventory.product_id, quantity: 2,
        reference_type: "ORDER", reference_id: "990", movement_type: "RESERVE" });
    }
    // The first row was committed by an earlier execution.
    stock.quantity_on_hand = 8; stock.quantity_reserved = 1; stock.quantity_committed = 2;
    app.tables.Stock_Movements.push({ ROWID: "900", inventory_id: stock.ROWID, quantity: 2,
      reference_type: "ORDER", reference_id: "990", movement_type: "SALE" });
    // Keep mock IDs numeric, just as Catalyst does.
    app.tables.Stock_Movements[0].ROWID = "901";
    app.tables.Stock_Movements[1].ROWID = "902";
    await commitReservation(app, "990");
    assert.equal(stock.quantity_on_hand, 8);
    assert.equal(second.quantity_on_hand, 8);
    assert.equal(app.tables.Stock_Movements.filter(row => row.movement_type === "SALE").length, 2);
  });

  it("fails closed after an uncertain inventory write instead of reducing stock twice", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    app.tables.Stock_Movements.push({ ROWID: "901", inventory_id: "501", warehouse_id: "10",
      product_id: "100", quantity: 2, reference_type: "ORDER", reference_id: "991", movement_type: "RESERVE" });
    const datastore = app.datastore.bind(app);
    app.datastore = () => ({ table: name => {
      const table = datastore().table(name);
      return { ...table, insertRow: async payload => {
        if (name === "Stock_Movements" && payload.movement_type === "SALE") throw new Error("Lost database connection");
        return table.insertRow(payload);
      } };
    } });
    await assert.rejects(commitReservation(app, "991"), /Lost database/);
    const stock = app.tables.Inventory.find(row => row.ROWID === "501");
    assert.equal(stock.quantity_on_hand, 8);
    await assert.rejects(commitReservation(app, "991"), /reconciliation/);
    assert.equal(stock.quantity_on_hand, 8);
  });

  it("transfer moves stock between warehouses without cross-updating source pool", async () => {
    const app = buildHardeningMockApp({ initialInventory: JSON.parse(JSON.stringify(baseInventory)) });
    await transferStock(
      app,
      {
        from_warehouse_id: "11",
        to_warehouse_id: "10",
        product_id: "100",
        variant_id: "200",
        quantity: 5,
      },
      "TEST"
    );
    const qc = app.tables.Inventory.find((row) => String(row.ROWID) === "501");
    const central = app.tables.Inventory.find((row) => String(row.ROWID) === "502");
    assert.equal(Number(qc.quantity_on_hand), 15);
    assert.equal(Number(central.quantity_on_hand), 75);
  });
});

describe("Phase 5.5 fulfillment regression (pure logic)", () => {
  it("Quick Commerce stock math uses WH-RNC-001 pool", () => {
    const rows = [
      {
        warehouse_id: "10",
        quantity_on_hand: 10,
        quantity_reserved: 3,
        quantity_committed: 0,
        ROWID: "501",
        product_id: "100",
        variant_id: "200",
        is_active: true,
        status: "ACTIVE",
      },
      {
        warehouse_id: "11",
        quantity_on_hand: 80,
        quantity_reserved: 0,
        quantity_committed: 0,
        ROWID: "502",
        product_id: "100",
        variant_id: "200",
        is_active: true,
        status: "ACTIVE",
      },
    ];
    const stock = stockByWarehouseFromRows(rows);
    assert.equal(stock["10"], 7);
    assert.equal(stock["11"], 80);
  });

  it("Standard E-commerce picks central warehouse stock", () => {
    const stock = {
      11: 80,
      10: 7,
    };
    const central = centralWarehouses([
      { ROWID: "10", code: "WH-RNC-001", is_default: false },
      { ROWID: "11", code: "WH-BAN01", is_default: true },
    ]);
    const centralIds = central.map((row) => String(row.ROWID));
    assert.equal(pickWarehouseWithStock(stock, centralIds, 1), "11");
  });

  it("Split checkout plan keeps QC and Standard warehouse assignments separate", () => {
    const evaluation = {
      options: [
        {
          mode: "SPLIT",
          available: true,
          groups: [
            {
              mode: "QUICK_COMMERCE",
              items: [
                {
                  product_id: "100",
                  quantity: 1,
                  fulfillment_type: "QUICK_COMMERCE",
                  store: { warehouse_id: "10" },
                },
              ],
            },
            {
              mode: "E_COMMERCE",
              items: [
                {
                  product_id: "101",
                  quantity: 1,
                  fulfillment_type: "E_COMMERCE",
                  warehouse_id: "11",
                },
              ],
            },
          ],
        },
      ],
      items: [],
    };
    const plan = resolveCheckoutPlan(evaluation, "SPLIT", [
      { product_id: "100", quantity: 1, line_total: 100 },
      { product_id: "101", quantity: 1, line_total: 200 },
    ]);
    assert.equal(plan.groups[0].warehouse_id, "10");
    assert.equal(plan.groups[1].warehouse_id, "11");
  });

  it("availableOf preserves on_hand - reserved - committed", () => {
    assert.equal(
      availableOf({ quantity_on_hand: 10, quantity_reserved: 3, quantity_committed: 0 }),
      7
    );
  });
});
