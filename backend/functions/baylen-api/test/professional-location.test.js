"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { JOB_STATUS, assertJobTransition } = require("../lib/professional-job-fsm");
const {
  validateCapturedAt,
  validateAccuracy,
  computeLocationStatus,
  computeAgeSeconds,
  canAcceptProfessionalLocationPing,
  startProfessionalJobTravel,
  recordProfessionalJobLocation,
  getCustomerProfessionalTracking,
} = require("../lib/professional-location-engine");
const {
  isNewerLocation,
  writeProfessionalLocationCache,
  readProfessionalLocationCache,
  referenceCacheKey,
} = require("../lib/professional-location-cache");
const {
  MAX_CAPTURE_AGE_SECONDS,
  MAX_FUTURE_SKEW_SECONDS,
  MAX_ACCURACY_METERS,
} = require("../lib/professional-location-config");
const { JOB_TYPES } = require("../lib/professional-job-engine");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PARTNER_A = "36851000000379403";
const PARTNER_B = "36851000000391429";
const JOB_ID = "36851000000391424";
const USER_ID = "36851000000295001";
const SERVICE_JOB_ID = "36851000000388549";

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

function acceptedJob(overrides = {}) {
  return {
    id: JOB_ID,
    job_number: "PJ20260001",
    job_type: "HOME_SERVICE",
    reference_type: "SERVICE_JOB",
    reference_row_id: SERVICE_JOB_ID,
    delivery_partner_row_id: PARTNER_A,
    outlet_row_id: "36851000000286399",
    status: JOB_STATUS.ACCEPTED,
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
              user_id: USER_ID,
              status: state.serviceJobStatus || "ACCEPTED",
              provider_id: "36851000000295001",
              visit_latitude: 23.3441,
              visit_longitude: 85.3096,
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
      if (sql.includes("reference_type = 'SERVICE_JOB'")) {
        return [{ Professional_Jobs: { ROWID: JOB_ID } }];
      }
      return [];
    },
  };
  return {
    zcql: () => zcqlApi,
    cache: () => ({
      segment: () => ({
        async getValue(key) {
          return cache.get(key) || null;
        },
        async put(key, value) {
          cache.set(key, value);
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
    _updates: updates,
    _history: history,
    _state: state,
  };
}

describe("professional-location PP-005", () => {
  it("FSM allows ACCEPTED to EN_ROUTE", () => {
    assert.doesNotThrow(() => assertJobTransition(JOB_STATUS.ACCEPTED, JOB_STATUS.EN_ROUTE));
  });

  it("validates latitude and longitude bounds via requireCoordinates path", async () => {
    const app = mockApp({ job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }) });
    await assert.rejects(
      () =>
        recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
          latitude: 95,
          longitude: 85.3,
          captured_at: new Date().toISOString(),
        }),
      (error) => error.code === "INVALID_COORDINATES" || error.status === 400
    );
  });

  it("rejects invalid accuracy", () => {
    assert.throws(() => validateAccuracy(-1), (error) => error.code === "LOCATION_INVALID");
  });

  it("rejects stale captured_at", () => {
    const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    assert.throws(() => validateCapturedAt(old), (error) => error.code === "LOCATION_UPDATE_TOO_OLD");
  });

  it("starts travel from ACCEPTED", async () => {
    const state = { job: acceptedJob(), serviceJobStatus: "ACCEPTED" };
    const app = mockApp(state);
    const result = await startProfessionalJobTravel(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.new_status, JOB_STATUS.EN_ROUTE);
    assert.equal(state.job.status, JOB_STATUS.EN_ROUTE);
  });

  it("start travel is idempotent when already EN_ROUTE", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    const result = await startProfessionalJobTravel(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.idempotent, true);
  });

  it("blocks unauthorized professional for location", async () => {
    const app = mockApp({ job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }) });
    await assert.rejects(
      () =>
        recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_B), {
          latitude: 23.34,
          longitude: 85.31,
          captured_at: new Date().toISOString(),
        }),
      (error) => error.code === "JOB_NOT_FOUND"
    );
  });

  it("blocks location when job not EN_ROUTE", async () => {
    const app = mockApp({ job: acceptedJob({ status: JOB_STATUS.ACCEPTED }) });
    await assert.rejects(
      () =>
        recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
          latitude: 23.34,
          longitude: 85.31,
          captured_at: new Date().toISOString(),
        }),
      (error) => error.code === "TRACKING_NOT_ALLOWED"
    );
  });

  it("accepts valid location and updates cache", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    const capturedAt = new Date().toISOString();
    const result = await recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
      latitude: 23.3441,
      longitude: 85.3096,
      accuracy_m: 8,
      speed_mps: 4.2,
      heading: 125,
      captured_at: capturedAt,
    });
    assert.equal(result.recorded, true);
    const cached = await readProfessionalLocationCache(app, JOB_ID);
    assert.equal(cached.latitude, 23.3441);
    assert.equal(cached.longitude, 85.3096);
  });

  it("older location cannot overwrite newer cache", async () => {
    const app = mockApp({ job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }) });
    const newer = {
      latitude: 23.35,
      longitude: 85.31,
      captured_at: "2026-09-05T10:00:15Z",
      professional_row_id: PARTNER_A,
    };
    const older = {
      latitude: 23.34,
      longitude: 85.3,
      captured_at: "2026-09-05T10:00:10Z",
      professional_row_id: PARTNER_A,
    };
    assert.equal(isNewerLocation(older, newer), false);
    await writeProfessionalLocationCache(app, JOB_ID, newer);
    const second = await writeProfessionalLocationCache(app, JOB_ID, older);
    assert.equal(second.written, false);
    assert.equal(second.reason, "STALE_UPDATE");
  });

  it("computes LIVE and STALE location status", () => {
    const live = computeLocationStatus({
      captured_at: new Date().toISOString(),
    });
    assert.equal(live, "LIVE");
    const stale = computeLocationStatus({
      captured_at: new Date(Date.now() - 120000).toISOString(),
    });
    assert.equal(stale, "STALE");
    assert.equal(computeLocationStatus(null), "UNAVAILABLE");
  });

  it("customer tracking authorized for owner", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    await writeProfessionalLocationCache(app, JOB_ID, {
      latitude: 23.3441,
      longitude: 85.3096,
      captured_at: new Date().toISOString(),
      professional_row_id: PARTNER_A,
    });
    const tracking = await getCustomerProfessionalTracking(app, {
      userId: USER_ID,
      professionalJobId: JOB_ID,
    });
    assert.equal(tracking.tracking_allowed, true);
    assert.equal(tracking.location_status, "LIVE");
    assert.equal(tracking.latitude, 23.3441);
    assert.ok(tracking.age_seconds != null);
  });

  it("customer tracking blocked for completed job", async () => {
    const state = {
      job: acceptedJob({ status: JOB_STATUS.COMPLETED }),
      serviceJobStatus: "COMPLETED",
    };
    const app = mockApp(state);
    const tracking = await getCustomerProfessionalTracking(app, {
      userId: USER_ID,
      professionalJobId: JOB_ID,
    });
    assert.equal(tracking.tracking_allowed, false);
    assert.equal(tracking.location_status, "UNAVAILABLE");
  });
});

describe("Module 4 location tracking", () => {
  it("validateCapturedAt rejects timestamps older than max capture age", () => {
    const tooOld = new Date(Date.now() - (MAX_CAPTURE_AGE_SECONDS + 5) * 1000).toISOString();
    assert.throws(() => validateCapturedAt(tooOld), (error) => error.code === "LOCATION_UPDATE_TOO_OLD");
  });

  it("validateCapturedAt rejects future timestamps beyond skew", () => {
    const future = new Date(Date.now() + (MAX_FUTURE_SKEW_SECONDS + 10) * 1000).toISOString();
    assert.throws(() => validateCapturedAt(future), (error) => error.code === "LOCATION_INVALID");
  });

  it("validateAccuracy rejects readings poorer than max accuracy", () => {
    assert.throws(
      () => validateAccuracy(MAX_ACCURACY_METERS + 1),
      (error) => error.code === "LOCATION_INVALID"
    );
  });

  it("canAcceptProfessionalLocationPing allows HOME_SERVICE only while EN_ROUTE", () => {
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.EN_ROUTE, JOB_TYPES.HOME_SERVICE), true);
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.ACCEPTED, JOB_TYPES.HOME_SERVICE), false);
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.ARRIVED, JOB_TYPES.HOME_SERVICE), false);
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.GOING_TO_PICKUP, JOB_TYPES.HOME_SERVICE), false);
  });

  it("canAcceptProfessionalLocationPing allows PRODUCT_DELIVERY during pickup or en route", () => {
    assert.equal(
      canAcceptProfessionalLocationPing(JOB_STATUS.GOING_TO_PICKUP, JOB_TYPES.PRODUCT_DELIVERY),
      true
    );
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.EN_ROUTE, JOB_TYPES.PRODUCT_DELIVERY), true);
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.ACCEPTED, JOB_TYPES.PRODUCT_DELIVERY), false);
    assert.equal(canAcceptProfessionalLocationPing(JOB_STATUS.ARRIVED, JOB_TYPES.PRODUCT_DELIVERY), false);
  });

  it("recordProfessionalJobLocation ignores stale cache when partner sends older ping", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    const newerAt = new Date().toISOString();
    await recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
      latitude: 23.35,
      longitude: 85.31,
      captured_at: newerAt,
    });
    const olderAt = new Date(Date.now() - 5000).toISOString();
    const stale = await recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
      latitude: 23.34,
      longitude: 85.3,
      captured_at: olderAt,
    });
    assert.equal(stale.recorded, false);
    assert.equal(stale.reason, "STALE_UPDATE");
    const cached = await readProfessionalLocationCache(app, JOB_ID);
    assert.equal(cached.latitude, 23.35);
  });

  it("partner publish → cache → customer read integration", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    const capturedAt = new Date().toISOString();
    await recordProfessionalJobLocation(app, JOB_ID, partnerSession(PARTNER_A), {
      latitude: 23.35,
      longitude: 85.32,
      accuracy_m: 12,
      captured_at: capturedAt,
    });
    const refKey = referenceCacheKey("SERVICE_JOB", SERVICE_JOB_ID);
    assert.ok(refKey);
    const refCached = await app.cache().segment().getValue(refKey);
    assert.ok(refCached);
    const tracking = await getCustomerProfessionalTracking(app, {
      userId: USER_ID,
      professionalJobId: JOB_ID,
    });
    assert.equal(tracking.tracking_allowed, true);
    assert.equal(tracking.latitude, 23.35);
    assert.equal(tracking.longitude, 85.32);
    assert.equal(tracking.location_status, "LIVE");
  });

  it("ETA calculation returns reasonable value for known coordinates", async () => {
    const state = { job: acceptedJob({ status: JOB_STATUS.EN_ROUTE }), serviceJobStatus: "EN_ROUTE" };
    const app = mockApp(state);
    await writeProfessionalLocationCache(app, JOB_ID, {
      latitude: 23.35,
      longitude: 85.32,
      captured_at: new Date().toISOString(),
      professional_row_id: PARTNER_A,
    });
    const tracking = await getCustomerProfessionalTracking(app, {
      userId: USER_ID,
      professionalJobId: JOB_ID,
    });
    assert.ok(tracking.route);
    assert.ok(tracking.route.distance_km > 0);
    assert.ok(tracking.route.eta_minutes >= 1);
    assert.equal(tracking.route.routing_source, "haversine_estimate");
  });

  it("hides live coordinates after ARRIVED for privacy", async () => {
    const state = {
      job: acceptedJob({ status: JOB_STATUS.ARRIVED }),
      serviceJobStatus: "ARRIVED",
    };
    const app = mockApp(state);
    await writeProfessionalLocationCache(app, JOB_ID, {
      latitude: 23.3441,
      longitude: 85.3096,
      captured_at: new Date().toISOString(),
      professional_row_id: PARTNER_A,
    });
    const tracking = await getCustomerProfessionalTracking(app, {
      userId: USER_ID,
      professionalJobId: JOB_ID,
    });
    assert.equal(tracking.tracking_allowed, false);
    assert.equal(tracking.arrived, true);
    assert.equal(tracking.latitude, null);
    assert.equal(tracking.longitude, null);
    assert.equal(tracking.location_status, "UNAVAILABLE");
    assert.equal(tracking.route, null);
  });
});
