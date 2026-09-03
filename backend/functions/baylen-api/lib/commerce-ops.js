"use strict";

/**
 * Shared Quick Commerce picker/rider order operations.
 * Uses Orders + Order_Items + Order_Timeline (always present).
 * Optional: Riders, Delivery_Tracking tables when provisioned.
 */

const crypto = require("crypto");
const { asId, optionalText, rowOf, rowsOf, num, sqlString } = require("./http");

const QC_STATUSES = [
  "PLACED",
  "CONFIRMED",
  "STORE_ASSIGNED",
  "PICKING",
  "PACKED",
  "RIDER_SEARCHING",
  "RIDER_ASSIGNED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "PARTIALLY_FULFILLED",
  "REFUND_PENDING",
  "REFUNDED",
  // keep e-com compatible
  "PROCESSING",
  "SHIPPED",
  "COMPLETED",
];

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireOpsKey(req, envName, headerName, roleLabel) {
  const expected = process.env[envName];
  if (!expected) {
    const error = new Error(envName + " is not configured");
    error.status = 503;
    throw error;
  }
  const provided = req.headers[headerName];
  if (!secureEqual(provided, expected)) {
    const error = new Error(roleLabel + " authorization required");
    error.status = 403;
    throw error;
  }
}

function requirePickerKey(req) {
  requireOpsKey(req, "PICKER_API_KEY", "x-baylen-picker-key", "Picker");
}

function requireRiderKey(req) {
  requireOpsKey(req, "RIDER_API_KEY", "x-baylen-rider-key", "Rider");
}

function actorId(req, header) {
  return optionalText(req.headers[header], header, 80) || "OPS";
}

async function loadOrder(zcql, orderId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code, fulfillment_mode, fulfillment_store_id, fulfillment_warehouse_id, fulfillment_rider_id, fulfillment_rider_name, fulfillment_rider_phone, rider_latitude, rider_longitude FROM Orders WHERE ROWID = " +
        asId(orderId, "order_id")
    ),
    "Orders"
  );
}

async function loadOrderSafe(zcql, orderId) {
  try {
    return await loadOrder(zcql, orderId);
  } catch (_) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
          asId(orderId, "order_id")
      ),
      "Orders"
    );
  }
}

async function loadOrderItems(zcql, orderId) {
  try {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, status, fulfillment_type, pick_status FROM Order_Items WHERE order_id = " +
          asId(orderId, "order_id")
      ),
      "Order_Items"
    );
  } catch (_) {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, variant_id, product_name, sku, quantity, unit_price, line_total, status FROM Order_Items WHERE order_id = " +
          asId(orderId, "order_id")
      ),
      "Order_Items"
    );
  }
}

async function addTimeline(app, orderId, status, note, actorType) {
  await app.datastore().table("Order_Timeline").insertRow({
    order_id: orderId,
    status,
    note: note || status,
    actor_type: actorType || "SYSTEM",
    happened_at: nowSql(),
  });
}

async function notifyUser(app, order, status, title, body) {
  if (!order || !order.user_id) return;
  try {
    await app.datastore().table("Notifications").insertRow({
      user_id: order.user_id,
      type: "ORDER",
      title: title || "Order update",
      body: body || ("Your order is now " + status),
      reference_type: "ORDER",
      reference_id: order.ROWID,
      delivery_status: "PENDING",
      read_at: null,
    });
  } catch (_) {}
}

async function setOrderStatus(app, order, status, note, actorType, extra = {}) {
  const payload = { ROWID: order.ROWID, status, ...extra };
  await app.datastore().table("Orders").updateRow(payload);
  await addTimeline(app, order.ROWID, status, note, actorType);
  await notifyUser(app, order, status);
  return { ...order, status, ...extra };
}

function mapCommerceOrder(order, items) {
  return {
    id: String(order.ROWID),
    order_number: order.order_number || "",
    status: order.status || "",
    payment_status: order.payment_status || "",
    currency: order.currency || "INR",
    grand_total: num(order.grand_total),
    shipping_name: order.shipping_name || "",
    shipping_phone: order.shipping_phone || "",
    shipping_line1: order.shipping_line1 || "",
    shipping_city: order.shipping_city || "",
    shipping_state: order.shipping_state || "",
    shipping_postal_code: order.shipping_postal_code || "",
    fulfillment_mode: order.fulfillment_mode || "",
    fulfillment_store_id: order.fulfillment_store_id ? String(order.fulfillment_store_id) : "",
    fulfillment_warehouse_id: order.fulfillment_warehouse_id
      ? String(order.fulfillment_warehouse_id)
      : "",
    rider: {
      id: order.fulfillment_rider_id ? String(order.fulfillment_rider_id) : "",
      name: order.fulfillment_rider_name || "",
      phone: order.fulfillment_rider_phone || "",
      latitude: order.rider_latitude != null ? num(order.rider_latitude) : null,
      longitude: order.rider_longitude != null ? num(order.rider_longitude) : null,
    },
    items: (items || []).map((item) => ({
      id: String(item.ROWID),
      product_id: item.product_id ? String(item.product_id) : "",
      variant_id: item.variant_id ? String(item.variant_id) : "",
      product_name: item.product_name || "",
      sku: item.sku || "",
      quantity: num(item.quantity),
      unit_price: num(item.unit_price),
      line_total: num(item.line_total),
      status: item.status || "",
      fulfillment_type: item.fulfillment_type || "",
      pick_status: item.pick_status || "PENDING",
    })),
  };
}

async function listPickerQueue(zcql, { storeId, status } = {}) {
  let query =
    "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, fulfillment_mode, fulfillment_store_id, fulfillment_warehouse_id FROM Orders WHERE status IN ('CONFIRMED','STORE_ASSIGNED','PICKING','PACKED','RIDER_SEARCHING')";
  try {
    const rows = rowsOf(await zcql.executeZCQLQuery(query), "Orders");
    return rows.filter((row) => {
      if (storeId && String(row.fulfillment_store_id || "") !== String(storeId)) return false;
      if (status && String(row.status) !== String(status)) return false;
      const mode = String(row.fulfillment_mode || "").toUpperCase();
      return !mode || mode === "QUICK_COMMERCE" || mode === "SPLIT" || mode === "QC";
    });
  } catch (_) {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city FROM Orders WHERE status IN ('CONFIRMED','PROCESSING','PACKED')"
      ),
      "Orders"
    );
    return rows;
  }
}

async function loadRider(zcql, riderId) {
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, phone, photo_url, vehicle_type, vehicle_number, latitude, longitude, is_active, is_available, current_order_id FROM Riders WHERE ROWID = " +
          asId(riderId, "rider_id") +
          " AND is_active = true"
      ),
      "Riders"
    );
  } catch (_) {
    return null;
  }
}

async function listAvailableRiders(zcql) {
  try {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, phone, photo_url, vehicle_type, vehicle_number, latitude, longitude, is_active, is_available, current_order_id FROM Riders WHERE is_active = true AND is_available = true"
      ),
      "Riders"
    );
  } catch (_) {
    return [];
  }
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1);
  const aLng = Number(lng1);
  const bLat = Number(lat2);
  const bLng = Number(lng2);
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return Number.POSITIVE_INFINITY;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

async function assignNearestRider(app, order, storeLat, storeLng) {
  const zcql = app.zcql();
  const riders = await listAvailableRiders(zcql);
  if (!riders.length) {
    await setOrderStatus(app, order, "RIDER_SEARCHING", "Searching for rider", "SYSTEM");
    return null;
  }
  const ranked = riders
    .map((rider) => ({
      rider,
      distance: distanceKm(storeLat, storeLng, rider.latitude, rider.longitude),
    }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0].rider;
  const updated = await setOrderStatus(app, order, "RIDER_ASSIGNED", "Rider assigned: " + (best.name || best.ROWID), "SYSTEM", {
    fulfillment_rider_id: best.ROWID,
    fulfillment_rider_name: best.name || "",
    fulfillment_rider_phone: best.phone || "",
  });
  try {
    await app.datastore().table("Riders").updateRow({
      ROWID: best.ROWID,
      is_available: "false",
      current_order_id: order.ROWID,
    });
  } catch (_) {}
  return updated;
}

async function writeDeliveryTracking(app, { orderId, riderId, latitude, longitude, status }) {
  try {
    await app.datastore().table("Delivery_Tracking").insertRow({
      order_id: orderId,
      rider_id: riderId || null,
      latitude,
      longitude,
      status: status || "MOVING",
      recorded_at: nowSql(),
    });
  } catch (_) {
    // table may not exist yet — rider lat/lng still stored on Orders
  }
  try {
    await app.datastore().table("Orders").updateRow({
      ROWID: orderId,
      rider_latitude: latitude,
      rider_longitude: longitude,
    });
  } catch (_) {}
}

module.exports = {
  QC_STATUSES,
  nowSql,
  requirePickerKey,
  requireRiderKey,
  actorId,
  loadOrderSafe,
  loadOrderItems,
  addTimeline,
  notifyUser,
  setOrderStatus,
  mapCommerceOrder,
  listPickerQueue,
  loadRider,
  listAvailableRiders,
  assignNearestRider,
  writeDeliveryTracking,
  distanceKm,
};
