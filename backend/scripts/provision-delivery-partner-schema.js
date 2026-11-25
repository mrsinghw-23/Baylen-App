#!/usr/bin/env node
"use strict";

/**
 * Provisions Delivery Partner + KYC schema for HS-004/HS-005 on Zoho Catalyst Data Store.
 *
 * Usage:
 *   node backend/scripts/provision-delivery-partner-schema.js
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
    search_index_enabled: "false",
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

function bigintCol(name, { mandatory = false } = {}) {
  return {
    column_name: name,
    data_type: "bigint",
    is_mandatory: mandatory ? "true" : "false",
    is_unique: "false",
    search_index_enabled: "true",
    audit_consent: "false",
  };
}

const ALTERS = {
  Service_Jobs: [intCol("delivery_partner_id"), bigintCol("delivery_partner_row_id")],
  Auth_Otp_Challenges: [varchar("purpose", 30, { def: "customer" })],
  Delivery_Partner_KYC: [
    varchar("registration_phase", 30),
    varchar("email", 120),
    varchar("gender", 20),
    varchar("district", 80),
    varchar("password_hash", 128),
    varchar("password_salt", 64),
    intCol("outlet_id"),
    intCol("warehouse_id"),
  ],
  Delivery_Partners: [
    varchar("status", 30, { def: "pending_kyc" }),
    intCol("age"),
    varchar("qualification", 20),
    varchar("online_status", 20, { def: "OFFLINE" }),
    intCol("legacy_provider_id"),
    intCol("legacy_rider_id"),
    varchar("profile_photo_url", 255),
    dbl("rating"),
    varchar("email", 120),
    varchar("gender", 20),
    varchar("district", 80),
    varchar("date_of_birth", 20),
    varchar("registration_phase", 30, { def: "otp_verified" }),
    varchar("password_hash", 128),
    varchar("password_salt", 64),
    varchar("selfie_file_id", 40),
    varchar("selfie_folder_id", 40),
    varchar("passport_photo_file_id", 40),
    varchar("passport_photo_folder_id", 40),
    intCol("warehouse_id"),
    varchar("address_line1", 180),
    varchar("city", 80),
    varchar("state", 80),
    varchar("postal_code", 10),
  ],
};

const NEW_TABLES = [
  {
    table_name: "Delivery_Partners",
    columns: [
      varchar("phone", 20, { mandatory: true, unique: true }),
      intCol("outlet_id"),
      varchar("status", 30, { mandatory: true, def: "pending_kyc" }),
      varchar("first_name", 80),
      varchar("last_name", 80),
    ],
  },
  {
    table_name: "Delivery_Partner_KYC",
    columns: [
      intCol("delivery_partner_id", { mandatory: true }),
      varchar("first_name", 80),
      varchar("last_name", 80),
      varchar("date_of_birth", 20),
      varchar("pan_last4", 4),
      varchar("pan_hash", 64),
      varchar("aadhaar_last4", 4),
      varchar("aadhaar_hash", 64),
      varchar("address_line1", 180),
      varchar("address_line2", 180),
      varchar("city", 80),
      varchar("state", 80),
      varchar("postal_code", 10),
      varchar("country", 80, { def: "India" }),
      varchar("bank_account_last4", 4),
      varchar("bank_account_hash", 64),
      varchar("ifsc", 11),
      varchar("account_holder_name", 120),
      varchar("profile_photo_file_id", 40),
      varchar("profile_photo_folder_id", 40),
      varchar("identity_document_file_id", 40),
      varchar("identity_document_folder_id", 40),
      varchar("address_document_file_id", 40),
      varchar("address_document_folder_id", 40),
      varchar("rejection_reason", 255),
      varchar("reviewed_by", 120),
      varchar("submitted_at", 30),
      varchar("reviewed_at", 30),
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
