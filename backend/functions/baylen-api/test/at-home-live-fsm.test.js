"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  assertProviderTransition,
  canAcceptLocationPing,
  canShowLiveTracking,
  requiresArrivalOtp,
  PROVIDER_STATUS_ACTIONS,
} = require("../lib/at-home-beauty-fsm");
const { issueArrivalOtp, verifyArrivalOtp, customerOtpView } = require("../lib/at-home-beauty-otp");
const { buildRouteSummary } = require("../lib/geo-routing");

function mockApp() {
  const store = new Map();
  return {
    cache() {
      return {
        segment() {
          return {
            async put(key, value, _ttl) {
              store.set(key, value);
            },
            async getValue(key) {
              return store.get(key) || null;
            },
          };
        },
      };
    },
    _store: store,
  };
}

describe("provider FSM transitions", () => {
  it("allows ASSIGNED to ACCEPTED and EN_ROUTE chain", () => {
    assert.doesNotThrow(() => assertProviderTransition("ASSIGNED", "ACCEPTED"));
    assert.doesNotThrow(() => assertProviderTransition("ACCEPTED", "EN_ROUTE"));
    assert.doesNotThrow(() => assertProviderTransition("EN_ROUTE", "ARRIVED"));
    assert.doesNotThrow(() => assertProviderTransition("ARRIVED", "STARTED"));
  });

  it("rejects skipping EN_ROUTE", () => {
    assert.throws(() => assertProviderTransition("ACCEPTED", "ARRIVED"), /Invalid status transition/);
  });

  it("includes ACCEPTED in provider actions", () => {
    assert.equal(PROVIDER_STATUS_ACTIONS.includes("ACCEPTED"), true);
  });
});

describe("live tracking gate", () => {
  it("only accepts GPS when EN_ROUTE", () => {
    assert.equal(canAcceptLocationPing("EN_ROUTE"), true);
    assert.equal(canAcceptLocationPing("ACCEPTED"), false);
    assert.equal(canAcceptLocationPing("ASSIGNED"), false);
  });

  it("shows tracking to customer only after travel starts", () => {
    assert.equal(canShowLiveTracking("ASSIGNED"), false);
    assert.equal(canShowLiveTracking("EN_ROUTE"), true);
  });

  it("requires OTP before STARTED from ARRIVED", () => {
    assert.equal(requiresArrivalOtp("ARRIVED", "STARTED"), true);
    assert.equal(requiresArrivalOtp("EN_ROUTE", "ARRIVED"), false);
  });
});

describe("arrival OTP", () => {
  it("issues and verifies a 6 digit code", async () => {
    const app = mockApp();
    const issued = await issueArrivalOtp(app, "9001");
    assert.match(issued.otp, /^\d{6}$/);
    const verified = await verifyArrivalOtp(app, "9001", issued.otp);
    assert.equal(verified.verified, true);
  });

  it("exposes customer view with code while pending", async () => {
    const app = mockApp();
    const issued = await issueArrivalOtp(app, "9002");
    const stateRaw = await app.cache().segment().getValue("beauty_job_otp:9002");
    const pendingView = customerOtpView(JSON.parse(stateRaw));
    assert.equal(pendingView.required, true);
    assert.equal(pendingView.code, issued.otp);
  });
});

describe("geo routing estimate", () => {
  it("returns distance and ETA from coordinates", () => {
    const route = buildRouteSummary(19.076, 72.8777, 19.1176, 72.906, 20);
    assert.ok(route.distance_km > 0);
    assert.ok(route.eta_minutes > 0);
    assert.equal(route.routing_source, "haversine_estimate");
  });
});
