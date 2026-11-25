"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  parseWhatsappGatewayResponse,
  isDevOtpFallbackEnabled,
} = require("../lib/whatsapp-otp");

describe("whatsapp OTP gateway parsing", () => {
  it("accepts Meta-style message id responses", () => {
    const result = parseWhatsappGatewayResponse({
      messaging_product: "whatsapp",
      messages: [{ id: "wamid.HBgMOTE5NzY1NDMyMTA" }],
    });
    assert.equal(result.accepted, true);
    assert.equal(result.messageId, "wamid.HBgMOTE5NzY1NDMyMTA");
  });

  it("rejects HTTP 200 bodies with gateway errors", () => {
    const result = parseWhatsappGatewayResponse({
      error: { message: "Invalid template", code: 132000 },
    });
    assert.equal(result.accepted, false);
    assert.match(result.reason, /Invalid template/);
  });

  it("rejects empty success bodies without a message id", () => {
    const result = parseWhatsappGatewayResponse({ messaging_product: "whatsapp" });
    assert.equal(result.accepted, false);
    assert.match(result.reason, /did not confirm/i);
  });

  it("rejects plain-text error bodies", () => {
    const result = parseWhatsappGatewayResponse("Unauthorized");
    assert.equal(result.accepted, false);
    assert.match(result.reason, /Unauthorized/);
  });
});

describe("whatsapp OTP dev fallback guard", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  beforeEach(() => {
    process.env = { ...envBackup };
  });

  it("allows dev fallback only outside production", () => {
    delete process.env.BAYLEN_ENV;
    process.env.AUTH_OTP_DEV_RETURN_CODE = "true";
    assert.equal(isDevOtpFallbackEnabled(), true);
  });

  it("never allows dev fallback in production even when env var is true", () => {
    process.env.BAYLEN_ENV = "production";
    process.env.AUTH_OTP_DEV_RETURN_CODE = "true";
    assert.equal(isDevOtpFallbackEnabled(), false);
  });
});
