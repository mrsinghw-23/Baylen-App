#!/usr/bin/env node
"use strict";

/**
 * Verify Production baylen-api secret configuration without printing values.
 */

const fs = require("fs");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const CATALYSTRC = path.join(BACKEND_ROOT, ".catalystrc");
const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const FUNCTION_NAME = "baylen-api";
const MIN_LEN = 32;

const LENGTH_KEYS = ["AUTH_SESSION_SECRET", "ADMIN_API_KEY"];
const PRESENCE_KEYS = [
  "TATA_WHATSAPP_API_KEY",
  "TATA_WHATSAPP_SENDER",
  "TATA_TEMPLATE_NAME",
  "BAYLEN_ENV",
  "AUTH_OTP_DEV_RETURN_CODE",
];

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

async function fetchProductionFunction() {
  const { configStore, getActiveDC, Credential, endpoints } = loadCliModules();
  const dc = getActiveDC();
  const credential = configStore.get(`${dc}.credential`);
  if (!credential) {
    throw new Error("Run catalyst login before verifying Production secrets.");
  }
  Credential.init(credential);
  const functions = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Production",
    org: ORG_ID,
  });
  const list = await functions.getAllFunctions();
  const fn = (list || []).find((entry) => entry.name === FUNCTION_NAME || entry.api_name === FUNCTION_NAME);
  if (!fn) {
    throw new Error("Production function baylen-api not found");
  }
  return fn;
}

async function main() {
  const fn = await fetchProductionFunction();
  const vars = fn?.configuration?.environment?.variables || {};
  const report = {
    environment: "Production",
    function: FUNCTION_NAME,
    is_deployed: fn.is_deployed === true,
    checks: {},
    ok: true,
  };

  for (const key of LENGTH_KEYS) {
    const value = String(vars[key] || "").trim();
    report.checks[key] = {
      configured: value.length > 0,
      meets_min_length: value.length >= MIN_LEN,
      length: value.length,
    };
    if (!value || value.length < MIN_LEN) {
      report.ok = false;
    }
  }

  for (const key of PRESENCE_KEYS) {
    const value = String(vars[key] || "").trim();
    report.checks[key] = {
      configured: value.length > 0,
      value_preview: key.endsWith("_SECRET") || key.endsWith("_KEY") ? "[redacted]" : value,
    };
    if (!value && key !== "AUTH_OTP_DEV_RETURN_CODE") {
      report.ok = false;
    }
  }

  if (String(vars.AUTH_OTP_DEV_RETURN_CODE || "").toLowerCase() === "true") {
    report.checks.AUTH_OTP_DEV_RETURN_CODE = {
      configured: true,
      value_preview: "true",
      meets_policy: false,
    };
    report.ok = false;
  } else {
    report.checks.AUTH_OTP_DEV_RETURN_CODE = {
      configured: true,
      value_preview: String(vars.AUTH_OTP_DEV_RETURN_CODE || "false"),
      meets_policy: true,
    };
  }

  if (String(vars.BAYLEN_ENV || "").toLowerCase() !== "production") {
    report.checks.BAYLEN_ENV.value_preview = String(vars.BAYLEN_ENV || "");
    report.checks.BAYLEN_ENV.meets_policy = false;
    report.ok = false;
  } else {
    report.checks.BAYLEN_ENV.meets_policy = true;
  }

  process.env.BAYLEN_ENV = "production";
  process.env.AUTH_SESSION_SECRET = String(vars.AUTH_SESSION_SECRET || "");
  process.env.ADMIN_API_KEY = String(vars.ADMIN_API_KEY || "");
  process.env.AUTH_OTP_DEV_RETURN_CODE = String(vars.AUTH_OTP_DEV_RETURN_CODE || "false");
  const { assertRuntimeSecrets, resetRuntimeConfigCache } = require(path.join(
    __dirname,
    "../functions/baylen-api/lib/runtime-config"
  ));
  resetRuntimeConfigCache();
  try {
    const runtime = assertRuntimeSecrets();
    report.runtime_assertion = { ok: true, production: runtime.production, auth_session_configured: runtime.auth_session_configured };
  } catch (error) {
    report.runtime_assertion = { ok: false, code: error.code || "", message: error.message };
    report.ok = false;
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
