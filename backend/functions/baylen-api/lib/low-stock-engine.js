"use strict";

const { availableOf } = require("./inventory-ops");
const { num } = require("./http");
const { inventoryIdentityKey } = require("./inventory-identity");

const LOW_STOCK_STATUSES = ["IN_STOCK", "LOW_STOCK", "CRITICAL", "OUT_OF_STOCK"];

/**
 * Per-warehouse low-stock status from reorder fields.
 * available = on_hand - reserved - committed
 */
function computeLowStockStatus(row) {
  const available = availableOf(row);
  const reorderLevel = Math.max(0, Math.round(num(row.reorder_level)));
  const safetyStock = Math.max(0, Math.round(num(row.safety_stock)));

  if (available <= 0) {
    return "OUT_OF_STOCK";
  }
  if (available <= safetyStock) {
    return "CRITICAL";
  }
  if (reorderLevel > 0 && available <= reorderLevel) {
    return "LOW_STOCK";
  }
  return "IN_STOCK";
}

function mapLowStockRow(row, metadata = {}) {
  const available = availableOf(row);
  const status = computeLowStockStatus(row);
  return {
    inventory_id: String(row.ROWID),
    warehouse_id: String(row.warehouse_id),
    warehouse_code: metadata.warehouse_code || "",
    warehouse_name: metadata.warehouse_name || "",
    product_id: String(row.product_id),
    variant_id: row.variant_id ? String(row.variant_id) : null,
    sku: metadata.sku || "",
    product_name: metadata.product_name || "",
    variant_name: metadata.variant_name || "",
    quantity_on_hand: num(row.quantity_on_hand),
    quantity_reserved: num(row.quantity_reserved),
    quantity_committed: num(row.quantity_committed),
    available,
    reorder_level: num(row.reorder_level),
    reorder_quantity: num(row.reorder_quantity),
    safety_stock: num(row.safety_stock),
    status,
    reorder_recommendation:
      status === "LOW_STOCK" || status === "CRITICAL" || status === "OUT_OF_STOCK"
        ? Math.max(0, Math.round(num(row.reorder_quantity)))
        : 0,
    identity_key: inventoryIdentityKey(row.warehouse_id, row.product_id, row.variant_id),
  };
}

function summarizeLowStockRows(rows) {
  const summary = {
    total_rows: rows.length,
    in_stock: 0,
    low_stock: 0,
    critical: 0,
    out_of_stock: 0,
  };
  for (const row of rows) {
    if (row.status === "IN_STOCK") summary.in_stock += 1;
    else if (row.status === "LOW_STOCK") summary.low_stock += 1;
    else if (row.status === "CRITICAL") summary.critical += 1;
    else if (row.status === "OUT_OF_STOCK") summary.out_of_stock += 1;
  }
  return summary;
}

function matchesLowStockFilters(row, filters = {}) {
  if (filters.status && String(filters.status).toUpperCase() !== row.status) {
    return false;
  }
  if (filters.warehouse_id && String(filters.warehouse_id) !== String(row.warehouse_id)) {
    return false;
  }
  if (filters.warehouse_code && String(filters.warehouse_code).toUpperCase() !== String(row.warehouse_code).toUpperCase()) {
    return false;
  }
  if (filters.product_id && String(filters.product_id) !== String(row.product_id)) {
    return false;
  }
  if (filters.variant_id && String(filters.variant_id) !== String(row.variant_id)) {
    return false;
  }
  if (filters.sku && String(filters.sku).toUpperCase() !== String(row.sku).toUpperCase()) {
    return false;
  }
  if (filters.alert_only === true || filters.alert_only === "true") {
    return row.status !== "IN_STOCK";
  }
  return true;
}

module.exports = {
  LOW_STOCK_STATUSES,
  computeLowStockStatus,
  mapLowStockRow,
  summarizeLowStockRows,
  matchesLowStockFilters,
};
