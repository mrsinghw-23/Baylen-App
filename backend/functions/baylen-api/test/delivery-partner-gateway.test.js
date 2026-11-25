"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const RULES_PATH = path.resolve(__dirname, "../../../catalyst-user-rules.json");

function ruleNamesFor(endpoint) {
  const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  return rules
    .filter((rule) => rule.source_endpoint === endpoint)
    .map((rule) => rule.name);
}

describe("PP-001 gateway routes", () => {
  it("registers public pincode lookup endpoint", () => {
    assert.deepEqual(ruleNamesFor("/v1/location/pincode"), ["location-pincode"]);
  });

  it("registers dashboard and status endpoints once", () => {
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/dashboard"), [
      "delivery-partner-dashboard",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/status"), [
      "delivery-partner-status",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/jobs"), [
      "delivery-partner-jobs",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/jobs/detail"), [
      "delivery-partner-job-detail",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-accept"), [
      "delivery-partner-professional-job-accept",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-reject"), [
      "delivery-partner-professional-job-reject",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/notifications"), [
      "delivery-partner-notifications",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-cancel"), [
      "delivery-partner-professional-job-cancel",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/support/tickets"), [
      "delivery-partner-support-tickets",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-start-travel"), [
      "delivery-partner-professional-job-start-travel",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-location"), [
      "delivery-partner-professional-job-location",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/professional-jobs/tracking"), ["professional-jobs-tracking"]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/professional-job-arrive"), [
      "delivery-partner-professional-job-arrive",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/admin/professional-jobs/process-expired-offers"), [
      "admin-professional-jobs-process-expired-offers",
    ]);
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/jobs/{jobId}"), [
      "delivery-partner-job-detail-legacy",
    ]);
  });

  it("registers unified delivery partner KYC route for GET/POST/PUT", () => {
    assert.deepEqual(ruleNamesFor("/v1/delivery-partner/kyc"), ["delivery-partner-kyc"]);
  });

  it("registers admin delivery partner KYC review routes", () => {
    assert.equal(
      ruleNamesFor("/v1/admin/delivery-partners/{id}/kyc/approve").length,
      1
    );
    assert.equal(
      ruleNamesFor("/v1/admin/delivery-partners/{id}/kyc/reject").length,
      1
    );
  });
});
