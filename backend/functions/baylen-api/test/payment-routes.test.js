"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const register = require("../routes/payments");
const handlers = new Map();
register({
  get: (url, handler) => handlers.set("GET " + url, handler),
  post: (url, handler) => handlers.set("POST " + url, handler),
});

test("all customer payment mutations require a customer session", async () => {
  for (const url of ["intent", "verify", "reconcile", "checkout-session", "refund-request"]) {
    let caught;
    await handlers.get("POST /v1/payments/" + url)(
      { headers: {}, body: {}, query: {} }, {}, error => { caught = error; });
    assert.equal(caught?.status, 401, url);
  }
});

test("refund execution cannot be called using ordinary unauthenticated requests", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-only";
  try {
    let caught;
    await handlers.get("POST /v1/admin/payments/refund-process")(
      { headers: {}, body: { refund_id: "1" } }, {}, error => { caught = error; });
    assert.equal(caught?.status, 403);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("all payment endpoints have API Gateway routes", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../catalyst-user-rules.json"), "utf8"));
  for (const name of handlers.keys()) {
    const url = name.slice(name.indexOf(" ") + 1);
    assert.ok(rules.some(rule => rule.source_endpoint === url), "Missing gateway route: " + url);
  }
});

test("delivery-job failure blocks payment fulfillment completion", async (context) => {
  const jobs = require("../lib/professional-job-engine");
  context.mock.method(jobs, "ensureProductDeliveryJob", async () => {
    throw new Error("Dispatch database unavailable");
  });
  const app = {
    zcql: () => ({ executeZCQLQuery: async query => {
      if (query.includes("FROM Orders WHERE ROWID = 1")) {
        return [{ Orders: { ROWID: "1", status: "PENDING_PAYMENT" } }];
      }
      return [];
    } }),
    datastore: () => ({ table: () => ({ updateRow: async () => ({}) }) }),
  };
  const { finalize } = require("../lib/payment-fulfillment");
  await assert.rejects(finalize(app, { reference_type: "ORDER", reference_id: "1", user_id: "7" }),
    /Dispatch database unavailable/);
});
