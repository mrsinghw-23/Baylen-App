#!/usr/bin/env node
"use strict";

/**
 * Production go-live helper.
 *
 * Catalyst blocks direct function/APIG upsert on Production (HTTP 406).
 * Flow:
 *   1. catalyst deploy --only functions:baylen-api   (Development)
 *   2. catalyst deploy --only apig                    (Development)
 *   3. Console → Deploy to Production (Settings → Environments)
 *   4. node scripts/production-env-bootstrap.js       (unique prod secrets)
 *   5. node scripts/production-smoke.js               (read-only checks)
 */
const https = require("https");
const path = require("path");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const PROD_BASE = "https://baylen-app-60069781151.catalystserverless.in";
const CONSOLE_DEPLOY_URL =
  "https://console.catalyst.zoho.in/baas/60069781151/project/36851000000230006/Development#/settings/environments";

const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

function request(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, PROD_BASE);
    const payload = body == null ? null : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = { raw: data.slice(0, 200) };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getAdminKey() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const api = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Production",
    org: ORG_ID,
  });
  const fn = (await api.getAllFunctions()).find((x) => x.name === "baylen-api");
  const key = fn?.configuration?.environment?.variables?.ADMIN_API_KEY || "";
  if (!key) throw new Error("Production ADMIN_API_KEY missing on baylen-api");
  return key;
}

async function getDevAdminKey() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const api = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Development",
    org: ORG_ID,
  });
  const fn = (await api.getAllFunctions()).find((x) => x.name === "baylen-api");
  return fn?.configuration?.environment?.variables?.ADMIN_API_KEY || "";
}

async function main() {
  const adminKey = await getAdminKey();
  const devKey = await getDevAdminKey();
  const adminHeaders = { "x-baylen-admin-key": adminKey };

  const health = await request("GET", "/health", {});
  const dup = await request("GET", "/v1/admin/inventory/duplicate-scan", adminHeaders);
  const devKeyOnProd = await request("GET", "/v1/admin/inventory/duplicate-scan", {
    "x-baylen-admin-key": devKey,
  });
  const backupRoute = await request("POST", "/v1/admin/backup/upload", adminHeaders, {});

  const checks = {
    health_ok: health.status === 200 && health.json?.data?.status === "up",
    otp_whatsapp_ready: health.json?.data?.auth?.otp_whatsapp_ready === true,
    dev_otp_fallback_disabled: health.json?.data?.auth?.dev_otp_fallback_enabled === false,
    admin_auth_ok: dup.status === 200 && dup.json?.ok === true,
    dev_key_rejected_on_prod: devKeyOnProd.status === 403,
    backup_route_present: backupRoute.status !== 404,
    keys_are_distinct: adminKey !== devKey && adminKey.length >= 32,
  };

  const fnApi = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Production",
    org: ORG_ID,
  });
  const prodFn = (await fnApi.getAllFunctions()).find((x) => x.name === "baylen-api");
  const devFnApi = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Development",
    org: ORG_ID,
  });
  const devFn = (await devFnApi.getAllFunctions()).find((x) => x.name === "baylen-api");

  const result = {
    ok: Object.values(checks).every(Boolean),
    base: PROD_BASE,
    checks,
    code_sync_hint: {
      production_modified: prodFn?.modified_time || null,
      development_modified: devFn?.modified_time || null,
      needs_console_deploy:
        (prodFn?.modified_time || "") !== (devFn?.modified_time || ""),
      console_url: CONSOLE_DEPLOY_URL,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
