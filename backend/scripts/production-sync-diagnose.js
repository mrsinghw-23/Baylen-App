#!/usr/bin/env node
"use strict";

/**
 * Diagnose Dev→Production sync blockers using Catalyst CLI + MCP-compatible checks.
 * MCP cannot trigger Production migration — this script explains why and what to do.
 */
const path = require("path");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const CONSOLE_ENV_URL =
  "https://console.catalyst.zoho.in/baas/60069781151/project/36851000000230006/Development#/settings/environments";
const CONSOLE_HOME_URL =
  "https://console.catalyst.zoho.in/baas/60069781151/project/36851000000230006/Development";

const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

async function envSnapshot(env) {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const fnApi = await endpoints.functionsAPI({ projectId: PROJECT_ID, env, org: ORG_ID });
  const fn = (await fnApi.getAllFunctions()).find((x) => x.name === "baylen-api");
  const apig = await endpoints.apigAPI({ projectId: PROJECT_ID, env, org: ORG_ID });
  const rules = await apig.getAllRules();
  const health = rules.find((r) => r.name === "health");
  return {
    env,
    fnModified: fn?.modified_time || null,
    fnDeployedFlag: fn?.is_deployed ?? null,
    apigRuleCount: rules.length,
    apigHealthModified: health?.modified_time || null,
  };
}

async function main() {
  const dev = await envSnapshot("Development");
  const prod = await envSnapshot("Production");
  const synced =
    prod.fnModified === dev.fnModified && prod.apigHealthModified === dev.apigHealthModified;

  const report = {
    synced,
    development: dev,
    production: prod,
    why_wait_script_stalls: synced
      ? null
      : [
          "Production timestamps did not change — Console 'Deploy to Production' has not completed since the latest Development deploy.",
          "Catalyst blocks direct Production function/APIG upsert (HTTP 406). CLI deploy only targets Development.",
          "Catalyst MCP has no Dev→Production migration tool (only read/update individual resources).",
        ],
    mcp_can_do: [
      "Read Production function env vars, APIG routes, project env status",
      "Update Production env vars (Create/Update Env Variables)",
      "Configure individual APIG routes (create only — not bulk code deploy)",
    ],
    mcp_cannot_do: [
      "Upload baylen-api code zip to Production",
      "Bulk-deploy catalyst-user-rules.json APIG to Production",
      "Trigger 'Deploy to Production' migration",
    ],
    fix_steps: [
      "1. Open Catalyst Console while Development is selected (not Production): " + CONSOLE_HOME_URL,
      "2. Top banner or Settings → Environments → click 'Deploy to Production'",
      "3. Wait for migration success (2–10 min). If you see 'diff generation already in progress', wait and retry.",
      "4. Re-run: node scripts/production-sync-wait.js --timeout-min 10",
    ],
    console_urls: {
      development_home: CONSOLE_HOME_URL,
      environments: CONSOLE_ENV_URL,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  if (!synced) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
