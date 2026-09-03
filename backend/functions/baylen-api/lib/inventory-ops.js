"use strict";

const { asId, optionalText, rowOf, rowsOf, num, sqlString, insertedRowId } = require("./http");

function availableOf(row) {
  return Math.max(
    0,
    num(row.quantity_on_hand) - num(row.quantity_reserved) - num(row.quantity_committed)
  );
}

async function loadInventoryRow(zcql, { inventoryId, warehouseId, productId, variantId }) {
  if (inventoryId) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, quantity_in_transit, quantity_damaged, reorder_level, safety_stock, reorder_quantity, allow_negative, status, is_active FROM Inventory WHERE ROWID = " +
          asId(inventoryId, "inventory_id")
      ),
      "Inventory"
    );
  }
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, quantity_in_transit, quantity_damaged, reorder_level, safety_stock, reorder_quantity, allow_negative, status, is_active FROM Inventory WHERE product_id = " +
    asId(productId, "product_id") +
    " AND warehouse_id = " +
    asId(warehouseId, "warehouse_id") +
    " AND is_active = true AND status = 'ACTIVE'";
  if (variantId) {
    query += " AND variant_id = " + asId(variantId, "variant_id");
  } else {
    query += " AND variant_id IS NULL";
  }
  return rowOf(await zcql.executeZCQLQuery(query), "Inventory");
}

async function resolveWarehouse(zcql, warehouseId, warehouseCode) {
  if (warehouseId) {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, code, name FROM Warehouses WHERE ROWID = " +
          asId(warehouseId, "warehouse_id") +
          " AND is_active = true"
      ),
      "Warehouses"
    );
    if (!row) {
      const error = new Error("Warehouse not found");
      error.status = 404;
      throw error;
    }
    return row;
  }
  const code = optionalText(warehouseCode, "warehouse_code", 30) || "HQ";
  let row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, code, name FROM Warehouses WHERE code = " + sqlString(code) + " AND is_active = true"
    ),
    "Warehouses"
  );
  if (row) return row;
  row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, code, name FROM Warehouses WHERE is_default = true AND is_active = true"
    ),
    "Warehouses"
  );
  if (row) return row;
  row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, code, name FROM Warehouses WHERE is_active = true"
    ),
    "Warehouses"
  );
  if (!row) {
    const error = new Error("No active warehouse configured");
    error.status = 409;
    throw error;
  }
  return row;
}

async function writeMovement(app, payload) {
  await app.datastore().table("Stock_Movements").insertRow({
    inventory_id: payload.inventory_id,
    warehouse_id: payload.warehouse_id,
    product_id: payload.product_id,
    variant_id: payload.variant_id || null,
    movement_type: payload.movement_type,
    quantity: payload.quantity,
    before_quantity: payload.before_quantity,
    after_quantity: payload.after_quantity,
    reference_type: payload.reference_type || null,
    reference_id: payload.reference_id || null,
    notes: payload.notes || null,
    reason: payload.reason || null,
    performed_by: payload.performed_by || "SYSTEM",
    movement_date: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
}

async function ensureInventoryRow(app, { warehouseId, productId, variantId }) {
  const zcql = app.zcql();
  const existing = await loadInventoryRow(zcql, { warehouseId, productId, variantId });
  if (existing) return existing;
  const inserted = await app.datastore().table("Inventory").insertRow({
    warehouse_id: warehouseId,
    product_id: productId,
    variant_id: variantId || null,
    quantity_on_hand: 0,
    quantity_reserved: 0,
    quantity_committed: 0,
    quantity_in_transit: 0,
    quantity_damaged: 0,
    reorder_level: 0,
    safety_stock: 0,
    reorder_quantity: 0,
    allow_negative: false,
    status: "ACTIVE",
    is_active: true,
  });
  return loadInventoryRow(zcql, { inventoryId: insertedRowId(inserted) });
}

async function adjustStock(app, body, actor) {
  const zcql = app.zcql();
  const warehouse = await resolveWarehouse(zcql, body.warehouse_id, body.warehouse_code);
  const productId = asId(body.product_id, "product_id");
  const variantId = body.variant_id ? asId(body.variant_id, "variant_id") : null;
  const delta = Math.round(num(body.quantity));
  if (!delta) {
    const error = new Error("quantity must be a non-zero integer for adjustment delta, or use absolute quantity_on_hand");
    error.status = 400;
    throw error;
  }
  const movementType = optionalText(body.movement_type, "movement_type", 30) || (delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT");
  let row = await ensureInventoryRow(app, {
    warehouseId: String(warehouse.ROWID),
    productId,
    variantId,
  });
  // re-read for concurrency freshness
  row = await loadInventoryRow(zcql, { inventoryId: String(row.ROWID) });
  const before = num(row.quantity_on_hand);
  const after = before + delta;
  if (after < 0 && !row.allow_negative && row.allow_negative !== "true") {
    const error = new Error("Insufficient stock for adjustment");
    error.status = 409;
    throw error;
  }
  await app.datastore().table("Inventory").updateRow({
    ROWID: row.ROWID,
    quantity_on_hand: after,
    reorder_level:
      body.reorder_level === undefined ? row.reorder_level : Math.max(0, Math.round(num(body.reorder_level))),
    reorder_quantity:
      body.reorder_quantity === undefined
        ? row.reorder_quantity
        : Math.max(0, Math.round(num(body.reorder_quantity))),
    safety_stock:
      body.safety_stock === undefined ? row.safety_stock : Math.max(0, Math.round(num(body.safety_stock))),
  });
  await writeMovement(app, {
    inventory_id: row.ROWID,
    warehouse_id: warehouse.ROWID,
    product_id: productId,
    variant_id: variantId,
    movement_type: movementType,
    quantity: Math.abs(delta),
    before_quantity: before,
    after_quantity: after,
    reference_type: body.reference_type || "ADMIN",
    reference_id: body.reference_id || null,
    notes: body.notes || "Stock adjustment",
    reason: body.reason || null,
    performed_by: actor || "ADMIN",
  });
  return {
    inventory_id: String(row.ROWID),
    before_quantity: before,
    after_quantity: after,
    available: Math.max(0, after - num(row.quantity_reserved) - num(row.quantity_committed)),
  };
}

async function setAbsoluteStock(app, body, actor) {
  const zcql = app.zcql();
  const warehouse = await resolveWarehouse(zcql, body.warehouse_id, body.warehouse_code);
  const productId = asId(body.product_id, "product_id");
  const variantId = body.variant_id ? asId(body.variant_id, "variant_id") : null;
  const target = Math.max(0, Math.round(num(body.quantity_on_hand)));
  let row = await ensureInventoryRow(app, {
    warehouseId: String(warehouse.ROWID),
    productId,
    variantId,
  });
  row = await loadInventoryRow(zcql, { inventoryId: String(row.ROWID) });
  const before = num(row.quantity_on_hand);
  await app.datastore().table("Inventory").updateRow({
    ROWID: row.ROWID,
    quantity_on_hand: target,
    quantity_reserved: Math.max(0, Math.round(num(body.quantity_reserved ?? row.quantity_reserved))),
    reorder_level:
      body.reorder_level === undefined ? row.reorder_level : Math.max(0, Math.round(num(body.reorder_level))),
    reorder_quantity:
      body.reorder_quantity === undefined
        ? row.reorder_quantity
        : Math.max(0, Math.round(num(body.reorder_quantity))),
    safety_stock:
      body.safety_stock === undefined ? row.safety_stock : Math.max(0, Math.round(num(body.safety_stock))),
  });
  await writeMovement(app, {
    inventory_id: row.ROWID,
    warehouse_id: warehouse.ROWID,
    product_id: productId,
    variant_id: variantId,
    movement_type: "STOCK_COUNT",
    quantity: Math.abs(target - before),
    before_quantity: before,
    after_quantity: target,
    reference_type: "ADMIN",
    notes: body.notes || "Absolute stock set",
    performed_by: actor || "ADMIN",
  });
  return { inventory_id: String(row.ROWID), before_quantity: before, after_quantity: target };
}

async function reserveStock(app, { productId, variantId, quantity, referenceType, referenceId, warehouseId }) {
  const zcql = app.zcql();
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, allow_negative FROM Inventory WHERE product_id = " +
    asId(productId, "product_id") +
    " AND is_active = true AND status = 'ACTIVE'";
  if (variantId) query += " AND variant_id = " + asId(variantId, "variant_id");
  if (warehouseId) query += " AND warehouse_id = " + asId(warehouseId, "warehouse_id");
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
  const need = Math.max(1, Math.round(num(quantity)));
  const available = rows.reduce((sum, row) => sum + availableOf(row), 0);
  if (available < need) {
    const error = new Error("Insufficient stock");
    error.status = 409;
    throw error;
  }
  let remaining = need;
  const reserved = [];
  for (const row of rows) {
    if (remaining < 1) break;
    const open = availableOf(row);
    const take = Math.min(open, remaining);
    if (take < 1) continue;
    const beforeReserved = num(row.quantity_reserved);
    const nextReserved = beforeReserved + take;
    await app.datastore().table("Inventory").updateRow({
      ROWID: row.ROWID,
      quantity_reserved: nextReserved,
    });
    await writeMovement(app, {
      inventory_id: row.ROWID,
      warehouse_id: row.warehouse_id,
      product_id: row.product_id,
      variant_id: row.variant_id,
      movement_type: "ORDER_RESERVATION",
      quantity: take,
      before_quantity: num(row.quantity_on_hand),
      after_quantity: num(row.quantity_on_hand),
      reference_type: referenceType || "ORDER",
      reference_id: referenceId || null,
      notes: "Reserved stock",
      performed_by: "SYSTEM",
    });
    reserved.push({ inventory_id: String(row.ROWID), quantity: take });
    remaining -= take;
  }
  return { reserved, quantity: need };
}

async function releaseReservation(app, referenceId, reason) {
  const zcql = app.zcql();
  const movements = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        asId(referenceId, "reference_id") +
        " AND (movement_type = 'ORDER_RESERVATION' OR movement_type = 'RESERVE')"
    ),
    "Stock_Movements"
  );
  for (const movement of movements) {
    const inventory = await loadInventoryRow(zcql, { inventoryId: String(movement.inventory_id) });
    if (!inventory) continue;
    const released = num(movement.quantity);
    const nextReserved = Math.max(0, num(inventory.quantity_reserved) - released);
    await app.datastore().table("Inventory").updateRow({
      ROWID: inventory.ROWID,
      quantity_reserved: nextReserved,
    });
    await writeMovement(app, {
      inventory_id: inventory.ROWID,
      warehouse_id: movement.warehouse_id,
      product_id: movement.product_id,
      variant_id: movement.variant_id,
      movement_type: "ORDER_RELEASE",
      quantity: released,
      before_quantity: num(inventory.quantity_on_hand),
      after_quantity: num(inventory.quantity_on_hand),
      reference_type: "ORDER",
      reference_id: referenceId,
      notes: reason || "Released reservation",
      performed_by: "SYSTEM",
    });
  }
}

async function commitReservation(app, referenceId) {
  const zcql = app.zcql();
  const movements = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        asId(referenceId, "reference_id") +
        " AND (movement_type = 'ORDER_RESERVATION' OR movement_type = 'RESERVE')"
    ),
    "Stock_Movements"
  );
  for (const movement of movements) {
    const inventory = await loadInventoryRow(zcql, { inventoryId: String(movement.inventory_id) });
    if (!inventory) continue;
    const qty = num(movement.quantity);
    const before = num(inventory.quantity_on_hand);
    const after = Math.max(0, before - qty);
    await app.datastore().table("Inventory").updateRow({
      ROWID: inventory.ROWID,
      quantity_on_hand: after,
      quantity_reserved: Math.max(0, num(inventory.quantity_reserved) - qty),
      quantity_committed: Math.max(0, num(inventory.quantity_committed)),
    });
    await writeMovement(app, {
      inventory_id: inventory.ROWID,
      warehouse_id: movement.warehouse_id,
      product_id: movement.product_id,
      variant_id: movement.variant_id,
      movement_type: "SALE",
      quantity: qty,
      before_quantity: before,
      after_quantity: after,
      reference_type: "ORDER",
      reference_id: referenceId,
      notes: "Committed reserved stock on payment/fulfillment",
      performed_by: "SYSTEM",
    });
  }
}

async function transferStock(app, body, actor) {
  const zcql = app.zcql();
  const from = await resolveWarehouse(zcql, body.from_warehouse_id, body.from_warehouse_code);
  const to = await resolveWarehouse(zcql, body.to_warehouse_id, body.to_warehouse_code);
  if (String(from.ROWID) === String(to.ROWID)) {
    const error = new Error("from and to warehouse must differ");
    error.status = 400;
    throw error;
  }
  const productId = asId(body.product_id, "product_id");
  const variantId = body.variant_id ? asId(body.variant_id, "variant_id") : null;
  const quantity = Math.max(1, Math.round(num(body.quantity)));
  let source = await ensureInventoryRow(app, {
    warehouseId: String(from.ROWID),
    productId,
    variantId,
  });
  source = await loadInventoryRow(zcql, { inventoryId: String(source.ROWID) });
  if (availableOf(source) < quantity) {
    const error = new Error("Insufficient available stock for transfer");
    error.status = 409;
    throw error;
  }
  const beforeFrom = num(source.quantity_on_hand);
  const afterFrom = beforeFrom - quantity;
  await app.datastore().table("Inventory").updateRow({
    ROWID: source.ROWID,
    quantity_on_hand: afterFrom,
  });
  await writeMovement(app, {
    inventory_id: source.ROWID,
    warehouse_id: from.ROWID,
    product_id: productId,
    variant_id: variantId,
    movement_type: "TRANSFER_OUT",
    quantity,
    before_quantity: beforeFrom,
    after_quantity: afterFrom,
    reference_type: "TRANSFER",
    notes: body.notes || "Transfer out",
    performed_by: actor || "ADMIN",
  });

  let dest = await ensureInventoryRow(app, {
    warehouseId: String(to.ROWID),
    productId,
    variantId,
  });
  dest = await loadInventoryRow(zcql, { inventoryId: String(dest.ROWID) });
  const beforeTo = num(dest.quantity_on_hand);
  const afterTo = beforeTo + quantity;
  await app.datastore().table("Inventory").updateRow({
    ROWID: dest.ROWID,
    quantity_on_hand: afterTo,
  });
  await writeMovement(app, {
    inventory_id: dest.ROWID,
    warehouse_id: to.ROWID,
    product_id: productId,
    variant_id: variantId,
    movement_type: "TRANSFER_IN",
    quantity,
    before_quantity: beforeTo,
    after_quantity: afterTo,
    reference_type: "TRANSFER",
    notes: body.notes || "Transfer in",
    performed_by: actor || "ADMIN",
  });
  return {
    from_warehouse_id: String(from.ROWID),
    to_warehouse_id: String(to.ROWID),
    quantity,
    from_after: afterFrom,
    to_after: afterTo,
  };
}

module.exports = {
  availableOf,
  loadInventoryRow,
  resolveWarehouse,
  ensureInventoryRow,
  adjustStock,
  setAbsoluteStock,
  reserveStock,
  releaseReservation,
  commitReservation,
  transferStock,
};
