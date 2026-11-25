#!/usr/bin/env node
"use strict";

/**
 * Provisions AT-HOME BEAUTY schema extensions on Zoho Catalyst Data Store.
 *
 * Usage:
 *   node backend/scripts/provision-at-home-beauty-schema.js
 *   node backend/scripts/provision-at-home-beauty-schema.js --seed
 *
 * --seed inserts DEV-ONLY sample zones/addons (safe to skip in production).
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
const seedDev = process.argv.includes("--seed");

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

function bool(name, { def } = {}) {
  const col = {
    column_name: name,
    data_type: "boolean",
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
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

function intCol(name, { def } = {}) {
  const col = {
    column_name: name,
    data_type: "int",
    is_mandatory: "false",
    search_index_enabled: "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

const ALTERS = {
  Service_Jobs: [
    varchar("booking_number", 30),
    varchar("pincode", 10),
    varchar("payment_status", 20, { def: "PENDING" }),
    dbl("visit_latitude"),
    dbl("visit_longitude"),
    intCol("outlet_id"),
    varchar("service_name_snapshot", 180),
    varchar("gender_preference", 10),
    varchar("idempotency_key", 80),
  ],
  Salon_Services: [bool("is_at_home", { def: "true" })],
  Outlets: [dbl("service_radius_km", { def: 12 })],
};

const NEW_TABLES = [
  {
    table_name: "Beauty_Service_Zones",
    columns: [
      intCol("outlet_id", { mandatory: true }),
      varchar("city", 80),
      varchar("state", 80),
      varchar("pincode_prefix", 6),
      dbl("max_radius_km", { def: 12 }),
      bool("is_active", { def: "true" }),
    ],
  },
  {
    table_name: "Beauty_Service_Addons",
    columns: [
      intCol("service_id", { mandatory: true }),
      varchar("name", 120, { mandatory: true }),
      varchar("description", 255),
      dbl("price", { def: 0 }),
      intCol("duration_minutes", { def: 0 }),
      bool("is_active", { def: "true" }),
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
      report.errors.push(tableName + ": " + JSON.stringify(res.body || res.status));
    } else {
      report.added.push(tableName + ": " + chunk.map((c) => c.column_name).join(", "));
    }
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

async function seedDevelopmentData(app, report) {
  if (!seedDev) {
    report.skipped.push("dev seed (pass --seed to enable)");
    return;
  }
  const zcql = app.zcql();
  const outlets = await zcql.executeZCQLQuery(
    "SELECT ROWID, city, state FROM Outlets WHERE is_active = true LIMIT 5"
  ).catch(() => []);
  const outletRows = outlets.map((row) => row.Outlets || row).filter(Boolean);
  if (!outletRows.length) {
    report.errors.push("dev seed: no active outlets found");
    return;
  }
  for (const outlet of outletRows.slice(0, 3)) {
    try {
      await app.datastore().table("Beauty_Service_Zones").insertRow({
        outlet_id: outlet.ROWID,
        city: outlet.city || "",
        state: outlet.state || "",
        pincode_prefix: "",
        max_radius_km: 15,
        is_active: true,
      });
      report.added.push("seed zone for outlet " + outlet.ROWID);
    } catch (e) {
      report.errors.push("seed zone: " + (e.message || e));
    }
  }
}

function loadCatalystSdk() {
  const localPath = path.join(
    __dirname,
    "../functions/baylen-api/node_modules/zcatalyst-sdk-node"
  );
  try {
    return require(localPath);
  } catch (_) {
    return require("zcatalyst-sdk-node");
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

  if (seedDev) {
    const catalyst = loadCatalystSdk();
    const app = catalyst.initialize({}, { scope: "admin" });
    await seedDevelopmentData(app, report);
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
