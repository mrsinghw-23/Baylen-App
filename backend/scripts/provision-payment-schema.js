#!/usr/bin/env node
"use strict";

// Read-only by default; --apply adds missing payment schema in Development.
const path = require("node:path");
const fs = require("node:fs");
const CLI_LIB = path.join(process.env.APPDATA || "", "npm/node_modules/zcatalyst-cli/lib");
const config = require(path.join(CLI_LIB, "util_modules/config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules/dc"));
const Credential = require(path.join(CLI_LIB, "authentication/credential")).default;
const API = require(path.join(CLI_LIB, "internal/api")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));
const rc = JSON.parse(fs.readFileSync(path.join(__dirname, "../.catalystrc"), "utf8"));
const project = rc.projects.find(p => p.idx === rc.actives.project);
if (!project) throw new Error("No active Catalyst project");
const environment = "Development";
const org = "60069781151";
const apply = process.argv.includes("--apply");
const column = (name, length, unique = false) => ({ column_name: name, data_type: "varchar",
  max_length: length, is_mandatory: "false", is_unique: String(unique),
  search_index_enabled: String(unique), audit_consent: "false" });
const specs = {
  Payment_Locks: [column("lock_key", 100, true), column("owner", 50), column("created_at", 30)],
  Refunds: [column("provider_refund_id", 100)],
};

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const options = { projectId: project.id, env: environment, org, authNeeded: true, resolveOnError: true, printError: false };
  const ds = await endpoints.datastoreAPI(options);
  const headers = { "Catalyst-org": org, Environment: environment };
  const tables = await ds.getAllTables();
  const report = { project: project.name, environment, apply, changes: [], problems: [] };
  for (const required of ["Payments", "Refunds", "Orders", "Appointments", "Service_Jobs"]) {
    if (!tables.some(t => (t.table_name || t.name) === required)) report.problems.push("Missing existing table: " + required);
  }
  if (report.problems.length) throw new Error(report.problems.join("; "));
  for (const [name, columns] of Object.entries(specs)) {
    let table = tables.find(t => (t.table_name || t.name) === name);
    if (!table) {
      report.changes.push("Create table " + name);
      if (!apply) continue;
      const r = await new API({ ...options }).post(`/baas/v1/project/${project.id}/table`, { json: true, body: { table_name: name }, headers });
      if (r.status >= 400 || r.body?.status === "failure") throw new Error("Cannot create " + name);
      table = r.body.data;
    }
    const id = String(table.table_id || table.id);
    const existing = await ds.getColumnDetails(id);
    for (const col of columns) {
      const present = existing.find(c => c.column_name === col.column_name);
      if (present) {
        if (col.is_unique === "true" && ![true, "true"].includes(present.is_unique)) {
          report.problems.push(name + "." + col.column_name + " must be UNIQUE before payments can run");
        }
        continue;
      }
      report.changes.push("Add " + name + "." + col.column_name + (col.is_unique === "true" ? " UNIQUE" : ""));
      if (apply) {
        const r = await new API({ ...options }).post(`/baas/v1/project/${project.id}/table/${id}/column`, { json: true, body: [col], headers });
        if (r.status >= 400 || r.body?.status === "failure") {
          const detail = r.body?.data || r.body || {};
          throw new Error("Cannot add " + name + "." + col.column_name + ": " +
            JSON.stringify({ status: r.status, code: detail.error_code || detail.code,
              message: detail.message || detail.error_message }));
        }
      }
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
