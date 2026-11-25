"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  processInventoryImportJob,
  createInventoryImportJob,
  previewInventoryImport,
  resolveFinalStatus,
} = require("../lib/inventory-import-pipeline");
const {
  LOCAL_LOCKS,
} = require("../lib/import-job-lock");
const {
  acquireJobLock,
  releaseJobLock,
  getInventoryImportJob,
  cancelInventoryImportJob,
  retryInventoryImportJob,
  runInventoryImportWorker,
  queueInventoryImportWorker,
  processNextQueuedInventoryJobs,
  isTerminalStatus,
} = require("../lib/inventory-import-worker");
const { resetRuntimeConfigCache } = require("../lib/runtime-config");

const WH1 = "WH-RNC-001";
const SKU = "MIN-NIA10-30ML";

function buildMockApp(state = {}) {
  const tables = state.tables || {
    Warehouses: [{ ROWID: "10", code: WH1, name: "QC 1", is_active: true }],
    Product_Variants: [{ ROWID: "200", product_id: "100", sku: SKU, is_active: true }],
    Products: [],
    Inventory: state.initialInventory || [],
    Stock_Movements: [],
    Import_Jobs: [],
    Import_Job_Rows: [],
    Import_Errors: [],
    Audit_Logs: [],
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
          if (query.includes("FROM Products WHERE sku =")) return [];
          if (query.includes("FROM Inventory WHERE")) {
            const rows = tables.Inventory.filter((item) => {
              const whMatch = query.match(/warehouse_id = (\d+)/);
              if (whMatch && String(item.warehouse_id) !== whMatch[1]) return false;
              const prodMatch = query.match(/product_id = (\d+)/);
              if (prodMatch && String(item.product_id) !== prodMatch[1]) return false;
              const varMatch = query.match(/variant_id = (\d+)/);
              if (varMatch && String(item.variant_id) !== varMatch[1]) return false;
              if (query.includes("variant_id IS NULL") && item.variant_id) return false;
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
          if (query.includes("FROM Import_Jobs WHERE mode = 'INVENTORY' AND status = 'QUEUED'")) {
            const limitMatch = query.match(/LIMIT (\d+)/);
            const limit = limitMatch ? Number(limitMatch[1]) : Infinity;
            const rows = tables.Import_Jobs.filter(
              (item) =>
                String(item.mode || "").toUpperCase() === "INVENTORY" &&
                String(item.status || "").toUpperCase() === "QUEUED"
            );
            return rows.slice(0, limit).map((row) => ({ Import_Jobs: row }));
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
            const pendingOnly = query.includes("status = 'PENDING'") && !query.includes("status IN");
            const rows = tables.Import_Job_Rows.filter((item) => {
              if (String(item.job_id) !== id) return false;
              if (pendingOnly) return item.status === "PENDING";
              return item.status === "PENDING" || item.status === "FAILED";
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

describe("inventory import worker state machine", () => {
  it("resolveFinalStatus maps outcomes to job states", () => {
    assert.equal(resolveFinalStatus(1, 0, 0, false), "COMPLETED");
    assert.equal(resolveFinalStatus(1, 1, 2, false), "COMPLETED_WITH_ERRORS");
    assert.equal(resolveFinalStatus(0, 0, 3, false), "FAILED");
    assert.equal(resolveFinalStatus(1, 0, 0, true), "CANCELLED");
  });

  it("isTerminalStatus identifies finished jobs", () => {
    assert.equal(isTerminalStatus("COMPLETED"), true);
    assert.equal(isTerminalStatus("COMPLETED_WITH_ERRORS"), true);
    assert.equal(isTerminalStatus("FAILED"), true);
    assert.equal(isTerminalStatus("CANCELLED"), true);
    assert.equal(isTerminalStatus("QUEUED"), false);
    assert.equal(isTerminalStatus("PROCESSING"), false);
  });
});

describe("inventory import worker lock", () => {
  beforeEach(() => {
    LOCAL_LOCKS.clear();
  });

  afterEach(() => {
    LOCAL_LOCKS.clear();
  });

  it("acquireJobLock rejects duplicate workers", () => {
    assert.equal(acquireJobLock("123"), true);
    assert.equal(acquireJobLock("123"), false);
    releaseJobLock("123");
    assert.equal(acquireJobLock("123"), true);
  });

  it("runInventoryImportWorker rejects concurrent processing", async () => {
    const app = buildMockApp({});
    const jobId = "800";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "PROCESSING",
      total_rows: 1,
    });
    acquireJobLock(jobId);
    await assert.rejects(
      () => runInventoryImportWorker(app, jobId),
      (error) => error.status === 409 && error.code === "JOB_ALREADY_PROCESSING"
    );
    releaseJobLock(jobId);
  });
});

describe("inventory import worker job lifecycle", () => {
  beforeEach(() => {
    LOCAL_LOCKS.clear();
  });

  afterEach(() => {
    LOCAL_LOCKS.clear();
  });

  it("createInventoryImportJob sets QUEUED status", async () => {
    const app = buildMockApp({});
    const csv = "warehouse_code,sku,stock\n" + WH1 + "," + SKU + ",25\n";
    const preview = await previewInventoryImport(app, csv);
    const jobId = await createInventoryImportJob(app, {
      filename: "test.csv",
      uploadedBy: "ADMIN",
      csvText: csv,
      preview,
    });
    const job = app.tables.Import_Jobs.find((item) => String(item.ROWID) === String(jobId));
    assert.equal(job.status, "QUEUED");
    assert.equal(app.tables.Import_Job_Rows.length, 1);
  });

  it("processInventoryImportJob rejects when already PROCESSING", async () => {
    const app = buildMockApp({});
    app.tables.Import_Jobs.push({
      ROWID: "810",
      mode: "INVENTORY",
      status: "PROCESSING",
      total_rows: 1,
    });
    await assert.rejects(
      () => processInventoryImportJob(app, "810"),
      (error) => error.status === 409
    );
  });

  it("processInventoryImportJob sets COMPLETED_WITH_ERRORS on partial success", async () => {
    const app = buildMockApp({});
    const jobId = "820";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "QUEUED",
      total_rows: 2,
    });
    app.tables.Import_Job_Rows.push(
      {
        ROWID: "821",
        job_id: jobId,
        row_number: 2,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
      },
      {
        ROWID: "822",
        job_id: jobId,
        row_number: 3,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: "WH-BAD", sku: SKU, stock: "10" }),
      }
    );
    const summary = await processInventoryImportJob(app, jobId);
    assert.equal(summary.status, "COMPLETED_WITH_ERRORS");
    assert.equal(app.tables.Import_Jobs[0].status, "COMPLETED_WITH_ERRORS");
    assert.equal(summary.created_inventory_rows, 1);
    assert.equal(summary.failed_rows, 1);
  });

  it("cancelInventoryImportJob only allows QUEUED or PROCESSING", async () => {
    const app = buildMockApp({});
    app.tables.Import_Jobs.push({
      ROWID: "830",
      mode: "INVENTORY",
      status: "COMPLETED",
      total_rows: 1,
    });
    await assert.rejects(
      () => cancelInventoryImportJob(app, "830"),
      (error) => error.status === 409
    );

    app.tables.Import_Jobs[0].status = "QUEUED";
    const result = await cancelInventoryImportJob(app, "830");
    assert.equal(result.job.status, "CANCELLED");
  });

  it("processInventoryImportJob respects CANCELLED status", async () => {
    const app = buildMockApp({});
    const jobId = "840";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "CANCELLED",
      total_rows: 1,
    });
    const summary = await processInventoryImportJob(app, jobId);
    assert.equal(summary.status, "CANCELLED");
    assert.equal(summary.cancelled, true);
  });

  it("processInventoryImportJob stops when cancelled mid-batch", async () => {
    const app = buildMockApp({});
    const jobId = "850";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "QUEUED",
      total_rows: 2,
    });
    app.tables.Import_Job_Rows.push(
      {
        ROWID: "851",
        job_id: jobId,
        row_number: 2,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
      },
      {
        ROWID: "852",
        job_id: jobId,
        row_number: 3,
        status: "PENDING",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "30" }),
      }
    );

    let jobFetchCount = 0;
    const baseZcql = app.zcql.bind(app);
    app.zcql = () => ({
      async executeZCQLQuery(query) {
        if (query.includes("FROM Import_Jobs WHERE ROWID =")) {
          jobFetchCount += 1;
          if (jobFetchCount > 2) {
            app.tables.Import_Jobs[0].status = "CANCELLED";
          }
        }
        if (query.includes("FROM Import_Job_Rows WHERE job_id =") && query.includes("status = 'FAILED'")) {
          return app.tables.Import_Job_Rows.filter(
            (item) => String(item.job_id) === jobId && item.status === "FAILED"
          ).map((row) => ({ Import_Job_Rows: row }));
        }
        if (
          query.includes("FROM Import_Job_Rows WHERE job_id =") &&
          query.includes("status IN ('SUCCESS', 'FAILED')")
        ) {
          return app.tables.Import_Job_Rows.filter(
            (item) =>
              String(item.job_id) === jobId && (item.status === "SUCCESS" || item.status === "FAILED")
          ).map((row) => ({ Import_Job_Rows: row }));
        }
        return baseZcql().executeZCQLQuery(query);
      },
    });

    const summary = await processInventoryImportJob(app, jobId, { batchSize: 1 });
    assert.equal(summary.cancelled, true);
    assert.equal(app.tables.Import_Jobs[0].status, "CANCELLED");
  });

  it("retryInventoryImportJob reprocesses FAILED rows only", async () => {
    const app = buildMockApp({});
    const jobId = "860";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "COMPLETED_WITH_ERRORS",
      total_rows: 2,
      processed_rows: 2,
      created_rows: 1,
      updated_rows: 0,
      failed_rows: 1,
    });
    app.tables.Import_Job_Rows.push(
      {
        ROWID: "861",
        job_id: jobId,
        row_number: 2,
        status: "SUCCESS",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
      },
      {
        ROWID: "862",
        job_id: jobId,
        row_number: 3,
        status: "FAILED",
        payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "30" }),
      }
    );

    const result = await retryInventoryImportJob(app, jobId, { queue: false });
    assert.equal(result.job.status, "COMPLETED");
    assert.equal(app.tables.Import_Job_Rows[1].status, "SUCCESS");
    assert.equal(app.tables.Inventory.length, 1);
    assert.equal(app.tables.Inventory[0].quantity_on_hand, 30);
  });

  it("getInventoryImportJob exposes successful_rows", async () => {
    const app = buildMockApp({});
    app.tables.Import_Jobs.push({
      ROWID: "870",
      mode: "INVENTORY",
      status: "COMPLETED",
      filename: "inv.csv",
      uploaded_by: "OPS",
      total_rows: 5,
      created_rows: 2,
      updated_rows: 3,
      failed_rows: 0,
      processed_rows: 5,
      error_count: 0,
    });
    const job = await getInventoryImportJob(app, "870");
    assert.equal(job.successful_rows, 5);
    assert.equal(job.created_by, "OPS");
    assert.equal(job.filename, "inv.csv");
  });

  it("queueInventoryImportWorker processes inline in development mode", async () => {
    const app = buildMockApp({});
    const jobId = "880";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "QUEUED",
      total_rows: 1,
    });
    app.tables.Import_Job_Rows.push({
      ROWID: "881",
      job_id: jobId,
      row_number: 2,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
    });

    const queued = await queueInventoryImportWorker(app, jobId, { actor: "BG" });
    assert.equal(queued.worker_mode, "inline");
    assert.equal(queued.processed_inline, true);
    assert.equal(queued.queued, false);
    assert.equal(app.tables.Import_Jobs[0].status, "COMPLETED");
    assert.equal(app.tables.Inventory.length, 1);
    assert.equal(app.tables.Stock_Movements[0].reference_type, "IMPORT");
    assert.equal(String(app.tables.Stock_Movements[0].reference_id), jobId);
  });

  it("queueInventoryImportWorker defers in production mode", async () => {
    process.env.BAYLEN_ENV = "production";
    process.env.AUTH_SESSION_SECRET = "x".repeat(32);
    process.env.ADMIN_API_KEY = "y".repeat(32);
    resetRuntimeConfigCache();

    const app = buildMockApp({});
    const jobId = "885";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "QUEUED",
      total_rows: 1,
    });
    app.tables.Import_Job_Rows.push({
      ROWID: "886",
      job_id: jobId,
      row_number: 2,
      status: "PENDING",
      payload_json: JSON.stringify({ warehouse_code: WH1, sku: SKU, stock: "25" }),
    });

    const queued = await queueInventoryImportWorker(app, jobId, { actor: "BG" });
    assert.equal(queued.worker_mode, "deferred");
    assert.equal(queued.processed_inline, false);
    assert.equal(queued.queued, true);
    assert.equal(app.tables.Import_Jobs[0].status, "QUEUED");
    assert.equal(app.tables.Inventory.length, 0);

    const processed = await processNextQueuedInventoryJobs(app, { limit: 1, actor: "CRON" });
    assert.equal(processed.results.length, 1);
    assert.equal(processed.results[0].status, "processed");
    assert.equal(app.tables.Import_Jobs[0].status, "COMPLETED");
  });

  it("processes batches without loading all rows at once", async () => {
    const app = buildMockApp({
      tables: {
        Warehouses: [
          { ROWID: "10", code: WH1, name: "QC 1", is_active: true },
          { ROWID: "11", code: "WH-RNC-002", name: "QC 2", is_active: true },
          { ROWID: "12", code: "WH-RNC-003", name: "QC 3", is_active: true },
        ],
        Product_Variants: [{ ROWID: "200", product_id: "100", sku: SKU, is_active: true }],
        Products: [],
        Inventory: [],
        Stock_Movements: [],
        Import_Jobs: [],
        Import_Job_Rows: [],
        Import_Errors: [],
        Audit_Logs: [],
      },
    });
    const jobId = "890";
    app.tables.Import_Jobs.push({
      ROWID: jobId,
      mode: "INVENTORY",
      status: "QUEUED",
      total_rows: 3,
    });
    const warehouses = [WH1, "WH-RNC-002", "WH-RNC-003"];
    for (let i = 0; i < 3; i += 1) {
      app.tables.Import_Job_Rows.push({
        ROWID: String(891 + i),
        job_id: jobId,
        row_number: i + 2,
        status: "PENDING",
        payload_json: JSON.stringify({
          warehouse_code: warehouses[i],
          sku: SKU,
          stock: String(10 + i),
        }),
      });
    }

    let maxBatchSize = 0;
    const baseZcql = app.zcql.bind(app);
    app.zcql = () => ({
      async executeZCQLQuery(query) {
        if (query.includes("FROM Import_Job_Rows WHERE job_id =") && query.includes("LIMIT")) {
          const limitMatch = query.match(/LIMIT (\d+)/);
          if (limitMatch) maxBatchSize = Math.max(maxBatchSize, Number(limitMatch[1]));
        }
        if (query.includes("FROM Warehouses WHERE code = 'WH-RNC-002'")) {
          return [{ Warehouses: app.tables.Warehouses[1] }];
        }
        if (query.includes("FROM Warehouses WHERE code = 'WH-RNC-003'")) {
          return [{ Warehouses: app.tables.Warehouses[2] }];
        }
        return baseZcql().executeZCQLQuery(query);
      },
    });

    await processInventoryImportJob(app, jobId, { batchSize: 1 });
    assert.equal(maxBatchSize, 1);
    assert.equal(app.tables.Import_Jobs[0].status, "COMPLETED");
    assert.equal(app.tables.Inventory.length, 3);
  });
});
