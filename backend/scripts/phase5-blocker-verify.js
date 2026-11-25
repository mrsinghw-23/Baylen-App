#!/usr/bin/env node
"use strict";
/** Phase 5 final blocker — live Development verification (read-only except worker no-op). */
const path = require("path");
const https = require("https");
const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";
const BASE = "https://baylen-app-60069781151.development.catalystserverless.in";
const PROTECTED_SKU = "MIN-NIA10-30ML";

function request(method, urlPath, headers, body) {
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
        res.on("data", (c) => (data += c));
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

async function requestWithRetry(method, urlPath, headers, body, { attempts = 3 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await request(method, urlPath, headers, body);
    if (last.status !== 404) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return last;
}

function unwrap(list, table) {
  return (list || []).map((item) => (item && item[table] ? item[table] : item));
}

async function getAdminKey() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const f = await endpoints.functionsAPI({ projectId: PROJECT_ID, env: ENV, org: ORG_ID });
  const fn = (await f.getAllFunctions()).find((x) => x.name === "baylen-api");
  const key = fn?.configuration?.environment?.variables?.ADMIN_API_KEY || "";
  if (!key) throw new Error("ADMIN_API_KEY missing on baylen-api");
  return key;
}

async function zcqlQuery(sql) {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const z = await endpoints.zcqlAPI({ projectId: PROJECT_ID, env: ENV, org: ORG_ID });
  return z.query(sql);
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
    .filter((r) => productIds.has(String(r.product_id)))
    .map((r) => ({
      code: whById.get(String(r.warehouse_id)),
      on_hand: Number(r.quantity_on_hand),
      reserved: Number(r.quantity_reserved),
      committed: Number(r.quantity_committed),
      available:
        Number(r.quantity_on_hand) - Number(r.quantity_reserved) - Number(r.quantity_committed),
    }))
    .filter((r) => r.code === "WH-RNC-001" || r.code === "WH-BAN01");
}

async function countOrders() {
  return unwrap(await zcqlQuery("SELECT ROWID FROM Orders"), "Orders").length;
}

async function main() {
  const adminKey = await getAdminKey();
  const adminHeaders = { "x-baylen-admin-key": adminKey };

  const health = await request("GET", "/health", {});
  const dup = await requestWithRetry("GET", "/v1/admin/inventory/duplicate-scan", adminHeaders);
  const worker = await requestWithRetry("POST", "/v1/admin/inventory/import/worker/process", adminHeaders, {
    limit: 1,
    batch_size: 25,
  });
  const workerNoAuth = await requestWithRetry("POST", "/v1/admin/inventory/import/worker/process", {}, { limit: 1 });
  const dupNoAuth = await requestWithRetry("GET", "/v1/admin/inventory/duplicate-scan", {});

  const inventory = await loadProtectedInventory();
  const orders = await countOrders();
  const rnc = inventory.find((x) => x.code === "WH-RNC-001");
  const ban = inventory.find((x) => x.code === "WH-BAN01");

  const report = {
    health: {
      pass: health.status === 200 && health.json?.ok === true && health.json?.data?.status === "up",
      status: health.status,
      ok: health.json?.ok,
      serviceStatus: health.json?.data?.status,
    },
    duplicate_scan: {
      pass:
        dup.status === 200 &&
        dup.json?.ok === true &&
        typeof dup.json?.data?.report?.duplicate_group_count === "number",
      status: dup.status,
      duplicate_group_count: dup.json?.data?.report?.duplicate_group_count,
    },
    worker_process: {
      pass: worker.status === 200 && worker.json?.ok === true && worker.json?.data?.worker_mode,
      status: worker.status,
      worker_mode: worker.json?.data?.worker_mode,
      found: worker.json?.data?.found,
    },
    admin_auth: {
      worker_no_key_status: workerNoAuth.status,
      dup_no_key_status: dupNoAuth.status,
      pass: workerNoAuth.status === 403 && dupNoAuth.status === 403,
    },
    inventory: {
      rows: inventory,
      rncOk: rnc?.on_hand === 10 && rnc?.reserved === 3 && rnc?.committed === 0 && rnc?.available === 7,
      banOk: ban?.on_hand === 80 && ban?.reserved === 0 && ban?.committed === 0 && ban?.available === 80,
    },
    orders: { count: orders, pass: orders === 3 },
  };

  console.log(JSON.stringify(report, null, 2));
  const allPass =
    report.health.pass &&
    report.duplicate_scan.pass &&
    report.duplicate_scan.duplicate_group_count === 0 &&
    report.worker_process.pass &&
    report.admin_auth.pass &&
    report.inventory.rncOk &&
    report.inventory.banOk &&
    report.orders.pass;
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
