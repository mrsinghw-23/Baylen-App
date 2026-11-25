"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  PARTNER_CANCEL_REASONS,
  PARTNER_CANCEL_HOME_STATUSES,
  NO_SHOW_WAIT_MINUTES,
} = require("../lib/professional-lifecycle-config");
const { canTransitionJob, JOB_STATUS } = require("../lib/professional-job-fsm");
const { partnerCancelAllowedStatuses } = require("../lib/professional-job-lifecycle");

describe("PP-010 professional lifecycle config", () => {
  it("normalizes partner cancel reasons", () => {
    assert.ok(PARTNER_CANCEL_REASONS.has("CUSTOMER_UNAVAILABLE"));
    assert.ok(PARTNER_CANCEL_REASONS.has("OTHER"));
  });

  it("requires a configured no-show wait window", () => {
    assert.ok(NO_SHOW_WAIT_MINUTES >= 0);
  });
});

describe("PP-010 professional job FSM cancel", () => {
  it("allows home service cancel before completion", () => {
    assert.equal(canTransitionJob("ACCEPTED", "CANCELLED", "HOME_SERVICE"), true);
    assert.equal(canTransitionJob("EN_ROUTE", "CANCELLED", "HOME_SERVICE"), true);
    assert.equal(canTransitionJob("ARRIVED", "CANCELLED", "HOME_SERVICE"), true);
    assert.equal(canTransitionJob("COMPLETED", "CANCELLED", "HOME_SERVICE"), false);
  });

  it("allows product delivery cancel before delivered", () => {
    assert.equal(canTransitionJob("PICKED_UP", "CANCELLED", "PRODUCT_DELIVERY"), true);
    assert.equal(canTransitionJob("DELIVERED", "CANCELLED", "PRODUCT_DELIVERY"), false);
  });

  it("exposes partner cancel window for home service", () => {
    const allowed = partnerCancelAllowedStatuses({ job_type: "HOME_SERVICE" });
    assert.ok(allowed.has("ACCEPTED"));
    assert.ok(PARTNER_CANCEL_HOME_STATUSES.has("ARRIVED"));
    assert.equal(allowed.has("STARTED"), false);
  });
});

describe("PP-010 terminal cancel guard", () => {
  it("does not allow cancel from completed", () => {
    assert.equal(canTransitionJob(JOB_STATUS.COMPLETED, JOB_STATUS.CANCELLED, "HOME_SERVICE"), false);
  });
});
