"use strict";

const { asId, optionalText, rowOf, rowsOf, num, sqlString, isTruthy } = require("./http");

const QC_WAREHOUSE_TYPES = new Set(["DARK_STORE", "QUICK_COMMERCE"]);
const CENTRAL_WAREHOUSE_TYPES = new Set(["CENTRAL", "STANDARD", "HQ"]);
const ALLOWED_WAREHOUSE_TYPES = new Set([
  ...QC_WAREHOUSE_TYPES,
  ...CENTRAL_WAREHOUSE_TYPES,
]);

function fail(message, status, code) {
  const error = new Error(message);
  error.status = status || 400;
  error.code = code || "VALIDATION_ERROR";
  throw error;
}

function normalizeWarehouseCode(code) {
  const text = String(code || "").trim().toUpperCase();
  if (!text) {
    fail("Warehouse code is required", 400, "INVALID_WAREHOUSE_CODE");
  }
  if (text.length > 30) {
    fail("Warehouse code must be at most 30 characters", 400, "INVALID_WAREHOUSE_CODE");
  }
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(text)) {
    fail(
      "Warehouse code must use letters, numbers, hyphen, or underscore",
      400,
      "INVALID_WAREHOUSE_CODE"
    );
  }
  return text;
}

function normalizeWarehouseType(type) {
  const value = String(type || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (!value) {
    return "";
  }
  if (!ALLOWED_WAREHOUSE_TYPES.has(value)) {
    fail("Invalid warehouse type: " + value, 400, "INVALID_WAREHOUSE_TYPE");
  }
  return value;
}

function warehouseTypeFromRow(row) {
  if (isTruthy(row.is_default) || String(row.code || "").toUpperCase() === "HQ") {
    return "CENTRAL";
  }
  if (row.outlet_id) {
    return "DARK_STORE";
  }
  return "WAREHOUSE";
}

function roleFlagsFromType(type) {
  const normalized = normalizeWarehouseType(type);
  if (QC_WAREHOUSE_TYPES.has(normalized)) {
    return { is_default: false, requires_outlet: true, type: normalized };
  }
  return { is_default: true, requires_outlet: false, type: normalized };
}

function boolValue(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return isTruthy(value);
}

function mapOutletSummary(outlet) {
  if (!outlet) {
    return null;
  }
  return {
    id: String(outlet.ROWID),
    name: outlet.name || "",
    code: outlet.code || "",
    city: outlet.city || "",
    state: outlet.state || "",
    latitude: outlet.latitude != null ? String(outlet.latitude) : "",
    longitude: outlet.longitude != null ? String(outlet.longitude) : "",
    store_type: outlet.store_type || "",
    delivery_enabled: isTruthy(outlet.delivery_enabled),
    service_radius_km:
      outlet.service_radius_km != null ? num(outlet.service_radius_km) : null,
    opening_time: outlet.opening_time || "",
    closing_time: outlet.closing_time || "",
    is_active: isTruthy(outlet.is_active),
  };
}

function mapAdminWarehouse(row, outlet) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.ROWID),
    code: row.code || "",
    name: row.name || "",
    type: warehouseTypeFromRow(row),
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    outlet_name: outlet ? outlet.name || "" : "",
    is_default: isTruthy(row.is_default),
    is_active: isTruthy(row.is_active),
    city: row.city || "",
    state: row.state || "",
    outlet: mapOutletSummary(outlet),
  };
}

async function loadWarehouseRow(zcql, warehouseId, { includeInactive = true } = {}) {
  let query =
    "SELECT ROWID, name, code, outlet_id, address_line1, city, state, is_active, is_default FROM Warehouses WHERE ROWID = " +
    asId(warehouseId, "warehouse_id");
  if (!includeInactive) {
    query += " AND is_active = true";
  }
  return rowOf(await zcql.executeZCQLQuery(query), "Warehouses");
}

async function loadWarehouseByCode(zcql, code, { excludeId = "" } = {}) {
  let query =
    "SELECT ROWID, name, code, outlet_id, address_line1, city, state, is_active, is_default FROM Warehouses WHERE code = " +
    sqlString(code);
  if (excludeId) {
    query += " AND ROWID != " + asId(excludeId, "warehouse_id");
  }
  return rowOf(await zcql.executeZCQLQuery(query), "Warehouses");
}

async function loadOutletRow(zcql, outletId) {
  if (!outletId) {
    return null;
  }
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, code, city, state, latitude, longitude, opening_time, closing_time, is_active, delivery_enabled, service_radius_km, store_type FROM Outlets WHERE ROWID = " +
          asId(outletId, "outlet_id")
      ),
      "Outlets"
    );
  } catch (_) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, code, city, state, latitude, longitude, opening_time, closing_time, is_active FROM Outlets WHERE ROWID = " +
          asId(outletId, "outlet_id")
      ),
      "Outlets"
    );
  }
}

async function findDefaultWarehouse(zcql, excludeId) {
  let query =
    "SELECT ROWID, code, name FROM Warehouses WHERE is_default = true AND is_active = true";
  if (excludeId) {
    query += " AND ROWID != " + asId(excludeId, "warehouse_id");
  }
  return rowOf(await zcql.executeZCQLQuery(query), "Warehouses");
}

async function assertOutletLink(zcql, outletId, { required }) {
  if (!outletId) {
    if (required) {
      fail("outlet_id is required for Quick Commerce warehouses", 400, "OUTLET_REQUIRED");
    }
    return null;
  }
  const outlet = await loadOutletRow(zcql, outletId);
  if (!outlet) {
    fail("Linked outlet not found", 404, "OUTLET_NOT_FOUND");
  }
  if (!isTruthy(outlet.is_active)) {
    fail("Linked outlet is inactive", 409, "OUTLET_INACTIVE");
  }
  return outlet;
}

function buildWarehousePayload(body, role) {
  const name = optionalText(body.name, "name", 160);
  if (!name) {
    fail("Warehouse name is required", 400, "INVALID_PAYLOAD");
  }
  const payload = {
    name,
    code: normalizeWarehouseCode(body.code),
    is_default: role.is_default,
    is_active: boolValue(body.is_active, true),
    outlet_id: role.requires_outlet
      ? body.outlet_id
        ? asId(body.outlet_id, "outlet_id")
        : null
      : body.outlet_id
        ? asId(body.outlet_id, "outlet_id")
        : null,
    address_line1: optionalText(body.address_line1, "address_line1", 255) || null,
    city: optionalText(body.city, "city", 100) || null,
    state: optionalText(body.state, "state", 100) || null,
  };
  if (role.requires_outlet && !payload.outlet_id) {
    fail("outlet_id is required for Quick Commerce warehouses", 400, "OUTLET_REQUIRED");
  }
  return payload;
}

async function upsertWarehouse(app, body) {
  const zcql = app.zcql();
  const warehouseId =
    body.id || body.warehouse_id ? asId(body.warehouse_id || body.id, "warehouse_id") : "";
  const isUpdate = Boolean(warehouseId);
  const typeInput = body.type || body.warehouse_type || "";
  if (!isUpdate && !typeInput) {
    fail("Warehouse type is required", 400, "INVALID_WAREHOUSE_TYPE");
  }

  let existing = null;
  if (isUpdate) {
    existing = await loadWarehouseRow(zcql, warehouseId, { includeInactive: true });
    if (!existing) {
      fail("Warehouse not found", 404, "WAREHOUSE_NOT_FOUND");
    }
  }

  let role;
  if (isUpdate && !typeInput) {
    role = {
      is_default: isTruthy(existing.is_default),
      requires_outlet: !isTruthy(existing.is_default),
      type: warehouseTypeFromRow(existing),
    };
  } else {
    role = roleFlagsFromType(typeInput);
  }

  const effectiveBody = { ...body };
  if (isUpdate) {
    if (body.code === undefined) {
      effectiveBody.code = existing.code;
    }
    if (
      (body.outlet_id === undefined ||
        body.outlet_id === null ||
        String(body.outlet_id).trim() === "") &&
      existing.outlet_id
    ) {
      effectiveBody.outlet_id = String(existing.outlet_id);
    }
  }

  const payload = buildWarehousePayload(effectiveBody, role);

  const duplicate = await loadWarehouseByCode(zcql, payload.code, {
    excludeId: warehouseId || "",
  });
  if (duplicate) {
    fail("Warehouse code already exists: " + payload.code, 409, "DUPLICATE_WAREHOUSE_CODE");
  }

  if (payload.is_default) {
    const otherDefault = await findDefaultWarehouse(zcql, warehouseId || "");
    if (otherDefault) {
      fail(
        "Another default warehouse already exists: " + (otherDefault.code || otherDefault.ROWID),
        409,
        "DUPLICATE_DEFAULT_WAREHOUSE"
      );
    }
  }

  const outlet = await assertOutletLink(zcql, payload.outlet_id, {
    required: role.requires_outlet,
  });

  if (isUpdate) {
    await app.datastore().table("Warehouses").updateRow({
      ROWID: warehouseId,
      ...payload,
    });
    const updated = await loadWarehouseRow(zcql, warehouseId, { includeInactive: true });
    return {
      action: "updated",
      warehouse: mapAdminWarehouse(updated, outlet || (updated.outlet_id ? await loadOutletRow(zcql, updated.outlet_id) : null)),
    };
  }

  const inserted = await app.datastore().table("Warehouses").insertRow(payload);
  const rowId = String(inserted.ROWID || inserted.rowid || "");
  const created = await loadWarehouseRow(zcql, rowId, { includeInactive: true });
  return {
    action: "created",
    warehouse: mapAdminWarehouse(created, outlet),
  };
}

async function listAdminWarehouses(app, { activeOnly = false } = {}) {
  const zcql = app.zcql();
  let query =
    "SELECT ROWID, name, code, outlet_id, address_line1, city, state, is_active, is_default FROM Warehouses";
  if (activeOnly) {
    query += " WHERE is_active = true";
  }
  query += " ORDER BY code ASC";
  const warehouses = rowsOf(await zcql.executeZCQLQuery(query), "Warehouses");
  const outlets = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, code, city, state, latitude, longitude, opening_time, closing_time, is_active, delivery_enabled, service_radius_km, store_type FROM Outlets"
    ),
    "Outlets"
  );
  const outletMap = new Map(outlets.map((row) => [String(row.ROWID), row]));
  return warehouses.map((row) =>
    mapAdminWarehouse(row, row.outlet_id ? outletMap.get(String(row.outlet_id)) : null)
  );
}

async function getAdminWarehouse(app, warehouseId) {
  const zcql = app.zcql();
  const row = await loadWarehouseRow(zcql, warehouseId, { includeInactive: true });
  if (!row) {
    fail("Warehouse not found", 404, "WAREHOUSE_NOT_FOUND");
  }
  const outlet = row.outlet_id ? await loadOutletRow(zcql, row.outlet_id) : null;
  return mapAdminWarehouse(row, outlet);
}

async function setWarehouseStatus(app, warehouseId, active) {
  const zcql = app.zcql();
  const existing = await loadWarehouseRow(zcql, warehouseId, { includeInactive: true });
  if (!existing) {
    fail("Warehouse not found", 404, "WAREHOUSE_NOT_FOUND");
  }
  await app.datastore().table("Warehouses").updateRow({
    ROWID: warehouseId,
    is_active: active,
  });
  const updated = await loadWarehouseRow(zcql, warehouseId, { includeInactive: true });
  const outlet = updated.outlet_id ? await loadOutletRow(zcql, updated.outlet_id) : null;
  return mapAdminWarehouse(updated, outlet);
}

module.exports = {
  ALLOWED_WAREHOUSE_TYPES,
  QC_WAREHOUSE_TYPES,
  CENTRAL_WAREHOUSE_TYPES,
  normalizeWarehouseCode,
  normalizeWarehouseType,
  warehouseTypeFromRow,
  roleFlagsFromType,
  mapAdminWarehouse,
  mapOutletSummary,
  upsertWarehouse,
  listAdminWarehouses,
  getAdminWarehouse,
  setWarehouseStatus,
  loadWarehouseByCode,
};
