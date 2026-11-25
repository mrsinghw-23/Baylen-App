"use strict";

const { num } = require("./http");
const {
  inventoryIdentityKey,
  pickCanonicalInventoryRow,
  inventoryIdentitySelectFields,
  loadInventoryRowsByIdentity,
} = require("./inventory-identity");

/**
 * Build a remediation plan for duplicate inventory rows.
 * Does NOT execute merges — admin confirmation required.
 */
function planDuplicateRemediation(groupRows, metadata = {}) {
  if (!Array.isArray(groupRows) || groupRows.length < 2) {
    const error = new Error("At least two duplicate rows are required to plan remediation");
    error.status = 400;
    error.code = "NOT_A_DUPLICATE_GROUP";
    throw error;
  }

  const sample = groupRows[0];
  const canonical = pickCanonicalInventoryRow(groupRows);
  const orphans = groupRows.filter((row) => String(row.ROWID) !== String(canonical.ROWID));

  const sumField = (field) =>
    groupRows.reduce((total, row) => total + Math.max(0, Math.round(num(row[field]))), 0);

  const mergedQuantities = {
    quantity_on_hand: sumField("quantity_on_hand"),
    quantity_reserved: sumField("quantity_reserved"),
    quantity_committed: sumField("quantity_committed"),
    quantity_in_transit: sumField("quantity_in_transit"),
    quantity_damaged: sumField("quantity_damaged"),
    reorder_level: Math.max(...groupRows.map((row) => Math.round(num(row.reorder_level)))),
    reorder_quantity: Math.max(...groupRows.map((row) => Math.round(num(row.reorder_quantity)))),
    safety_stock: Math.max(...groupRows.map((row) => Math.round(num(row.safety_stock)))),
  };

  const warnings = [];
  if (mergedQuantities.quantity_reserved > 0) {
    warnings.push(
      "Canonical merge must preserve active reservations — verify Stock_Movements reference orphan inventory_id values before deactivating rows."
    );
  }
  if (mergedQuantities.quantity_committed > 0) {
    warnings.push("Committed quantity exists — reconcile order/shipment references before merge.");
  }
  if (orphans.some((row) => num(row.quantity_on_hand) > 0)) {
    warnings.push("Orphan rows contain on_hand stock — merge must roll quantities into canonical row, not delete stock.");
  }

  return {
    identity_key: inventoryIdentityKey(sample.warehouse_id, sample.product_id, sample.variant_id),
    warehouse_id: String(sample.warehouse_id),
    product_id: String(sample.product_id),
    variant_id: sample.variant_id ? String(sample.variant_id) : null,
    warehouse_code: metadata.warehouse_code || "",
    sku: metadata.sku || metadata.variant_sku || "",
    canonical_row_id: String(canonical.ROWID),
    orphan_row_ids: orphans.map((row) => String(row.ROWID)),
    duplicate_count: groupRows.length,
    current_rows: groupRows.map((row) => ({
      row_id: String(row.ROWID),
      quantity_on_hand: num(row.quantity_on_hand),
      quantity_reserved: num(row.quantity_reserved),
      quantity_committed: num(row.quantity_committed),
      is_active: row.is_active,
      status: row.status || "ACTIVE",
    })),
    proposed_canonical_update: mergedQuantities,
    orphan_action: "DEACTIVATE_AFTER_MERGE",
    protections: [
      "Never delete rows with Stock_Movements history",
      "Re-point Stock_Movements.inventory_id from orphan → canonical before deactivating orphan",
      "Verify no open ORDER reservations reference orphan inventory_id",
      "Write Audit_Logs entry with before/after quantities",
      "Require explicit admin confirmation token",
    ],
    auto_execute: false,
    requires_admin_confirmation: true,
    warnings,
  };
}

/**
 * Load full duplicate group rows for planning (read-only).
 */
async function loadDuplicateGroupForRemediation(zcql, { warehouseId, productId, variantId }) {
  const rows = await loadInventoryRowsByIdentity(zcql, {
    warehouseId,
    productId,
    variantId,
    includeInactive: true,
  });
  if (rows.length < 2) {
    return null;
  }
  return rows;
}

module.exports = {
  planDuplicateRemediation,
  loadDuplicateGroupForRemediation,
  inventoryIdentitySelectFields,
};
