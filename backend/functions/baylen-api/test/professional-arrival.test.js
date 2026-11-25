"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { JOB_STATUS, assertJobTransition } = require("../lib/professional-job-fsm");
const { ARRIVAL_RADIUS_METERS, haversineMeters } = require("../lib/professional-arrival-engine");
const {
  getProfessionalJobArrivalPreview,
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
  resendProfessionalJobOtp,
} = require("../lib/professional-arrival-engine");
const {
  writeProfessionalLocationCache,
} = require("../lib/professional-location-cache");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PARTNER_A = "36851000000379403";
const PARTNER_B = "36851000000391429";
const JOB_ID = "36851000000391424";
const SERVICE_JOB_ID = "36851000000388549";
const DEST_LAT = 23.3448;
const DEST_LNG = 85.3101;

function partnerSession(rowId) {
  return {
    delivery_partner_id: "dp_" + rowId,
    role: "delivery_partner",
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
      legacy_provider_id: "36851000000295001",
      ...overrides,
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
    status: JOB_STATUS.EN_ROUTE,
    priority: 0,
    metadata_json: "",
    assigned_at: "2026-09-05 10:00:00",
    offer_expires_at: "",
    accepted_at: "2026-09-05 10:05:00",
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
        return [partnerRow(PARTNER_A, state.partnerOverrides || {})];
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
      if (sql.includes("FROM Service_Jobs WHERE ROWID = " + SERVICE_JOB_ID)) {
        return [
          {
            Service_Jobs: {
              ROWID: SERVICE_JOB_ID,
              user_id: "36851000000295001",
              status: state.serviceJobStatus || "EN_ROUTE",
              provider_id: "36851000000295001",
              visit_latitude: DEST_LAT,
              visit_longitude: DEST_LNG,
              visit_line1: "Test address",
              visit_city: "Ranchi",
              visit_state: "Jharkhand",
              pincode: "834001",
              booking_number: "BK001",
              grand_total: 999,
              currency: "INR",
              scheduled_at: "2026-09-05 12:00:00",
              service_name_snapshot: "Facial",
            },
          },
        ];
      }
      if (sql.includes("FROM Job_Items WHERE job_id = " + SERVICE_JOB_ID)) {
        return [{ Job_Items: { service_id: "1", service_name: "Facial", quantity: 1 } }];
      }
      if (sql.includes("FROM Salon_Services WHERE ROWID = 1")) {
        return [{ Salon_Services: { ROWID: "1", name: "Facial", duration_minutes: 60, is_at_home: true } }];
      }
      return [];
    },
  };
  return {
    zcql: () => zcqlApi,
    cache: () => ({
      segment: () => ({
        async getValue(key) {
          return cache.get(String(key)) ?? null;
        },
        async put(key, value) {
          cache.set(String(key), value);
        },
      }),
    }),
    datastore: () => ({
      table(name) {
        return {
          async updateRow(row) {
            updates.push({ table: name, row });
            if (name === "Professional_Jobs" && row.job_status) {
              state.job.status = row.job_status;
            }
            if (name === "Service_Jobs" && row.status) {
              state.serviceJobStatus = row.status;
            }
          },
          async insertRow(row) {
            updates.push({ table: name, row });
          },
        };
      },
    }),
    _cache: cache,
    _state: state,
    _history: history,
  };
}

async function seedNearLocation(app) {
  await writeProfessionalLocationCache(app, JOB_ID, {
    latitude: DEST_LAT,
    longitude: DEST_LNG,
    accuracy_m: 8,
    captured_at: new Date().toISOString(),
    professional_row_id: PARTNER_A,
  });
}

async function seedFarLocation(app) {
  await writeProfessionalLocationCache(app, JOB_ID, {
    latitude: 23.33,
    longitude: 85.29,
    accuracy_m: 8,
    captured_at: new Date().toISOString(),
    professional_row_id: PARTNER_A,
  });
}

describe("professional-arrival PP-006", () => {
  it("FSM allows EN_ROUTE to ARRIVED and ARRIVED to OTP_VERIFIED", () => {
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.EN_ROUTE, JOB_STATUS.ARRIVED));
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.ARRIVED, JOB_STATUS.OTP_VERIFIED));
  });

  it("haversineMeters returns reasonable distance", () => {
    const meters = haversineMeters(DEST_LAT, DEST_LNG, DEST_LAT + 0.0005, DEST_LNG + 0.0005);
    assert.ok(meters > 0 && meters < 200);
  });

  it("arrival preview eligible when inside radius", async () => {
    const app = mockApp({ job: jobRow(), serviceJobStatus: "EN_ROUTE" });
    await seedNearLocation(app);
    const preview = await getProfessionalJobArrivalPreview(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(preview.eligible, true);
    assert.ok(preview.distance_meters <= ARRIVAL_RADIUS_METERS);
  });

  it("confirm arrival succeeds inside geofence", async () => {
    const state = { job: jobRow(), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    await seedNearLocation(app);
    const result = await confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.status, JOB_STATUS.ARRIVED);
    assert.equal(state.job.status, JOB_STATUS.ARRIVED);
    assert.equal(state.serviceJobStatus, "ARRIVED");
  });

  it("ARRIVAL_TOO_FAR when outside geofence", async () => {
    const app = mockApp({ job: jobRow(), serviceJobStatus: "EN_ROUTE" });
    await seedFarLocation(app);
    await assert.rejects(
      () => confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "ARRIVAL_TOO_FAR"
    );
  });

  it("LOCATION_STALE blocks arrival", async () => {
    const app = mockApp({ job: jobRow(), serviceJobStatus: "EN_ROUTE" });
    await writeProfessionalLocationCache(app, JOB_ID, {
      latitude: DEST_LAT,
      longitude: DEST_LNG,
      accuracy_m: 8,
      captured_at: new Date(Date.now() - 120000).toISOString(),
      professional_row_id: PARTNER_A,
    });
    await assert.rejects(
      () => confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "LOCATION_STALE"
    );
  });

  it("wrong professional blocked", async () => {
    const app = mockApp({ job: jobRow(), serviceJobStatus: "EN_ROUTE" });
    await seedNearLocation(app);
    await assert.rejects(
      () => confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_B)),
      (error) => error.code === "JOB_NOT_FOUND"
    );
  });

  it("arrival idempotent when already ARRIVED", async () => {
    const state = { job: jobRow({ status: JOB_STATUS.ARRIVED }), serviceJobStatus: "ARRIVED" };
    const app = mockApp(state);
    await seedNearLocation(app);
    const result = await confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.idempotent, true);
  });

  it("OTP verification success", async () => {
    const state = { job: jobRow(), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    await seedNearLocation(app);
    await confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A));
    const otpRaw = app._cache.get("beauty_job_otp:" + SERVICE_JOB_ID);
    const otpState = JSON.parse(otpRaw);
    const result = await verifyProfessionalJobOtp(
      app,
      JOB_ID,
      partnerSession(PARTNER_A),
      otpState.otp_code
    );
    assert.equal(result.status, JOB_STATUS.OTP_VERIFIED);
    assert.equal(state.job.status, JOB_STATUS.OTP_VERIFIED);
  });

  it("invalid OTP rejected", async () => {
    const state = { job: jobRow({ status: JOB_STATUS.ARRIVED }), serviceJobStatus: "ARRIVED" };
    const app = mockApp(state);
    await issueOtp(app);
    await assert.rejects(
      () => verifyProfessionalJobOtp(app, JOB_ID, partnerSession(PARTNER_A), "000000"),
      (error) => error.code === "OTP_INVALID"
    );
  });

  it("OTP verification idempotent", async () => {
    const state = { job: jobRow({ status: JOB_STATUS.OTP_VERIFIED }), serviceJobStatus: "ARRIVED" };
    const app = mockApp(state);
    const result = await verifyProfessionalJobOtp(app, JOB_ID, partnerSession(PARTNER_A), "123456");
    assert.equal(result.idempotent, true);
  });

  it("cancelled job cannot arrive", async () => {
    const app = mockApp({ job: jobRow({ status: JOB_STATUS.CANCELLED }), serviceJobStatus: "CANCELLED" });
    await seedNearLocation(app);
    await assert.rejects(
      () => confirmProfessionalJobArrival(app, JOB_ID, partnerSession(PARTNER_A)),
      (error) => error.code === "JOB_NOT_TRACKABLE"
    );
  });
});

async function issueOtp(app) {
  const { issueArrivalOtp } = require("../lib/at-home-beauty-otp");
  await issueArrivalOtp(app, SERVICE_JOB_ID);
}
