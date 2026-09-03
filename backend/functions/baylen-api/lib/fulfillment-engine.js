#!/usr/bin/env node
"use strict";

/**
 * Hybrid fulfillment decision engine.
 * Backend authority for Quick Commerce vs Standard E-Commerce options.
 * Uses Warehouses + Outlets (+ Inventory). Does not invent stock.
 */

const { asId, rowOf, rowsOf, num, sqlString, isTruthy, optionalText } = require("./http");
const { availableOf } = require("./inventory-ops");

function qcRadiusKm() {
  const raw = Number(process.env.FULFILLMENT_QC_RADIUS_KM);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

function qcEtaMinutes() {
  return {
    min: Math.max(1, Math.round(num(process.env.FULFILLMENT_QC_ETA_MIN) || 15)),
    max: Math.max(1, Math.round(num(process.env.FULFILLMENT_QC_ETA_MAX) || 20)),
  };
}

function ecEtaDays() {
  return {
    min: Math.max(1, Math.round(num(process.env.FULFILLMENT_EC_ETA_DAYS_MIN) || 2)),
    max: Math.max(1, Math.round(num(process.env.FULFILLMENT_EC_ETA_DAYS_MAX) || 3)),
  };
}

function qcCodLimit() {
  const raw = Number(process.env.FULFILLMENT_QC_COD_LIMIT);
  return Number.isFinite(raw) && raw >= 0 ? raw : 2000;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const aLat = Number(lat1);
  const aLng = Number(lng1);
  const bLat = Number(lat2);
  const bLng = Number(lng2);
  if (![aLat, aLng, bLat, bLng].every((n) => Number.isFinite(n))) return null;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function productQcEnabled(product) {
  if (product.quick_commerce_enabled === undefined || product.quick_commerce_enabled === null || product.quick_commerce_enabled === "") {
    return true;
  }
  return isTruthy(product.quick_commerce_enabled);
}

function productEcEnabled(product) {
  if (product.ecommerce_enabled === undefined || product.ecommerce_enabled === null || product.ecommerce_enabled === "") {
    return true;
  }
  return isTruthy(product.ecommerce_enabled);
}

async function loadProduct(zcql, productId) {
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku, status, selling_price, mrp, quick_commerce_enabled, ecommerce_enabled FROM Products WHERE ROWID = " +
          asId(productId, "product_id")
      ),
      "Products"
    );
  } catch (_) {
    // Columns may not exist yet — fall back without eligibility flags.
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku, status, selling_price, mrp FROM Products WHERE ROWID = " +
          asId(productId, "product_id")
      ),
      "Products"
    );
  }
}

async function inventoryForProduct(zcql, productId, variantId) {
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, is_active, status FROM Inventory WHERE product_id = " +
    asId(productId, "product_id") +
    " AND is_active = true AND status = 'ACTIVE'";
  if (variantId) {
    query += " AND variant_id = " + asId(variantId, "variant_id");
  }
  return rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
}

async function loadWarehouses(zcql) {
  return rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, code, outlet_id, address_line1, city, state, is_active, is_default FROM Warehouses WHERE is_active = true"
    ),
    "Warehouses"
  );
}

async function loadOutlet(zcql, outletId) {
  if (!outletId) return null;
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, address_line1, city, state, latitude, longitude, opening_time, closing_time, is_active, delivery_enabled, service_radius_km, store_type FROM Outlets WHERE ROWID = " +
          asId(outletId, "outlet_id") +
          " AND is_active = true"
      ),
      "Outlets"
    );
  } catch (_) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, address_line1, city, state, latitude, longitude, opening_time, closing_time, is_active FROM Outlets WHERE ROWID = " +
          asId(outletId, "outlet_id") +
          " AND is_active = true"
      ),
      "Outlets"
    );
  }
}

function parseHm(value) {
  const text = String(value || "").trim();
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isStoreOpenNow(outlet, now = new Date()) {
  if (!outlet) return false;
  if (outlet.is_open === false || outlet.is_open === "false") return false;
  const open = parseHm(outlet.opening_time);
  const close = parseHm(outlet.closing_time);
  if (open == null || close == null) return true; // unknown hours → treat as open if active
  const mins = now.getHours() * 60 + now.getMinutes();
  if (close > open) return mins >= open && mins <= close;
  // overnight window
  return mins >= open || mins <= close;
}

function deliveryEnabled(outlet) {
  if (!outlet) return false;
  if (outlet.delivery_enabled === undefined || outlet.delivery_enabled === null || outlet.delivery_enabled === "") {
    return true;
  }
  return isTruthy(outlet.delivery_enabled);
}

function radiusForOutlet(outlet) {
  const configured = Number(outlet && outlet.service_radius_km);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return qcRadiusKm();
}

async function buildDarkStoreCandidates(zcql, latitude, longitude) {
  const warehouses = await loadWarehouses(zcql);
  const candidates = [];
  for (const wh of warehouses) {
    const outlet = await loadOutlet(zcql, wh.outlet_id);
    if (!outlet) continue;
    const dist = distanceKm(latitude, longitude, outlet.latitude, outlet.longitude);
    if (dist == null) continue;
    const radius = radiusForOutlet(outlet);
    const open = isStoreOpenNow(outlet);
    const deliver = deliveryEnabled(outlet);
    const serviceable = dist <= radius && open && deliver;
    candidates.push({
      warehouse_id: String(wh.ROWID),
      warehouse_code: wh.code || "",
      warehouse_name: wh.name || "",
      store_id: String(outlet.ROWID),
      store_name: outlet.name || wh.name || "",
      store_type: outlet.store_type || "DARK_STORE",
      latitude: Number(outlet.latitude),
      longitude: Number(outlet.longitude),
      distance_km: Math.round(dist * 100) / 100,
      service_radius_km: radius,
      is_open: open,
      delivery_enabled: deliver,
      serviceable,
      is_default_warehouse: isTruthy(wh.is_default) || String(wh.code || "").toUpperCase() === "HQ",
    });
  }
  candidates.sort((a, b) => a.distance_km - b.distance_km);
  return candidates;
}

function centralWarehouses(warehouses) {
  const defaults = warehouses.filter(
    (w) => isTruthy(w.is_default) || String(w.code || "").toUpperCase() === "HQ"
  );
  return defaults.length ? defaults : warehouses;
}

/**
 * Evaluate fulfillment for cart-like items.
 * items: [{ product_id, variant_id?, quantity, unit_price? }]
 */
async function evaluateFulfillment(app, { latitude, longitude, items }) {
  const zcql = app.zcql();
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const qcEta = qcEtaMinutes();
  const ecEta = ecEtaDays();
  const lineResults = [];
  const warnings = [];

  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error("items are required");
    error.status = 400;
    throw error;
  }

  let darkStores = [];
  if (hasLocation) {
    try {
      darkStores = await buildDarkStoreCandidates(zcql, lat, lng);
    } catch (e) {
      warnings.push("Unable to load dark-store candidates: " + (e.message || e));
    }
  } else {
    warnings.push("Location missing — Quick Commerce cannot be evaluated until latitude/longitude are provided");
  }

  const warehouses = await loadWarehouses(zcql);
  const central = centralWarehouses(warehouses);
  const centralIds = new Set(central.map((w) => String(w.ROWID)));

  for (const raw of items) {
    const productId = asId(raw.product_id, "product_id");
    const variantId = raw.variant_id ? asId(raw.variant_id, "variant_id") : null;
    const quantity = Math.max(1, Math.round(num(raw.quantity) || 1));
    const product = await loadProduct(zcql, productId);
    if (!product || String(product.status || "").toUpperCase() !== "ACTIVE") {
      lineResults.push({
        product_id: productId,
        variant_id: variantId,
        quantity,
        product_name: product ? product.name : "",
        sku: product ? product.sku : "",
        quick_commerce: { available: false, reason: "PRODUCT_UNAVAILABLE" },
        standard_ecommerce: { available: false, reason: "PRODUCT_UNAVAILABLE" },
      });
      continue;
    }

    const invRows = await inventoryForProduct(zcql, productId, variantId);
    const stockByWarehouse = {};
    for (const row of invRows) {
      const wid = String(row.warehouse_id);
      stockByWarehouse[wid] = (stockByWarehouse[wid] || 0) + availableOf(row);
    }

    const qcAllowed = productQcEnabled(product);
    const ecAllowed = productEcEnabled(product);

    let qc = {
      available: false,
      reason: !hasLocation ? "LOCATION_REQUIRED" : !qcAllowed ? "PRODUCT_QC_DISABLED" : "NO_SERVICEABLE_STORE",
      store: null,
      available_quantity: 0,
      eta_minutes_min: qcEta.min,
      eta_minutes_max: qcEta.max,
      label: "Quick Commerce",
      eta_label: qcEta.min + "–" + qcEta.max + " minutes",
    };

    if (hasLocation && qcAllowed) {
      for (const store of darkStores.filter((s) => s.serviceable)) {
        const qty = stockByWarehouse[store.warehouse_id] || 0;
        if (qty >= quantity) {
          qc = {
            available: true,
            reason: "OK",
            store: {
              store_id: store.store_id,
              store_name: store.store_name,
              warehouse_id: store.warehouse_id,
              warehouse_code: store.warehouse_code,
              distance_km: store.distance_km,
              service_radius_km: store.service_radius_km,
            },
            available_quantity: qty,
            eta_minutes_min: qcEta.min,
            eta_minutes_max: qcEta.max,
            label: "Quick Commerce",
            eta_label: qcEta.min + "–" + qcEta.max + " minutes",
          };
          break;
        }
        if (qty > 0 && !qc.available) {
          qc.reason = "INSUFFICIENT_LOCAL_STOCK";
          qc.available_quantity = Math.max(qc.available_quantity, qty);
        }
      }
      if (!qc.available && darkStores.length && !darkStores.some((s) => s.serviceable)) {
        qc.reason = "OUTSIDE_SERVICE_RADIUS_OR_STORE_CLOSED";
      }
    }

    let centralQty = 0;
    for (const wid of centralIds) {
      centralQty += stockByWarehouse[wid] || 0;
    }
    // If no explicit central warehouse, allow any warehouse stock for EC
    if (centralIds.size === 0) {
      centralQty = Object.values(stockByWarehouse).reduce((s, n) => s + n, 0);
    }

    const ec = {
      available: ecAllowed && centralQty >= quantity,
      reason: !ecAllowed
        ? "PRODUCT_EC_DISABLED"
        : centralQty >= quantity
          ? "OK"
          : centralQty > 0
            ? "INSUFFICIENT_WAREHOUSE_STOCK"
            : "NO_WAREHOUSE_STOCK",
      warehouse_ids: [...centralIds],
      available_quantity: centralQty,
      eta_days_min: ecEta.min,
      eta_days_max: ecEta.max,
      label: "Standard Delivery",
      eta_label: ecEta.min + "–" + ecEta.max + " days",
    };

    lineResults.push({
      product_id: productId,
      variant_id: variantId,
      quantity,
      product_name: product.name || "",
      sku: product.sku || "",
      unit_price: raw.unit_price != null ? num(raw.unit_price) : num(product.selling_price),
      quick_commerce: qc,
      standard_ecommerce: ec,
    });
  }

  const qcLines = lineResults.filter((l) => l.quick_commerce.available);
  const ecOnlyLines = lineResults.filter((l) => !l.quick_commerce.available && l.standard_ecommerce.available);
  const bothOk = lineResults.filter((l) => l.quick_commerce.available && l.standard_ecommerce.available);
  const unavailable = lineResults.filter((l) => !l.quick_commerce.available && !l.standard_ecommerce.available);

  const allQc = lineResults.length > 0 && qcLines.length === lineResults.length;
  const allEc =
    lineResults.length > 0 &&
    lineResults.every((l) => l.standard_ecommerce.available) &&
    qcLines.length === 0;
  const split = qcLines.length > 0 && ecOnlyLines.length > 0;
  const bothFullCart =
    lineResults.length > 0 &&
    lineResults.every((l) => l.quick_commerce.available) &&
    lineResults.every((l) => l.standard_ecommerce.available);

  const options = [];
  if (allQc || bothFullCart) {
    const store = qcLines[0]?.quick_commerce?.store || null;
    options.push({
      mode: "QUICK_COMMERCE",
      available: true,
      label: "Quick Commerce",
      eta_label: qcEta.min + "–" + qcEta.max + " minutes",
      eta_minutes_min: qcEta.min,
      eta_minutes_max: qcEta.max,
      icon: "bolt",
      item_count: lineResults.length,
      fulfillment_store: store,
      items: lineResults.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        quantity: l.quantity,
        fulfillment_type: "QUICK_COMMERCE",
        store: l.quick_commerce.store,
      })),
    });
  }
  if (lineResults.every((l) => l.standard_ecommerce.available)) {
    options.push({
      mode: "E_COMMERCE",
      available: true,
      label: "Standard Delivery",
      eta_label: ecEta.min + "–" + ecEta.max + " days",
      eta_days_min: ecEta.min,
      eta_days_max: ecEta.max,
      icon: "package",
      item_count: lineResults.length,
      items: lineResults.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        quantity: l.quantity,
        fulfillment_type: "E_COMMERCE",
      })),
    });
  }
  if (split) {
    options.push({
      mode: "SPLIT",
      available: true,
      label: "Split delivery",
      description: "Some items arrive in 15–20 minutes; others in 2–3 days",
      icon: "split",
      groups: [
        {
          mode: "QUICK_COMMERCE",
          label: "Quick Commerce",
          eta_label: qcEta.min + "–" + qcEta.max + " minutes",
          item_count: qcLines.length,
          fulfillment_store: qcLines[0]?.quick_commerce?.store || null,
          items: qcLines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            fulfillment_type: "QUICK_COMMERCE",
            store: l.quick_commerce.store,
          })),
        },
        {
          mode: "E_COMMERCE",
          label: "Standard Delivery",
          eta_label: ecEta.min + "–" + ecEta.max + " days",
          item_count: ecOnlyLines.length,
          items: ecOnlyLines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            fulfillment_type: "E_COMMERCE",
          })),
        },
      ],
    });
  }

  const subtotal = lineResults.reduce((s, l) => s + num(l.unit_price) * l.quantity, 0);
  const codAllowedForQc = subtotal <= qcCodLimit();

  return {
    location: hasLocation ? { latitude: lat, longitude: lng } : null,
    config: {
      qc_radius_km: qcRadiusKm(),
      qc_eta_minutes: qcEta,
      ec_eta_days: ecEta,
      qc_cod_limit: qcCodLimit(),
    },
    nearby_stores: darkStores.slice(0, 10),
    serviceable_stores: darkStores.filter((s) => s.serviceable),
    items: lineResults,
    options,
    summary: {
      quick_commerce_available: options.some((o) => o.mode === "QUICK_COMMERCE"),
      standard_ecommerce_available: options.some((o) => o.mode === "E_COMMERCE"),
      split_available: options.some((o) => o.mode === "SPLIT"),
      unavailable_item_count: unavailable.length,
      both_modes_for_full_cart: bothFullCart,
      items_qc: qcLines.length,
      items_ec_only: ecOnlyLines.length,
      items_both: bothOk.length,
    },
    payment_hints: {
      cod_allowed_for_quick_commerce: codAllowedForQc,
      qc_cod_limit: qcCodLimit(),
      cod_blocked_reason: codAllowedForQc
        ? null
        : "COD is not available for Quick Commerce orders above ₹" + qcCodLimit(),
    },
    warnings,
  };
}

async function evaluateProductAvailability(app, { productId, variantId, quantity, latitude, longitude }) {
  const result = await evaluateFulfillment(app, {
    latitude,
    longitude,
    items: [
      {
        product_id: productId,
        variant_id: variantId || null,
        quantity: quantity || 1,
      },
    ],
  });
  const line = result.items[0] || null;
  return {
    product_id: String(productId),
    variant_id: variantId ? String(variantId) : null,
    location: result.location,
    quick_commerce: line ? line.quick_commerce : { available: false, reason: "UNKNOWN" },
    standard_ecommerce: line ? line.standard_ecommerce : { available: false, reason: "UNKNOWN" },
    options: result.options,
    nearby_stores: result.nearby_stores,
    warnings: result.warnings,
    config: result.config,
  };
}

module.exports = {
  distanceKm,
  qcRadiusKm,
  qcEtaMinutes,
  ecEtaDays,
  qcCodLimit,
  evaluateFulfillment,
  evaluateProductAvailability,
  buildDarkStoreCandidates,
};
