"use strict";

/**
 * Hybrid checkout plan resolution.
 * Server is the authority: client-suggested mode is validated against a fresh
 * evaluateFulfillment result before any order is created.
 */

function moneySafe(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Pick default mode when client omits fulfillment_mode.
 * Prefer QC → SPLIT → EC.
 */
function defaultFulfillmentMode(options) {
  const modes = (options || []).filter((o) => o && o.available).map((o) => o.mode);
  if (modes.includes("QUICK_COMMERCE")) return "QUICK_COMMERCE";
  if (modes.includes("SPLIT")) return "SPLIT";
  if (modes.includes("E_COMMERCE")) return "E_COMMERCE";
  return null;
}

/**
 * Validate requested mode against engine options and build fulfillment groups.
 */
function resolveCheckoutPlan(evaluation, requestedMode, cartLines) {
  const options = (evaluation && evaluation.options) || [];
  const unavailable = ((evaluation && evaluation.items) || []).filter(
    (line) =>
      !(line.quick_commerce && line.quick_commerce.available) &&
      !(line.standard_ecommerce && line.standard_ecommerce.available)
  );
  if (unavailable.length) {
    const names = unavailable.map((l) => l.product_name || l.product_id).join(", ");
    const error = new Error(
      "Some items are unavailable for delivery: " +
        names +
        ". Remove them or try again later."
    );
    error.status = 409;
    error.code = "ITEMS_UNAVAILABLE";
    error.details = { unavailable };
    throw error;
  }

  const mode =
    requestedMode && String(requestedMode).trim()
      ? String(requestedMode).trim().toUpperCase()
      : defaultFulfillmentMode(options);

  if (!mode) {
    const error = new Error(
      "No fulfillment option is available for this cart and delivery location."
    );
    error.status = 409;
    error.code = "NO_FULFILLMENT_OPTION";
    throw error;
  }

  const option = options.find((o) => o.mode === mode && o.available);
  if (!option) {
    const availableModes = options.filter((o) => o.available).map((o) => o.mode);
    const error = new Error(
      mode === "QUICK_COMMERCE"
        ? "Quick Commerce is no longer available for one or more items (stock, radius, or store hours changed). Choose Standard Delivery or refresh options."
        : "Selected fulfillment mode is not available. Available: " +
            (availableModes.join(", ") || "none")
    );
    error.status = 409;
    error.code = "FULFILLMENT_MODE_UNAVAILABLE";
    error.details = { requested: mode, available: availableModes };
    throw error;
  }

  const lineByKey = new Map();
  for (const line of cartLines || []) {
    const key =
      String(line.product_id) + ":" + (line.variant_id ? String(line.variant_id) : "");
    lineByKey.set(key, line);
  }

  function attachLines(planItems, fulfillmentType) {
    return (planItems || [])
      .map((item) => {
        const key =
          String(item.product_id) +
          ":" +
          (item.variant_id ? String(item.variant_id) : "");
        const line = lineByKey.get(key);
        if (!line) return null;
        const store = item.store || null;
        return {
          ...line,
          fulfillment_type: fulfillmentType,
          fulfillment_store_id: store && store.store_id ? String(store.store_id) : "",
          fulfillment_warehouse_id:
            (store && store.warehouse_id ? String(store.warehouse_id) : "") ||
            (item.warehouse_id ? String(item.warehouse_id) : ""),
          store,
        };
      })
      .filter(Boolean);
  }

  const groups = [];
  if (mode === "SPLIT" && Array.isArray(option.groups)) {
    for (const group of option.groups) {
      const gMode = group.mode;
      const lines = attachLines(group.items, gMode);
      if (!lines.length) continue;
      const store = group.fulfillment_store || lines[0]?.store || null;
      groups.push({
        mode: gMode,
        label: group.label || gMode,
        eta_label: group.eta_label || "",
        store,
        store_id: store && store.store_id ? String(store.store_id) : "",
        warehouse_id:
          (store && store.warehouse_id ? String(store.warehouse_id) : "") ||
          (lines[0] && lines[0].fulfillment_warehouse_id
            ? String(lines[0].fulfillment_warehouse_id)
            : ""),
        lines,
      });
    }
  } else {
    const fulfillmentType = mode === "QUICK_COMMERCE" ? "QUICK_COMMERCE" : "E_COMMERCE";
    const lines = attachLines(option.items, fulfillmentType);
    const store = option.fulfillment_store || lines[0]?.store || null;
    groups.push({
      mode: fulfillmentType,
      label: option.label || fulfillmentType,
      eta_label: option.eta_label || "",
      store,
      store_id: store && store.store_id ? String(store.store_id) : "",
      warehouse_id:
        (store && store.warehouse_id ? String(store.warehouse_id) : "") ||
        (lines[0] && lines[0].fulfillment_warehouse_id
          ? String(lines[0].fulfillment_warehouse_id)
          : ""),
      lines,
    });
  }

  if (!groups.length) {
    const error = new Error("Could not build fulfillment groups for this cart");
    error.status = 409;
    error.code = "EMPTY_FULFILLMENT_GROUPS";
    throw error;
  }

  const covered = new Set();
  for (const group of groups) {
    for (const line of group.lines) {
      covered.add(
        String(line.product_id) + ":" + (line.variant_id ? String(line.variant_id) : "")
      );
    }
  }
  for (const line of cartLines || []) {
    const key =
      String(line.product_id) + ":" + (line.variant_id ? String(line.variant_id) : "");
    if (!covered.has(key)) {
      const error = new Error(
        "Fulfillment plan is incomplete for product " + (line.product_name || line.product_id)
      );
      error.status = 409;
      error.code = "INCOMPLETE_FULFILLMENT_PLAN";
      throw error;
    }
  }

  return { mode, option, groups };
}

function apportionTotals(lines, { discountAmount, taxAmount, shippingAmount }) {
  const subtotal = moneySafe(lines.reduce((sum, line) => sum + Number(line.line_total || 0), 0));
  const rem = {
    discount: moneySafe(discountAmount),
    tax: moneySafe(taxAmount),
    ship: moneySafe(shippingAmount),
  };
  return lines.map((line, index) => {
    const last = index === lines.length - 1;
    const share = subtotal > 0 ? Number(line.line_total || 0) / subtotal : 0;
    const d = last ? rem.discount : moneySafe(Number(discountAmount || 0) * share);
    const t = last ? rem.tax : moneySafe(Number(taxAmount || 0) * share);
    const s = last ? rem.ship : moneySafe(Number(shippingAmount || 0) * share);
    rem.discount = moneySafe(rem.discount - d);
    rem.tax = moneySafe(rem.tax - t);
    rem.ship = moneySafe(rem.ship - s);
    const payable = moneySafe(Math.max(0, Number(line.line_total || 0) - d));
    return {
      ...line,
      _discount_share: d,
      _tax_share: t,
      _shipping_share: s,
      _grand_share: moneySafe(payable + t + s),
    };
  });
}

function groupTotals(groupLines) {
  return {
    subtotal: moneySafe(groupLines.reduce((s, l) => s + Number(l.line_total || 0), 0)),
    discount: moneySafe(groupLines.reduce((s, l) => s + Number(l._discount_share || 0), 0)),
    tax: moneySafe(groupLines.reduce((s, l) => s + Number(l._tax_share || 0), 0)),
    shipping: moneySafe(groupLines.reduce((s, l) => s + Number(l._shipping_share || 0), 0)),
    grand: moneySafe(groupLines.reduce((s, l) => s + Number(l._grand_share || 0), 0)),
  };
}

module.exports = {
  defaultFulfillmentMode,
  resolveCheckoutPlan,
  apportionTotals,
  groupTotals,
  moneySafe,
};
