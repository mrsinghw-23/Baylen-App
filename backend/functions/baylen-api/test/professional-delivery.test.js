"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  JOB_STATUS,
  assertJobTransition,
  PRODUCT_DELIVERY_TRANSITIONS,
} = require("../lib/professional-job-fsm");
const {
  startProfessionalJobPickup,
  verifyProfessionalJobPickup,
  completeProfessionalJobDelivery,
} = require("../lib/professional-delivery-engine");
const { writeProfessionalLocationCache } = require("../lib/professional-location-cache");

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PARTNER_A = "36851000000379403";
const JOB_ID = "36851000000393001";
const ORDER_ID = "36851000000393002";
const OUTLET_ID = "36851000000286399";
const PICKUP_LAT = 23.3505;
const PICKUP_LNG = 85.3205;
const DEST_LAT = 23.3448;
const DEST_LNG = 85.3101;

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

function mockApp(state) {
  const cache = new Map();
  const updates = [];
  const zcqlApi = {
    async executeZCQLQuery(sql) {
      if (sql.includes("FROM Delivery_Partners WHERE ROWID = " + PARTNER_A)) {
        return [
          {
            Delivery_Partners: {
              ROWID: PARTNER_A,
              phone: "+919876543210",
              status: "active",
              online_status: "ONLINE_AVAILABLE",
              outlet_row_id: OUTLET_ID,
              legacy_rider_id: "36851000000295002",
            },
          },
        ];
      }
      if (sql.includes("FROM Professional_Jobs WHERE ROWID = " + JOB_ID)) {
        return [
          {
            Professional_Jobs: {
              ROWID: JOB_ID,
              job_number: "PJ20260008",
              job_type: "PRODUCT_DELIVERY",
              reference_type: "ORDER",
              reference_row_id: ORDER_ID,
              delivery_partner_row_id: PARTNER_A,
              outlet_row_id: OUTLET_ID,
              job_status: state.jobStatus,
              job_priority: 0,
              idempotency_key: "product_delivery:order:" + ORDER_ID,
            },
          },
        ];
      }
      if (sql.includes("FROM Orders WHERE ROWID = " + ORDER_ID)) {
        return [
          {
            Orders: {
              ROWID: ORDER_ID,
              order_number: "ORD-PP008",
              status: state.orderStatus || "CONFIRMED",
              payment_status: state.paymentStatus || "PAID",
              payment_method: "ONLINE",
              grand_total: 1499,
              currency: "INR",
              shipping_postal_code: "834001",
              fulfillment_store_id: OUTLET_ID,
            },
          },
        ];
      }
      if (sql.includes("FROM Outlets WHERE ROWID = " + OUTLET_ID)) {
        return [
          {
            Outlets: {
              ROWID: OUTLET_ID,
              name: "PP008 Store",
              address_line1: "Store Road",
              city: "Ranchi",
              latitude: PICKUP_LAT,
              longitude: PICKUP_LNG,
            },
          },
        ];
      }
      return [];
    },
  };
  return {
    zcql: () => zcqlApi,
    cache: () => ({
      segment: () => ({
        async put(key, value) {
          cache.set(key, value);
        },
        async getValue(key) {
          return cache.get(key) || null;
        },
      }),
    }),
    datastore: () => ({
      table: () => ({
        async updateRow(row) {
          updates.push(row);
          if (row.job_status) {
            state.jobStatus = row.job_status;
          }
        },
        async insertRow(row) {
          updates.push(row);
        },
      }),
    }),
    _updates: updates,
    _cache: cache,
  };
}

describe("professional-delivery PP-008", () => {
  it("product FSM allows full delivery path", () => {
    assert.doesNotThrow(() =>
      assertJobTransition(JOB_STATUS.ACCEPTED, JOB_STATUS.GOING_TO_PICKUP, "PRODUCT_DELIVERY")
    );
    assert.doesNotThrow(() =>
      assertJobTransition(JOB_STATUS.GOING_TO_PICKUP, JOB_STATUS.ARRIVED_PICKUP, "PRODUCT_DELIVERY")
    );
    assert.doesNotThrow(() =>
      assertJobTransition(JOB_STATUS.PICKED_UP, JOB_STATUS.EN_ROUTE, "PRODUCT_DELIVERY")
    );
    assert.doesNotThrow(() =>
      assertJobTransition(JOB_STATUS.DELIVERED, JOB_STATUS.COMPLETED, "PRODUCT_DELIVERY")
    );
    assert.throws(() =>
      assertJobTransition(JOB_STATUS.ACCEPTED, JOB_STATUS.EN_ROUTE, "PRODUCT_DELIVERY")
    );
  });

  it("home service cannot use product-only transitions", () => {
    assert.throws(() =>
      assertJobTransition(JOB_STATUS.ACCEPTED, JOB_STATUS.GOING_TO_PICKUP, "HOME_SERVICE")
    );
  });

  it("start pickup transitions ACCEPTED to GOING_TO_PICKUP", async () => {
    const state = { jobStatus: JOB_STATUS.ACCEPTED, orderStatus: "CONFIRMED" };
    const app = mockApp(state);
    const result = await startProfessionalJobPickup(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.status, JOB_STATUS.GOING_TO_PICKUP);
    assert.equal(state.jobStatus, JOB_STATUS.GOING_TO_PICKUP);
  });

  it("verify pickup rejects without OTP state", async () => {
    const state = { jobStatus: JOB_STATUS.ARRIVED_PICKUP };
    const app = mockApp(state);
    await assert.rejects(
      () => verifyProfessionalJobPickup(app, JOB_ID, partnerSession(PARTNER_A), "123456"),
      (error) => error.code === "OTP_NOT_FOUND"
    );
  });

  it("complete delivery is idempotent", async () => {
    const state = { jobStatus: JOB_STATUS.COMPLETED };
    const app = mockApp(state);
    const result = await completeProfessionalJobDelivery(app, JOB_ID, partnerSession(PARTNER_A));
    assert.equal(result.idempotent, true);
    assert.equal(result.status, JOB_STATUS.COMPLETED);
  });

  it("PRODUCT_DELIVERY_TRANSITIONS includes reassignment protection", () => {
    assert.ok(PRODUCT_DELIVERY_TRANSITIONS.ACCEPTED.has("REASSIGNMENT_REQUIRED"));
    assert.ok(PRODUCT_DELIVERY_TRANSITIONS.EN_ROUTE.has("REASSIGNMENT_REQUIRED"));
  });
});
