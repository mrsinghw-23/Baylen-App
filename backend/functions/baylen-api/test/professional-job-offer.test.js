"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { assertJobTransition, JOB_STATUS } = require("../lib/professional-job-fsm");
const {
  REJECTION_REASONS,
  normalizeRejectionReason,
  isOfferExpired,
  acceptProfessionalJobOffer,
  rejectProfessionalJobOffer,
  expireProfessionalJobOffer,
  buildOfferCapabilities,
} = require("../lib/professional-job-offer-engine");
const { computeOfferExpiresAt } = require("../lib/professional-job-engine");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PARTNER_A = "36851000000379403";
const PARTNER_B = "36851000000379404";
const JOB_ID = "36851000000391424";

function partnerSession(rowId) {
  return {
    delivery_partner_id: "dp_" + rowId,
    role: "delivery_partner",
    phone: "+919876543210",
    status: "active",
  };
}

function partnerRow(rowId, overrides = {}) {
  return {
    Delivery_Partners: {
      ROWID: rowId,
      phone: "+919876543210",
      status: "active",
      online_status: "ONLINE_AVAILABLE",
      outlet_row_id: "36851000000286399",
      legacy_provider_id: "3685100000",
      legacy_rider_id: null,
      ...overrides,
    },
  };
}

function assignedJob(overrides = {}) {
  return {
    id: JOB_ID,
    job_number: "PJ20260001",
    job_type: "HOME_SERVICE",
    reference_type: "SERVICE_JOB",
    reference_row_id: "36851000000388549",
    delivery_partner_row_id: PARTNER_A,
    outlet_row_id: "36851000000286399",
    status: JOB_STATUS.ASSIGNED,
    priority: 0,
    metadata_json: "",
    assigned_at: "2026-09-05 10:00:00",
    offer_expires_at: computeOfferExpiresAt(new Date(Date.now() + 3600000)),
    accepted_at: "",
    ...overrides,
  };
}

function mockApp(state) {
  const updates = [];
  const history = [];
  const zcqlApi = {
    async executeZCQLQuery(sql) {
      if (state.partnerOverrides && sql.includes("FROM Delivery_Partners WHERE ROWID = " + PARTNER_A)) {
        return [partnerRow(PARTNER_A, state.partnerOverrides)];
      }
      if (sql.includes("FROM Delivery_Partners WHERE ROWID = " + PARTNER_A)) {
        return [partnerRow(PARTNER_A)];
      }
      if (sql.includes("FROM Delivery_Partners WHERE ROWID = " + PARTNER_B)) {
        return [partnerRow(PARTNER_B)];
      }
      if (sql.includes("FROM Professional_Jobs WHERE ROWID = " + JOB_ID)) {
        return [
          {
            Professional_Jobs: {
              ROWID: JOB_ID,
              job_number: state.job.job_number,
              job_type: state.job.job_type,
              reference_type: state.job.reference_type,
              reference_row_id: state.job.reference_row_id,
              delivery_partner_row_id: state.job.delivery_partner_row_id,
              outlet_row_id: state.job.outlet_row_id,
              job_status: state.job.status,
              job_priority: 0,
              idempotency_key: "test-key",
              assigned_at: state.job.assigned_at,
              accepted_at: state.job.accepted_at,
              offer_expires_at: state.job.offer_expires_at,
              metadata_json: state.job.metadata_json,
            },
          },
        ];
      }
      if (sql.includes("FROM Service_Jobs WHERE ROWID")) {
        return [
          {
            Service_Jobs: {
              ROWID: state.job.reference_row_id,
              booking_number: "BK-1",
              status: "ASSIGNED",
              payment_status: "PAID",
              outlet_row_id: "36851000000286399",
              visit_city: "Ranchi",
              pincode: "834001",
            },
          },
        ];
      }
      if (sql.includes("FROM Job_Items WHERE job_id")) {
        return [{ Job_Items: { service_id: "36851000000380001", service_name: "Facial", quantity: 1 } }];
      }
      if (sql.includes("FROM Salon_Services WHERE ROWID")) {
        return [{ Salon_Services: { ROWID: "36851000000380001", is_at_home: true, duration_minutes: 60 } }];
      }
      if (sql.includes("UPDATE Professional_Jobs")) {
        if (sql.includes("offer_expires_at = NULL")) {
          state.job.offer_expires_at = "";
        }
        if (sql.includes("delivery_partner_row_id = NULL")) {
          state.job.delivery_partner_row_id = "";
        }
        return [];
      }
      if (sql.includes("UPDATE Service_Jobs")) {
        return [];
      }
      return [];
    },
  };
  return {
    updates,
    history,
    zcql() {
      return zcqlApi;
    },
    datastore() {
      return {
        table(name) {
          return {
            async updateRow(payload) {
              updates.push({ table: name, payload });
              if (name === "Professional_Jobs") {
                if (payload.job_status) state.job.status = payload.job_status;
                if (payload.accepted_at) state.job.accepted_at = payload.accepted_at;
                if (payload.delivery_partner_row_id) {
                  state.job.delivery_partner_row_id = payload.delivery_partner_row_id;
                }
                if (payload.metadata_json) state.job.metadata_json = payload.metadata_json;
              }
            },
            async insertRow(payload) {
              history.push(payload);
            },
          };
        },
      };
    },
    cache() {
      return { segment() { return { async getValue() { return null; }, async put() {} }; } };
    },
  };
}

describe("PP-004 FSM", () => {
  it("allows ASSIGNED to ACCEPTED and REASSIGNMENT_REQUIRED", () => {
    assert.doesNotThrow(() => assertJobTransition("ASSIGNED", "ACCEPTED"));
    assert.doesNotThrow(() => assertJobTransition("ASSIGNED", "REASSIGNMENT_REQUIRED"));
    assert.doesNotThrow(() => assertJobTransition("REASSIGNMENT_REQUIRED", "ASSIGNMENT_PENDING"));
  });
});

describe("PP-004 rejection reasons", () => {
  it("accepts controlled reasons only", () => {
    assert.equal(normalizeRejectionReason("too_far"), "TOO_FAR");
    assert.throws(() => normalizeRejectionReason("INVALID"), /reason must be one of/);
    assert.equal(REJECTION_REASONS.includes("OTHER"), true);
  });
});

describe("PP-004 offer expiry", () => {
  it("detects expired offers from timestamp", () => {
    const expired = assignedJob({
      offer_expires_at: "2020-01-01 00:00:00",
    });
    assert.equal(isOfferExpired(expired), true);
    assert.equal(buildOfferCapabilities(expired, PARTNER_A).can_accept, false);
  });
});

describe("PP-004 accept", () => {
  it("accepts a valid offer for the assigned partner", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    const result = await acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.success, true);
    assert.equal(result.new_status, JOB_STATUS.ACCEPTED);
    assert.equal(state.job.status, JOB_STATUS.ACCEPTED);
    assert.ok(state.job.accepted_at);
  });

  it("is idempotent when the same partner accepts twice", async () => {
    const state = { job: assignedJob({ status: JOB_STATUS.ACCEPTED, accepted_at: "2026-09-05 11:00:00" }) };
    const app = mockApp(state);
    const result = await acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.success, true);
    assert.equal(result.new_status, JOB_STATUS.ACCEPTED);
  });

  it("denies unauthorized partner acceptance", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    await assert.rejects(
      () => acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_B)),
      (error) => error.status === 409 && error.code === "JOB_ALREADY_ASSIGNED"
    );
  });

  it("denies acceptance when offer expired", async () => {
    const state = {
      job: assignedJob({ offer_expires_at: "2020-01-01 00:00:00" }),
    };
    const app = mockApp(state);
    await assert.rejects(
      () => acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "OFFER_EXPIRED"
    );
  });

  it("denies acceptance for offline partner", async () => {
    const state = { job: assignedJob(), partnerOverrides: { online_status: "OFFLINE" } };
    const app = mockApp(state);
    await assert.rejects(
      () => acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "PARTNER_OFFLINE"
    );
  });
});

describe("PP-004 reject", () => {
  it("records rejection history metadata", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    const result = await rejectProfessionalJobOffer(
      app,
      JOB_ID,
      partnerSession(PARTNER_A),
      "TOO_FAR"
    );
    assert.equal(result.success, true);
    assert.equal(result.rejection_reason, "TOO_FAR");
    assert.ok(state.job.metadata_json.includes(PARTNER_A));
    assert.equal(state.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
  });

  it("rejects invalid rejection reason", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    await assert.rejects(
      () => rejectProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A), "INVALID"),
      (error) => error.status === 422
    );
  });

  it("denies unauthorized partner rejection", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    await assert.rejects(
      () => rejectProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_B), "TOO_FAR"),
      (error) => error.status === 404
    );
  });
});

describe("PP-004 expire", () => {
  it("expires stale offers and redispatches", async () => {
    const state = {
      job: assignedJob({ offer_expires_at: "2020-01-01 00:00:00" }),
    };
    const app = mockApp(state);
    const originalDispatch = require("../lib/professional-dispatch-engine").dispatchProfessionalJob;
    require("../lib/professional-dispatch-engine").dispatchProfessionalJob = async () => ({
      dispatched: true,
      partner_row_id: PARTNER_B,
    });
    try {
      const result = await expireProfessionalJobOffer(app, JOB_ID);
      assert.equal(result.expired, true);
      assert.equal(state.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
    } finally {
      require("../lib/professional-dispatch-engine").dispatchProfessionalJob = originalDispatch;
    }
  });

  it("is idempotent when offer already accepted", async () => {
    const state = { job: assignedJob({ status: JOB_STATUS.ACCEPTED }) };
    const app = mockApp(state);
    const result = await expireProfessionalJobOffer(app, JOB_ID);
    assert.equal(result.expired, false);
    assert.equal(result.reason, "ALREADY_ACCEPTED");
  });
});

describe("PP-004 concurrency", () => {
  it("allows only one logical acceptance under parallel accept calls", async () => {
    const state = { job: assignedJob() };
    const app = mockApp(state);
    const [first, second] = await Promise.all([
      acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A)),
      acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_A)),
    ]);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(state.job.status, JOB_STATUS.ACCEPTED);
  });

  it("denies second partner when job already accepted", async () => {
    const state = {
      job: assignedJob({
        status: JOB_STATUS.ACCEPTED,
        accepted_at: "2026-09-05 11:00:00",
        delivery_partner_row_id: PARTNER_A,
      }),
    };
    const app = mockApp(state);
    await assert.rejects(
      () => acceptProfessionalJobOffer(app, JOB_ID, partnerSession(PARTNER_B)),
      (error) => error.status === 409 && error.code === "JOB_ALREADY_ASSIGNED"
    );
  });
});

describe("PP-004 capabilities", () => {
  it("exposes accept/reject flags for offered jobs", () => {
    const caps = buildOfferCapabilities(assignedJob(), PARTNER_A);
    assert.equal(caps.can_accept, true);
    assert.equal(caps.can_reject, true);
    assert.equal(caps.accepted, false);
  });
});

describe("PP-004 local job lock", () => {
  it("allows nested lock acquisition on the same job in local mode", async () => {
    const { withProfessionalJobLock } = require("../lib/professional-job-lock");
    process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";
    const app = { cache: () => ({ segment: () => ({ getValue: async () => null, put: async () => {} }) }) };
    let nested = false;
    await withProfessionalJobLock(app, JOB_ID, async () => {
      await withProfessionalJobLock(app, JOB_ID, async () => {
        nested = true;
      });
    });
    assert.equal(nested, true);
  });
});
