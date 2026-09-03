#!/usr/bin/env node
"use strict";

/**
 * Provisions Riders + Delivery_Tracking tables and order/item columns for QC ops.
 * Run when Data Store quota/billing is available:
 *   node backend/scripts/provision-picker-rider-schema.js
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

function varchar(name, max, { mandatory = false, def } = {}) {
  const col = {
    column_name: name,
    data_type: "varchar",
    max_length: max,
    is_mandatory: mandatory ? "true" : "false",
    is_unique: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function bool(name, { def = "true" } = {}) {
  return {
    column_name: name,
    data_type: "boolean",
    default_value: String(def),
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
}

function dbl(name) {
  return {
    column_name: name,
    data_type: "double",
    decimal_digits: 6,
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
}

function bigint(name, { mandatory = false } = {}) {
  return {
    column_name: name,
    data_type: "bigint",
    is_mandatory: mandatory ? "true" : "false",
    is_unique: "false",
    search_index_enabled: "true",
    audit_consent: "false",
  };
}

function datetime(name) {
  return {
    column_name: name,
    data_type: "datetime",
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
}

const NEW_TABLES = {
  Riders: [
    varchar("name", 120, { mandatory: true }),
    varchar("phone", 30, { mandatory: true }),
    varchar("photo_url", 255),
    varchar("vehicle_type", 40),
    varchar("vehicle_number", 40),
    dbl("latitude"),
    dbl("longitude"),
    bool("is_active", { def: "true" }),
    bool("is_available", { def: "true" }),
    bigint("current_order_id"),
  ],
  Delivery_Tracking: [
    bigint("order_id", { mandatory: true }),
    bigint("rider_id"),
    dbl("latitude"),
    dbl("longitude"),
    varchar("status", 40),
    datetime("recorded_at"),
  ],
};

const ALTERS = {
  Orders: [
    varchar("fulfillment_mode", 30),
    varchar("fulfillment_store_id", 40),
    varchar("fulfillment_warehouse_id", 40),
    varchar("fulfillment_rider_id", 40),
    varchar("fulfillment_rider_name", 120),
    varchar("fulfillment_rider_phone", 30),
    dbl("rider_latitude"),
    dbl("rider_longitude"),
  ],
  Order_Items: [
    varchar("fulfillment_type", 30),
    varchar("pick_status", 30, { def: "PENDING" }),
  ],
};

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
  const report = { created: [], columns: [], errors: [] };

  async function insertColumns(tableId, tableName, columns) {
    const existing = await ds.getColumnDetails(tableId);
    const names = new Set(existing.map((c) => c.column_name));
    const missing = columns.filter((c) => !names.has(c.column_name));
    for (let i = 0; i < missing.length; i += 4) {
      const chunk = missing.slice(i, i + 4);
      await sleep(400);
      Credential.init(config.get(getActiveDC() + ".credential"));
      const api = new API(apiOpts);
      const res = await api.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/column`, {
        body: chunk,
        json: true,
        headers: { "Catalyst-org": ORG_ID, Environment: ENV },
      });
      if (res.status >= 400 || res.body?.status === "failure") {
        report.errors.push(tableName + ":" + JSON.stringify(res.body || res.status));
      } else {
        report.columns.push(tableName + ":" + chunk.map((c) => c.column_name).join(","));
      }
    }
  }

  for (const [name, columns] of Object.entries(NEW_TABLES)) {
    let tableId = byName.get(name);
    if (!tableId) {
      await sleep(400);
      Credential.init(config.get(getActiveDC() + ".credential"));
      const api = new API(apiOpts);
      const res = await api.post(`/baas/v1/project/${PROJECT_ID}/table`, {
        body: { table_name: name },
        json: true,
        headers: { "Catalyst-org": ORG_ID, Environment: ENV },
      });
      if (res.status >= 400 || res.body?.status === "failure") {
        report.errors.push("create " + name + ":" + JSON.stringify(res.body || res.status));
        continue;
      }
      tableId = String(res.body.data.table_id || res.body.data.id);
      byName.set(name, tableId);
      report.created.push(name);
    }
    await insertColumns(tableId, name, columns);
  }

  for (const [name, columns] of Object.entries(ALTERS)) {
    const tableId = byName.get(name);
    if (!tableId) {
      report.errors.push(name + ": missing");
      continue;
    }
    await insertColumns(tableId, name, columns);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
