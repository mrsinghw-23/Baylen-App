"use strict";

const { verifySession } = require("./session");

const RATE_LIMITS = Object.freeze({
  "auth.otp_send": { limit: 8, windowSeconds: 300 },
  "auth.otp_verify": { limit: 15, windowSeconds: 300 },
  "job.accept": { limit: 40, windowSeconds: 60 },
  "job.reject": { limit: 40, windowSeconds: 60 },
  "job.cancel": { limit: 25, windowSeconds: 60 },
  "job.arrival": { limit: 30, windowSeconds: 60 },
  "job.otp_verify": { limit: 20, windowSeconds: 60 },
  "job.otp_resend": { limit: 8, windowSeconds: 300 },
  "job.location": { limit: 180, windowSeconds: 60 },
  "job.proof": { limit: 30, windowSeconds: 60 },
  "job.complete": { limit: 30, windowSeconds: 60 },
  "tracking.customer": { limit: 90, windowSeconds: 60 },
});

function requestIp(req) {
  return String(
    req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown"
  )
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function readBearerToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return String(req.headers["x-baylen-token"] || "").trim();
}

function resolveRateLimitBucket(path, method) {
  const route = String(path || "").split("?")[0];
  if (route === "/v1/auth/delivery-partner/otp/request") {
    return "auth.otp_send";
  }
  if (route === "/v1/auth/delivery-partner/otp/verify") {
    return "auth.otp_verify";
  }
  if (route === "/v1/professional-jobs/tracking" && method === "GET") {
    return "tracking.customer";
  }
  if (method !== "POST" || !route.startsWith("/v1/delivery-partner/")) {
    return null;
  }
  if (route.includes("accept")) {
    return "job.accept";
  }
  if (route.includes("reject")) {
    return "job.reject";
  }
  if (route.includes("cancel") || route.includes("no-show")) {
    return "job.cancel";
  }
  if (route.includes("arrive")) {
    return "job.arrival";
  }
  if (route.includes("verify-otp") || route.includes("verify-pickup") || route.includes("verify-delivery")) {
    return "job.otp_verify";
  }
  if (route.includes("resend-otp")) {
    return "job.otp_resend";
  }
  if (route.includes("location")) {
    return "job.location";
  }
  if (route.includes("proof")) {
    return "job.proof";
  }
  if (route.includes("complete")) {
    return "job.complete";
  }
  return null;
}

function resolveRateLimitIdentity(req, bucket) {
  const token = readBearerToken(req);
  const session = token ? verifySession(token) : null;
  if (session?.delivery_partner_id) {
    return "dp:" + String(session.delivery_partner_id);
  }
  if (session?.user_id) {
    return "user:" + String(session.user_id);
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const mobile = String(body.phone || body.mobile || "").trim();
  if (mobile && bucket.startsWith("auth.")) {
    return "mobile:" + mobile;
  }
  return "ip:" + requestIp(req);
}

function rateLimitCacheKey(bucket, identity) {
  return "pro_rate:" + bucket + ":" + identity;
}

async function enforceProfessionalRateLimit(app, bucket, identity) {
  const config = RATE_LIMITS[bucket];
  if (!config || !app) {
    return;
  }
  const key = rateLimitCacheKey(bucket, String(identity || "anon"));
  let state = { count: 0, window_start: Date.now() };
  try {
    const raw = await app.cache().segment().getValue(key);
    if (raw) {
      state = JSON.parse(raw);
    }
  } catch (_) {}
  const windowStart = Number(state.window_start) || Date.now();
  const elapsed = (Date.now() - windowStart) / 1000;
  if (elapsed >= config.windowSeconds) {
    state = { count: 0, window_start: Date.now() };
  }
  state.count = Number(state.count || 0) + 1;
  const ttlMinutes = Math.max(1, Math.ceil(config.windowSeconds / 60));
  try {
    await app.cache().segment().put(key, JSON.stringify(state), ttlMinutes);
  } catch (_) {}
  if (state.count > config.limit) {
    const error = new Error("Too many requests. Please try again shortly.");
    error.status = 429;
    error.code = "RATE_LIMIT_EXCEEDED";
    error.retry_after_seconds = Math.max(1, Math.ceil(config.windowSeconds - elapsed));
    throw error;
  }
}

async function professionalRateLimitMiddleware(req, res, next) {
  try {
    const bucket = resolveRateLimitBucket(req.path, req.method);
    if (!bucket) {
      return next();
    }
    const identity = resolveRateLimitIdentity(req, bucket);
    await enforceProfessionalRateLimit(req.catalystApp, bucket, identity);
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  RATE_LIMITS,
  resolveRateLimitBucket,
  resolveRateLimitIdentity,
  enforceProfessionalRateLimit,
  professionalRateLimitMiddleware,
};
