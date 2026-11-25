"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const { asId } = require("../lib/http");
const { compareRowIds, isSafeRowId } = require("../lib/professional-partner-guard");
const {
  resolveRateLimitBucket,
  enforceProfessionalRateLimit,
  RATE_LIMITS,
} = require("../lib/professional-rate-limit");
const {
  OTP_MAX_ATTEMPTS,
  verifyArrivalOtp,
  issueArrivalOtp,
  customerOtpView,
} = require("../lib/at-home-beauty-otp");
const {
  verifyPickupOtp,
  issuePickupOtp,
  readPickupOtpState,
} = require("../lib/delivery-otp");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const ROW_ID = "36851000000394489";

describe("PP-012 ROWID audit", () => {
  it("asId keeps 17-digit Catalyst ids as strings", () => {
    assert.equal(asId(ROW_ID, "id"), ROW_ID);
    assert.equal(Number(ROW_ID) > Number.MAX_SAFE_INTEGER, true);
  });

  it("compareRowIds avoids Number truncation", () => {
    assert.equal(compareRowIds(ROW_ID, ROW_ID), true);
    assert.equal(compareRowIds(String(Number(ROW_ID)), ROW_ID), false);
  });

  it("professional lib modules avoid parseInt on row ids", () => {
    const libDir = path.resolve(__dirname, "../lib");
    const files = fs
      .readdirSync(libDir)
      .filter((name) => name.startsWith("professional") || name.startsWith("delivery-partner"))
      .filter((name) => name.endsWith(".js"));
    const unsafe = [];
    const rowIdPattern = /parseInt\s*\([^)]*(row|ROWID|Id|id)/i;
    for (const file of files) {
      const content = fs.readFileSync(path.join(libDir, file), "utf8");
      if (rowIdPattern.test(content)) {
        unsafe.push(file);
      }
    }
    assert.deepEqual(unsafe, []);
  });

  it("normalizeRowId path uses asId not Number()", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../lib/professional-job-engine.js"),
      "utf8"
    );
    assert.match(source, /function normalizeRowId\(value, field\) {\s*return asId\(value, field\);/);
    assert.equal(isSafeRowId(ROW_ID), true);
  });
});

describe("PP-012 OTP + file security", () => {
  function mockCacheApp() {
    const store = new Map();
    return {
      cache() {
        return {
          segment() {
            return {
              async put(key, value) {
                store.set(key, value);
              },
              async getValue(key) {
                return store.get(key) || null;
              },
            };
          },
        };
      },
      store,
    };
  }

  it("hashes arrival OTP and locks after max attempts", async () => {
    const app = mockCacheApp();
    await issueArrivalOtp(app, "job-1");
    const raw = app.store.get("beauty_job_otp:job-1");
    const state = JSON.parse(raw);
    assert.ok(state.otp_hash);
    assert.ok(state.otp_code);
    assert.ok(!state.otp_hash.includes(state.otp_code));

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      try {
        await verifyArrivalOtp(app, "job-1", "000000");
      } catch (error) {
        assert.ok(error.code === "OTP_INVALID" || error.code === "OTP_LOCKED");
      }
    }
    await assert.rejects(() => verifyArrivalOtp(app, "job-1", "000000"), (error) => {
      return error.status === 429 && error.code === "OTP_LOCKED";
    });
  });

  it("delivery pickup OTP removes plaintext code after verification", async () => {
    const app = mockCacheApp();
    const payload = await issuePickupOtp(app, "order-1");
    await verifyPickupOtp(app, "order-1", payload.otp_code);
    const after = await readPickupOtpState(app, "order-1");
    assert.equal(after.verified, true);
    assert.equal(after.otp_code, undefined);
  });

  it("customer OTP view exposes code only to customer channel", () => {
    const view = customerOtpView({
      verified: false,
      otp_code: "123456",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    assert.equal(view.required, true);
    assert.equal(view.code, "123456");
  });

  it("arrival preview response schema excludes OTP fields", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../lib/professional-arrival-engine.js"),
      "utf8"
    );
    const start = source.indexOf("async function getProfessionalJobArrivalPreview");
    const end = source.indexOf("async function syncServiceJobArrived");
    const previewBlock = source.slice(start, end);
    assert.equal(previewBlock.includes("otp_code"), false);
    assert.equal(previewBlock.includes("customerOtpView"), false);
  });
});

describe("PP-012 rate limiting", () => {
  it("maps sensitive professional routes to buckets", () => {
    assert.equal(resolveRateLimitBucket("/v1/delivery-partner/professional-job-accept", "POST"), "job.accept");
    assert.equal(resolveRateLimitBucket("/v1/delivery-partner/professional-job-location", "POST"), "job.location");
    assert.equal(resolveRateLimitBucket("/v1/auth/delivery-partner/otp/request", "POST"), "auth.otp_send");
    assert.equal(resolveRateLimitBucket("/v1/professional-jobs/tracking", "GET"), "tracking.customer");
  });

  it("returns 429 when bucket exceeds configured limit", async () => {
    const store = new Map();
    const app = {
      cache() {
        return {
          segment() {
            return {
              async put(key, value) {
                store.set(key, value);
              },
              async getValue(key) {
                return store.get(key) || null;
              },
            };
          },
        };
      },
    };
    const bucket = "job.accept";
    const limit = RATE_LIMITS[bucket].limit;
    for (let i = 0; i < limit; i++) {
      await enforceProfessionalRateLimit(app, bucket, "dp:test");
    }
    await assert.rejects(
      () => enforceProfessionalRateLimit(app, bucket, "dp:test"),
      (error) => error.status === 429 && error.code === "RATE_LIMIT_EXCEEDED"
    );
  });
});
