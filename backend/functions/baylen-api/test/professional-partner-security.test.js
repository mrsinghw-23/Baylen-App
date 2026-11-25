"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const {
  compareRowIds,
  isSafeRowId,
  assertPartnerOwnsJob,
  assertPartnerOutletAccess,
  assertPartnerJobMutationAccess,
  assertPartnerExecutionAllowed,
} = require("../lib/professional-partner-guard");

describe("PP-011 partner guard", () => {
  it("compares 17-digit Catalyst ROWIDs as strings safely", () => {
    const rowId = "36851000000394489";
    assert.equal(isSafeRowId(rowId), true);
    assert.equal(compareRowIds(rowId, rowId), true);
    assert.equal(Number(rowId) > Number.MAX_SAFE_INTEGER, true);
    assert.equal(compareRowIds(String(Number(rowId)), rowId), false);
  });

  it("denies cross-partner job mutation with 404 semantics", () => {
    assert.throws(
      () =>
        assertPartnerOwnsJob(
          { delivery_partner_row_id: "36851000000379403" },
          { row_id: "36851000000391429" }
        ),
      (error) => error.status === 404 && error.code === "JOB_NOT_FOUND"
    );
  });

  it("denies cross-outlet job access without leaking existence", () => {
    assert.throws(
      () =>
        assertPartnerOutletAccess(
          { outlet_row_id: "36851000000286399" },
          { outlet_row_id: "36851000000286400" }
        ),
      (error) => error.status === 404 && error.code === "JOB_NOT_FOUND"
    );
  });

  it("allows mutation when partner owns job at same outlet", () => {
    assert.doesNotThrow(() =>
      assertPartnerJobMutationAccess(
        {
          delivery_partner_row_id: "36851000000379403",
          outlet_row_id: "36851000000286399",
        },
        {
          row_id: "36851000000379403",
          outlet_row_id: "36851000000286399",
        }
      )
    );
  });

  it("blocks suspended partners from execution", () => {
    assert.throws(
      () => assertPartnerExecutionAllowed({ status: "suspended" }),
      (error) => error.status === 403 && error.code === "PARTNER_NOT_APPROVED"
    );
  });

  it("blocks pending KYC partners from execution", () => {
    assert.throws(
      () => assertPartnerExecutionAllowed({ status: "pending_kyc" }),
      (error) => error.status === 403 && error.code === "PARTNER_NOT_OPERATIONAL"
    );
  });
});

describe("PP-011 gateway coverage", () => {
  it("registers gateway rules for PP-010 lifecycle routes", () => {
    const rules = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../../catalyst-user-rules.json"), "utf8")
    );
    const endpoints = [
      "/v1/delivery-partner/notifications",
      "/v1/delivery-partner/notifications/read",
      "/v1/delivery-partner/professional-job-cancel",
      "/v1/delivery-partner/professional-job-no-show-eligibility",
      "/v1/delivery-partner/professional-job-no-show",
      "/v1/delivery-partner/support/tickets",
    ];
    for (const endpoint of endpoints) {
      assert.equal(
        rules.filter((rule) => rule.source_endpoint === endpoint).length,
        1,
        endpoint
      );
    }
  });
});
