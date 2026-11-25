"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  isProductionRuntime,
  getAuthSessionSecret,
  inventoryImportWorkerMode,
  assertRuntimeSecrets,
  resetRuntimeConfigCache,
  DEV_SESSION_FALLBACK,
} = require("../lib/runtime-config");

describe("runtime-config production guards", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetRuntimeConfigCache();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    resetRuntimeConfigCache();
  });

  it("uses dev session fallback in non-production when unset", () => {
    delete process.env.BAYLEN_ENV;
    delete process.env.AUTH_SESSION_SECRET;
    assert.equal(getAuthSessionSecret(), DEV_SESSION_FALLBACK);
    assert.equal(isProductionRuntime(), false);
    assert.equal(inventoryImportWorkerMode(), "inline");
  });

  it("requires AUTH_SESSION_SECRET in production", () => {
    process.env.BAYLEN_ENV = "production";
    process.env.ADMIN_API_KEY = "a".repeat(32);
    delete process.env.AUTH_SESSION_SECRET;
    assert.throws(() => getAuthSessionSecret(), (error) => error.code === "MISSING_AUTH_SESSION_SECRET");
  });

  it("defaults import worker to deferred in production", () => {
    process.env.BAYLEN_ENV = "production";
    process.env.AUTH_SESSION_SECRET = "s".repeat(32);
    process.env.ADMIN_API_KEY = "a".repeat(32);
    resetRuntimeConfigCache();
    assert.equal(inventoryImportWorkerMode(), "deferred");
  });

  it("assertRuntimeSecrets passes with production secrets", () => {
    process.env.BAYLEN_ENV = "production";
    process.env.AUTH_SESSION_SECRET = "s".repeat(32);
    process.env.ADMIN_API_KEY = "a".repeat(32);
    resetRuntimeConfigCache();
    const status = assertRuntimeSecrets();
    assert.equal(status.production, true);
    assert.equal(status.auth_session_configured, true);
    assert.equal(status.admin_api_key_configured, true);
  });

  it("rejects dev OTP fallback env in production", () => {
    process.env.BAYLEN_ENV = "production";
    process.env.AUTH_SESSION_SECRET = "s".repeat(32);
    process.env.ADMIN_API_KEY = "a".repeat(32);
    process.env.AUTH_OTP_DEV_RETURN_CODE = "true";
    resetRuntimeConfigCache();
    assert.throws(
      () => assertRuntimeSecrets(),
      (error) => error.code === "DEV_OTP_FALLBACK_IN_PRODUCTION"
    );
  });
});
