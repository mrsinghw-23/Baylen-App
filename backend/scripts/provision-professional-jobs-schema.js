#!/usr/bin/env node
"use strict";

/**
 * Provisions Professional_Jobs + Job_Status_History for PP-002 on Catalyst Data Store.
 *
 * Usage:
 *   node backend/scripts/provision-professional-jobs-schema.js
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

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function varchar(name, max, { mandatory = false, def, unique = false } = {}) {
  const col = {
    column_name: name,
    data_type: "varchar",
    max_length: max,
    is_mandatory: mandatory ? "true" : "false",
    is_unique: unique ? "true" : "false",
    search_index_enabled: unique ? "true" : "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function intCol(name, { mandatory = false, def } = {}) {
  const col = {
    column_name: name,
    data_type: "int",
    is_mandatory: mandatory ? "true" : "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function bigintCol(name, { mandatory = false, unique = false } = {}) {
  return {
    column_name: name,
    data_type: "bigint",
    is_mandatory: mandatory ? "true" : "false",
    is_unique: unique ? "true" : "false",
    search_index_enabled: "true",
    audit_consent: "false",
  };
}

const ALTERS = {
  Delivery_Partners: [bigintCol("outlet_row_id"), bigintCol("legacy_provider_row_id"), bigintCol("legacy_rider_row_id")],
  Service_Jobs: [bigintCol("outlet_row_id")],
  Orders: [bigintCol("professional_job_row_id")],
};

const NEW_TABLES = [
  {
    table_name: "Professional_Jobs",
    columns: [
      varchar("job_number", 30, { mandatory: true, unique: true }),
      varchar("job_type", 20, { mandatory: true }),
      varchar("reference_type", 20, { mandatory: true }),
      bigintCol("reference_row_id", { mandatory: true }),
      bigintCol("delivery_partner_row_id"),
      bigintCol("outlet_row_id"),
      varchar("job_status", 40, { mandatory: true, def: "CREATED" }),
      intCol("job_priority", { def: 0 }),
      varchar("idempotency_key", 80, { mandatory: true, unique: true }),
      varchar("assigned_at", 30),
      varchar("accepted_at", 30),
      varchar("offer_expires_at", 30),
      varchar("started_at", 30),
      varchar("completed_at", 30),
      varchar("metadata_json", 512),
    ],
  },
  {
    table_name: "Job_Status_History",
    columns: [
      bigintCol("professional_job_row_id", { mandatory: true }),
      varchar("old_status", 40),
      varchar("new_status", 40, { mandatory: true }),
      varchar("actor_id", 40),
      varchar("actor_role", 20),
      varchar("reason", 255),
      varchar("metadata_json", 512),
      varchar("happened_at", 30, { mandatory: true }),
    ],
  },
];

async function insertColumns(ds, apiOpts, tableId, tableName, columns, report) {
  let existing;
  try {
    existing = await ds.getColumnDetails(tableId);
  } catch (e) {
    report.errors.push(tableName + ": " + (e.message || e));
    return;
  }
  const names = new Set(existing.map((c) => c.column_name));
  const missing = columns.filter((c) => !names.has(c.column_name));
  if (!missing.length) {
    report.skipped.push(tableName);
    return;
  }
  for (let i = 0; i < missing.length; i += 1) {
    const chunk = missing.slice(i, i + 1);
    await sleep(400);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const api = new API(apiOpts);
    const res = await api.post(
      `/baas/v1/project/${PROJECT_ID}/table/${tableId}/column`,
      {
        body: chunk,
        json: true,
        headers: { "Catalyst-org": ORG_ID, Environment: ENV },
      }
    );
    if (res.status >= 400 || res.body?.status === "failure") {
      report.errors.push(tableName + ": " + JSON.stringify(res.body || res.status));
    } else {
      report.added.push(tableName + ": " + chunk.map((c) => c.column_name).join(", "));
    }
  }
}

async function ensureTables(ds, byName, apiOpts, report) {
  for (const spec of NEW_TABLES) {
    let tableId = byName.get(spec.table_name);
    if (!tableId) {
      await sleep(500);
      Credential.init(config.get(getActiveDC() + ".credential"));
      const api = new API(apiOpts);
      const res = await api.post(`/baas/v1/project/${PROJECT_ID}/table`, {
        body: { table_name: spec.table_name },
        json: true,
        headers: { "Catalyst-org": ORG_ID, Environment: ENV },
      });
      if (res.status >= 400 || res.body?.status === "failure") {
        report.errors.push(
          spec.table_name + ": " + JSON.stringify(res.body || res.status)
        );
        continue;
      }
      tableId = String(res.body.data.table_id || res.body.data.id);
      byName.set(spec.table_name, tableId);
      report.added.push("TABLE " + spec.table_name);
    } else {
      report.skipped.push(spec.table_name + " (exists)");
    }
    await insertColumns(ds, apiOpts, tableId, spec.table_name, spec.columns, report);
  }
}

async function ensureColumns(ds, byName, apiOpts, report) {
  for (const [tableName, columns] of Object.entries(ALTERS)) {
    const tableId = byName.get(tableName);
    if (!tableId) {
      report.errors.push(tableName + ": table missing");
      continue;
    }
    await insertColumns(ds, apiOpts, tableId, tableName, columns, report);
  }
}

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
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
  const report = { added: [], skipped: [], errors: [] };
  await ensureTables(ds, byName, apiOpts, report);
  await ensureColumns(ds, byName, apiOpts, report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
