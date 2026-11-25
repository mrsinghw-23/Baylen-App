"use strict";

const DEV_SESSION_FALLBACK = "baylen-dev-session-key";
const MIN_SECRET_LENGTH = 32;

/**
 * Production runtime detection.
 * Set BAYLEN_ENV=production or CATALYST_ENVIRONMENT=Production on Production baylen-api.
 */
function isProductionRuntime() {
  const raw = String(
    process.env.BAYLEN_ENV || process.env.CATALYST_ENVIRONMENT || process.env.NODE_ENV || ""
  ).toLowerCase();
  return raw === "production" || raw === "prod";
}

function resolveAuthSessionSecret() {
  const secret = String(process.env.AUTH_SESSION_SECRET || "").trim();
  if (secret.length >= MIN_SECRET_LENGTH) {
    return secret;
  }
  if (isProductionRuntime()) {
    const error = new Error(
      "AUTH_SESSION_SECRET must be set to a random string of at least " +
        MIN_SECRET_LENGTH +
        " characters in Production"
    );
    error.code = "MISSING_AUTH_SESSION_SECRET";
    throw error;
  }
  if (secret.length > 0 && secret.length < MIN_SECRET_LENGTH) {
    console.warn(
      "[runtime-config] AUTH_SESSION_SECRET is shorter than " +
        MIN_SECRET_LENGTH +
        " characters — use a longer secret before Production"
    );
  }
  return secret || DEV_SESSION_FALLBACK;
}

function resolveAdminApiKey() {
  const key = String(process.env.ADMIN_API_KEY || "").trim();
  if (key.length >= MIN_SECRET_LENGTH) {
    return key;
  }
  if (isProductionRuntime()) {
    const error = new Error(
      "ADMIN_API_KEY must be set to a random string of at least " +
        MIN_SECRET_LENGTH +
        " characters in Production"
    );
    error.code = "MISSING_ADMIN_API_KEY";
    throw error;
  }
  return key;
}

let cachedSessionSecret = null;

function getAuthSessionSecret() {
  if (!cachedSessionSecret) {
    cachedSessionSecret = resolveAuthSessionSecret();
  }
  return cachedSessionSecret;
}

function inventoryImportWorkerMode() {
  const explicit = String(process.env.INVENTORY_IMPORT_WORKER_MODE || "").toLowerCase();
  if (explicit === "inline" || explicit === "deferred") {
    return explicit;
  }
  return isProductionRuntime() ? "deferred" : "inline";
}

/**
 * Fail fast on Production misconfiguration. Development warns only.
 */
function assertRuntimeSecrets() {
  getAuthSessionSecret();
  const adminKey = resolveAdminApiKey();
  if (isProductionRuntime() && !adminKey) {
    const error = new Error("ADMIN_API_KEY is required in Production");
    error.code = "MISSING_ADMIN_API_KEY";
    throw error;
  }
  if (isProductionRuntime() && inventoryImportWorkerMode() !== "deferred") {
    console.warn(
      "[runtime-config] INVENTORY_IMPORT_WORKER_MODE should be 'deferred' in Production"
    );
  }
  if (
    isProductionRuntime() &&
    String(process.env.AUTH_OTP_DEV_RETURN_CODE || "false").toLowerCase() === "true"
  ) {
    const error = new Error("AUTH_OTP_DEV_RETURN_CODE must be false in Production");
    error.code = "DEV_OTP_FALLBACK_IN_PRODUCTION";
    throw error;
  }
  return {
    production: isProductionRuntime(),
    import_worker_mode: inventoryImportWorkerMode(),
    auth_session_configured: getAuthSessionSecret() !== DEV_SESSION_FALLBACK,
    admin_api_key_configured: adminKey.length >= MIN_SECRET_LENGTH,
  };
}

function resetRuntimeConfigCache() {
  cachedSessionSecret = null;
}

module.exports = {
  DEV_SESSION_FALLBACK,
  MIN_SECRET_LENGTH,
  isProductionRuntime,
  getAuthSessionSecret,
  resolveAdminApiKey,
  inventoryImportWorkerMode,
  assertRuntimeSecrets,
  resetRuntimeConfigCache,
};
