#!/usr/bin/env node
"use strict";

/**
 * Hybrid fulfillment decision engine.
 * Backend authority for Quick Commerce vs Standard E-Commerce options.
 * Uses Warehouses + Outlets (+ Inventory). Does not invent stock.
 */

const { asId, rowOf, rowsOf, num, sqlString, isTruthy, optionalText } = require("./http");
const { availableOf } = require("./inventory-ops");
const {
  loadFulfillmentTopology,
  maxServiceRadiusKm,
  passesBoundingBox,
  getOutletFromTopology,
} = require("./fulfillment-topology");
const { dedupeToCanonicalInventoryRows } = require("./inventory-identity");
const { parseLocation } = require("./geo-coords");

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

async function loadProductsByIds(zcql, productIds) {
  const ids = [...new Set((productIds || []).map((id) => String(id)).filter(Boolean))];
  const map = new Map();
  if (!ids.length) {
    return map;
  }
  let query =
    "SELECT ROWID, name, sku, status, selling_price, mrp, quick_commerce_enabled, ecommerce_enabled FROM Products WHERE ROWID IN (" +
    ids.map((id) => asId(id, "product_id")).join(",") +
    ")";
  let rows = [];
  try {
    rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
  } catch (_) {
    query =
      "SELECT ROWID, name, sku, status, selling_price, mrp FROM Products WHERE ROWID IN (" +
      ids.map((id) => asId(id, "product_id")).join(",") +
      ")";
    rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
  }
  for (const row of rows) {
    map.set(String(row.ROWID), row);
  }
  return map;
}

async function inventoryForProductIds(zcql, productIds) {
  const ids = [...new Set((productIds || []).map((id) => String(id)).filter(Boolean))];
  if (!ids.length) {
    return [];
  }
  const query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, is_active, status FROM Inventory WHERE product_id IN (" +
    ids.map((id) => asId(id, "product_id")).join(",") +
    ") AND is_active = true AND status = 'ACTIVE'";
  return rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
}

function inventoryRowsForItem(allRows, productId, variantId) {
  const pid = String(productId);
  const vid = variantId ? String(variantId) : null;
  return (allRows || []).filter((row) => {
    if (String(row.product_id) !== pid) {
      return false;
    }
    if (vid) {
      return String(row.variant_id) === vid;
    }
    // No variant on request: include all product inventory rows (matches legacy per-product query).
    return true;
  });
}

function stockByWarehouseFromRows(invRows) {
  const stockByWarehouse = {};
  for (const row of dedupeToCanonicalInventoryRows(invRows || [])) {
    const wid = String(row.warehouse_id);
    stockByWarehouse[wid] = (stockByWarehouse[wid] || 0) + availableOf(row);
  }
  return stockByWarehouse;
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

const OUTLET_BUSINESS_TIMEZONE =
  optionalText(process.env.FULFILLMENT_OUTLET_TIMEZONE, "timezone", 64) || "Asia/Kolkata";

/**
 * Parse a clock time to minutes-from-midnight (0–1439).
 * Supports "10:00", "21:00", "10:00 AM", and "9:00 PM".
 * Returns null for malformed values.
 */
function parseHm(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] ? match[3].toUpperCase() : null;

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }

  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function outletLocalMinutes(now, timeZone = OUTLET_BUSINESS_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((part) => part.type === "hour");
  const minutePart = parts.find((part) => part.type === "minute");
  const hour = Number(hourPart && hourPart.value);
  const minute = Number(minutePart && minutePart.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function isMinutesWithinBusinessWindow(mins, open, close) {
  if (open == null || close == null) return false;
  if (open === close) return false;
  if (close > open) {
    return mins >= open && mins < close;
  }
  // Overnight window, e.g. 22:00 – 02:00
  return mins >= open || mins < close;
}

function isStoreOpenNow(outlet, now = new Date(), timeZone = OUTLET_BUSINESS_TIMEZONE) {
  if (!outlet) return false;
  if (outlet.is_open === false || outlet.is_open === "false") return false;

  const openingRaw = outlet.opening_time;
  const closingRaw = outlet.closing_time;
  const openingText = openingRaw == null ? "" : String(openingRaw).trim();
  const closingText = closingRaw == null ? "" : String(closingRaw).trim();

  if (!openingText || !closingText) return false;

  const open = parseHm(openingText);
  const close = parseHm(closingText);
  if (open == null || close == null) return false;

  const mins = outletLocalMinutes(now, timeZone);
  if (mins == null) return false;
  return isMinutesWithinBusinessWindow(mins, open, close);
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

async function loadWarehouses(zcql) {
  const { loadWarehouses: loadWarehousesBatch } = require("./fulfillment-topology");
  return loadWarehousesBatch(zcql);
}

function buildDarkStoreCandidatesFromTopology(topology, latitude, longitude, options = {}) {
  const radiusDefault = options.qcRadiusKm != null ? options.qcRadiusKm : qcRadiusKm();
  const maxRadius = maxServiceRadiusKm(topology.outletsById, topology.warehouses, radiusDefault);
  const candidates = [];

  for (const wh of topology.warehouses || []) {
    if (!wh.outlet_id) {
      continue;
    }
    const outlet = getOutletFromTopology(topology, wh.outlet_id);
    if (!outlet) {
      continue;
    }
    if (
      !passesBoundingBox(latitude, longitude, outlet.latitude, outlet.longitude, maxRadius)
    ) {
      continue;
    }
    const dist = distanceKm(latitude, longitude, outlet.latitude, outlet.longitude);
    if (dist == null) {
      continue;
    }
    const radius = radiusForOutlet(outlet);
    const open = isStoreOpenNow(outlet, options.now);
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

async function buildDarkStoreCandidates(zcql, latitude, longitude) {
  const topology = await loadFulfillmentTopology(zcql);
  return buildDarkStoreCandidatesFromTopology(topology, latitude, longitude);
}

function centralWarehouses(warehouses) {
  const defaults = warehouses.filter(
    (w) => isTruthy(w.is_default) || String(w.code || "").toUpperCase() === "HQ"
  );
  return defaults.length ? defaults : warehouses;
}

function pickWarehouseWithStock(stockByWarehouse, warehouseIds, quantity) {
  const need = Math.max(1, Math.round(num(quantity) || 1));
  const ordered = (warehouseIds || []).map(String).filter(Boolean);
  for (const wid of ordered) {
    if ((stockByWarehouse[wid] || 0) >= need) {
      return wid;
    }
  }
  return null;
}

function resolveStandardWarehouseList(topology, latitude, longitude) {
  const centralIds = [...topology.centralWarehouseIds];
  if (!standardGeoRoutingEnabled()) {
    return centralIds.length ? centralIds : [];
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  const regionalStandard = (topology.warehouses || []).filter((row) => {
    const id = String(row.ROWID);
    if (centralIds.includes(id)) {
      return false;
    }
    if (row.outlet_id) {
      return false;
    }
    return true;
  });

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !regionalStandard.length) {
    return centralIds.length ? centralIds : regionalStandard.map((row) => String(row.ROWID));
  }

  const ranked = regionalStandard
    .map((row) => {
      let distance_km = null;
      if (row.outlet_id) {
        const outlet = getOutletFromTopology(topology, row.outlet_id);
        if (outlet) {
          distance_km = distanceKm(lat, lng, outlet.latitude, outlet.longitude);
        }
      }
      return { warehouse_id: String(row.ROWID), distance_km: distance_km == null ? 999999 : distance_km };
    })
    .sort((a, b) => a.distance_km - b.distance_km)
    .map((row) => row.warehouse_id);

  return [...ranked, ...centralIds.filter((id) => !ranked.includes(id))];
}

function standardGeoRoutingEnabled() {
  const raw = String(process.env.STANDARD_GEO_ROUTING_ENABLED || "").toLowerCase();
  return raw === "true" || raw === "1";
}

function evaluateFulfillmentLine({
  product,
  productId,
  variantId,
  quantity,
  hasLocation,
  darkStores,
  topology,
  invRows,
  latitude,
  longitude,
}) {
  const qcEta = qcEtaMinutes();
  const ecEta = ecEtaDays();
  const qty = Math.max(1, Math.round(num(quantity) || 1));

  if (!product || String(product.status || "").toUpperCase() !== "ACTIVE") {
    return {
      product_id: productId,
      variant_id: variantId,
      quantity: qty,
      quick_commerce: { available: false, reason: "PRODUCT_UNAVAILABLE" },
      standard_ecommerce: { available: false, reason: "PRODUCT_UNAVAILABLE" },
    };
  }

  const stockByWarehouse = stockByWarehouseFromRows(invRows);
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
      const availableQty = stockByWarehouse[store.warehouse_id] || 0;
      if (availableQty >= qty) {
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
          available_quantity: availableQty,
          eta_minutes_min: qcEta.min,
          eta_minutes_max: qcEta.max,
          label: "Quick Commerce",
          eta_label: qcEta.min + "–" + qcEta.max + " minutes",
        };
        break;
      }
      if (availableQty > 0 && !qc.available) {
        qc.reason = "INSUFFICIENT_LOCAL_STOCK";
        qc.available_quantity = Math.max(qc.available_quantity, availableQty);
      }
    }
    if (!qc.available && darkStores.some((s) => s.serviceable)) {
      qc.reason = qc.available_quantity > 0 ? "INSUFFICIENT_LOCAL_STOCK" : "NO_LOCAL_STOCK";
    }
    if (!qc.available && darkStores.length && !darkStores.some((s) => s.serviceable)) {
      qc.reason = "OUTSIDE_SERVICE_RADIUS_OR_STORE_CLOSED";
    }
  }

  const standardList = resolveStandardWarehouseList(topology, latitude, longitude);
  let centralQty = 0;
  for (const wid of standardList) {
    centralQty += stockByWarehouse[wid] || 0;
  }
  const ecWarehouseId = pickWarehouseWithStock(stockByWarehouse, standardList, qty);

  const ec = {
    available: ecAllowed && centralQty >= qty,
    reason: !ecAllowed
      ? "PRODUCT_EC_DISABLED"
      : centralQty >= qty
        ? "OK"
        : centralQty > 0
          ? "INSUFFICIENT_WAREHOUSE_STOCK"
          : "NO_WAREHOUSE_STOCK",
    warehouse_id: ecWarehouseId,
    warehouse_ids: standardList,
    available_quantity: centralQty,
    eta_days_min: ecEta.min,
    eta_days_max: ecEta.max,
    label: "Standard Delivery",
    eta_label: ecEta.min + "–" + ecEta.max + " days",
  };

  return {
    product_id: productId,
    variant_id: variantId,
    quantity: qty,
    product_name: product.name || "",
    sku: product.sku || "",
    quick_commerce: qc,
    standard_ecommerce: ec,
  };
}

function qcStoreFromCandidate(store) {
  return {
    store_id: store.store_id,
    store_name: store.store_name,
    warehouse_id: store.warehouse_id,
    warehouse_code: store.warehouse_code,
    distance_km: store.distance_km,
    service_radius_km: store.service_radius_km,
  };
}

/**
 * Nearest serviceable dark store that can fulfill every cart line at that warehouse.
 * Store A (1 km, qty 2) vs Store B (2 km, qty 10) for request 5 → Store B.
 */
function findNearestQuickStoreForCart(lineResults, darkStores, lineStockMaps) {
  if (!Array.isArray(lineResults) || !lineResults.length) {
    return null;
  }
  for (const store of (darkStores || []).filter((candidate) => candidate.serviceable)) {
    const fulfillsAll = lineResults.every((line, index) => {
      const stockMap = lineStockMaps[index] || {};
      return (stockMap[store.warehouse_id] || 0) >= line.quantity;
    });
    if (fulfillsAll) {
      return store;
    }
  }
  return null;
}

/**
 * Evaluate fulfillment for cart-like items.
 * items: [{ product_id, variant_id?, quantity, unit_price? }]
 */
async function evaluateFulfillment(app, { latitude, longitude, items }) {
  const zcql = app.zcql();
  const location = parseLocation(latitude, longitude);
  const hasLocation = location != null;
  const lat = location ? location.latitude : NaN;
  const lng = location ? location.longitude : NaN;

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
  let topology = null;
  if (hasLocation) {
    try {
      topology = await loadFulfillmentTopology(zcql);
      darkStores = buildDarkStoreCandidatesFromTopology(topology, lat, lng);
    } catch (e) {
      warnings.push("Unable to load dark-store candidates: " + (e.message || e));
    }
  } else {
    warnings.push("Location missing — Quick Commerce cannot be evaluated until latitude/longitude are provided");
  }

  if (!topology) {
    topology = await loadFulfillmentTopology(zcql);
  }
  const warehouses = topology.warehouses;
  const central = topology.centralWarehouses;
  const centralIds = new Set(topology.centralWarehouseIds);

  const productIds = items.map((raw) => asId(raw.product_id, "product_id"));
  const productsById = await loadProductsByIds(zcql, productIds);
  const inventoryRows = await inventoryForProductIds(zcql, productIds);
  const lineStockMaps = [];

  for (const raw of items) {
    const productId = asId(raw.product_id, "product_id");
    const variantId = raw.variant_id ? asId(raw.variant_id, "variant_id") : null;
    const quantity = Math.max(1, Math.round(num(raw.quantity) || 1));
    const product = productsById.get(String(productId));
    const invRows = inventoryRowsForItem(inventoryRows, productId, variantId);
    lineStockMaps.push(stockByWarehouseFromRows(invRows));
    const line = evaluateFulfillmentLine({
      product,
      productId,
      variantId,
      quantity,
      hasLocation,
      darkStores,
      topology,
      invRows,
      latitude: lat,
      longitude: lng,
    });
    lineResults.push({
      ...line,
      unit_price: raw.unit_price != null ? num(raw.unit_price) : num(product && product.selling_price),
    });
  }

  const qcLines = lineResults.filter((l) => l.quick_commerce.available);
  const ecOnlyLines = lineResults.filter((l) => !l.quick_commerce.available && l.standard_ecommerce.available);
  const bothOk = lineResults.filter((l) => l.quick_commerce.available && l.standard_ecommerce.available);
  const unavailable = lineResults.filter((l) => !l.quick_commerce.available && !l.standard_ecommerce.available);

  const cartQuickStore = hasLocation
    ? findNearestQuickStoreForCart(lineResults, darkStores, lineStockMaps)
    : null;
  const cartQcAvailable = cartQuickStore !== null;
  const perLineQc = lineResults.length > 0 && qcLines.length === lineResults.length;

  const allEc =
    lineResults.length > 0 &&
    lineResults.every((l) => l.standard_ecommerce.available) &&
    !cartQcAvailable;
  const split = qcLines.length > 0 && ecOnlyLines.length > 0;

  const options = [];
  if (cartQcAvailable) {
    const store = qcStoreFromCandidate(cartQuickStore);
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
        store,
      })),
    });
  } else if (perLineQc && !cartQcAvailable) {
    warnings.push(
      "Quick Commerce requires one nearby store to fulfill all items. Choose Standard Delivery or remove items."
    );
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
        warehouse_id: l.standard_ecommerce?.warehouse_id || null,
      })),
    });
  }
  if (split) {
    const qcIndices = lineResults
      .map((line, index) => (line.quick_commerce.available ? index : -1))
      .filter((index) => index >= 0);
    const qcSubset = qcIndices.map((index) => lineResults[index]);
    const qcStockSubset = qcIndices.map((index) => lineStockMaps[index]);
    const splitQcStore = findNearestQuickStoreForCart(qcSubset, darkStores, qcStockSubset);
    const splitStore = splitQcStore ? qcStoreFromCandidate(splitQcStore) : null;
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
          fulfillment_store: splitStore,
          items: qcLines.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            fulfillment_type: "QUICK_COMMERCE",
            store: splitStore || l.quick_commerce.store,
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
            warehouse_id: l.standard_ecommerce?.warehouse_id || null,
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
      both_modes_for_full_cart:
        cartQcAvailable &&
        lineResults.length > 0 &&
        lineResults.every((l) => l.standard_ecommerce.available),
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
  parseHm,
  outletLocalMinutes,
  isMinutesWithinBusinessWindow,
  isStoreOpenNow,
  OUTLET_BUSINESS_TIMEZONE,
  evaluateFulfillment,
  evaluateFulfillmentLine,
  evaluateProductAvailability,
  findNearestQuickStoreForCart,
  qcStoreFromCandidate,
  buildDarkStoreCandidates,
  buildDarkStoreCandidatesFromTopology,
  pickWarehouseWithStock,
  centralWarehouses,
  standardGeoRoutingEnabled,
  resolveStandardWarehouseList,
  loadProductsByIds,
  inventoryForProductIds,
  stockByWarehouseFromRows,
  inventoryRowsForItem,
};
