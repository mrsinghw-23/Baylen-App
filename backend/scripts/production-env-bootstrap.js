#!/usr/bin/env node
"use strict";

/**
 * Configure Production baylen-api env vars (never prints secret values).
 * Does NOT deploy — run before `catalyst deploy` with Production active in .catalystrc.
 */
const crypto = require("crypto");
const path = require("path");

const PROJECT_ID = "36851000000230006";
const DEV_ORG = "60069781151";
const PROD_ORG = "60069781151";
const FUNCTION_ID = "36851000000291764";

const WORKDRIVE = {
  WORKDRIVE_CONNECTION_NAME: "zohodrive",
  BACKUP_WORKDRIVE_DAILY_FOLDER_ID: "ran7hb08ff45f5ee540788a4fa8da84eaa208",
  BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID: "ran7ha2bc8446c09e4909ac8ba57c339e8678",
  BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID: "ran7h9f831d8f6bd147149451e12e1cd9e4b2",
  BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID: "ran7h03f9877c24f74c859a8602da9e6dd08c",
};

const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

async function loadDevVars() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const api = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Development",
    org: DEV_ORG,
  });
  const fn = (await api.getAllFunctions()).find((x) => x.name === "baylen-api");
  return { ...(fn?.configuration?.environment?.variables || {}) };
}

async function main() {
  const devVars = await loadDevVars();
  const productionVars = {
    ...devVars,
    ...WORKDRIVE,
    BAYLEN_ENV: "production",
    INVENTORY_IMPORT_WORKER_MODE: "deferred",
    AUTH_OTP_DEV_RETURN_CODE: "false",
    AUTH_SESSION_SECRET: randomSecret(32),
    ADMIN_API_KEY: "baylen_prod_admin_" + randomSecret(16),
    BACKUP_ENCRYPTION_KEY: randomSecret(32),
  };

  delete productionVars.CATALYST_ENVIRONMENT;

  Credential.init(config.get(getActiveDC() + ".credential"));
  const prodApi = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Production",
    org: PROD_ORG,
  });
  await prodApi.updateConfig(FUNCTION_ID, productionVars);

  const verify = (await prodApi.getAllFunctions()).find((x) => x.name === "baylen-api");
  const v = verify?.configuration?.environment?.variables || {};
  const checks = [
    ["BAYLEN_ENV", v.BAYLEN_ENV === "production"],
    ["AUTH_SESSION_SECRET", (v.AUTH_SESSION_SECRET || "").length >= 32],
    ["ADMIN_API_KEY", (v.ADMIN_API_KEY || "").length >= 32],
    ["INVENTORY_IMPORT_WORKER_MODE", v.INVENTORY_IMPORT_WORKER_MODE === "deferred"],
    ["WORKDRIVE_CONNECTION_NAME", v.WORKDRIVE_CONNECTION_NAME === "zohodrive"],
    ["BACKUP_ENCRYPTION_KEY", (v.BACKUP_ENCRYPTION_KEY || "").length >= 32],
    ["TATA_WHATSAPP_API_KEY", Boolean(v.TATA_WHATSAPP_API_KEY)],
  ];
  console.log(JSON.stringify({ ok: checks.every((c) => c[1]), checks: Object.fromEntries(checks) }, null, 2));
  if (!checks.every((c) => c[1])) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
