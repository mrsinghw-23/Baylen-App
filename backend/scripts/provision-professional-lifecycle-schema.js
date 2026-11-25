#!/usr/bin/env node
"use strict";

/**
 * PP-010 — Partner_Notifications + Partner_Support_Tickets tables.
 *
 * Usage:
 *   node backend/scripts/provision-professional-lifecycle-schema.js
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

const NEW_TABLES = [
  {
    table_name: "Partner_Notifications",
    columns: [
      bigintCol("partner_row_id", { mandatory: true }),
      varchar("notification_type", 40, { mandatory: true }),
      varchar("title", 120, { mandatory: true }),
      varchar("body", 512, { mandatory: true }),
      varchar("reference_type", 20),
      bigintCol("reference_id"),
      bigintCol("professional_job_row_id"),
      varchar("delivery_status", 20, { def: "DELIVERED" }),
      varchar("read_at", 30),
      varchar("created_at", 30, { mandatory: true }),
    ],
  },
  {
    table_name: "Partner_Support_Tickets",
    columns: [
      varchar("ticket_number", 30, { mandatory: true, unique: true }),
      bigintCol("partner_row_id", { mandatory: true }),
      bigintCol("professional_job_row_id"),
      varchar("category", 30, { mandatory: true }),
      varchar("message", 512, { mandatory: true }),
      varchar("status", 20, { mandatory: true, def: "OPEN" }),
      varchar("metadata_json", 512),
      varchar("created_at", 30, { mandatory: true }),
      varchar("updated_at", 30, { mandatory: true }),
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
  for (const col of missing) {
    await sleep(400);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const api = new API(apiOpts);
    const res = await api.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/column`, {
      body: [col],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      report.errors.push(tableName + ": " + JSON.stringify(res.body || res.status));
    } else {
      report.added.push(tableName + ": " + col.column_name);
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
        report.errors.push(spec.table_name + ": " + JSON.stringify(res.body || res.status));
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
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
