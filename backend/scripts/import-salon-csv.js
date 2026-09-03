"use strict";

const fs = require("fs");
const path = require("path");

const apiBase = (
  process.env.BAYLEN_API_BASE ||
  "https://baylen-app-60069781151.development.catalystserverless.in"
).replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY || "";

async function adminPost(pathname, body) {
  if (!adminKey) {
    throw new Error("Set ADMIN_API_KEY before running salon admin scripts");
  }
  const response = await fetch(apiBase + pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-baylen-admin-key": adminKey,
      "x-baylen-admin-user": process.env.BAYLEN_ADMIN_USER || "salon-import-script",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("Invalid JSON from API: " + text.slice(0, 300));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || text.slice(0, 300));
  }
  return data.data || data;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const confirm = args.has("--confirm");
  const allSeeds = args.has("--all-seeds");
  const fileArg = process.argv.find((arg) => arg.startsWith("--file="));
  const filePath = fileArg ? fileArg.slice("--file=".length) : "";

  if (args.has("--cleanup")) {
    const result = await adminPost("/v1/admin/salon/cleanup", { confirm });
    console.log(JSON.stringify(result, null, 2));
    if (!confirm) {
      console.log("\nDry run only. Re-run with --cleanup --confirm to delete demo salon service data.");
    }
    return;
  }

  let csvText = "";
  if (allSeeds) {
    const result = await adminPost("/v1/admin/salon/imports/all-seeds", { confirm });
    console.log(JSON.stringify(result, null, 2));
    if (!confirm) {
      console.log("\nPreview only. Re-run with --all-seeds --confirm after adding CSV rows.");
    }
    return;
  }

  if (!filePath) {
    console.error(
      "Usage:\n" +
        "  node backend/scripts/import-salon-csv.js --cleanup [--confirm]\n" +
        "  node backend/scripts/import-salon-csv.js --file=backend/seeds/salon/salon-gold.csv [--confirm]\n" +
        "  node backend/scripts/import-salon-csv.js --all-seeds [--confirm]"
    );
    process.exit(1);
  }

  csvText = fs.readFileSync(path.resolve(filePath), "utf8");
  const endpoint = confirm ? "/v1/admin/salon/imports" : "/v1/admin/salon/imports/preview";
  const result = await adminPost(endpoint, { csv_text: csvText, confirm });
  console.log(JSON.stringify(result, null, 2));
  if (!confirm) {
    console.log("\nPreview only. Re-run with --confirm to import.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
