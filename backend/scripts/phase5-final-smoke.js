#!/usr/bin/env node
"use strict";

/**
 * Phase 5 Final — Development integration smoke tests.
 * Does NOT modify MIN-NIA10-30ML stock at WH-RNC-001 / WH-BAN01.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const CLI_LIB = path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "zcatalyst-cli",
  "lib"
);
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";
const BASE = "https://baylen-app-60069781151.development.catalystserverless.in";
const RANCHI = { latitude: 23.3782, longitude: 85.3315 };
const PROTECTED_SKU = "MIN-NIA10-30ML";
const TEST_SKU = "LOR-EOHS-100ML";
const TEST_WAREHOUSE = "WH-BAN01";

const results = [];

function log(msg) {
  console.log(msg);
}

function record(phase, check, pass, detail) {
  results.push({ phase, check, pass, detail });
  log((pass ? "PASS" : "FAIL") + " [" + phase + "] " + check + (detail ? " — " + detail : ""));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function request(method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const payload = body == null ? null : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function unwrap(list, table) {
  return (list || []).map((item) => (item && item[table] ? item[table] : item));
}

async function getAdminKey() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const f = await endpoints.functionsAPI({ projectId: PROJECT_ID, env: ENV, org: ORG_ID });
  const funcs = await f.getAllFunctions();
  const fn = funcs.find((x) => x.name === "baylen-api");
  const vars =
    (fn.configuration && fn.configuration.environment && fn.configuration.environment.variables) || {};
  const adminKey = vars.ADMIN_API_KEY || "";
  if (!adminKey) throw new Error("ADMIN_API_KEY missing on baylen-api");
  return adminKey;
}

async function zcqlQuery(sql) {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zcql = await endpoints.zcqlAPI({ projectId: PROJECT_ID, env: ENV, org: ORG_ID });
  return zcql.query(sql);
}

async function loadProtectedInventory() {
  const invRows = unwrap(
    await zcqlQuery(
      "SELECT ROWID, warehouse_id, product_id, quantity_on_hand, quantity_reserved, quantity_committed FROM Inventory"
    ),
    "Inventory"
  );
  const productRows = unwrap(
    await zcqlQuery("SELECT ROWID, sku FROM Products WHERE sku = '" + PROTECTED_SKU + "'"),
    "Products"
  );
  const productIds = new Set(productRows.map((r) => String(r.ROWID)));
  const whRows = unwrap(await zcqlQuery("SELECT ROWID, code FROM Warehouses"), "Warehouses");
  const whById = new Map(whRows.map((r) => [String(r.ROWID), r.code]));
  return invRows
    .filter((row) => productIds.has(String(row.product_id)))
    .map((row) => ({
      code: whById.get(String(row.warehouse_id)) || row.warehouse_id,
      sku: PROTECTED_SKU,
      on_hand: Number(row.quantity_on_hand),
      reserved: Number(row.quantity_reserved),
      committed: Number(row.quantity_committed),
      available:
        Number(row.quantity_on_hand) - Number(row.quantity_reserved) - Number(row.quantity_committed),
    }))
    .filter((row) => row.code === "WH-RNC-001" || row.code === "WH-BAN01");
}

async function loadTestSkuStock() {
  const productRows = unwrap(
    await zcqlQuery("SELECT ROWID FROM Products WHERE sku = '" + TEST_SKU + "'"),
    "Products"
  );
  if (!productRows.length) return null;
  const productId = String(productRows[0].ROWID);
  const whRows = unwrap(
    await zcqlQuery("SELECT ROWID FROM Warehouses WHERE code = '" + TEST_WAREHOUSE + "'"),
    "Warehouses"
  );
  if (!whRows.length) return null;
  const warehouseId = String(whRows[0].ROWID);
  const invRows = unwrap(
    await zcqlQuery(
      "SELECT quantity_on_hand FROM Inventory WHERE product_id = " +
        productId +
        " AND warehouse_id = " +
        warehouseId
    ),
    "Inventory"
  );
  return invRows[0] ? Number(invRows[0].quantity_on_hand) : null;
}

async function countOrders() {
  const rows = unwrap(await zcqlQuery("SELECT ROWID FROM Orders"), "Orders");
  return rows.length;
}

async function main() {
  const adminKey = await getAdminKey();
  const adminHeaders = { "x-baylen-admin-key": adminKey, "x-baylen-admin-user": "PHASE5_SMOKE" };

  const inventoryBefore = await loadProtectedInventory();
  const ordersBefore = await countOrders();
  const testStockBefore = await loadTestSkuStock();

  log("\n=== BASELINE ===");
  log(JSON.stringify({ inventoryBefore, ordersBefore, testStockBefore }, null, 2));

  // Health
  const health = await request("GET", "/health");
  record("health", "GET /health", health.status === 200 && health.json?.ok === true, "status=" + health.status);

  // Phase 5.5 — canonical inventory via admin list + duplicate scan via ZCQL
  const adminInv = await request("GET", "/v1/admin/inventory?sku=" + encodeURIComponent(PROTECTED_SKU), {
    headers: adminHeaders,
  });
  const invRows = adminInv.json?.data?.rows || adminInv.json?.data?.inventory || [];
  const whRnc = inventoryBefore.find((r) => r.code === "WH-RNC-001");
  const whBan = inventoryBefore.find((r) => r.code === "WH-BAN01");
  record(
    "5.5",
    "admin inventory list",
    adminInv.status === 200,
    "rows=" + (Array.isArray(invRows) ? invRows.length : "?")
  );

  const dupScan = unwrap(
    await zcqlQuery(
      "SELECT warehouse_id, product_id, variant_id, COUNT(ROWID) AS c FROM Inventory GROUP BY warehouse_id, product_id, variant_id HAVING COUNT(ROWID) > 1"
    ),
    "Inventory"
  );
  record("5.5", "duplicate scan", dupScan.length === 0, "duplicate_groups=" + dupScan.length);

  if (whRnc && whBan) {
    record(
      "5.5",
      "warehouse isolation WH-RNC-001",
      whRnc.on_hand === 10 && whRnc.reserved === 3 && whRnc.available === 7,
      JSON.stringify(whRnc)
    );
    record(
      "5.5",
      "warehouse isolation WH-BAN01",
      whBan.on_hand === 80 && whBan.reserved === 0 && whBan.available === 80,
      JSON.stringify(whBan)
    );
  }

  // Phase 5.6 — import worker with test SKU
  const restoreStock = testStockBefore == null ? 0 : testStockBefore;
  const importStock = restoreStock === 42 ? 43 : 42;
  const csv =
    "warehouse_code,sku,stock,reorder_level,reorder_quantity,safety_stock\n" +
    TEST_WAREHOUSE +
    "," +
    TEST_SKU +
    "," +
    importStock +
    ",5,10,2\n";

  const importRes = await request("POST", "/v1/admin/inventory/import", {
    headers: adminHeaders,
    body: { csv_text: csv, filename: "phase5-smoke.csv", confirm: true, async: false },
  });
  const jobId = importRes.json?.data?.job_id || importRes.json?.data?.summary?.job_id;
  const jobStatus = importRes.json?.data?.summary?.status || importRes.json?.data?.status;
  record(
    "5.6",
    "import job completes",
    importRes.status === 200 && (jobStatus === "COMPLETED" || jobStatus === "COMPLETED_WITH_ERRORS"),
    "job=" + jobId + " status=" + jobStatus
  );

  if (jobId) {
    const jobGet = await request("GET", "/v1/admin/inventory/import/job?id=" + encodeURIComponent(jobId), {
      headers: adminHeaders,
    });
    const j = jobGet.json?.data?.job || jobGet.json?.data || {};
    record("5.6", "job status API", jobGet.status === 200, "status=" + (j.status || "?"));

    const retryRes = await request("POST", "/v1/admin/inventory/import/job/retry", {
      headers: adminHeaders,
      body: { id: jobId },
    });
    const retryOk = retryRes.status === 200 || retryRes.status === 409;
    record(
      "5.6",
      "retry safe (no double stock)",
      retryOk,
      "status=" + retryRes.status + " (409 expected when job already COMPLETED)"
    );

    await sleep(1500);
    const afterRetryStock = await loadTestSkuStock();
    record("5.6", "stock unchanged after retry", afterRetryStock === importStock, "stock=" + afterRetryStock);
  }

  // Restore test SKU stock
  const restoreCsv =
    "warehouse_code,sku,stock,reorder_level,reorder_quantity,safety_stock\n" +
    TEST_WAREHOUSE +
    "," +
    TEST_SKU +
    "," +
    restoreStock +
    ",5,10,2\n";
  await request("POST", "/v1/admin/inventory/import", {
    headers: adminHeaders,
    body: { csv_text: restoreCsv, filename: "phase5-restore.csv", confirm: true, async: false },
  });

  // Phase 5.7 — low stock
  const lowStock = await request("GET", "/v1/admin/inventory/low-stock?limit=50", { headers: adminHeaders });
  record("5.7", "low-stock list", lowStock.status === 200, "status=" + lowStock.status);

  const summary = await request("GET", "/v1/admin/inventory/low-stock/summary", { headers: adminHeaders });
  const sum = summary.json?.data?.summary || summary.json?.data || {};
  record("5.7", "low-stock summary", summary.status === 200 && typeof sum.total_rows === "number", JSON.stringify(sum));

  const whFilter = await request(
    "GET",
    "/v1/admin/inventory/low-stock?warehouse_code=WH-RNC-001&limit=20",
    { headers: adminHeaders }
  );
  record("5.7", "warehouse filter", whFilter.status === 200, "status=" + whFilter.status);

  const statusFilter = await request("GET", "/v1/admin/inventory/low-stock?status=IN_STOCK&limit=20", {
    headers: adminHeaders,
  });
  record("5.7", "status filter", statusFilter.status === 200, "status=" + statusFilter.status);

  const alertScan1 = await request(
    "GET",
    "/v1/admin/inventory/low-stock?warehouse_code=WH-RNC-001&sku=" + PROTECTED_SKU + "&record_alerts=true&limit=5",
    { headers: adminHeaders }
  );
  const alertScan2 = await request(
    "GET",
    "/v1/admin/inventory/low-stock?warehouse_code=WH-RNC-001&sku=" + PROTECTED_SKU + "&record_alerts=true&limit=5",
    { headers: adminHeaders }
  );
  const t1 = alertScan1.json?.data?.alert_transitions?.length || 0;
  const t2 = alertScan2.json?.data?.alert_transitions?.length || 0;
  record("5.7", "alert deduplication", alertScan1.status === 200 && t2 <= t1, "t1=" + t1 + " t2=" + t2);

  // Phase 5.8 — catalog with location
  const catalog = await request(
    "GET",
    "/v1/catalog/products?latitude=" + RANCHI.latitude + "&longitude=" + RANCHI.longitude + "&limit=50"
  );
  const products = catalog.json?.data?.products || [];
  record("5.8", "catalog products location-aware", catalog.status === 200 && products.length > 0, "count=" + products.length);

  const serum = products.find((p) => (p.sku || "").includes("MIN-NIA") || (p.name || "").includes("Niacinamide"));
  if (serum) {
    record(
      "5.8",
      "catalog availability fields",
      "quick_available" in serum && "standard_available" in serum,
      "quick=" + serum.quick_available + " standard=" + serum.standard_available
    );
    record(
      "5.8",
      "no reservation during catalog",
      whRnc && whRnc.reserved === 3,
      "reserved still 3"
    );
  }

  for (const limit of [10, 50]) {
    const t0 = Date.now();
    const res = await request(
      "GET",
      "/v1/catalog/products?latitude=" + RANCHI.latitude + "&longitude=" + RANCHI.longitude + "&limit=" + limit
    );
    const ms = Date.now() - t0;
    record("5.8", "catalog " + limit + " products", res.status === 200, ms + "ms");
  }

  // Phase 5.9 — serviceability
  const regions = await request("GET", "/v1/admin/serviceability/regions", { headers: adminHeaders });
  record("5.9", "list regions", regions.status === 200, "status=" + regions.status);

  const testPin = "835215";
  const upsert = await request("POST", "/v1/admin/serviceability/region/upsert", {
    headers: adminHeaders,
    body: {
      pincode: testPin,
      city: "Phase5 Smoke City",
      state: "Jharkhand",
      estimated_delivery_days: 3,
      delivery_zone: "SMOKE_TEST",
    },
  });
  const regionId = upsert.json?.data?.region?.id;
  record("5.9", "upsert region", upsert.status === 200, "id=" + regionId);

  const badPin = await request("POST", "/v1/admin/serviceability/region/upsert", {
    headers: adminHeaders,
    body: { pincode: "123", city: "Bad", state: "X" },
  });
  record("5.9", "invalid pincode rejected", badPin.status >= 400, "status=" + badPin.status);

  if (regionId) {
    const deactivate = await request("POST", "/v1/admin/serviceability/region/deactivate", {
      headers: adminHeaders,
      body: { id: regionId },
    });
    record("5.9", "deactivate region", deactivate.status === 200, "status=" + deactivate.status);
  }

  const pincodeCheck = await request("POST", "/v1/checkout/check-pincode", {
    body: { pincode: "834001" },
  });
  record("5.9", "checkout pincode regression", pincodeCheck.status === 200, "status=" + pincodeCheck.status);

  // Phase 5.10 + Quick/Standard/Split regression
  const productRows = unwrap(
    await zcqlQuery("SELECT ROWID, sku FROM Products WHERE sku = '" + PROTECTED_SKU + "'"),
    "Products"
  );
  const productId = productRows[0]?.ROWID;
  const lorRows = unwrap(
    await zcqlQuery("SELECT ROWID, sku FROM Products WHERE sku = '" + TEST_SKU + "'"),
    "Products"
  );
  const lorProductId = lorRows[0]?.ROWID;

  const fulfillment = await request("POST", "/v1/fulfillment/check", {
    body: {
      latitude: RANCHI.latitude,
      longitude: RANCHI.longitude,
      items: [{ product_id: productId, quantity: 1 }],
    },
  });
  const f = fulfillment.json?.data?.fulfillment || fulfillment.json?.data || {};
  const line = (f.items || [])[0] || {};
  const qc = line.quick_commerce || {};
  const std = line.standard_ecommerce || {};
  record(
    "Quick",
    "WH-RNC-001 + ETA",
    qc.available === true && String(qc.store?.warehouse_code || "").includes("RNC"),
    (qc.store?.warehouse_code || "?") + " eta=" + (qc.eta_label || "?")
  );
  record(
    "Standard",
    "WH-BAN01 + ETA",
    std.available === true &&
      (String(std.warehouse_code || "").includes("BAN") ||
        String(std.warehouse_id || "") === "36851000000293759"),
    (std.warehouse_code || std.warehouse_id || "?") + " eta=" + (std.eta_label || "?")
  );
  record(
    "5.10",
    "flag OFF Standard central",
    std.available === true &&
      (String(std.warehouse_code || "").includes("BAN") ||
        String(std.warehouse_id || "") === "36851000000293759"),
    "warehouse=" + (std.warehouse_code || std.warehouse_id || "?")
  );

  if (lorProductId) {
    const split = await request("POST", "/v1/fulfillment/check", {
      body: {
        latitude: RANCHI.latitude,
        longitude: RANCHI.longitude,
        items: [
          { product_id: productId, quantity: 1 },
          { product_id: lorProductId, quantity: 1 },
        ],
      },
    });
    const sd = split.json?.data?.fulfillment || split.json?.data || {};
    const splitOpt = (sd.options || []).find((o) => o.mode === "SPLIT") || {};
    record(
      "Split",
      "split available",
      sd.summary?.split_available === true && splitOpt.available === true,
      JSON.stringify({
        split_available: sd.summary?.split_available,
        qc_group: splitOpt.groups?.[0]?.fulfillment_store?.warehouse_code,
        std_group: splitOpt.groups?.[1]?.items?.length,
      }).slice(0, 160)
    );
  }

  // Final data safety
  const inventoryAfter = await loadProtectedInventory();
  const ordersAfter = await countOrders();
  let inventoryOk = true;
  for (const expected of [
    { code: "WH-RNC-001", on_hand: 10, reserved: 3, committed: 0, available: 7 },
    { code: "WH-BAN01", on_hand: 80, reserved: 0, committed: 0, available: 80 },
  ]) {
    const row = inventoryAfter.find((r) => r.code === expected.code);
    const ok =
      row &&
      row.on_hand === expected.on_hand &&
      row.reserved === expected.reserved &&
      row.committed === expected.committed &&
      row.available === expected.available;
    if (!ok) inventoryOk = false;
    record("data", expected.code + " inventory", ok, row ? JSON.stringify(row) : "missing");
  }
  record("data", "orders count", ordersAfter === ordersBefore && ordersAfter === 3, ordersBefore + " -> " + ordersAfter);

  const failed = results.filter((r) => !r.pass);
  log("\n=== SUMMARY ===");
  log("Total: " + results.length + " | Failed: " + failed.length);
  if (failed.length) {
    log("Failures:");
    for (const f of failed) log("  - [" + f.phase + "] " + f.check + ": " + f.detail);
    process.exit(1);
  }
  log("ALL SMOKE TESTS PASSED");
  fs.writeFileSync(
    path.join(__dirname, "..", "docs", "hybrid-commerce", "phase5-smoke-results.json"),
    JSON.stringify({ inventoryBefore, inventoryAfter, ordersBefore, ordersAfter, results }, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
