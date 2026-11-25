#!/usr/bin/env node
"use strict";

/**
 * Poll until Production baylen-api/APIG timestamps match Development (Console migration done).
 * Usage: node scripts/production-sync-wait.js [--timeout-min 10]
 */
const path = require("path");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const CONSOLE_URL =
  "https://console.catalyst.zoho.in/baas/60069781151/project/36851000000230006/Development#/settings/environments";

const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

function parseTimeoutMin() {
  const idx = process.argv.indexOf("--timeout-min");
  if (idx === -1) return 10;
  const n = Number(process.argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

async function snapshot() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const out = {};
  for (const env of ["Development", "Production"]) {
    const fnApi = await endpoints.functionsAPI({ projectId: PROJECT_ID, env, org: ORG_ID });
    const fn = (await fnApi.getAllFunctions()).find((x) => x.name === "baylen-api");
    const apig = await endpoints.apigAPI({ projectId: PROJECT_ID, env, org: ORG_ID });
    const health = (await apig.getAllRules()).find((r) => r.name === "health");
    out[env] = {
      fnModified: fn?.modified_time || null,
      apigHealthModified: health?.modified_time || null,
    };
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const timeoutMin = parseTimeoutMin();
  const deadline = Date.now() + timeoutMin * 60 * 1000;
  console.log("Waiting for Production to match Development after Console Deploy to Production.");
  console.log("Console:", CONSOLE_URL);
  console.log("Timeout:", timeoutMin, "minutes\n");

  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const snap = await snapshot();
    const dev = snap.Development;
    const prod = snap.Production;
    const synced =
      prod.fnModified === dev.fnModified && prod.apigHealthModified === dev.apigHealthModified;

    console.log(
      JSON.stringify(
        {
          attempt,
          synced,
          development: dev,
          production: prod,
        },
        null,
        2
      )
    );

    if (synced) {
      console.log("\nProduction sync complete.");
      return;
    }

    await sleep(15000);
  }

  console.error("\nTimed out waiting for Production sync. Re-run Console Deploy to Production.");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
