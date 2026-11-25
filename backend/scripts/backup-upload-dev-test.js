#!/usr/bin/env node
"use strict";

/**
 * Development-only WorkDrive backup upload verification.
 * Does NOT touch Production.
 */
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";
const FUNCTION_ID = "36851000000291764";
const BASE = "https://baylen-app-60069781151.development.catalystserverless.in";
const REPO_ROOT = path.resolve(__dirname, "../..");
const BACKUP_OUT = path.join(REPO_ROOT, "backend", "backups", "dev-upload-test");

const FOLDER_IDS = {
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

function request(method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
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
            json = { raw: data };
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

async function getFunctionApi() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  return endpoints.functionsAPI({ projectId: PROJECT_ID, env: ENV, org: ORG_ID });
}

async function ensureBackupEnvVars(backupKeyHex) {
  const api = await getFunctionApi();
  const fn = (await api.getAllFunctions()).find((x) => x.name === "baylen-api");
  const current = { ...(fn?.configuration?.environment?.variables || {}) };
  const merged = {
    ...current,
    ...FOLDER_IDS,
    BACKUP_ENCRYPTION_KEY: backupKeyHex,
  };
  await api.updateConfig(FUNCTION_ID, merged);
  return { adminKey: current.ADMIN_API_KEY || "" };
}

function findArtifactFile(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".baylen-backup"))
    .map((name) => path.join(dir, name));
  return files.sort().pop() || null;
}

async function main() {
  const backupKeyHex = crypto.randomBytes(32).toString("hex");
  console.log("[backup-upload-dev-test] Setting Development function backup env vars...");
  const { adminKey } = await ensureBackupEnvVars(backupKeyHex);
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY missing on baylen-api");
  }

  fs.mkdirSync(BACKUP_OUT, { recursive: true });
  console.log("[backup-upload-dev-test] Exporting + encrypting Development backup...");
  const exportResult = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, "backend", "scripts", "backup-datastore.js"),
      "--env",
      "Development",
      "--mode",
      "encrypt",
      "--frequency",
      "daily",
      "--out",
      BACKUP_OUT,
    ],
    {
      cwd: path.join(REPO_ROOT, "backend"),
      env: { ...process.env, BACKUP_ENCRYPTION_KEY: backupKeyHex },
      encoding: "utf8",
    }
  );
  if (exportResult.status !== 0) {
    console.error(exportResult.stdout);
    console.error(exportResult.stderr);
    throw new Error("Development backup encrypt failed");
  }

  const artifactPath = findArtifactFile(BACKUP_OUT);
  if (!artifactPath) {
    throw new Error("Encrypted artifact not found in " + BACKUP_OUT);
  }
  const artifactBuffer = fs.readFileSync(artifactPath);
  const head = artifactBuffer.slice(0, 120).toString("utf8");
  if (head.includes('"tables"') && !head.includes("encryptedPayload")) {
    throw new Error("Artifact appears plaintext — aborting upload test");
  }

  console.log("[backup-upload-dev-test] Uploading via POST /v1/admin/backup/upload ...");
  const uploadRes = await request(
    "POST",
    "/v1/admin/backup/upload",
    { "x-baylen-admin-key": adminKey },
    {
      environment: "Development",
      frequency: "daily",
      artifact_base64: artifactBuffer.toString("base64"),
    }
  );

  const payload = uploadRes.json?.upload?.data?.upload || uploadRes.json?.upload || uploadRes.json;
  const summary = {
    http_status: uploadRes.status,
    upload: payload,
    error: uploadRes.json?.error || uploadRes.json?.message,
    artifact_file: path.basename(artifactPath),
    artifact_bytes: artifactBuffer.length,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (uploadRes.status !== 200 || !payload?.workdrive_resource_id) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[backup-upload-dev-test] FAILED:", error.message);
  process.exitCode = 1;
});
