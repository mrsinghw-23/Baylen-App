"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { JOB_STATUS, assertJobTransition } = require("../lib/professional-job-fsm");
const {
  startProfessionalJobService,
  updateProfessionalJobChecklistItem,
  completeProfessionalJobService,
  getProfessionalJobExecution,
} = require("../lib/professional-execution-engine");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PARTNER_A = "36851000000379403";
const PARTNER_B = "36851000000391429";
const JOB_ID = "36851000000392163";
const SERVICE_JOB_ID = "36851000000392162";

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

function partnerRow(rowId) {
  return {
    Delivery_Partners: {
      ROWID: rowId,
      phone: "+919876543210",
      status: "active",
      online_status: "ONLINE_AVAILABLE",
      outlet_row_id: "36851000000286399",
      legacy_provider_id: "36851000000295001",
    },
  };
}

function jobRow(overrides = {}) {
  return {
    id: JOB_ID,
    job_number: "PJ20260001",
    job_type: "HOME_SERVICE",
    reference_type: "SERVICE_JOB",
    reference_row_id: SERVICE_JOB_ID,
    delivery_partner_row_id: PARTNER_A,
    outlet_row_id: "36851000000286399",
    status: JOB_STATUS.OTP_VERIFIED,
    started_at: "",
    completed_at: "",
    metadata_json: "",
    ...overrides,
  };
}

function mockApp(state) {
  const cache = new Map();
  const updates = [];
  const history = [];
  const zcqlApi = {
    async executeZCQLQuery(sql) {
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
              job_number: "PJ20260001",
              job_type: "HOME_SERVICE",
              reference_type: "SERVICE_JOB",
              reference_row_id: SERVICE_JOB_ID,
              delivery_partner_row_id: state.job.delivery_partner_row_id,
              outlet_row_id: "36851000000286399",
              job_status: state.job.status,
              job_priority: 0,
              idempotency_key: "home_service:service_job:" + SERVICE_JOB_ID,
              assigned_at: "2026-09-05 10:00:00",
              accepted_at: "2026-09-05 10:05:00",
              offer_expires_at: "",
              started_at: state.job.started_at || "",
              completed_at: state.job.completed_at || "",
              metadata_json: "",
              CREATEDTIME: "2026-09-05 10:00:00",
              MODIFIEDTIME: "2026-09-05 10:00:00",
            },
          },
        ];
      }
      if (sql.includes("FROM Service_Jobs WHERE ROWID = " + SERVICE_JOB_ID)) {
        return [
          {
            Service_Jobs: {
              ROWID: SERVICE_JOB_ID,
              status: state.serviceJobStatus || "ARRIVED",
              user_id: "36851000000290001",
              grand_total: 1299,
              payment_status: "PAID",
              visit_latitude: 23.3448,
              visit_longitude: 85.3101,
              visit_line1: "Test Street",
              visit_city: "Ranchi",
              booking_number: "PP004-HOME-ACCEPT",
            },
          },
        ];
      }
      if (sql.includes("FROM Job_Items WHERE job_id = " + SERVICE_JOB_ID)) {
        return [
          {
            Job_Items: {
              service_id: "36851000000380001",
              service_name: "Hair Spa",
              quantity: 1,
            },
          },
        ];
      }
      if (sql.includes("FROM Salon_Services WHERE ROWID =")) {
        return [
          {
            Salon_Services: {
              ROWID: "36851000000380001",
              name: "Hair Spa",
              duration_minutes: 60,
              is_at_home: true,
              selling_price: 999,
            },
          },
        ];
      }
      if (sql.includes("FROM Users WHERE ROWID =")) {
        return [{ Users: { ROWID: "36851000000290001", first_name: "Test", phone: "+919999999999" } }];
      }
      return [];
    },
  };

  return {
    state,
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
              if (name === "Professional_Jobs" && payload.job_status) {
                state.job.status = payload.job_status;
              }
              if (name === "Professional_Jobs" && payload.started_at) {
                state.job.started_at = payload.started_at;
              }
              if (name === "Professional_Jobs" && payload.completed_at) {
                state.job.completed_at = payload.completed_at;
              }
              if (name === "Service_Jobs" && payload.status) {
                state.serviceJobStatus = payload.status;
              }
              return payload;
            },
            async insertRow(payload) {
              updates.push({ table: name, payload, insert: true });
              return { ROWID: "36851000000400001" };
            },
          };
        },
      };
    },
    cache() {
      return {
        segment() {
          return {
            async getValue(key) {
              if (key === "beauty_job_otp:" + SERVICE_JOB_ID) {
                return JSON.stringify({ verified: true, otp_code: "123456" });
              }
              return cache.get(String(key)) ?? null;
            },
            async put(key, value) {
              cache.set(String(key), value);
            },
          };
        },
      };
    },
  };
}

describe("professional execution FSM", () => {
  it("allows OTP_VERIFIED to STARTED to IN_PROGRESS to COMPLETED", () => {
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.OTP_VERIFIED, JOB_STATUS.STARTED));
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.STARTED, JOB_STATUS.IN_PROGRESS));
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.IN_PROGRESS, JOB_STATUS.COMPLETED));
  });

  it("blocks EN_ROUTE from STARTED", () => {
    assert.throws(() => assertJobTransition(JOB_STATUS.EN_ROUTE, JOB_STATUS.STARTED));
  });
});

describe("professional execution engine", () => {
  it("starts service from OTP_VERIFIED and syncs Service_Jobs", async () => {
    const state = { job: jobRow(), serviceJobStatus: "ARRIVED" };
    const app = mockApp(state);
    const result = await startProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.status, JOB_STATUS.IN_PROGRESS);
    assert.ok(result.service_started_at);
    assert.equal(state.job.status, JOB_STATUS.IN_PROGRESS);
    assert.equal(state.serviceJobStatus, "STARTED");
  });

  it("is idempotent on duplicate start", async () => {
    const state = {
      job: jobRow({ status: JOB_STATUS.IN_PROGRESS, started_at: "2026-09-05 11:00:00" }),
      serviceJobStatus: "STARTED",
    };
    const app = mockApp(state);
    const result = await startProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.idempotent, true);
  });

  it("rejects unauthorized partner", async () => {
    const state = { job: jobRow(), serviceJobStatus: "ARRIVED" };
    const app = mockApp(state);
    await assert.rejects(
      () => startProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_B)),
      (error) => error.code === "JOB_NOT_FOUND"
    );
  });

  it("updates checklist item while in progress", async () => {
    const state = {
      job: jobRow({ status: JOB_STATUS.IN_PROGRESS, started_at: "2026-09-05 11:00:00" }),
      serviceJobStatus: "STARTED",
    };
    const app = mockApp(state);
    await startProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_A));
    const execution = await getProfessionalJobExecution(app, JOB_ID, partnerSession(PARTNER_A));
    const itemId = execution.checklist[0].id;
    const updated = await updateProfessionalJobChecklistItem(
      app,
      JOB_ID,
      partnerSession(PARTNER_A),
      itemId,
      true
    );
    assert.equal(updated.done, true);
    assert.ok(updated.progress_percent >= 0);
  });

  it("completes service after mandatory checklist", async () => {
    const state = {
      job: jobRow({ status: JOB_STATUS.IN_PROGRESS, started_at: "2026-09-05 11:00:00" }),
      serviceJobStatus: "STARTED",
    };
    const app = mockApp(state);
    const execution = await getProfessionalJobExecution(app, JOB_ID, partnerSession(PARTNER_A));
    for (const item of execution.checklist) {
      if (item.mandatory) {
        await updateProfessionalJobChecklistItem(
          app,
          JOB_ID,
          partnerSession(PARTNER_A),
          item.id,
          true
        );
      }
    }
    const result = await completeProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.status, JOB_STATUS.COMPLETED);
    assert.equal(state.serviceJobStatus, "COMPLETED");
  });

  it("blocks completion when mandatory checklist incomplete", async () => {
    const state = {
      job: jobRow({ status: JOB_STATUS.IN_PROGRESS, started_at: "2026-09-05 11:00:00" }),
      serviceJobStatus: "STARTED",
    };
    const app = mockApp(state);
    await assert.rejects(
      () => completeProfessionalJobService(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "CHECKLIST_INCOMPLETE"
    );
  });
});
