"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { assertJobTransition, JOB_STATUS } = require("../lib/professional-job-fsm");
const {
  DISPATCH_RANK_WEIGHTS,
  evaluatePartnerEligibility,
  rankEligibleCandidates,
  isJobReferenceDispatchable,
  assignJobToPartner,
  dispatchProfessionalJob,
} = require("../lib/professional-dispatch-engine");
const { buildPartnerJobsQuery, parseView } = require("../lib/professional-job-list");

const LONG_PARTNER_ID = "36851000001234567";
const LONG_JOB_ID = "36851000009876543";

function activePartner(overrides = {}) {
  return {
    row_id: LONG_PARTNER_ID,
    delivery_partner_id: "dp_" + LONG_PARTNER_ID,
    status: "active",
    online_status: "ONLINE_AVAILABLE",
    outlet_row_id: "1001",
    outlet_id: "1001",
    legacy_provider_id: "501",
    legacy_rider_id: "901",
    rating: 4.5,
    phone: "919876543210",
    ...overrides,
  };
}

function pendingJob(overrides = {}) {
  return {
    id: LONG_JOB_ID,
    job_number: "PJ20260001",
    job_type: "HOME_SERVICE",
    reference_type: "SERVICE_JOB",
    reference_row_id: "7001",
    delivery_partner_row_id: "",
    outlet_row_id: "1001",
    status: JOB_STATUS.ASSIGNMENT_PENDING,
    priority: 0,
    metadata_json: "",
    ...overrides,
  };
}

function mockZcql(handlers = {}) {
  return {
    async executeZCQLQuery(sql) {
      for (const [pattern, fn] of Object.entries(handlers)) {
        if (sql.includes(pattern)) {
          return fn(sql);
        }
      }
      return [];
    },
  };
}

describe("PP-003 FSM", () => {
  it("allows ASSIGNMENT_PENDING to ASSIGNED", () => {
    assert.doesNotThrow(() => assertJobTransition("ASSIGNMENT_PENDING", "ASSIGNED"));
  });
});

describe("PP-003 dispatch ranking", () => {
  it("uses explicit weights and does not rank ineligible partners", () => {
    assert.ok(DISPATCH_RANK_WEIGHTS.skill_match > DISPATCH_RANK_WEIGHTS.rating);
    const ranked = rankEligibleCandidates([
      { eligible: false, score: 999, partner_row_id: "1" },
      { eligible: true, score: 120, partner_row_id: "2", distance_km: 2 },
      { eligible: true, score: 150, partner_row_id: "3", distance_km: 5 },
    ]);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].partner_row_id, "3");
  });
});

describe("PP-003 eligibility", () => {
  it("excludes offline partner", async () => {
    const zcql = mockZcql({
      "Provider_Services": async () => [{ Provider_Services: { ROWID: "1" } }],
      "Service_Areas": async () => [{ Service_Areas: { city: "Ranchi" } }],
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const result = await evaluatePartnerEligibility(
      zcql,
      activePartner({ online_status: "OFFLINE" }),
      pendingJob(),
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Ranchi",
        outlet_row_id: "1001",
        scheduled_at: "",
        duration_minutes: 60,
      }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("PARTNER_OFFLINE"));
  });

  it("excludes pending KYC partner", async () => {
    const zcql = mockZcql({
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const result = await evaluatePartnerEligibility(
      zcql,
      activePartner({ status: "kyc_submitted" }),
      pendingJob(),
      { kind: "HOME_SERVICE", is_at_home: true, service_id: "55", outlet_row_id: "1001" }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("PARTNER_NOT_OPERATIONAL"));
  });

  it("excludes partner at concurrent workload limit", async () => {
    const zcql = mockZcql({
      "Provider_Services": async () => [{ Provider_Services: { ROWID: "1" } }],
      "Service_Areas": async () => [{ Service_Areas: { city: "Ranchi" } }],
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 3 } }],
    });
    const result = await evaluatePartnerEligibility(
      zcql,
      activePartner(),
      pendingJob(),
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Ranchi",
        visit_state: "Jharkhand",
        outlet_row_id: "1001",
        scheduled_at: "",
        duration_minutes: 60,
      }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("WORKLOAD_LIMIT"));
  });

  it("excludes partner with schedule conflict", async () => {
    const zcql = mockZcql({
      "Provider_Services": async () => [{ Provider_Services: { ROWID: "1" } }],
      "Service_Areas": async () => [{ Service_Areas: { city: "Ranchi" } }],
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const existingStart = new Date("2026-09-09T10:00:00");
    const result = await evaluatePartnerEligibility(
      zcql,
      activePartner(),
      pendingJob(),
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Ranchi",
        visit_state: "Jharkhand",
        outlet_row_id: "1001",
        scheduled_at: "2026-09-09 10:30:00",
        duration_minutes: 60,
      },
      {
        assignedCount: 0,
        assignedWindows: [
          {
            start: existingStart,
            end: new Date(existingStart.getTime() + 90 * 60000),
          },
        ],
      }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("SCHEDULE_CONFLICT"));
  });

  it("excludes skill mismatch for home service", async () => {
    const zcql = mockZcql({
      "Provider_Services": async () => [],
      "Service_Areas": async () => [{ Service_Areas: { city: "Ranchi" } }],
      "Professional_Jobs WHERE delivery_partner_row_id": async () => [{ Professional_Jobs: { total: 0 } }],
    });
    const result = await evaluatePartnerEligibility(
      zcql,
      activePartner(),
      pendingJob(),
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Ranchi",
        outlet_row_id: "1001",
      }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("SKILL_MISMATCH"));
  });

  it("allows COD order reference for product delivery", () => {
    const check = isJobReferenceDispatchable({
      kind: "PRODUCT_DELIVERY",
      status: "CONFIRMED",
      payment_status: "PENDING",
      payment_method: "COD",
      outlet_row_id: "1001",
    });
    assert.equal(check.ok, true);
  });

  it("allows prepaid order reference for product delivery", () => {
    const check = isJobReferenceDispatchable({
      kind: "PRODUCT_DELIVERY",
      status: "CONFIRMED",
      payment_status: "PAID",
      payment_method: "ONLINE",
      outlet_row_id: "1001",
    });
    assert.equal(check.ok, true);
  });

  it("excludes non-at-home service", () => {
    const check = isJobReferenceDispatchable({
      kind: "HOME_SERVICE",
      status: "CONFIRMED",
      is_at_home: false,
      service_id: "55",
    });
    assert.equal(check.ok, false);
    assert.equal(check.reason, "SERVICE_NOT_AT_HOME");
  });
});

describe("PP-003 assignment concurrency", () => {
  it("second assignment attempt fails when job already assigned", async () => {
    const state = {
      job: {
        ROWID: LONG_JOB_ID,
        job_status: JOB_STATUS.ASSIGNED,
        delivery_partner_row_id: "999",
      },
    };
    const app = {
      zcql: () => mockZcql({
        "FROM Professional_Jobs WHERE ROWID": async () => [{ Professional_Jobs: state.job }],
      }),
      datastore: () => ({
        table(name) {
          return {
            async updateRow(row) {
              Object.assign(state.job, row);
            },
          };
        },
      }),
    };
    const result = await assignJobToPartner(app, LONG_JOB_ID, LONG_PARTNER_ID);
    assert.equal(result.assigned, false);
    assert.equal(result.reason, "JOB_NOT_PENDING");
  });
});

describe("PP-003 partner jobs API query", () => {
  it("builds offered view scoped to partner bigint ROWID", () => {
    parseView("offered");
    const sql = buildPartnerJobsQuery(LONG_PARTNER_ID, "offered", "PRODUCT_DELIVERY");
    assert.match(sql, new RegExp("delivery_partner_row_id = " + LONG_PARTNER_ID));
    assert.match(sql, /job_status = 'ASSIGNED'/);
    assert.match(sql, /PRODUCT_DELIVERY/);
  });
});

describe("PP-003 dispatch with no candidates", () => {
  it("returns NO_ELIGIBLE_PARTNER safely", async () => {
    const jobRow = {
      ROWID: LONG_JOB_ID,
      job_number: "PJ1",
      job_type: "PRODUCT_DELIVERY",
      reference_type: "ORDER",
      reference_row_id: "8001",
      delivery_partner_row_id: "",
      outlet_row_id: "1001",
      job_status: JOB_STATUS.ASSIGNMENT_PENDING,
      job_priority: 0,
      idempotency_key: "k1",
      metadata_json: "{}",
    };
    const app = {
      zcql: () =>
        mockZcql({
          "FROM Professional_Jobs WHERE ROWID": async () => [{ Professional_Jobs: jobRow }],
          "FROM Orders WHERE ROWID": async () => [
            {
              Orders: {
                ROWID: "8001",
                order_number: "BLN-1",
                status: "CONFIRMED",
                payment_status: "PAID",
                payment_method: "ONLINE",
                grand_total: 500,
                shipping_name: "A",
                shipping_line1: "Line",
                shipping_city: "Ranchi",
                shipping_postal_code: "834001",
                fulfillment_store_id: "1001",
              },
            },
          ],
          "FROM Outlets WHERE ROWID": async () => [{ Outlets: { ROWID: "1001", name: "Store", city: "Ranchi" } }],
          "FROM Delivery_Partners WHERE status": async () => [],
          Job_Status_History: async () => [],
        }),
      datastore: () => ({
        table() {
          return { async insertRow() {}, async updateRow() {} };
        },
      }),
    };
    const result = await dispatchProfessionalJob(app, LONG_JOB_ID);
    assert.equal(result.dispatched, false);
    assert.equal(result.reason, "NO_ELIGIBLE_PARTNER");
  });
});
