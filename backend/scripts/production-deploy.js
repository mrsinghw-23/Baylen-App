#!/usr/bin/env node
"use strict";

/**
 * Attempt Production deploy via Catalyst API (usually blocked with HTTP 406).
 * Primary Production sync: Catalyst Console → Deploy to Production.
 *
 * Usage:
 *   node scripts/production-deploy.js           # try API deploy + APIG (expect 406)
 *   node scripts/production-deploy.js --smoke   # read-only Production smoke only
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Production";
const FN_NAME = "baylen-api";
const STACK = "node20";
const MEMORY = 256;
const CONSOLE_URL =
  "https://console.catalyst.zoho.in/baas/60069781151/project/36851000000230006/Development#/settings/environments";

const BACKEND_ROOT = path.join(__dirname, "..");
const FN_DIR = path.join(BACKEND_ROOT, "functions", FN_NAME);
const APIG_RULES = path.join(BACKEND_ROOT, "catalyst-user-rules.json");

const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));
const Archiver = require(path.join(CLI_LIB, "archiver")).default;

async function packFunction(sourceDir, name) {
  const zip = new Archiver(name);
  const ignore = new Set(["node_modules", ".git", ".env", "test", "coverage", ".nyc_output"]);

  async function walk(dir, prefix = "") {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (ignore.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (!entry.name.endsWith(".test.js")) {
        zip.add(rel, fs.createReadStream(full));
      }
    }
  }

  await walk(sourceDir);
  const finalized = await zip.finalize();
  return finalized.fsStream();
}

async function tryProductionDeploy() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zipStream = await packFunction(FN_DIR, FN_NAME);
  const appAPI = await endpoints.applogicAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  return appAPI.deploy(zipStream.stream, {
    stack: STACK,
    name: FN_NAME,
    memory: MEMORY,
    contentLength: zipStream.length,
  });
}

async function tryProductionApig() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const apigAPI = await endpoints.apigAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  return apigAPI.deploy(fs.createReadStream(APIG_RULES));
}

function runSmoke() {
  const r = spawnSync(process.execPath, [path.join(__dirname, "production-smoke.js")], {
    stdio: "inherit",
    cwd: BACKEND_ROOT,
  });
  process.exit(r.status ?? 1);
}

async function main() {
  if (process.argv.includes("--smoke")) {
    runSmoke();
    return;
  }

  console.log("NOTE: Catalyst blocks direct Production upsert (HTTP 406).");
  console.log("After Development deploy, use Console → Deploy to Production:");
  console.log(CONSOLE_URL);
  console.log("");

  try {
    console.log("Attempting baylen-api upsert on Production...");
    const fn = await tryProductionDeploy();
    console.log(JSON.stringify({ step: "function", ok: true, id: String(fn.id || "") }));
  } catch (err) {
    const msg = err.message || String(err);
    console.log(JSON.stringify({ step: "function", ok: false, error: msg }));
    if (!/406/.test(msg)) {
      process.exitCode = 1;
    }
  }

  try {
    console.log("Attempting APIG deploy on Production...");
    await tryProductionApig();
    console.log(JSON.stringify({ step: "apig", ok: true }));
  } catch (err) {
    const msg = err.message || String(err);
    console.log(JSON.stringify({ step: "apig", ok: false, error: msg }));
    if (!/406/.test(msg)) {
      process.exitCode = 1;
    }
  }

  runSmoke();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
