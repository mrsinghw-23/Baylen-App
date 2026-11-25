"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  JOB_STATUS,
  canTransitionJob,
  assertJobTransition,
  HOME_SERVICE_TRANSITIONS,
  PRODUCT_DELIVERY_TRANSITIONS,
} = require("../lib/professional-job-fsm");
const {
  JOB_TYPES,
  transitionProfessionalJob,
} = require("../lib/professional-job-engine");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const JOB_ID = "36851000000391424";
const PARTNER_A = "36851000000379403";
const PARTNER_B = "36851000000379404";
const SERVICE_JOB_ID = "36851000000390002";
const OUTLET_ID = "36851000000370001";

function buildLifecycleApp(initialJob) {
  const state = {
    job: {
      id: JOB_ID,
      job_number: "PJ20260099",
      job_type: initialJob.job_type || JOB_TYPES.HOME_SERVICE,
      reference_type: "SERVICE_JOB",
      reference_row_id: SERVICE_JOB_ID,
      delivery_partner_row_id: PARTNER_A,
      outlet_row_id: OUTLET_ID,
      status: initialJob.status || JOB_STATUS.ASSIGNMENT_PENDING,
      metadata_json: initialJob.metadata_json || "",
      offer_expires_at: initialJob.offer_expires_at || "2099-01-01 00:00:00",
      accepted_at: initialJob.accepted_at || "",
    },
    history: [],
    serviceJobs: {
      [SERVICE_JOB_ID]: {
        ROWID: SERVICE_JOB_ID,
        user_id: "100",
        booking_number: "HS-99",
        status: "CONFIRMED",
        payment_status: "PAID",
        outlet_row_id: OUTLET_ID,
        visit_city: "Ranchi",
        pincode: "834001",
      },
    },
  };

  function rawJob() {
    return {
      ROWID: state.job.id,
      job_number: state.job.job_number,
      job_type: state.job.job_type,
      reference_type: state.job.reference_type,
      reference_row_id: state.job.reference_row_id,
      delivery_partner_row_id: state.job.delivery_partner_row_id,
      outlet_row_id: state.job.outlet_row_id,
      job_status: state.job.status,
      job_priority: 0,
      idempotency_key: "lifecycle-test",
      metadata_json: state.job.metadata_json,
      offer_expires_at: state.job.offer_expires_at,
      accepted_at: state.job.accepted_at,
    };
  }

  return {
    state,
    zcql() {
      return {
        async executeZCQLQuery(sql) {
          const query = String(sql);
          if (query.includes("FROM Professional_Jobs WHERE ROWID")) {
            return [{ Professional_Jobs: rawJob() }];
          }
          if (query.includes("FROM Service_Jobs WHERE ROWID")) {
            return [{ Service_Jobs: state.serviceJobs[SERVICE_JOB_ID] }];
          }
          if (query.includes("FROM Job_Items WHERE job_id")) {
            return [{ Job_Items: { service_id: "55", service_name: "Facial", quantity: 1 } }];
          }
          if (query.includes("FROM Salon_Services WHERE ROWID")) {
            return [{ Salon_Services: { ROWID: "55", is_at_home: true, duration_minutes: 60 } }];
          }
          if (query.includes("FROM Delivery_Partners WHERE ROWID = " + PARTNER_A)) {
            return [
              {
                Delivery_Partners: {
                  ROWID: PARTNER_A,
                  phone: "+919876543210",
                  status: "active",
                  online_status: "ONLINE_AVAILABLE",
                  outlet_row_id: OUTLET_ID,
                  legacy_provider_id: "501",
                },
              },
            ];
          }
          return [];
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async updateRow(payload) {
              if (name === "Professional_Jobs") {
                if (payload.job_status) state.job.status = payload.job_status;
                if (payload.delivery_partner_row_id !== undefined) {
                  state.job.delivery_partner_row_id = payload.delivery_partner_row_id;
                }
                if (payload.metadata_json !== undefined) {
                  state.job.metadata_json = payload.metadata_json;
                }
                if (payload.accepted_at !== undefined) {
                  state.job.accepted_at = payload.accepted_at;
                }
              }
              if (name === "Service_Jobs") {
                Object.assign(state.serviceJobs[SERVICE_JOB_ID], payload);
              }
            },
            async insertRow(payload) {
              if (name === "Job_Status_History") {
                state.history.push(payload);
              }
            },
          };
        },
      };
    },
    cache() {
      return {
        segment() {
          return { async getValue() { return null; }, async put() {} };
        },
      };
    },
  };
}

async function walkTransitions(app, jobId, statuses, jobType) {
  for (const next of statuses) {
    await transitionProfessionalJob(app, jobId, next, {
      actorId: "test",
      actorRole: "SYSTEM",
      reason: "lifecycle test",
    });
  }
}

describe("Module 3 FSM paths", () => {
  it("allows full HOME_SERVICE transition chain", () => {
    const chain = [
      "ASSIGNMENT_PENDING",
      "ASSIGNED",
      "ACCEPTED",
      "EN_ROUTE",
      "ARRIVED",
      "OTP_VERIFIED",
      "STARTED",
      "IN_PROGRESS",
      "COMPLETED",
    ];
    let current = "CREATED";
    for (const next of chain) {
      assert.equal(canTransitionJob(current, next, JOB_TYPES.HOME_SERVICE), true);
      current = next;
    }
  });

  it("allows full PRODUCT_DELIVERY transition chain", () => {
    const chain = [
      "ASSIGNMENT_PENDING",
      "ASSIGNED",
      "ACCEPTED",
      "GOING_TO_PICKUP",
      "ARRIVED_PICKUP",
      "PICKUP_VERIFIED",
      "PICKED_UP",
      "EN_ROUTE",
      "ARRIVED",
      "DELIVERY_VERIFIED",
      "DELIVERED",
      "COMPLETED",
    ];
    let current = "CREATED";
    for (const next of chain) {
      assert.equal(canTransitionJob(current, next, JOB_TYPES.PRODUCT_DELIVERY), true);
      current = next;
    }
  });

  it("throws INVALID_STATUS_TRANSITION for illegal home service jump", () => {
    assert.throws(
      () => assertJobTransition("ASSIGNMENT_PENDING", "COMPLETED", JOB_TYPES.HOME_SERVICE),
      (error) => error.code === "INVALID_STATUS_TRANSITION" && error.status === 409
    );
  });
});

describe("Module 3 lifecycle transitions", () => {
  it("walks HOME_SERVICE from ASSIGNMENT_PENDING to COMPLETED with history", async () => {
    const app = buildLifecycleApp({ status: JOB_STATUS.ASSIGNMENT_PENDING });
    await walkTransitions(app, JOB_ID, [
      JOB_STATUS.ASSIGNED,
      JOB_STATUS.ACCEPTED,
      JOB_STATUS.EN_ROUTE,
      JOB_STATUS.ARRIVED,
      JOB_STATUS.OTP_VERIFIED,
      JOB_STATUS.STARTED,
      JOB_STATUS.IN_PROGRESS,
      JOB_STATUS.COMPLETED,
    ]);
    assert.equal(app.state.job.status, JOB_STATUS.COMPLETED);
    assert.equal(app.state.history.length, 8);
    assert.equal(app.state.history[0].old_status, JOB_STATUS.ASSIGNMENT_PENDING);
    assert.equal(app.state.history[app.state.history.length - 1].new_status, JOB_STATUS.COMPLETED);
  });

  it("walks PRODUCT_DELIVERY from ASSIGNMENT_PENDING to COMPLETED", async () => {
    const app = buildLifecycleApp({
      job_type: JOB_TYPES.PRODUCT_DELIVERY,
      status: JOB_STATUS.ASSIGNMENT_PENDING,
    });
    await walkTransitions(app, JOB_ID, [
      JOB_STATUS.ASSIGNED,
      JOB_STATUS.ACCEPTED,
      JOB_STATUS.GOING_TO_PICKUP,
      JOB_STATUS.ARRIVED_PICKUP,
      JOB_STATUS.PICKUP_VERIFIED,
      JOB_STATUS.PICKED_UP,
      JOB_STATUS.EN_ROUTE,
      JOB_STATUS.ARRIVED,
      JOB_STATUS.DELIVERY_VERIFIED,
      JOB_STATUS.DELIVERED,
      JOB_STATUS.COMPLETED,
    ]);
    assert.equal(app.state.job.status, JOB_STATUS.COMPLETED);
    assert.equal(app.state.history.length, 11);
  });

  it("allows cancel from each cancellable HOME_SERVICE state", async () => {
    const cancellable = Object.entries(HOME_SERVICE_TRANSITIONS)
      .filter(([, targets]) => targets.has("CANCELLED"))
      .map(([status]) => status);
    for (const from of cancellable) {
      const app = buildLifecycleApp({ status: from });
      await transitionProfessionalJob(app, JOB_ID, JOB_STATUS.CANCELLED, {
        actorId: "customer",
        actorRole: "CUSTOMER",
        reason: "cancel test",
        metadata: { refund_required: true },
      });
      assert.equal(app.state.job.status, JOB_STATUS.CANCELLED);
      const last = app.state.history[app.state.history.length - 1];
      assert.equal(last.new_status, JOB_STATUS.CANCELLED);
      assert.equal(last.old_status, from);
    }
  });

  it("reassignment FSM: REASSIGNMENT_REQUIRED → ASSIGNMENT_PENDING → ASSIGNED", async () => {
    const app = buildLifecycleApp({ status: JOB_STATUS.REASSIGNMENT_REQUIRED });
    await transitionProfessionalJob(app, JOB_ID, JOB_STATUS.ASSIGNMENT_PENDING, {
      actorId: "dispatch",
      actorRole: "SYSTEM",
      reason: "Pool reopened after rejection",
    });
    assert.equal(app.state.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
    await transitionProfessionalJob(app, JOB_ID, JOB_STATUS.ASSIGNED, {
      actorId: "dispatch",
      actorRole: "SYSTEM",
      reason: "Reassigned to new partner",
      metadata: { delivery_partner_row_id: PARTNER_B },
    });
    assert.equal(app.state.job.status, JOB_STATUS.ASSIGNED);
    assert.equal(app.state.history.length, 2);
  });
});
