"use strict";

const { writeAdminAudit } = require("./audit");
const { inventoryIdentityKey } = require("./inventory-identity");

const ALERT_ENTITY = "LOW_STOCK_ALERT";
const CACHE_PREFIX = "lowstock:last:";

async function readLastAlertStatus(app, identityKey) {
  try {
    const raw = await app.cache().segment().getValue(CACHE_PREFIX + identityKey);
    return raw ? String(raw) : null;
  } catch (_) {
    return null;
  }
}

async function writeLastAlertStatus(app, identityKey, status) {
  try {
    await app.cache().segment().put(CACHE_PREFIX + identityKey, String(status), 24);
  } catch (_) {}
}

/**
 * Emit alert only on status transition (dedupe unchanged conditions).
 */
async function recordLowStockTransition(app, row, { actor = "SYSTEM", ipAddress = null } = {}) {
  const identityKey = inventoryIdentityKey(row.warehouse_id, row.product_id, row.variant_id);
  const previous = await readLastAlertStatus(app, identityKey);
  const current = row.status;

  if (previous === current) {
    return { emitted: false, identity_key: identityKey, status: current, previous_status: previous };
  }

  await writeLastAlertStatus(app, identityKey, current);

  const event = {
    identity_key: identityKey,
    warehouse_id: row.warehouse_id,
    warehouse_code: row.warehouse_code || "",
    product_id: row.product_id,
    variant_id: row.variant_id,
    sku: row.sku || "",
    status: current,
    previous_status: previous,
    available: row.available,
    reorder_level: row.reorder_level,
    safety_stock: row.safety_stock,
    reorder_recommendation: row.reorder_recommendation,
    emitted_at: new Date().toISOString(),
  };

  await writeAdminAudit(app, actor, "LOW_STOCK_TRANSITION", ALERT_ENTITY, identityKey, { status: previous }, event, ipAddress);

  return { emitted: true, event };
}

async function scanAndRecordLowStockAlerts(app, rows, options = {}) {
  const transitions = [];
  for (const row of rows || []) {
    if (row.status === "IN_STOCK" && options.skip_in_stock !== false) {
      const identityKey = inventoryIdentityKey(row.warehouse_id, row.product_id, row.variant_id);
      const previous = await readLastAlertStatus(app, identityKey);
      if (previous && previous !== "IN_STOCK") {
        const result = await recordLowStockTransition(app, row, options);
        if (result.emitted) transitions.push(result.event);
      } else if (previous === row.status) {
        continue;
      } else {
        await writeLastAlertStatus(app, identityKey, "IN_STOCK");
      }
      continue;
    }
    if (row.status !== "IN_STOCK") {
      const result = await recordLowStockTransition(app, row, options);
      if (result.emitted) transitions.push(result.event);
    }
  }
  return transitions;
}

module.exports = {
  ALERT_ENTITY,
  recordLowStockTransition,
  scanAndRecordLowStockAlerts,
  readLastAlertStatus,
};
