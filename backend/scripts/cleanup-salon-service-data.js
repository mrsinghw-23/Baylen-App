"use strict";

/**
 * Phase 2 — remove OLD demo salon service data from Catalyst Development.
 * Preserves: Outlets, Salon_Packages, Outlet_Packages, Appointments, e-commerce.
 *
 * Usage (from repo root, with Catalyst CLI logged in):
 *   node backend/scripts/cleanup-salon-service-data.js --dry-run
 *   node backend/scripts/cleanup-salon-service-data.js --confirm
 *
 * Or set BAYLEN_API_BASE + ADMIN_API_KEY and use --via-api (export backup only).
 */

const fs = require("fs");
const path = require("path");

const backupDir = path.resolve(
  __dirname,
  "../docs/salon-booking/backup/2026-09-01"
);

const TABLES_IN_ORDER = [
  "Staff_Services",
  "Outlet_Service_Prices",
  "Salon_Services",
  "Staff",
];

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run") || !args.has("--confirm");

  fs.mkdirSync(backupDir, { recursive: true });

  let catalyst;
  try {
    catalyst = require("zcatalyst-sdk-node");
  } catch (_) {
    console.error("Install zcatalyst-sdk-node in backend/functions/baylen-api, or run via Catalyst shell.");
    process.exit(1);
  }

  const app = catalyst.initialize({}, { scope: "admin" });
  const zcql = app.zcql();
  const summary = {};

  for (const table of TABLES_IN_ORDER) {
    const result = await zcql.executeZCQLQuery(`SELECT * FROM ${table}`);
    const rows = flattenRows(result, table);
    summary[table] = rows.length;
    fs.writeFileSync(
      path.join(backupDir, `${table}.json`),
      JSON.stringify(rows, null, 2),
      "utf8"
    );
    console.log(`Backed up ${table}: ${rows.length} rows`);

    if (!dryRun) {
      for (const row of rows) {
        const id = row.ROWID || row.rowid;
        if (!id) continue;
        await zcql.executeZCQLQuery(`DELETE FROM ${table} WHERE ROWID = ${id}`);
      }
      console.log(`Deleted ${table}: ${rows.length} rows`);
    }
  }

  fs.writeFileSync(
    path.join(backupDir, "README.md"),
    [
      "# Salon service data backup (2026-09-01)",
      "",
      "Exported before Phase 2 cleanup of demo salon catalog.",
      "",
      "| Table | Rows |",
      "|-------|------|",
      ...Object.entries(summary).map(([table, count]) => `| ${table} | ${count} |`),
      "",
      "Not included: Outlets, Appointments, Salon_Packages, Outlet_Packages, e-commerce.",
    ].join("\n"),
    "utf8"
  );

  if (dryRun) {
    console.log("\nDry run complete. Re-run with --confirm to delete backed-up rows.");
  } else {
    console.log("\nCleanup complete. Verify counts are 0 for service tables.");
  }
}

function flattenRows(result, tableName) {
  if (!Array.isArray(result)) return [];
  return result.map((item) => item[tableName] || item);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
