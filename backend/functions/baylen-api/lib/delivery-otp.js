"use strict";

const crypto = require("crypto");

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

function pickupOtpCacheKey(orderId) {
  return "delivery_pickup_otp:" + String(orderId);
}

function deliveryOtpCacheKey(orderId) {
  return "delivery_drop_otp:" + String(orderId);
}

function otpHash(orderId, otp, scope) {
  return crypto
    .createHash("sha256")
    .update(String(scope) + ":" + String(orderId) + ":" + String(otp))
    .digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueScopedOtp(app, cacheKey, orderId, scope) {
  const otp = generateOtp();
  const payload = {
    order_id: String(orderId),
    scope,
    otp_hash: otpHash(orderId, otp, scope),
    otp_code: otp,
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
    attempts: 0,
    verified: false,
    issued_at: new Date().toISOString(),
  };
  try {
    await app.cache().segment().put(cacheKey, JSON.stringify(payload), OTP_TTL_MINUTES);
  } catch (_) {}
  return payload;
}

async function readScopedOtp(app, cacheKey) {
  try {
    const raw = await app.cache().segment().getValue(cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

async function verifyScopedOtp(app, cacheKey, orderId, scope, otp) {
  const state = await readScopedOtp(app, cacheKey);
  if (!state) {
    const error = new Error("No verification code is active for this order");
    error.status = 404;
    error.code = "OTP_NOT_FOUND";
    throw error;
  }
  if (state.verified) {
    return { verified: true, already_verified: true };
  }
  if (Date.now() > Date.parse(state.expires_at || "")) {
    const error = new Error("Verification code has expired");
    error.status = 410;
    error.code = "OTP_EXPIRED";
    throw error;
  }
  const attempts = Number(state.attempts || 0) + 1;
  const code = String(otp || "").trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error("Enter the 6 digit verification code");
    error.status = 400;
    throw error;
  }
  if (attempts > OTP_MAX_ATTEMPTS) {
    const error = new Error("Too many invalid attempts");
    error.status = 429;
    error.code = "OTP_LOCKED";
    throw error;
  }
  const valid = state.otp_hash === otpHash(orderId, code, scope);
  state.attempts = attempts;
  if (!valid) {
    try {
      await app.cache().segment().put(cacheKey, JSON.stringify(state), OTP_TTL_MINUTES);
    } catch (_) {}
    const error = new Error("Invalid verification code");
    error.status = 409;
    error.code = "OTP_INVALID";
    throw error;
  }
  state.verified = true;
  state.verified_at = new Date().toISOString();
  delete state.otp_code;
  try {
    await app.cache().segment().put(cacheKey, JSON.stringify(state), OTP_TTL_MINUTES);
  } catch (_) {}
  return { verified: true, already_verified: false };
}

async function issuePickupOtp(app, orderId) {
  return issueScopedOtp(app, pickupOtpCacheKey(orderId), orderId, "PICKUP");
}

async function readPickupOtpState(app, orderId) {
  return readScopedOtp(app, pickupOtpCacheKey(orderId));
}

async function verifyPickupOtp(app, orderId, otp) {
  return verifyScopedOtp(app, pickupOtpCacheKey(orderId), orderId, "PICKUP", otp);
}

async function issueDeliveryOtp(app, orderId) {
  return issueScopedOtp(app, deliveryOtpCacheKey(orderId), orderId, "DELIVERY");
}

async function readDeliveryOtpState(app, orderId) {
  return readScopedOtp(app, deliveryOtpCacheKey(orderId));
}

async function verifyDeliveryOtp(app, orderId, otp) {
  return verifyScopedOtp(app, deliveryOtpCacheKey(orderId), orderId, "DELIVERY", otp);
}

module.exports = {
  OTP_TTL_MINUTES,
  issuePickupOtp,
  readPickupOtpState,
  verifyPickupOtp,
  issueDeliveryOtp,
  readDeliveryOtpState,
  verifyDeliveryOtp,
};
