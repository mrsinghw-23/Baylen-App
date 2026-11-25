"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  inventoryCsvObjects,
  validateInventoryRecord,
  previewInventoryImport,
  processInventoryImportJob,
  inventoryTemplateHeaderRow,
} = require("../lib/inventory-import-pipeline");
const {
  inventoryTemplateCsv,
  parseNonNegativeInteger,
  inventoryRowIdentity,
  INVENTORY_MAX_ROWS,
} = require("../lib/inventory-csv-contract");
const { csvObjects, templateHeaderRow } = require("../lib/import-pipeline");

const WH1 = "WH-RNC-001";
const WH2 = "WH-RNC-002";
const SKU = "MIN-NIA10-30ML";
const SKU2 = "LOR-EOHS-100ML";

function buildMockApp(state = {}) {
  const tables = state.tables || {
    Warehouses: [
      { ROWID: "10", code: WH1, name: "QC 1", is_active: true },
      { ROWID: "11", code: WH2, name: "QC 2", is_active: true },
      { ROWID: "12", code: "WH-BAN01", name: "Central", is_active: true, is_default: true },
    ],
    Product_Variants: [{ ROWID: "200", product_id: "100", sku: SKU, is_active: true }],
    Products: [{ ROWID: "100", sku: SKU2, name: "Loreal Oil", status: "ACTIVE" }],
    Inventory: state.initialInventory || [],
    Stock_Movements: [],
    Import_Jobs: [],
    Import_Job_Rows: [],
    Import_Errors: [],
  };
  state.nextId = state.nextId || 1000;

  function nextRowId() {
    state.nextId += 1;
    return String(state.nextId);
  }

  return {
    tables,
    zcql() {
      return {
        async executeZCQLQuery(query) {
          if (query.includes("FROM Warehouses WHERE code = 'WH-BAD'")) return [];
          if (query.includes("FROM Warehouses WHERE ROWID =")) {
            const match = query.match(/ROWID = (\d+)/);
            const id = match ? match[1] : "";
            const row = tables.Warehouses.find(
              (item) => String(item.ROWID) === id && item.is_active !== false
            );
            return row ? [{ Warehouses: row }] : [];
          }
          if (query.includes("FROM Warehouses WHERE code =")) {
            const match = query.match(/code = '([^']+)'/);
            const code = match ? match[1] : "";
            const row = tables.Warehouses.find((item) => item.code === code && item.is_active !== false);
            return row ? [{ Warehouses: row }] : [];
          }
          if (query.includes("FROM Product_Variants WHERE sku =")) {
            const match = query.match(/sku = '([^']+)'/);
            const sku = match ? match[1] : "";
            const row = tables.Product_Variants.find((item) => item.sku === sku);
            return row ? [{ Product_Variants: row }] : [];
          }
          if (query.includes("FROM Products WHERE sku =")) {
            const match = query.match(/sku = '([^']+)'/);
            const sku = match ? match[1] : "";
            const row = tables.Products.find((item) => item.sku === sku);
            return row ? [{ Products: row }] : [];
          }
          if (query.includes("FROM Products WHERE ROWID =")) {
            const match = query.match(/ROWID = (\d+)/);
            const id = match ? match[1] : "";
            const row = tables.Products.find((item) => String(item.ROWID) === id);
            return row ? [{ Products: row }] : [];
          }
          if (query.includes("FROM Inventory WHERE")) {
            const rows = tables.Inventory.filter((item) => {
              if (query.includes("is_active = true") && item.is_active === false) return false;
              if (query.includes("status = 'ACTIVE'") && item.status && item.status !== "ACTIVE") return false;
              const whMatch = query.match(/warehouse_id = (\d+)/);
              if (whMatch && String(item.warehouse_id) !== whMatch[1]) return false;
              const prodMatch = query.match(/product_id = (\d+)/);
              if (prodMatch && String(item.product_id) !== prodMatch[1]) return false;
              const varMatch = query.match(/variant_id = (\d+)/);
              if (varMatch && String(item.variant_id) !== varMatch[1]) return false;
              if (query.includes("variant_id IS NULL") && item.variant_id) return false;
              const invMatch = query.match(/ROWID = (\d+)/);
              if (invMatch && String(item.ROWID) !== invMatch[1]) return false;
              return true;
            });
            return rows.map((row) => ({ Inventory: row }));
          }
          if (query.includes("FROM Import_Jobs WHERE ROWID =")) {
            const match = query.match(/ROWID = (\d+)/);
            const id = match ? match[1] : "";
            const row = tables.Import_Jobs.find((item) => String(item.ROWID) === id);
            return row ? [{ Import_Jobs: row }] : [];
          }
          if (query.includes("FROM Import_Job_Rows WHERE job_id =")) {
            const match = query.match(/job_id = (\d+)/);
            const id = match ? match[1] : "";
            const limitMatch = query.match(/LIMIT (\d+)/);
            const limit = limitMatch ? Number(limitMatch[1]) : Infinity;
            if (query.includes("status = 'FAILED'") && !query.includes("status IN")) {
              return tables.Import_Job_Rows.filter(
                (item) => String(item.job_id) === id && item.status === "FAILED"
              ).map((row) => ({ Import_Job_Rows: row }));
            }
            if (query.includes("status IN ('SUCCESS', 'FAILED')")) {
              return tables.Import_Job_Rows.filter(
                (item) =>
                  String(item.job_id) === id && (item.status === "SUCCESS" || item.status === "FAILED")
              ).map((row) => ({ Import_Job_Rows: row }));
            }
            const pendingOnly = query.includes("status = 'PENDING'");
            const retryable = query.includes("status IN ('PENDING', 'FAILED')");
            const rows = tables.Import_Job_Rows.filter((item) => {
              if (String(item.job_id) !== id) return false;
              if (pendingOnly && !retryable) return item.status === "PENDING";
              if (retryable) return item.status === "PENDING" || item.status === "FAILED";
              return true;
            });
            return rows.slice(0, limit).map((row) => ({ Import_Job_Rows: row }));
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
              const row = { ROWID: nextRowId(), ...payload };
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

function csvRow(warehouse, sku, stock, extras = "") {
  return `${warehouse},${sku},${stock}${extras ? "," + extras : ""}`;
}

describe("inventory CSV contract", () => {
  it("template header matches contract", () => {
    assert.equal(
      inventoryTemplateHeaderRow(),
      "warehouse_code,sku,stock,reorder_level,reorder_quantity,safety_stock"
    );
    assert.ok(inventoryTemplateCsv().includes("WH-RNC-001,MIN-NIA10-30ML,25"));
  });

  it("rejects missing required headers", () => {
    assert.throws(
      () => inventoryCsvObjects("sku,stock\nA,1\n"),
      (error) => error.code === "MISSING_HEADERS"
    );
  });

  it("parses valid rows", () => {
    const rows = inventoryCsvObjects(
      "warehouse_code,sku,stock\nWH-RNC-001,MIN-NIA10-30ML,25\n"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].warehouse_code, "WH-RNC-001");
  });

  it("validates non-negative integer stock", () => {
    assert.deepEqual(parseNonNegativeInteger("25", "stock", { required: true }), { value: 25 });
    assert.equal(parseNonNegativeInteger("-5", "stock", { required: true }).error.code, "INVALID_STOCK");
    assert.equal(parseNonNegativeInteger("1.5", "stock", { required: true }).error.code, "INVALID_STOCK");
    assert.equal(parseNonNegativeInteger("", "stock", { required: true }).error.code, "MISSING_STOCK");
  });

  it("uses warehouse_code + sku identity", () => {
    assert.equal(inventoryRowIdentity(" wh-rnc-001 ", "min-nia10-30ml"), "WH-RNC-001|MIN-NIA10-30ML");
  });
});

describe("inventory import validation", () => {
  it("validates a single valid row", async () => {
    const app = buildMockApp({});
    const seen = new Set();
    const result = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, sku: SKU, stock: "25" },
      seen
    );
    assert.equal(result.ok, true);
    assert.equal(result.normalized.stock, 25);
    assert.equal(result.normalized.warehouse_id, "10");
    assert.equal(result.normalized.product_id, "100");
    assert.equal(result.normalized.variant_id, "200");
  });

  it("allows same SKU in multiple warehouses", async () => {
    const app = buildMockApp({});
    const seen = new Set();
    const first = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, sku: SKU, stock: "25" },
      seen
    );
    const second = await validateInventoryRecord(
      app,
      { row_number: 3, warehouse_code: WH2, sku: SKU, stock: "15" },
      seen
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  it("allows same SKU in ten warehouses", async () => {
    const app = buildMockApp({
      tables: {
        Warehouses: Array.from({ length: 10 }, (_, index) => ({
          ROWID: String(index + 1),
          code: "WH-RNC-" + String(index + 1).padStart(3, "0"),
          is_active: true,
        })),
        Product_Variants: [{ ROWID: "200", product_id: "100", sku: SKU }],
        Products: [],
        Inventory: [],
        Stock_Movements: [],
        Import_Jobs: [],
        Import_Job_Rows: [],
        Import_Errors: [],
      },
    });
    const seen = new Set();
    for (let i = 0; i < 10; i += 1) {
      const result = await validateInventoryRecord(
        app,
        {
          row_number: i + 2,
          warehouse_code: "WH-RNC-" + String(i + 1).padStart(3, "0"),
          sku: SKU,
          stock: "10",
        },
        seen
      );
      assert.equal(result.ok, true, "row " + (i + 2));
    }
  });

  it("rejects unknown warehouse", async () => {
    const app = buildMockApp({});
    const result = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: "WH-BAD", sku: SKU, stock: "10" },
      new Set()
    );
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "WAREHOUSE_NOT_FOUND");
  });

  it("rejects unknown SKU", async () => {
    const app = buildMockApp({});
    const result = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, sku: "MISSING-SKU", stock: "10" },
      new Set()
    );
    assert.equal(result.ok, false);
    assert.equal(result.errors[0].code, "SKU_NOT_FOUND");
  });

  it("rejects missing required fields and duplicate warehouse+sku", async () => {
    const app = buildMockApp({});
    const missingWh = await validateInventoryRecord(
      app,
      { row_number: 2, sku: SKU, stock: "10" },
      new Set()
    );
    assert.equal(missingWh.errors.some((item) => item.field === "warehouse_code"), true);

    const missingSku = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, stock: "10" },
      new Set()
    );
    assert.equal(missingSku.errors.some((item) => item.field === "sku"), true);

    const missingStock = await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, sku: SKU },
      new Set()
    );
    assert.equal(missingStock.errors.some((item) => item.code === "MISSING_STOCK"), true);

    const seen = new Set();
    await validateInventoryRecord(
      app,
      { row_number: 2, warehouse_code: WH1, sku: SKU, stock: "10" },
      seen
    );
    const duplicate = await validateInventoryRecord(
      app,
      { row_number: 3, warehouse_code: WH1, sku: SKU, stock: "12" },
      seen
    );
    assert.equal(duplicate.errors[0].code, "DUPLICATE_INVENTORY_ROW");
  });

  it("accepts optional reorder fields and product-level SKU", async () => {
    const app = buildMockApp({});
    const result = await validateInventoryRecord(
      app,
      {
        row_number: 2,
        warehouse_code: WH1,
        sku: SKU2,
        stock: "10",
        reorder_level: "3",
        reorder_quantity: "10",
        safety_stock: "2",
      },
      new Set()
    );
    assert.equal(result.ok, true);
    assert.equal(result.normalized.variant_id, null);
    assert.equal(result.normalized.reorder_level, 3);
  });
});

describe("inventory import processing", () => {
  it("creates inventory row and stock movement with absolute stock", async () => {
    const app = buildMockApp({});
    const jobId = "900";
    app.tables.Import_Jobs.push({ ROWID: jobId, mode: "INVENTORY", status: "QUEUED", total_rows: 1 });
    app.tables.Import_Job_Rows.push({
      ROWID: "901",
      job_id: jobId,
      row_number: 2,
      sku: SKU,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
    });

    const summary = await processInventoryImportJob(app, jobId, { actor: "TEST" });
    assert.equal(summary.created_inventory_rows, 1);
    assert.equal(app.tables.Inventory.length, 1);
    assert.equal(app.tables.Inventory[0].quantity_on_hand, 25);
    assert.equal(app.tables.Stock_Movements.length, 1);
    assert.equal(app.tables.Stock_Movements[0].movement_type, "STOCK_COUNT");
    assert.equal(app.tables.Stock_Movements[0].after_quantity, 25);
    assert.equal(app.tables.Stock_Movements[0].reference_type, "IMPORT");
  });

  it("updates existing inventory without additive stock", async () => {
    const app = buildMockApp({
      initialInventory: [
        {
          ROWID: "500",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 10,
          quantity_reserved: 0,
          quantity_committed: 0,
          reorder_level: 4,
          reorder_quantity: 8,
          safety_stock: 1,
          status: "ACTIVE",
          is_active: true,
        },
      ],
    });
    const jobId = "910";
    app.tables.Import_Jobs.push({ ROWID: jobId, mode: "INVENTORY", status: "QUEUED", total_rows: 1 });
    app.tables.Import_Job_Rows.push({
      ROWID: "911",
      job_id: jobId,
      row_number: 2,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
    });

    const summary = await processInventoryImportJob(app, jobId);
    assert.equal(summary.updated_inventory_rows, 1);
    assert.equal(app.tables.Inventory.length, 1);
    assert.equal(app.tables.Inventory[0].quantity_on_hand, 25);
    assert.equal(app.tables.Stock_Movements[0].before_quantity, 10);
    assert.equal(app.tables.Stock_Movements[0].after_quantity, 25);
    assert.equal(app.tables.Stock_Movements[0].quantity, 15);
  });

  it("preserves reorder fields when omitted on update", async () => {
    const app = buildMockApp({
      initialInventory: [
        {
          ROWID: "500",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 10,
          reorder_level: 4,
          reorder_quantity: 8,
          safety_stock: 1,
          status: "ACTIVE",
          is_active: true,
        },
      ],
    });
    const jobId = "920";
    app.tables.Import_Jobs.push({ ROWID: jobId, mode: "INVENTORY", status: "QUEUED", total_rows: 1 });
    app.tables.Import_Job_Rows.push({
      ROWID: "921",
      job_id: jobId,
      row_number: 2,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "12" }),
    });
    await processInventoryImportJob(app, jobId);
    assert.equal(app.tables.Inventory[0].reorder_level, 4);
    assert.equal(app.tables.Inventory[0].reorder_quantity, 8);
    assert.equal(app.tables.Inventory[0].safety_stock, 1);
  });

  it("re-importing identical stock remains idempotent", async () => {
    const app = buildMockApp({
      initialInventory: [
        {
          ROWID: "500",
          warehouse_id: "10",
          product_id: "100",
          variant_id: "200",
          quantity_on_hand: 25,
          status: "ACTIVE",
          is_active: true,
        },
      ],
    });
    const jobId = "930";
    app.tables.Import_Jobs.push({ ROWID: jobId, mode: "INVENTORY", status: "QUEUED", total_rows: 1 });
    app.tables.Import_Job_Rows.push({
      ROWID: "931",
      job_id: jobId,
      row_number: 2,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
    });
    await processInventoryImportJob(app, jobId);
    assert.equal(app.tables.Inventory[0].quantity_on_hand, 25);
    assert.equal(app.tables.Stock_Movements[0].quantity, 0);
  });

  it("preview does not modify inventory", async () => {
    const app = buildMockApp({});
    const csv =
      "warehouse_code,sku,stock\n" +
      csvRow(WH1, SKU, "25") +
      "\n" +
      csvRow(WH2, SKU, "15") +
      "\n";
    const preview = await previewInventoryImport(app, csv);
    assert.equal(preview.valid_rows, 2);
    assert.equal(app.tables.Inventory.length, 0);
    assert.equal(app.tables.Stock_Movements.length, 0);
  });

  it("reports partial failures without stopping valid rows", async () => {
    const app = buildMockApp({});
    const jobId = "940";
    app.tables.Import_Jobs.push({ ROWID: jobId, mode: "INVENTORY", status: "QUEUED", total_rows: 1 });
    app.tables.Import_Job_Rows.push(
      {
        ROWID: "941",
        job_id: jobId,
        row_number: 2,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
      },
      {
        ROWID: "942",
        job_id: jobId,
        row_number: 3,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: "WH-BAD", sku: SKU, stock: "10" }),
      }
    );
    const summary = await processInventoryImportJob(app, jobId);
    assert.equal(summary.created_inventory_rows, 1);
    assert.equal(summary.failed_rows, 1);
    assert.equal(app.tables.Import_Errors.length, 1);
  });
});

describe("inventory import scale parsing", () => {
  it("parses 100-row CSV", () => {
    const lines = ["warehouse_code,sku,stock"];
    for (let i = 0; i < 100; i += 1) {
      lines.push("WH-RNC-001,MIN-NIA10-30ML," + (i + 1));
    }
    const rows = inventoryCsvObjects(lines.join("\n"));
    assert.equal(rows.length, 100);
  });

  it("parses 500-row CSV", () => {
    const lines = ["warehouse_code,sku,stock"];
    for (let i = 0; i < 500; i += 1) {
      lines.push("WH-RNC-001,MIN-NIA10-30ML,10");
    }
    const rows = inventoryCsvObjects(lines.join("\n"));
    assert.equal(rows.length, 500);
  });

  it("parses 1000-row CSV", () => {
    const lines = ["warehouse_code,sku,stock"];
    for (let i = 0; i < 1000; i += 1) {
      lines.push("WH-RNC-001,MIN-NIA10-30ML,10");
    }
    const rows = inventoryCsvObjects(lines.join("\n"));
    assert.equal(rows.length, 1000);
  });

  it("rejects rows above parser cap", () => {
    const lines = ["warehouse_code,sku,stock"];
    for (let i = 0; i < INVENTORY_MAX_ROWS + 1; i += 1) {
      lines.push("WH-RNC-001,MIN-NIA10-30ML,10");
    }
    assert.throws(() => inventoryCsvObjects(lines.join("\n")), /supports up to/);
  });
});

describe("product CSV regression", () => {
  it("existing product template header remains unchanged", () => {
    const header = templateHeaderRow();
    assert.ok(header.includes("warehouse_code"));
    assert.ok(header.includes("stock"));
    assert.ok(header.includes("reorder_level"));
    assert.ok(header.includes("product_code"));
  });

  it("existing product csvObjects still requires product headers", () => {
    assert.throws(
      () => csvObjects("warehouse_code,sku,stock\nWH-RNC-001,MIN-NIA10-30ML,25\n"),
      (error) => error.code === "MISSING_HEADERS"
    );
  });
});
