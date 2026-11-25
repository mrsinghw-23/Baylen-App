#!/usr/bin/env node
"use strict";

/**
 * PP-002 Dev verification: ZCQL proof for Professional_Jobs + Job_Status_History.
 *
 * Usage:
 *   node backend/scripts/verify-pp002-professional-jobs.js
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
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";

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

  const report = {
    professional_jobs: [],
    job_status_history: [],
    partner_bridge: [],
    service_job_bridge: [],
    order_links: [],
    counts: {},
  };

  const jobs = unwrap(
    await zcql.query(
      "SELECT ROWID, job_number, job_type, reference_type, reference_row_id, delivery_partner_row_id, outlet_row_id, job_status, idempotency_key FROM Professional_Jobs ORDER BY CREATEDTIME DESC LIMIT 20"
    ),
    "Professional_Jobs"
  );
  report.professional_jobs = jobs;
  report.counts.professional_jobs = jobs.length;

  const history = unwrap(
    await zcql.query(
      "SELECT ROWID, professional_job_row_id, old_status, new_status, actor_id, actor_role, reason, happened_at FROM Job_Status_History ORDER BY CREATEDTIME DESC LIMIT 40"
    ),
    "Job_Status_History"
  );
  report.job_status_history = history;
  report.counts.job_status_history = history.length;

  report.partner_bridge = unwrap(
    await zcql.query(
      "SELECT ROWID, outlet_id, outlet_row_id, legacy_provider_id, legacy_provider_row_id FROM Delivery_Partners ORDER BY CREATEDTIME DESC LIMIT 5"
    ),
    "Delivery_Partners"
  );

  report.service_job_bridge = unwrap(
    await zcql.query(
      "SELECT ROWID, booking_number, outlet_id, outlet_row_id, delivery_partner_id, delivery_partner_row_id, status FROM Service_Jobs WHERE delivery_partner_row_id IS NOT NULL ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Service_Jobs"
  );

  report.order_links = unwrap(
    await zcql.query(
      "SELECT ROWID, order_number, payment_method, payment_status, status, professional_job_row_id FROM Orders WHERE professional_job_row_id IS NOT NULL ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Orders"
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
