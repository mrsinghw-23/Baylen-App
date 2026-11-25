"use strict";

const path = require("path");

const DEFAULT_WORKDRIVE_API_BASE = "https://workdrive.zoho.in/api/v1";
const DEFAULT_WORKDRIVE_DOWNLOAD_BASE = "https://workdrive.zoho.in/download";
const DUPLICATE_STATUS = 409;

function workdriveConfigFromEnv(env = process.env) {
  return {
    connectionName:
      String(
        env.WORKDRIVE_CONNECTION_NAME || env.WORKDRIVE_CONNECTION_LINK_NAME || "zohodrive"
      ).trim() || "zohodrive",
    apiBase: String(env.BACKUP_WORKDRIVE_API_BASE || DEFAULT_WORKDRIVE_API_BASE).replace(
      /\/$/,
      ""
    ),
    downloadBase: String(
      env.BACKUP_WORKDRIVE_DOWNLOAD_BASE || DEFAULT_WORKDRIVE_DOWNLOAD_BASE
    ).replace(/\/$/, ""),
    folderIds: {
      daily: String(env.BACKUP_WORKDRIVE_DAILY_FOLDER_ID || "").trim(),
      weekly: String(env.BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID || "").trim(),
      monthly: String(env.BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID || "").trim(),
      "recovery-test": String(env.BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID || "").trim(),
    },
  };
}

function normalizeFrequency(value) {
  const raw = String(value || "daily").trim().toLowerCase();
  if (raw === "daily") return "daily";
  if (raw === "weekly") return "weekly";
  if (raw === "monthly") return "monthly";
  if (raw === "recovery-test" || raw === "recovery_test" || raw === "recovery") {
    return "recovery-test";
  }
  const error = new Error("Invalid backup frequency: " + value);
  error.code = "FREQUENCY_INVALID";
  throw error;
}

function resolveFolderId(frequency, config = workdriveConfigFromEnv()) {
  const key = normalizeFrequency(frequency);
  const envVarByFrequency = {
    daily: "BACKUP_WORKDRIVE_DAILY_FOLDER_ID",
    weekly: "BACKUP_WORKDRIVE_WEEKLY_FOLDER_ID",
    monthly: "BACKUP_WORKDRIVE_MONTHLY_FOLDER_ID",
    "recovery-test": "BACKUP_WORKDRIVE_RECOVERY_FOLDER_ID",
  };
  const folderId = config.folderIds[key];
  if (!folderId) {
    const error = new Error(
      "Missing WorkDrive folder ID for frequency " +
        key +
        ". Set " +
        envVarByFrequency[key]
    );
    error.code = "WORKDRIVE_FOLDER_MISSING";
    error.frequency = key;
    throw error;
  }
  return folderId;
}

async function getWorkdriveAccessToken(app, connectionName) {
  if (!app || !app.connections || typeof app.connections !== "function") {
    const error = new Error("Catalyst app connections API unavailable");
    error.code = "WORKDRIVE_CONNECTION_UNAVAILABLE";
    throw error;
  }
  let credentials;
  try {
    credentials = await app.connections().getConnectionCredentials(connectionName);
  } catch (error) {
    const err = new Error(
      "WorkDrive Catalyst Connection not available: " + connectionName
    );
    err.code = "WORKDRIVE_CONNECTION_MISSING";
    err.cause = error;
    throw err;
  }

  const headers = credentials.headers || {};
  const authorization =
    headers.Authorization || headers.authorization || headers.AUTHORIZATION || "";
  let token = String(authorization)
    .replace(/^Zoho-oauthtoken\s+/i, "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token && credentials.parameters && credentials.parameters.access_token) {
    token = String(credentials.parameters.access_token).trim();
  }
  if (!token) {
    const err = new Error("WorkDrive connection did not return an access token");
    err.code = "WORKDRIVE_TOKEN_MISSING";
    throw err;
  }
  return token;
}

function buildMultipartBody(fieldName, fileName, buffer, boundary) {
  const prefix =
    "--" +
    boundary +
    '\r\nContent-Disposition: form-data; name="' +
    fieldName +
    '"; filename="' +
    fileName +
    '"\r\nContent-Type: application/octet-stream\r\n\r\n';
  const suffix = "\r\n--" + boundary + "--\r\n";
  return Buffer.concat([Buffer.from(prefix, "utf8"), buffer, Buffer.from(suffix, "utf8")]);
}

async function uploadEncryptedArtifact({
  app,
  buffer,
  fileName,
  folderId,
  config = workdriveConfigFromEnv(),
  overrideNameExist = false,
  fetchImpl = fetch,
}) {
  const token = await getWorkdriveAccessToken(app, config.connectionName);
  const boundary = "----baylenbackup" + Date.now();
  const body = buildMultipartBody("content", fileName, buffer, boundary);
  const url =
    config.apiBase +
    "/upload?filename=" +
    encodeURIComponent(fileName) +
    "&parent_id=" +
    encodeURIComponent(folderId) +
    "&override-name-exist=" +
    (overrideNameExist ? "true" : "false");

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: "Zoho-oauthtoken " + token,
      "Content-Type": "multipart/form-data; boundary=" + boundary,
    },
    body,
  });

  const responseBody = await response.json().catch(() => ({}));
  if (response.status === DUPLICATE_STATUS) {
    const error = new Error("WorkDrive duplicate filename conflict: " + fileName);
    error.code = "WORKDRIVE_DUPLICATE";
    error.status = response.status;
    error.body = responseBody;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(
      "WorkDrive upload failed with status " + response.status
    );
    error.code = "WORKDRIVE_UPLOAD_FAILED";
    error.status = response.status;
    error.body = responseBody;
    throw error;
  }

  const resourceId =
    responseBody &&
    Array.isArray(responseBody.data) &&
    responseBody.data[0] &&
    responseBody.data[0].attributes &&
    responseBody.data[0].attributes.resource_id
      ? String(responseBody.data[0].attributes.resource_id)
      : "";

  return {
    fileName,
    folderId,
    resourceId,
    response: responseBody,
  };
}

async function downloadEncryptedArtifact({
  app,
  resourceId,
  config = workdriveConfigFromEnv(),
  fetchImpl = fetch,
}) {
  const token = await getWorkdriveAccessToken(app, config.connectionName);
  const url = config.downloadBase + "/" + encodeURIComponent(resourceId);
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Authorization: "Zoho-oauthtoken " + token,
    },
  });
  if (!response.ok) {
    const error = new Error("WorkDrive download failed with status " + response.status);
    error.code = "WORKDRIVE_DOWNLOAD_FAILED";
    error.status = response.status;
    throw error;
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = {
  DUPLICATE_STATUS,
  workdriveConfigFromEnv,
  normalizeFrequency,
  resolveFolderId,
  getWorkdriveAccessToken,
  uploadEncryptedArtifact,
  downloadEncryptedArtifact,
};
