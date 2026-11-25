#!/usr/bin/env node
"use strict";

/**
 * PP-002 Development smoke: create Professional_Jobs from real Catalyst rows + idempotency checks.
 */

const path = require("path");
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
const API = require(path.join(CLI_LIB, "internal", "api")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));
const {
  ensureProductDeliveryJob,
  ensureHomeServiceJob,
  ensureProductDeliveryJobsForPaidOrder,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-engine"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(rows, table) {
  return (rows || []).map((row) => row[table] || row);
}

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zcql = await endpoints.zcqlAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );

  async function insertRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    await sleep(250);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [payload],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("insert " + tableName + ": " + JSON.stringify(res.body));
    }
    const data = res.body.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first && first[tableName] ? first[tableName] : first;
  }

  async function updateRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined && value !== "") {
        clean[key] = value;
      }
    }
    await sleep(250);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.put(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [clean],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("update " + tableName + ": " + JSON.stringify(res.body));
    }
    return res.body.data;
  }

  const app = {
    zcql() {
      return {
        executeZCQLQuery(query) {
          return zcql.query(String(query));
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            insertRow(payload) {
              return insertRow(name, payload);
            },
            updateRow(payload) {
              return updateRow(name, payload);
            },
          };
        },
      };
    },
  };

  const report = { cases: [], errors: [] };

  const codOrders = unwrap(
    await zcql.query(
      "SELECT ROWID, order_number, payment_method, payment_status, status, parent_order_id FROM Orders WHERE payment_method = 'COD' AND status != 'CANCELLED' ORDER BY CREATEDTIME DESC LIMIT 5"
    ),
    "Orders"
  );
  const paidOrders = unwrap(
    await zcql.query(
      "SELECT ROWID, order_number, payment_method, payment_status, status, parent_order_id FROM Orders WHERE payment_status = 'PAID' AND status != 'CANCELLED' ORDER BY CREATEDTIME DESC LIMIT 5"
    ),
    "Orders"
  );
  const homeJobs = unwrap(
    await zcql.query(
      "SELECT ROWID, booking_number, status, payment_status FROM Service_Jobs WHERE status IN ('CONFIRMED','ASSIGNED','ACCEPTED') ORDER BY CREATEDTIME DESC LIMIT 5"
    ),
    "Service_Jobs"
  );

  async function runCase(label, fn) {
    try {
      const result = await fn();
      report.cases.push({
        label,
        ok: true,
        created: result.created,
        idempotent: result.idempotent,
        job_id: result.job?.id,
        job_type: result.job?.job_type,
        status: result.job?.status,
        reference_row_id: result.job?.reference_row_id,
        idempotency_key: result.job?.idempotency_key,
      });
    } catch (error) {
      report.errors.push({ label, message: error.message, code: error.code || "" });
      report.cases.push({ label, ok: false, error: error.message });
    }
  }

  const codTarget = codOrders.find((row) => !row.parent_order_id) || codOrders[0];
  if (codTarget) {
    const orderId = String(codTarget.ROWID);
    await runCase("cod_job_create", () =>
      ensureProductDeliveryJob(app, orderId, { actorId: "pp002-smoke", actorRole: "system" })
    );
    await runCase("cod_job_idempotent", () =>
      ensureProductDeliveryJob(app, orderId, { actorId: "pp002-smoke", actorRole: "system" })
    );
  }

  const paidTarget = paidOrders.find((row) => !row.parent_order_id) || paidOrders[0];
  if (paidTarget) {
    const orderId = String(paidTarget.ROWID);
    await runCase("paid_job_create", () =>
      ensureProductDeliveryJobsForPaidOrder(app, orderId, {
        actorId: "pp002-smoke",
        actorRole: "system",
      }).then((rows) => rows[0] || { created: false, idempotent: true, job: null })
    );
    await runCase("paid_job_idempotent", () =>
      ensureProductDeliveryJobsForPaidOrder(app, orderId, {
        actorId: "pp002-smoke",
        actorRole: "system",
      }).then((rows) => rows[0] || { created: false, idempotent: true, job: null })
    );
  }

  if (homeJobs[0]) {
    const jobId = String(homeJobs[0].ROWID);
    await runCase("home_service_job_create", () =>
      ensureHomeServiceJob(app, jobId, { actorId: "pp002-smoke", actorRole: "system" })
    );
    await runCase("home_service_job_idempotent", () =>
      ensureHomeServiceJob(app, jobId, { actorId: "pp002-smoke", actorRole: "system" })
    );
  }

  report.professional_jobs = unwrap(
    await zcql.query(
      "SELECT ROWID, job_number, job_type, reference_type, reference_row_id, delivery_partner_row_id, outlet_row_id, job_status, idempotency_key FROM Professional_Jobs ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Professional_Jobs"
  );
  report.job_status_history = unwrap(
    await zcql.query(
      "SELECT ROWID, professional_job_row_id, old_status, new_status, actor_id, actor_role, happened_at FROM Job_Status_History ORDER BY CREATEDTIME DESC LIMIT 20"
    ),
    "Job_Status_History"
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
