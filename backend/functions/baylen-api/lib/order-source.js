"use strict";

/**
 * Order source abstraction for product delivery.
 * Professionals consume normalized Professional_Jobs only.
 * THIRD_PARTY and INTERNAL both map into the same Baylen order model.
 */
const ORDER_SOURCES = Object.freeze({
  THIRD_PARTY: "THIRD_PARTY",
  INTERNAL: "INTERNAL",
});

function normalizeOrderSource(value) {
  const source = String(value || "").trim().toUpperCase();
  if (source === ORDER_SOURCES.THIRD_PARTY || source === ORDER_SOURCES.INTERNAL) {
    return source;
  }
  return ORDER_SOURCES.INTERNAL;
}

function isOrderIntegrationEnabled() {
  return String(process.env.ORDER_INTEGRATION_ENABLED || "").trim().toLowerCase() === "true";
}

function normalizeInboundOrder(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    order_source: normalizeOrderSource(body.order_source || ORDER_SOURCES.THIRD_PARTY),
    external_order_id: String(body.external_order_id || body.order_id || "").trim(),
    customer_name: String(body.customer_name || "").trim(),
    shipping_line1: String(body.shipping_line1 || body.address || "").trim(),
    shipping_city: String(body.shipping_city || body.city || "").trim(),
    shipping_state: String(body.shipping_state || body.state || "").trim(),
    shipping_district: String(body.shipping_district || body.district || "").trim(),
    shipping_postal_code: String(body.shipping_postal_code || body.pincode || "").replace(/\D/g, "").slice(0, 6),
    grand_total: Number(body.grand_total || body.amount || 0) || 0,
    currency: String(body.currency || "INR").trim() || "INR",
    items: items.map((item) => ({
      name: String(item?.name || item?.product_name || "Item").trim(),
      quantity: Number(item?.quantity || 1) || 1,
    })),
  };
}

function validateNormalizedOrder(order) {
  if (!order.external_order_id) {
    return { ok: false, reason: "MISSING_EXTERNAL_ORDER_ID" };
  }
  if (!order.shipping_state || !order.shipping_district || order.shipping_postal_code.length !== 6) {
    return { ok: false, reason: "MISSING_LOCATION" };
  }
  return { ok: true };
}

module.exports = {
  ORDER_SOURCES,
  normalizeOrderSource,
  isOrderIntegrationEnabled,
  normalizeInboundOrder,
  validateNormalizedOrder,
};
