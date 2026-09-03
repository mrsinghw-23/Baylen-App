#!/usr/bin/env node
"use strict";

/**
 * Hybrid checkout plan scenarios A–F (unit tests, no live Data Store).
 * Run: node backend/scripts/test-hybrid-checkout-scenarios.js
 */

const assert = require("assert");
const {
  defaultFulfillmentMode,
  resolveCheckoutPlan,
} = require("../functions/baylen-api/lib/hybrid-checkout");

function line(id, name, { qc, ec, qcReason, ecReason }) {
  return {
    product_id: id,
    variant_id: null,
    quantity: 1,
    product_name: name,
    unit_price: 100,
    quick_commerce: qc
      ? {
          available: true,
          reason: "OK",
          store: {
            store_id: "S1",
            warehouse_id: "W1",
            store_name: "Dark Store",
            distance_km: 1.2,
          },
        }
      : {
          available: false,
          reason: qcReason || "NO_SERVICEABLE_STORE",
          store: null,
        },
    standard_ecommerce: ec
      ? { available: true, reason: "OK", warehouse_ids: ["WHQ"] }
      : {
          available: false,
          reason: ecReason || "NO_WAREHOUSE_STOCK",
          warehouse_ids: [],
        },
  };
}

function buildEvaluation(items) {
  const qcLines = items.filter((l) => l.quick_commerce.available);
  const ecOnly = items.filter(
    (l) => !l.quick_commerce.available && l.standard_ecommerce.available
  );
  const allQc = items.length > 0 && qcLines.length === items.length;
  const bothFull =
    items.length > 0 &&
    items.every((l) => l.quick_commerce.available) &&
    items.every((l) => l.standard_ecommerce.available);
  const options = [];
  if (allQc || bothFull) {
    options.push({
      mode: "QUICK_COMMERCE",
      available: true,
      label: "Quick Commerce",
      eta_label: "15–20 minutes",
      fulfillment_store: qcLines[0]?.quick_commerce?.store || null,
      items: items.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        quantity: l.quantity,
        fulfillment_type: "QUICK_COMMERCE",
        store: l.quick_commerce.store,
      })),
    });
  }
  if (items.every((l) => l.standard_ecommerce.available)) {
    options.push({
      mode: "E_COMMERCE",
      available: true,
      label: "Standard Delivery",
      eta_label: "2–3 days",
      items: items.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        quantity: l.quantity,
        fulfillment_type: "E_COMMERCE",
      })),
    });
  }
  if (qcLines.length > 0 && ecOnly.length > 0) {
    options.push({
      mode: "SPLIT",
      available: true,
      label: "Split delivery",
      groups: [
        {
          mode: "QUICK_COMMERCE",
          label: "Quick Commerce",
          eta_label: "15–20 minutes",
          fulfillment_store: qcLines[0].quick_commerce.store,
          items: qcLines.map((l) => ({
            product_id: l.product_id,
            variant_id: null,
            quantity: 1,
            store: l.quick_commerce.store,
          })),
        },
        {
          mode: "E_COMMERCE",
          label: "Standard Delivery",
          eta_label: "2–3 days",
          items: ecOnly.map((l) => ({
            product_id: l.product_id,
            variant_id: null,
            quantity: 1,
          })),
        },
      ],
    });
  }
  return { items, options, summary: {} };
}

function cartFrom(items) {
  return items.map((l) => ({
    product_id: l.product_id,
    variant_id: l.variant_id,
    product_name: l.product_name,
    quantity: l.quantity,
    line_total: 100,
  }));
}

function run(name, fn) {
  try {
    fn();
    console.log("PASS", name);
  } catch (e) {
    console.error("FAIL", name, e.message);
    process.exitCode = 1;
  }
}

run("Scenario A: local stock → Quick Commerce", () => {
  const items = [line("P1", "Serum", { qc: true, ec: true })];
  const evaluation = buildEvaluation(items);
  assert.strictEqual(defaultFulfillmentMode(evaluation.options), "QUICK_COMMERCE");
  const plan = resolveCheckoutPlan(evaluation, "QUICK_COMMERCE", cartFrom(items));
  assert.strictEqual(plan.mode, "QUICK_COMMERCE");
  assert.strictEqual(plan.groups.length, 1);
  assert.strictEqual(plan.groups[0].warehouse_id, "W1");
});

run("Scenario B: local stock unavailable → E-Commerce", () => {
  const items = [
    line("P1", "Serum", {
      qc: false,
      ec: true,
      qcReason: "INSUFFICIENT_LOCAL_STOCK",
    }),
  ];
  const evaluation = buildEvaluation(items);
  assert.ok(evaluation.options.some((o) => o.mode === "E_COMMERCE"));
  assert.ok(!evaluation.options.some((o) => o.mode === "QUICK_COMMERCE"));
  const plan = resolveCheckoutPlan(evaluation, null, cartFrom(items));
  assert.strictEqual(plan.mode, "E_COMMERCE");
});

run("Scenario C: mixed cart → SPLIT parent/child groups", () => {
  const items = [
    line("P1", "Local", { qc: true, ec: true }),
    line("P2", "Warehouse only", { qc: false, ec: true }),
  ];
  const evaluation = buildEvaluation(items);
  assert.ok(evaluation.options.some((o) => o.mode === "SPLIT"));
  const plan = resolveCheckoutPlan(evaluation, "SPLIT", cartFrom(items));
  assert.strictEqual(plan.mode, "SPLIT");
  assert.strictEqual(plan.groups.length, 2);
  assert.strictEqual(plan.groups[0].mode, "QUICK_COMMERCE");
  assert.strictEqual(plan.groups[1].mode, "E_COMMERCE");
});

run("Scenario D: item unavailable during checkout → clear error", () => {
  const items = [line("P1", "Gone", { qc: false, ec: false })];
  const evaluation = buildEvaluation(items);
  assert.throws(
    () => resolveCheckoutPlan(evaluation, "QUICK_COMMERCE", cartFrom(items)),
    (err) => err.code === "ITEMS_UNAVAILABLE" && err.status === 409
  );
});

run("Scenario D2: QC requested but no longer available → clear message", () => {
  const items = [line("P1", "Serum", { qc: false, ec: true })];
  const evaluation = buildEvaluation(items);
  assert.throws(
    () => resolveCheckoutPlan(evaluation, "QUICK_COMMERCE", cartFrom(items)),
    (err) =>
      err.code === "FULFILLMENT_MODE_UNAVAILABLE" &&
      /Quick Commerce is no longer available/i.test(err.message)
  );
});

run("Scenario E: outside QC radius → E-Commerce only", () => {
  const items = [
    line("P1", "Serum", {
      qc: false,
      ec: true,
      qcReason: "OUTSIDE_SERVICE_RADIUS_OR_STORE_CLOSED",
    }),
  ];
  const evaluation = buildEvaluation(items);
  assert.ok(!evaluation.options.some((o) => o.mode === "QUICK_COMMERCE"));
  const plan = resolveCheckoutPlan(evaluation, null, cartFrom(items));
  assert.strictEqual(plan.mode, "E_COMMERCE");
});

run("Scenario F: inactive/closed store → E-Commerce fallback", () => {
  const items = [
    line("P1", "Serum", {
      qc: false,
      ec: true,
      qcReason: "OUTSIDE_SERVICE_RADIUS_OR_STORE_CLOSED",
    }),
  ];
  const evaluation = buildEvaluation(items);
  const plan = resolveCheckoutPlan(evaluation, "E_COMMERCE", cartFrom(items));
  assert.strictEqual(plan.mode, "E_COMMERCE");
  assert.strictEqual(plan.groups[0].mode, "E_COMMERCE");
});

if (!process.exitCode) {
  console.log("\nAll hybrid checkout scenarios passed.");
}
