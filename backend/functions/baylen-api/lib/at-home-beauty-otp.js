"use strict";

const crypto = require("crypto");

const OTP_TTL_MINUTES = 15;
const OTP_MAX_ATTEMPTS = 5;

function otpCacheKey(jobId) {
  return "beauty_job_otp:" + String(jobId);
}

function otpHash(jobId, otp) {
  return crypto
    .createHash("sha256")
    .update(String(jobId) + ":" + String(otp))
    .digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueArrivalOtp(app, jobId) {
  const otp = generateOtp();
  const payload = {
    job_id: String(jobId),
    otp_hash: otpHash(jobId, otp),
    otp_code: otp,
    expires_at: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString(),
    attempts: 0,
    verified: false,
    issued_at: new Date().toISOString(),
  };
  try {
    await app.cache().segment().put(otpCacheKey(jobId), JSON.stringify(payload), OTP_TTL_MINUTES);
  } catch (_) {}
  return { otp, payload };
}

async function readArrivalOtpState(app, jobId) {
  try {
    const raw = await app.cache().segment().getValue(otpCacheKey(jobId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function verifyArrivalOtp(app, jobId, otp) {
  const state = await readArrivalOtpState(app, jobId);
  if (!state) {
    const error = new Error("No arrival code is active for this booking");
    error.status = 404;
    error.code = "OTP_NOT_FOUND";
    throw error;
  }
  if (state.verified) {
    return { verified: true, already_verified: true };
  }
  if (Date.now() > Date.parse(state.expires_at || "")) {
    const error = new Error("Arrival code has expired");
    error.status = 410;
    error.code = "OTP_EXPIRED";
    throw error;
  }
  const attempts = Number(state.attempts || 0) + 1;
  const code = String(otp || "").trim();
  if (!/^\d{6}$/.test(code)) {
    const error = new Error("Enter the 6 digit arrival code");
    error.status = 400;
    throw error;
  }
  if (attempts > OTP_MAX_ATTEMPTS) {
    const error = new Error("Too many invalid attempts. Request a new code from support.");
    error.status = 429;
    error.code = "OTP_LOCKED";
    throw error;
  }
  const valid = state.otp_hash === otpHash(jobId, code);
  if (!valid) {
    state.attempts = attempts;
    try {
      await app.cache().segment().put(otpCacheKey(jobId), JSON.stringify(state), OTP_TTL_MINUTES);
    } catch (_) {}
    const error = new Error("Incorrect arrival code");
    error.status = 401;
    error.code = "OTP_INVALID";
    error.attempts_remaining = Math.max(0, OTP_MAX_ATTEMPTS - attempts);
    throw error;
  }
  state.verified = true;
  state.verified_at = new Date().toISOString();
  state.attempts = attempts;
  try {
    await app.cache().segment().put(otpCacheKey(jobId), JSON.stringify(state), OTP_TTL_MINUTES);
  } catch (_) {}
  return { verified: true, already_verified: false };
}

function customerOtpView(state) {
  if (!state || state.verified) {
    return { required: false, code: null, expires_at: null, verified: state?.verified === true };
  }
  if (Date.now() > Date.parse(state.expires_at || "")) {
    return { required: false, code: null, expires_at: state.expires_at, expired: true };
  }
  return {
    required: true,
    code: state.otp_code || null,
    expires_at: state.expires_at,
    message: "Share this code with your professional when they arrive",
  };
}

module.exports = {
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
  issueArrivalOtp,
  readArrivalOtpState,
  verifyArrivalOtp,
  customerOtpView,
};
