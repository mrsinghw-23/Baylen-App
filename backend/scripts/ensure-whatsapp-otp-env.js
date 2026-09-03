#!/usr/bin/env node
"use strict";

/**
 * Keeps WhatsApp OTP working on baylen-api (the API the Play Store app uses).
 *
 * Flutter login calls baylen-api /v1/auth/otp/* — NOT AppSail baylen-auth.
 * If Tata vars exist only on AppSail, users cannot receive OTP on WhatsApp.
 *
 * Usage (from backend/):
 *   node scripts/ensure-whatsapp-otp-env.js --verify
 *   node scripts/ensure-whatsapp-otp-env.js --sync
 *   node scripts/ensure-whatsapp-otp-env.js --verify-live
 */

const fs = require("fs");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const CATALYSTRC = path.join(BACKEND_ROOT, ".catalystrc");
const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const FUNCTION_NAME = "baylen-api";
const APPSAIL_SOURCE = "baylen-auth";
const WHATSAPP_KEYS = [
  "TATA_WHATSAPP_API_KEY",
  "TATA_WHATSAPP_SENDER",
  "TATA_TEMPLATE_NAME",
];

const args = new Set(process.argv.slice(2));
const shouldSync = args.has("--sync");
const shouldVerifyLive = args.has("--verify-live");
const shouldVerify = args.has("--verify") || shouldVerifyLive || !shouldSync;

function readProjectDomain() {
  const raw = JSON.parse(fs.readFileSync(CATALYSTRC, "utf8"));
  const project = raw.projects?.find((entry) => entry.id === PROJECT_ID) || raw.projects?.[0];
  const domainName = project?.domain?.name;
  if (!domainName) {
    throw new Error("Could not read Catalyst domain from .catalystrc");
  }
  return `https://${domainName}.catalystserverless.in`;
}

function loadCliModules() {
  const cliRoot = path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "zcatalyst-cli",
    "lib"
  );
  const configStore = require(path.join(cliRoot, "util_modules", "config-store")).default;
  const { getActiveDC } = require(path.join(cliRoot, "util_modules", "dc"));
  const Credential = require(path.join(cliRoot, "authentication", "credential")).default;
  const endpoints = require(path.join(cliRoot, "endpoints"));
  return { configStore, getActiveDC, Credential, endpoints };
}

async function getRemoteApis() {
  const { configStore, getActiveDC, Credential, endpoints } = loadCliModules();
  const dc = getActiveDC();
  const credential = configStore.get(`${dc}.credential`);
  if (!credential) {
    throw new Error("Run catalyst login before syncing WhatsApp OTP env vars.");
  }
  Credential.init(credential);
  const opts = { projectId: PROJECT_ID, env: "Development", org: ORG_ID };
  return {
    functions: await endpoints.functionsAPI(opts),
    appsail: await endpoints.appSailAPI(opts),
  };
}

function functionVars(fn) {
  return fn?.configuration?.environment?.variables || {};
}

function appsailVars(service) {
  return service?.configuration?.environment?.variables || {};
}

function printStatus(label, vars) {
  console.log(`\n${label}`);
  for (const key of WHATSAPP_KEYS) {
    console.log(`  ${key}: ${vars[key] ? "set" : "MISSING"}`);
  }
  console.log(
    `  AUTH_OTP_DEV_RETURN_CODE: ${vars.AUTH_OTP_DEV_RETURN_CODE === "true" ? "true (NOT for Play Store)" : "false"}`
  );
}

function missingKeys(vars) {
  return WHATSAPP_KEYS.filter((key) => !String(vars[key] || "").trim());
}

async function verifyRemoteConfig() {
  const { functions, appsail } = await getRemoteApis();
  const fnList = await functions.getAllFunctions();
  const fn = fnList.find((entry) => entry.name === FUNCTION_NAME);
  if (!fn) {
    throw new Error(`${FUNCTION_NAME} function not found in Catalyst`);
  }

  const sails = await appsail.getAllAppsails();
  const source =
    sails.find((entry) => entry.name === APPSAIL_SOURCE) ||
    sails.find((entry) => entry.name === "baylen-api-appsail");
  if (!source) {
    throw new Error(`No AppSail service found to copy WhatsApp vars from`);
  }

  const fnVars = functionVars(fn);
  const sourceVars = appsailVars(source);
  printStatus(`${FUNCTION_NAME} (Play Store login API)`, fnVars);
  printStatus(`${source.name} (source)`, sourceVars);

  const fnMissing = missingKeys(fnVars);
  const sourceMissing = missingKeys(sourceVars);
  if (fnMissing.length > 0) {
    console.error(
      `\nERROR: ${FUNCTION_NAME} is missing WhatsApp OTP vars: ${fnMissing.join(", ")}`
    );
    console.error("Run: node scripts/ensure-whatsapp-otp-env.js --sync");
    process.exitCode = 1;
    return { fn, fnVars, source, sourceVars, fnMissing, sourceMissing };
  }
  if (varsDevFallbackEnabled(fnVars)) {
    console.error(
      "\nERROR: AUTH_OTP_DEV_RETURN_CODE=true on baylen-api. Disable for Play Store builds."
    );
    process.exitCode = 1;
  }
  console.log("\nOK: baylen-api WhatsApp OTP env is configured.");
  return { fn, fnVars, source, sourceVars, fnMissing, sourceMissing };
}

function varsDevFallbackEnabled(vars) {
  return String(vars.AUTH_OTP_DEV_RETURN_CODE || "false").toLowerCase() === "true";
}

async function syncRemoteConfig() {
  const { functions, appsail } = await getRemoteApis();
  const fnList = await functions.getAllFunctions();
  const fn = fnList.find((entry) => entry.name === FUNCTION_NAME);
  if (!fn) {
    throw new Error(`${FUNCTION_NAME} function not found in Catalyst`);
  }

  const sails = await appsail.getAllAppsails();
  const source =
    sails.find((entry) => entry.name === APPSAIL_SOURCE) ||
    sails.find((entry) => entry.name === "baylen-api-appsail");
  if (!source) {
    throw new Error(`No AppSail service found to copy WhatsApp vars from`);
  }

  const sourceVars = appsailVars(source);
  const sourceMissing = missingKeys(sourceVars);
  if (sourceMissing.length > 0) {
    throw new Error(
      `Source AppSail ${source.name} is missing: ${sourceMissing.join(", ")}`
    );
  }

  const nextVars = { ...functionVars(fn) };
  for (const key of WHATSAPP_KEYS) {
    nextVars[key] = sourceVars[key];
  }
  nextVars.AUTH_OTP_DEV_RETURN_CODE = "false";

  await functions.updateConfig(fn.id, nextVars);
  console.log(`Synced WhatsApp OTP vars from ${source.name} -> ${FUNCTION_NAME}`);
  printStatus(`${FUNCTION_NAME} (updated)`, nextVars);
}

async function verifyLiveHealth() {
  const base = readProjectDomain();
  const url = `${base}/health`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.json();
  const auth = body?.data?.auth || {};
  console.log(`\nLive health: ${url}`);
  console.log(JSON.stringify(auth, null, 2));

  if (!response.ok || !body?.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }
  if (!auth.otp_whatsapp_ready) {
    throw new Error(
      `Live baylen-api reports otp_whatsapp_ready=false (missing: ${(auth.missing || []).join(", ")})`
    );
  }
  if (auth.dev_otp_fallback_enabled) {
    throw new Error("Live baylen-api has dev OTP fallback enabled");
  }
  console.log("OK: live health confirms WhatsApp OTP is ready.");
}

async function main() {
  if (shouldSync) {
    await syncRemoteConfig();
  }
  if (shouldVerify) {
    await verifyRemoteConfig();
  }
  if (shouldVerifyLive && !process.exitCode) {
    await verifyLiveHealth();
  }
  if (process.exitCode) {
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
