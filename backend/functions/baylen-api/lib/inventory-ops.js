"use strict";

const { asId, optionalText, rowOf, rowsOf, num, sqlString } = require("./http");
const {
  loadInventoryRowsByIdentity,
  loadInventoryRowByIdentity,
  pickCanonicalInventoryRow,
  inventoryIdentityKey,
  dedupeToCanonicalInventoryRows,
} = require("./inventory-identity");
const { validateInventoryInvariants } = require("./inventory-invariants");
const { withInventoryRowLock } = require("./inventory-row-lock");

function availableOf(row) {
  return Math.max(
    0,
    num(row.quantity_on_hand) - num(row.quantity_reserved) - num(row.quantity_committed)
  );
}

function aggregateAvailable(rows) {
  return (rows || []).reduce((sum, row) => sum + availableOf(row), 0);
}

function availableInWarehouses(rows, warehouseIds) {
  const allowed = new Set((warehouseIds || []).map(String));
  if (!allowed.size) {
    return 0;
  }
  return (rows || [])
    .filter((row) => allowed.has(String(row.warehouse_id)))
    .reduce((sum, row) => sum + availableOf(row), 0);
}

async function queryInventoryForProduct(zcql, productId, variantId) {
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, is_active, status FROM Inventory WHERE product_id = " +
    asId(productId, "product_id") +
    " AND is_active = true AND status = 'ACTIVE'";
  if (variantId) {
    query += " AND variant_id = " + asId(variantId, "variant_id");
  }
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
  return dedupeToCanonicalInventoryRows(rows);
}

async function totalAvailableForProduct(zcql, productId, variantId) {
  return aggregateAvailable(await queryInventoryForProduct(zcql, productId, variantId));
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
  return loadInventoryRowByIdentity(zcql, { warehouseId, productId, variantId });
}

async function resolveWarehouse(zcql, warehouseId, warehouseCode, options = {}) {
  const strictCode = options.strictCode === true;
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
      error.code = "WAREHOUSE_NOT_FOUND";
      throw error;
    }
    return row;
  }
  const rawCode = warehouseCode != null ? String(warehouseCode).trim() : "";
  const hasExplicitCode = rawCode.length > 0;
  if (hasExplicitCode) {
    const code = optionalText(rawCode, "warehouse_code", 30);
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, code, name FROM Warehouses WHERE code = " +
          sqlString(code) +
          " AND is_active = true"
      ),
      "Warehouses"
    );
    if (row) {
      return row;
    }
    const error = new Error("Warehouse not found for code: " + code);
    error.status = 404;
    error.code = "WAREHOUSE_NOT_FOUND";
    throw error;
  }
  if (strictCode) {
    const error = new Error("Warehouse code is required");
    error.status = 400;
    error.code = "WAREHOUSE_NOT_FOUND";
    throw error;
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
  return app.datastore().table("Stock_Movements").insertRow({
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

async function reservationMovementsForReference(zcql, referenceType, referenceId, inventoryId) {
  if (!referenceId) {
    return [];
  }
  let query =
    "SELECT ROWID, inventory_id, quantity, movement_type FROM Stock_Movements WHERE reference_type = " +
    sqlString(referenceType || "ORDER") +
    " AND reference_id = " +
    asId(referenceId, "reference_id") +
    " AND inventory_id = " +
    asId(inventoryId, "inventory_id") +
    " AND (movement_type = 'ORDER_RESERVATION' OR movement_type = 'RESERVE' OR movement_type = 'ORDER_RELEASE')";
  return rowsOf(await zcql.executeZCQLQuery(query), "Stock_Movements");
}

function netReservedForReference(movements) {
  let net = 0;
  for (const movement of movements || []) {
    const qty = num(movement.quantity);
    const type = String(movement.movement_type || "").toUpperCase();
    if (type === "ORDER_RESERVATION" || type === "RESERVE") {
      net += qty;
    } else if (type === "ORDER_RELEASE") {
      net -= qty;
    }
  }
  return Math.max(0, net);
}

async function atomicReserveOnRow(app, row, { quantity, referenceType, referenceId, warehouseId }) {
  const zcql = app.zcql();
  const inventoryId = String(row.ROWID);
  return withInventoryRowLock(app, inventoryId, async () => {
    const fresh = await loadInventoryRow(zcql, { inventoryId });
    if (!fresh) {
      const error = new Error("Inventory row not found");
      error.status = 404;
      throw error;
    }
    validateInventoryInvariants(fresh, "pre-reserve");

    const refType = referenceType || "ORDER";
    const existing = await reservationMovementsForReference(zcql, refType, referenceId, inventoryId);
    const already = netReservedForReference(existing);
    const need = Math.max(1, Math.round(num(quantity)));
    if (referenceId && already >= need) {
      return {
        inventory_id: inventoryId,
        quantity: need,
        warehouse_id: String(fresh.warehouse_id),
        idempotent: true,
        already_reserved: already,
      };
    }
    if (referenceId && already > 0 && already < need) {
      const error = new Error("Partial reservation already exists for this reference");
      error.status = 409;
      error.code = "PARTIAL_RESERVATION_EXISTS";
      throw error;
    }

    const open = availableOf(fresh);
    if (open < need) {
      const error = new Error(
        warehouseId
          ? "Insufficient stock at the selected fulfillment warehouse. Another shopper may have taken the last unit — refresh delivery options or try another mode."
          : "Insufficient stock"
      );
      error.status = 409;
      error.code = "INSUFFICIENT_STOCK";
      throw error;
    }

    const beforeReserved = num(fresh.quantity_reserved);
    const nextReserved = beforeReserved + need;
    if (nextReserved + num(fresh.quantity_committed) > num(fresh.quantity_on_hand)) {
      const error = new Error("Insufficient stock after concurrency check");
      error.status = 409;
      error.code = "INSUFFICIENT_STOCK";
      throw error;
    }

    await app.datastore().table("Inventory").updateRow({
      ROWID: fresh.ROWID,
      quantity_reserved: nextReserved,
    });

    const afterRow = {
      ...fresh,
      quantity_reserved: nextReserved,
    };
    validateInventoryInvariants(afterRow, "post-reserve");

    await writeMovement(app, {
      inventory_id: fresh.ROWID,
      warehouse_id: fresh.warehouse_id,
      product_id: fresh.product_id,
      variant_id: fresh.variant_id,
      movement_type: "ORDER_RESERVATION",
      quantity: need,
      before_quantity: num(fresh.quantity_on_hand),
      after_quantity: num(fresh.quantity_on_hand),
      reference_type: refType,
      reference_id: referenceId || null,
      notes: warehouseId ? "Reserved QC stock at warehouse" : "Reserved stock",
      performed_by: "SYSTEM",
    });

    return {
      inventory_id: inventoryId,
      quantity: need,
      warehouse_id: String(fresh.warehouse_id),
      idempotent: false,
    };
  });
}

async function atomicReleaseOnRow(app, movement, referenceId, reason) {
  const zcql = app.zcql();
  const inventoryId = String(movement.inventory_id);
  return withInventoryRowLock(app, inventoryId, async () => {
    const inventory = await loadInventoryRow(zcql, { inventoryId });
    if (!inventory) {
      return { skipped: true };
    }
    validateInventoryInvariants(inventory, "pre-release");
    const released = num(movement.quantity);
    const nextReserved = Math.max(0, num(inventory.quantity_reserved) - released);
    await app.datastore().table("Inventory").updateRow({
      ROWID: inventory.ROWID,
      quantity_reserved: nextReserved,
    });
    validateInventoryInvariants(
      { ...inventory, quantity_reserved: nextReserved },
      "post-release"
    );
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
    return { released: released };
  });
}

async function atomicCommitOnRow(app, movement, referenceId) {
  const zcql = app.zcql();
  const inventoryId = String(movement.inventory_id);
  return withInventoryRowLock(app, inventoryId, async () => {
    const inventory = await loadInventoryRow(zcql, { inventoryId });
    if (!inventory) {
      throw Object.assign(new Error("Reserved inventory is missing; reconciliation required"), { status: 409 });
    }
    validateInventoryInvariants(inventory, "pre-commit");
    const qty = num(movement.quantity);
    if (num(inventory.quantity_reserved) < qty) {
      const error = new Error("Cannot commit more than reserved quantity");
      error.status = 409;
      error.code = "COMMIT_EXCEEDS_RESERVED";
      throw error;
    }
    const before = num(inventory.quantity_on_hand);
    const after = Math.max(0, before - qty);
    const nextReserved = Math.max(0, num(inventory.quantity_reserved) - qty);
    const nextCommitted = num(inventory.quantity_committed) + qty;
    // Persist intent before the stock write. An interrupted write must not be replayed blindly.
    const journal = await writeMovement(app, {
      ...movement, movement_type: "COMMIT_PENDING", quantity: qty,
      before_quantity: before, after_quantity: after,
      reference_type: "ORDER", reference_id: referenceId,
      notes: "Pending stock commit; reconcile before retry if interrupted",
    });
    await app.datastore().table("Inventory").updateRow({
      ROWID: inventory.ROWID,
      quantity_on_hand: after,
      quantity_reserved: nextReserved,
      quantity_committed: nextCommitted,
    });
    validateInventoryInvariants(
      {
        ...inventory,
        quantity_on_hand: after,
        quantity_reserved: nextReserved,
        quantity_committed: nextCommitted,
      },
      "post-commit"
    );
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
    await app.datastore().table("Stock_Movements").updateRow({
      ROWID: journal.ROWID || journal.rowid, movement_type: "COMMIT_DONE",
    });
    return { committed: qty };
  });
}

async function ensureInventoryRow(app, { warehouseId, productId, variantId }) {
  const zcql = app.zcql();
  const identity = { warehouseId, productId, variantId };
  const key = inventoryIdentityKey(warehouseId, productId, variantId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let rows = await loadInventoryRowsByIdentity(zcql, identity);
    if (rows.length > 0) {
      if (rows.length > 1) {
        console.warn(
          "[inventory-ops] duplicate inventory rows for " +
            key +
            ": " +
            rows.map((row) => String(row.ROWID)).join(", ")
        );
      }
      return pickCanonicalInventoryRow(rows);
    }

    if (attempt < 2) {
      try {
        await app.datastore().table("Inventory").insertRow({
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
      } catch (error) {
        console.warn(
          "[inventory-ops] inventory insert attempt failed for " + key + ": " + (error.message || error)
        );
      }
    }
  }

  const rows = await loadInventoryRowsByIdentity(zcql, identity);
  if (!rows.length) {
    const error = new Error("Inventory row could not be created");
    error.status = 500;
    error.code = "INVENTORY_CREATE_FAILED";
    throw error;
  }
  if (rows.length > 1) {
    console.warn(
      "[inventory-ops] concurrent duplicate inventory rows for " +
        key +
        ": " +
        rows.map((row) => String(row.ROWID)).join(", ")
    );
  }
  return pickCanonicalInventoryRow(rows);
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
  return withInventoryRowLock(app, String(row.ROWID), async () => {
    row = await loadInventoryRow(zcql, { inventoryId: String(row.ROWID) });
    validateInventoryInvariants(row, "pre-adjust");
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
    validateInventoryInvariants({ ...row, quantity_on_hand: after }, "post-adjust");
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
  });
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
    reference_type: body.reference_type || "ADMIN",
    reference_id: body.reference_id || null,
    notes: body.notes || "Absolute stock set",
    performed_by: actor || "ADMIN",
  });
  return { inventory_id: String(row.ROWID), before_quantity: before, after_quantity: target };
}

async function reserveStock(app, { productId, variantId, quantity, referenceType, referenceId, warehouseId }) {
  const zcql = app.zcql();
  const need = Math.max(1, Math.round(num(quantity)));
  let rows = [];

  if (warehouseId) {
    const canonical = await loadInventoryRowByIdentity(zcql, {
      warehouseId,
      productId,
      variantId,
    });
    if (canonical) {
      rows = [canonical];
    }
  } else {
    let query =
      "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, allow_negative FROM Inventory WHERE product_id = " +
      asId(productId, "product_id") +
      " AND is_active = true AND status = 'ACTIVE'";
    if (variantId) {
      query += " AND variant_id = " + asId(variantId, "variant_id");
    }
    rows = dedupeToCanonicalInventoryRows(rowsOf(await zcql.executeZCQLQuery(query), "Inventory"));
  }

  if (!rows.length) {
    const error = new Error(
      warehouseId
        ? "Insufficient stock at the selected fulfillment warehouse. Another shopper may have taken the last unit — refresh delivery options or try another mode."
        : "Insufficient stock"
    );
    error.status = 409;
    error.code = "INSUFFICIENT_STOCK";
    throw error;
  }

  let remaining = need;
  const reserved = [];
  for (const candidate of rows) {
    if (remaining < 1) {
      break;
    }
    if (warehouseId && String(candidate.warehouse_id) !== String(warehouseId)) {
      continue;
    }
    const result = await atomicReserveOnRow(app, candidate, {
      quantity: remaining,
      referenceType,
      referenceId,
      warehouseId,
    });
    reserved.push({
      inventory_id: result.inventory_id,
      quantity: result.quantity,
      warehouse_id: result.warehouse_id,
      idempotent: result.idempotent === true,
    });
    remaining -= result.quantity;
  }

  if (remaining > 0) {
    if (referenceId) {
      try {
        await releaseReservation(app, referenceId, "Rolled back after concurrent stock conflict");
      } catch (_) {}
    }
    const error = new Error(
      "Item became unavailable during checkout. Quick Commerce stock changed — refresh delivery options."
    );
    error.status = 409;
    error.code = "STOCK_RACE_CONFLICT";
    throw error;
  }

  return { reserved, quantity: need };
}

async function releaseReservation(app, referenceId, reason) {
  const zcql = app.zcql();
  const refId = asId(referenceId, "reference_id");
  const alreadyReleased = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        refId +
        " AND movement_type = 'ORDER_RELEASE'"
    ),
    "Stock_Movements"
  );
  if (alreadyReleased.length > 0) {
    return { released: true, reference_id: String(referenceId), already_released: true };
  }

  const movements = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        refId +
        " AND (movement_type = 'ORDER_RESERVATION' OR movement_type = 'RESERVE')"
    ),
    "Stock_Movements"
  );
  for (const movement of movements) {
    await atomicReleaseOnRow(app, movement, referenceId, reason);
  }
  return {
    released: true,
    reference_id: String(referenceId),
    movement_count: movements.length,
  };
}

async function commitReservation(app, referenceId) {
  const zcql = app.zcql();
  const refId = asId(referenceId, "reference_id");
  const alreadyCommitted = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        refId +
        " AND movement_type = 'SALE'"
    ),
    "Stock_Movements"
  );
  const movements = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        refId +
        " AND (movement_type = 'ORDER_RESERVATION' OR movement_type = 'RESERVE')"
    ),
    "Stock_Movements"
  );
  const totals = new Map();
  for (const movement of movements) {
    const key = String(movement.inventory_id);
    const prior = totals.get(key);
    totals.set(key, { ...movement, quantity: num(prior?.quantity) + num(movement.quantity) });
  }
  const pending = rowsOf(await zcql.executeZCQLQuery(
    "SELECT ROWID, inventory_id FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
    refId + " AND movement_type = 'COMMIT_PENDING'"), "Stock_Movements");
  let committedCount = 0;
  for (const [key, movement] of totals) {
    const sold = alreadyCommitted.filter(row => String(row.inventory_id) === key)
      .reduce((sum, row) => sum + num(row.quantity), 0);
    if (sold === movement.quantity) continue;
    if (sold > movement.quantity || pending.some(row => String(row.inventory_id) === key)) {
      throw Object.assign(new Error("Stock commit requires reconciliation before retry"), {
        status: 409, code: "STOCK_COMMIT_UNCERTAIN",
      });
    }
    await atomicCommitOnRow(app, { ...movement, quantity: movement.quantity - sold }, referenceId);
    committedCount++;
  }
  return {
    committed: true,
    reference_id: String(referenceId),
    movement_count: movements.length,
    already_committed: committedCount === 0,
  };
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
  aggregateAvailable,
  availableInWarehouses,
  queryInventoryForProduct,
  totalAvailableForProduct,
  loadInventoryRow,
  resolveWarehouse,
  ensureInventoryRow,
  adjustStock,
  setAbsoluteStock,
  reserveStock,
  releaseReservation,
  commitReservation,
  transferStock,
  validateInventoryInvariants,
};
