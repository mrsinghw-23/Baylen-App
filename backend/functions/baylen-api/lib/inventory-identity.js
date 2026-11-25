"use strict";

const { asId, rowsOf, isTruthy } = require("./http");

/**
 * Inventory identity = warehouse_id + product_id + variant_id
 * SKU is NOT the inventory primary key.
 */

function normalizeVariantId(variantId) {
  if (variantId === undefined || variantId === null || String(variantId).trim() === "") {
    return null;
  }
  return String(variantId);
}

function inventoryIdentityKey(warehouseId, productId, variantId) {
  return (
    String(warehouseId) +
    "|" +
    String(productId) +
    "|" +
    (normalizeVariantId(variantId) || "NULL")
  );
}

function pickCanonicalInventoryRow(rows) {
  if (!rows || !rows.length) {
    return null;
  }
  const sorted = [...rows].sort((left, right) =>
    String(left.ROWID).localeCompare(String(right.ROWID))
  );
  const active = sorted.find(
    (row) => isTruthy(row.is_active) && String(row.status || "ACTIVE") === "ACTIVE"
  );
  return active || sorted[0];
}

/**
 * Collapse duplicate identity rows to one canonical row per warehouse+product+variant.
 * Read paths must use this so stock is never double-counted.
 */
function dedupeToCanonicalInventoryRows(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    const key = inventoryIdentityKey(row.warehouse_id, row.product_id, row.variant_id);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, row);
      continue;
    }
    byKey.set(key, pickCanonicalInventoryRow([existing, row]));
  }
  return [...byKey.values()];
}

function inventoryIdentitySelectFields() {
  return "ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, quantity_in_transit, quantity_damaged, reorder_level, safety_stock, reorder_quantity, allow_negative, status, is_active";
}

async function loadInventoryRowsByIdentity(
  zcql,
  { warehouseId, productId, variantId, includeInactive = false }
) {
  const normalizedVariantId = normalizeVariantId(variantId);
  let query =
    "SELECT " +
    inventoryIdentitySelectFields() +
    " FROM Inventory WHERE product_id = " +
    asId(productId, "product_id") +
    " AND warehouse_id = " +
    asId(warehouseId, "warehouse_id");
  if (normalizedVariantId) {
    query += " AND variant_id = " + asId(normalizedVariantId, "variant_id");
  } else {
    query += " AND variant_id IS NULL";
  }
  if (!includeInactive) {
    query += " AND is_active = true AND status = 'ACTIVE'";
  }
  return rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
}

async function loadInventoryRowByIdentity(zcql, identity, options = {}) {
  const rows = await loadInventoryRowsByIdentity(zcql, { ...identity, ...options });
  if (rows.length > 1) {
    console.warn(
      "[inventory-identity] duplicate rows for " +
        inventoryIdentityKey(identity.warehouseId, identity.productId, identity.variantId) +
        ": " +
        rows.map((row) => String(row.ROWID)).join(", ")
    );
  }
  return pickCanonicalInventoryRow(rows);
}

function groupDuplicateInventoryRows(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = inventoryIdentityKey(row.warehouse_id, row.product_id, row.variant_id);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, groupRows]) => groupRows.length > 1)
    .map(([key, groupRows]) => {
      const [warehouseId, productId, variantToken] = key.split("|");
      return {
        warehouse_id: warehouseId,
        product_id: productId,
        variant_id: variantToken === "NULL" ? null : variantToken,
        duplicate_count: groupRows.length,
        row_ids: groupRows.map((row) => String(row.ROWID)),
      };
    });
}

async function scanInventoryDuplicates(zcql, { includeInactive = true } = {}) {
  let query = "SELECT ROWID, warehouse_id, product_id, variant_id, is_active, status FROM Inventory";
  if (!includeInactive) {
    query += " WHERE is_active = true AND status = 'ACTIVE'";
  }
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
  return groupDuplicateInventoryRows(rows);
}

async function buildInventoryDuplicateReport(zcql, options = {}) {
  const includeInactive = options.includeInactive !== false;
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, is_active, status FROM Inventory";
  if (!includeInactive) {
    query += " WHERE is_active = true AND status = 'ACTIVE'";
  }
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
  const duplicateGroups = groupDuplicateInventoryRows(rows);
  const uniqueIdentities = dedupeToCanonicalInventoryRows(rows).length;

  const warehouseIds = [...new Set(rows.map((row) => String(row.warehouse_id)))];
  const productIds = [...new Set(rows.map((row) => String(row.product_id)))];
  const warehousesById = new Map();
  const productsById = new Map();
  const variantsById = new Map();

  if (warehouseIds.length) {
    const whRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, code FROM Warehouses WHERE ROWID IN (" +
          warehouseIds.map((id) => asId(id, "warehouse_id")).join(",") +
          ")"
      ),
      "Warehouses"
    );
    for (const row of whRows) {
      warehousesById.set(String(row.ROWID), row.code || "");
    }
  }

  if (productIds.length) {
    const productRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, sku FROM Products WHERE ROWID IN (" +
          productIds.map((id) => asId(id, "product_id")).join(",") +
          ")"
      ),
      "Products"
    );
    for (const row of productRows) {
      productsById.set(String(row.ROWID), row.sku || "");
    }
    const variantRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, sku FROM Product_Variants WHERE product_id IN (" +
          productIds.map((id) => asId(id, "product_id")).join(",") +
          ")"
      ),
      "Product_Variants"
    );
    for (const row of variantRows) {
      variantsById.set(String(row.ROWID), row.sku || "");
    }
  }

  const enrichedGroups = duplicateGroups.map((group) => ({
    ...group,
    warehouse_code: warehousesById.get(String(group.warehouse_id)) || "",
    sku: productsById.get(String(group.product_id)) || variantsById.get(String(group.variant_id)) || "",
    variant_sku: group.variant_id ? variantsById.get(String(group.variant_id)) || "" : null,
  }));

  const affectedWarehouseIds = [...new Set(enrichedGroups.map((group) => String(group.warehouse_id)))];
  const affectedSkus = [
    ...new Set(
      enrichedGroups
        .map((group) => group.sku || group.variant_sku)
        .filter(Boolean)
    ),
  ];

  return {
    total_rows: rows.length,
    unique_identities: uniqueIdentities,
    duplicate_group_count: enrichedGroups.length,
    duplicate_groups: enrichedGroups,
    affected_warehouse_ids: affectedWarehouseIds,
    affected_skus: affectedSkus,
  };
}

module.exports = {
  normalizeVariantId,
  inventoryIdentityKey,
  pickCanonicalInventoryRow,
  dedupeToCanonicalInventoryRows,
  loadInventoryRowsByIdentity,
  loadInventoryRowByIdentity,
  groupDuplicateInventoryRows,
  scanInventoryDuplicates,
  buildInventoryDuplicateReport,
};
