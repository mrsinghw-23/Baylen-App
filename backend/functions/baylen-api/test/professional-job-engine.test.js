"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  JOB_TYPES,
  JOB_STATUS,
  buildProductDeliveryIdempotencyKey,
  buildHomeServiceIdempotencyKey,
  resolveCheckoutOrderTargets,
  createProfessionalJob,
  ensureProductDeliveryJob,
  ensureHomeServiceJob,
  ensureProductDeliveryJobsForCheckout,
  ensureProductDeliveryJobsForPaidOrder,
  transitionProfessionalJob,
  mapProfessionalJob,
} = require("../lib/professional-job-engine");
const { assertJobTransition } = require("../lib/professional-job-fsm");

const LONG_ORDER_ID = "36851000000390001";
const LONG_SERVICE_JOB_ID = "36851000000390002";
const LONG_PARTNER_ID = "36851000000379403";
const LONG_OUTLET_ID = "36851000000370001";

function buildProfessionalJobApp(state) {
  state.professionalJobs = state.professionalJobs || [];
  state.statusHistory = state.statusHistory || [];
  state.orders = state.orders || {};
  state.serviceJobs = state.serviceJobs || {};
  state.nextJobId = state.nextJobId || 9000;

  function findJobByKey(key) {
    return state.professionalJobs.find((row) => row.idempotency_key === key) || null;
  }

  return {
    zcql() {
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Professional_Jobs WHERE idempotency_key")) {
            const keyMatch = sql.match(/idempotency_key = '([^']+)'/);
            const key = keyMatch ? keyMatch[1] : "";
            const row = findJobByKey(key);
            return row ? [{ Professional_Jobs: row._raw }] : [];
          }
          if (sql.includes("FROM Professional_Jobs WHERE ROWID")) {
            const idMatch = sql.match(/ROWID = (\d+)/);
            const id = idMatch ? idMatch[1] : "";
            const row = state.professionalJobs.find((item) => String(item.id) === id);
            return row ? [{ Professional_Jobs: row._raw }] : [];
          }
          if (sql.includes("FROM Orders")) {
            if (sql.includes("WHERE parent_order_id")) {
              const parentMatch = sql.match(/parent_order_id = (\d+)/);
              const parentId = parentMatch ? parentMatch[1] : "";
              return Object.values(state.orders)
                .filter((row) => String(row.parent_order_id) === parentId)
                .map((row) => ({ Orders: row }));
            }
            const idMatch = sql.match(/WHERE ROWID = (\d+)/);
            const id = idMatch ? idMatch[1] : "";
            const row = state.orders[id];
            return row ? [{ Orders: row }] : [];
          }
          if (sql.includes("FROM Service_Jobs")) {
            const idMatch = sql.match(/WHERE ROWID = (\d+)/);
            const id = idMatch ? idMatch[1] : "";
            const row = state.serviceJobs[id];
            return row ? [{ Service_Jobs: row }] : [];
          }
          if (sql.includes("FROM Delivery_Partners WHERE ROWID")) {
            const idMatch = sql.match(/ROWID = (\d+)/);
            const id = idMatch ? idMatch[1] : "";
            const row = state.partners?.[id];
            return row ? [{ Delivery_Partners: row }] : [];
          }
          return [];
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async insertRow(payload) {
              if (name === "Professional_Jobs") {
                const existing = findJobByKey(payload.idempotency_key);
                if (existing) {
                  return { ROWID: existing.id };
                }
                const id = String(state.nextJobId++);
                const raw = {
                  ROWID: id,
                  job_number: payload.job_number,
                  job_type: payload.job_type,
                  reference_type: payload.reference_type,
                  reference_row_id: payload.reference_row_id,
                  delivery_partner_row_id: payload.delivery_partner_row_id,
                  outlet_row_id: payload.outlet_row_id,
                  job_status: payload.job_status,
                  job_priority: payload.job_priority,
                  idempotency_key: payload.idempotency_key,
                  metadata_json: payload.metadata_json,
                  CREATEDTIME: "2026-09-05 10:00:00",
                  MODIFIEDTIME: "2026-09-05 10:00:00",
                };
                const mapped = mapProfessionalJob(raw);
                mapped._raw = raw;
                state.professionalJobs.push(mapped);
                return { ROWID: id };
              }
              if (name === "Job_Status_History") {
                state.statusHistory.push(payload);
                return {};
              }
              if (name === "Orders") {
                const id = String(payload.ROWID);
                state.orders[id] = { ...(state.orders[id] || {}), ...payload };
                return {};
              }
              return {};
            },
            async updateRow(payload) {
              if (name === "Professional_Jobs") {
                const row = state.professionalJobs.find((item) => String(item.id) === String(payload.ROWID));
                if (row) {
                  row.status = payload.job_status || payload.status || row.status;
                  row._raw.job_status = row.status;
                }
                return {};
              }
              if (name === "Orders") {
                const id = String(payload.ROWID);
                state.orders[id] = { ...(state.orders[id] || {}), ...payload };
                return {};
              }
              return {};
            },
          };
        },
      };
    },
    _state: state,
  };
}

describe("professional job idempotency keys", () => {
  it("builds stable keys for product delivery and home service", () => {
    assert.equal(
      buildProductDeliveryIdempotencyKey(LONG_ORDER_ID),
      "product_delivery:order:" + LONG_ORDER_ID
    );
    assert.equal(
      buildHomeServiceIdempotencyKey(LONG_SERVICE_JOB_ID),
      "home_service:service_job:" + LONG_SERVICE_JOB_ID
    );
  });

  it("excludes split parent orders from checkout targets", () => {
    assert.deepEqual(
      resolveCheckoutOrderTargets({
        createdOrderIds: ["100", "201", "202"],
        masterOrderId: "100",
        planMode: "SPLIT",
      }),
      ["201", "202"]
    );
    assert.deepEqual(
      resolveCheckoutOrderTargets({
        createdOrderIds: ["301"],
        masterOrderId: "301",
        planMode: "STANDARD",
      }),
      ["301"]
    );
  });
});

describe("professional job FSM", () => {
  it("allows CREATED to ASSIGNMENT_PENDING only", () => {
    assert.doesNotThrow(() => assertJobTransition("CREATED", "ASSIGNMENT_PENDING"));
    assert.doesNotThrow(() => assertJobTransition("ASSIGNMENT_PENDING", "ASSIGNED"));
    assert.throws(
      () => assertJobTransition("ASSIGNMENT_PENDING", "CREATED"),
      /Invalid professional job transition/
    );
  });
});

describe("PRODUCT_DELIVERY creation", () => {
  it("creates COD order job with bigint reference and history", async () => {
    const state = {
      orders: {
        [LONG_ORDER_ID]: {
          ROWID: LONG_ORDER_ID,
          user_id: "100",
          order_number: "ORD-1",
          status: "CONFIRMED",
          payment_status: "PENDING",
          payment_method: "COD",
          fulfillment_store_id: LONG_OUTLET_ID,
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    const result = await ensureProductDeliveryJob(app, LONG_ORDER_ID, {
      actorId: "100",
      actorRole: "customer",
      userId: "100",
    });
    assert.equal(result.created, true);
    assert.equal(result.job.job_type, JOB_TYPES.PRODUCT_DELIVERY);
    assert.equal(result.job.reference_row_id, LONG_ORDER_ID);
    assert.equal(result.job.outlet_row_id, LONG_OUTLET_ID);
    assert.equal(result.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
    assert.equal(state.statusHistory.length, 2);
    assert.equal(state.statusHistory[0].new_status, JOB_STATUS.CREATED);
    assert.equal(state.statusHistory[1].new_status, JOB_STATUS.ASSIGNMENT_PENDING);
  });

  it("creates paid order job", async () => {
    const state = {
      orders: {
        [LONG_ORDER_ID]: {
          ROWID: LONG_ORDER_ID,
          user_id: "100",
          order_number: "ORD-2",
          status: "CONFIRMED",
          payment_status: "PAID",
          payment_method: "RAZORPAY",
          fulfillment_store_id: LONG_OUTLET_ID,
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    const result = await ensureProductDeliveryJob(app, LONG_ORDER_ID);
    assert.equal(result.created, true);
    assert.equal(result.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
  });

  it("rejects unpaid non-COD orders", async () => {
    const state = {
      orders: {
        [LONG_ORDER_ID]: {
          ROWID: LONG_ORDER_ID,
          user_id: "100",
          status: "PLACED",
          payment_status: "PENDING",
          payment_method: "RAZORPAY",
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    await assert.rejects(
      () => ensureProductDeliveryJob(app, LONG_ORDER_ID),
      (error) => error.code === "INVALID_REFERENCE_STATE"
    );
  });

  it("does not duplicate on repeated payment callback", async () => {
    const state = {
      orders: {
        [LONG_ORDER_ID]: {
          ROWID: LONG_ORDER_ID,
          user_id: "100",
          status: "CONFIRMED",
          payment_status: "PAID",
          payment_method: "RAZORPAY",
          fulfillment_store_id: LONG_OUTLET_ID,
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    const first = await ensureProductDeliveryJob(app, LONG_ORDER_ID);
    const second = await ensureProductDeliveryJob(app, LONG_ORDER_ID);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.idempotent, true);
    assert.equal(app._state.professionalJobs.length, 1);
  });

  it("creates jobs for split child orders on paid checkout", async () => {
    const parentId = "36851000000390010";
    const childA = "36851000000390011";
    const childB = "36851000000390012";
    const state = {
      orders: {
        [parentId]: { ROWID: parentId, user_id: "100", status: "CONFIRMED", payment_status: "PAID", payment_method: "RAZORPAY" },
        [childA]: { ROWID: childA, user_id: "100", status: "CONFIRMED", payment_status: "PAID", payment_method: "RAZORPAY", parent_order_id: parentId, fulfillment_store_id: LONG_OUTLET_ID },
        [childB]: { ROWID: childB, user_id: "100", status: "CONFIRMED", payment_status: "PAID", payment_method: "RAZORPAY", parent_order_id: parentId, fulfillment_store_id: LONG_OUTLET_ID },
      },
    };
    const app = buildProfessionalJobApp(state);
    const results = await ensureProductDeliveryJobsForPaidOrder(app, parentId);
    assert.equal(results.length, 2);
    assert.equal(app._state.professionalJobs.length, 2);
  });

  it("creates COD jobs for split checkout child orders only", async () => {
    const parentId = "36851000000390020";
    const childA = "36851000000390021";
    const state = {
      orders: {
        [parentId]: { ROWID: parentId, user_id: "100", status: "PLACED", payment_status: "PENDING", payment_method: "COD" },
        [childA]: { ROWID: childA, user_id: "100", status: "CONFIRMED", payment_status: "PENDING", payment_method: "COD", parent_order_id: parentId, fulfillment_store_id: LONG_OUTLET_ID },
      },
    };
    const app = buildProfessionalJobApp(state);
    const results = await ensureProductDeliveryJobsForCheckout(app, {
      createdOrderIds: [parentId, childA],
      masterOrderId: parentId,
      planMode: "SPLIT",
      actorId: "100",
      actorRole: "customer",
      userId: "100",
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].order_id, childA);
  });
});

describe("HOME_SERVICE creation", () => {
  it("creates confirmed service job with partner bigint refs", async () => {
    const state = {
      serviceJobs: {
        [LONG_SERVICE_JOB_ID]: {
          ROWID: LONG_SERVICE_JOB_ID,
          user_id: "100",
          booking_number: "HS-1",
          status: "CONFIRMED",
          payment_status: "PAID",
          outlet_row_id: LONG_OUTLET_ID,
          delivery_partner_row_id: LONG_PARTNER_ID,
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    const result = await ensureHomeServiceJob(app, LONG_SERVICE_JOB_ID, {
      actorId: "100",
      actorRole: "customer",
      userId: "100",
    });
    assert.equal(result.created, true);
    assert.equal(result.job.job_type, JOB_TYPES.HOME_SERVICE);
    assert.equal(result.job.reference_row_id, LONG_SERVICE_JOB_ID);
    assert.equal(result.job.delivery_partner_row_id, LONG_PARTNER_ID);
    assert.equal(result.job.status, JOB_STATUS.ASSIGNMENT_PENDING);
  });

  it("does not duplicate on repeated home-service confirmation", async () => {
    const state = {
      serviceJobs: {
        [LONG_SERVICE_JOB_ID]: {
          ROWID: LONG_SERVICE_JOB_ID,
          user_id: "100",
          status: "CONFIRMED",
          payment_status: "PAID",
          outlet_row_id: LONG_OUTLET_ID,
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    const first = await ensureHomeServiceJob(app, LONG_SERVICE_JOB_ID);
    const second = await ensureHomeServiceJob(app, LONG_SERVICE_JOB_ID);
    assert.equal(first.created, true);
    assert.equal(second.idempotent, true);
    assert.equal(app._state.professionalJobs.length, 1);
  });

  it("rejects unconfirmed service jobs", async () => {
    const state = {
      serviceJobs: {
        [LONG_SERVICE_JOB_ID]: {
          ROWID: LONG_SERVICE_JOB_ID,
          user_id: "100",
          status: "REQUESTED",
          payment_status: "PENDING",
        },
      },
    };
    const app = buildProfessionalJobApp(state);
    await assert.rejects(
      () => ensureHomeServiceJob(app, LONG_SERVICE_JOB_ID),
      (error) => error.code === "INVALID_REFERENCE_STATE"
    );
  });
});

describe("reference validation and transitions", () => {
  it("rejects missing order reference", async () => {
    const app = buildProfessionalJobApp({ orders: {} });
    await assert.rejects(
      () =>
        createProfessionalJob(app, {
          jobType: JOB_TYPES.PRODUCT_DELIVERY,
          referenceRowId: LONG_ORDER_ID,
          idempotencyKey: buildProductDeliveryIdempotencyKey(LONG_ORDER_ID),
        }),
      (error) => error.code === "REFERENCE_NOT_FOUND"
    );
  });

  it("rejects split parent order references directly", async () => {
    const parentId = "36851000000390030";
    const state = {
      orders: {
        [parentId]: { ROWID: parentId, user_id: "100", status: "CONFIRMED", payment_status: "PAID", payment_method: "RAZORPAY" },
        "36851000000390031": { ROWID: "36851000000390031", parent_order_id: parentId, user_id: "100", status: "CONFIRMED", payment_status: "PAID", payment_method: "RAZORPAY" },
      },
    };
    const app = buildProfessionalJobApp(state);
    await assert.rejects(
      () => ensureProductDeliveryJob(app, parentId),
      (error) => error.code === "INVALID_REFERENCE_STATE"
    );
  });

  it("rejects invalid professional job transitions", async () => {
    const state = {
      professionalJobs: [
        {
          id: "9100",
          status: JOB_STATUS.ASSIGNMENT_PENDING,
          _raw: { ROWID: "9100", job_status: JOB_STATUS.ASSIGNMENT_PENDING },
        },
      ],
    };
    const app = buildProfessionalJobApp(state);
    await assert.rejects(
      () => transitionProfessionalJob(app, "9100", JOB_STATUS.CREATED),
      (error) => error.code === "INVALID_STATUS_TRANSITION"
    );
  });
});
