#!/usr/bin/env node
"use strict";

/**
 * Provisions hybrid-commerce columns when Data Store quota is available.
 * Run later: node backend/scripts/provision-hybrid-commerce-schema.js
 *
 * Does NOT invent Catalyst features — only extends existing tables.
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

function dbl(name, { def } = {}) {
  const col = {
    column_name: name,
    data_type: "double",
    decimal_digits: 2,
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

const ALTERS = {
  Products: [
    bool("quick_commerce_enabled", { def: "true" }),
    bool("ecommerce_enabled", { def: "true" }),
    varchar("quick_commerce_restriction_reason", 180),
  ],
  Outlets: [
    dbl("service_radius_km", { def: 3 }),
    bool("delivery_enabled", { def: "true" }),
    varchar("store_type", 40, { def: "RETAIL" }),
  ],
  Orders: [
    varchar("fulfillment_mode", 30),
    varchar("parent_order_id", 40),
    varchar("fulfillment_store_id", 40),
    varchar("fulfillment_warehouse_id", 40),
  ],
  Order_Items: [
    varchar("fulfillment_type", 30),
    varchar("fulfillment_store_id", 40),
    varchar("fulfillment_warehouse_id", 40),
  ],
};

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );
  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };
  const report = { added: [], skipped: [], errors: [] };

  for (const [tableName, columns] of Object.entries(ALTERS)) {
    const tableId = byName.get(tableName);
    if (!tableId) {
      report.errors.push(tableName + ": table missing");
      continue;
    }
    let existing;
    try {
      existing = await ds.getColumnDetails(tableId);
    } catch (e) {
      report.errors.push(tableName + ": " + (e.message || e));
      continue;
    }
    const names = new Set(existing.map((c) => c.column_name));
    const missing = columns.filter((c) => !names.has(c.column_name));
    if (!missing.length) {
      report.skipped.push(tableName);
      continue;
    }
    for (let i = 0; i < missing.length; i += 4) {
      const chunk = missing.slice(i, i + 4);
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
        report.errors.push(
          tableName + ": " + JSON.stringify(res.body || res.status)
        );
      } else {
        report.added.push(
          tableName + ":" + chunk.map((c) => c.column_name).join(",")
        );
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
