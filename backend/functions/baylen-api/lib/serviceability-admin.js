"use strict";

const { rowOf, rowsOf, sqlString, asId, num, isTruthy } = require("./http");
const { normalizePincode } = require("./pincode");

function mapServiceabilityRecord(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.ROWID),
    pincode: row.pincode || "",
    city: row.city || "",
    state: row.state || "",
    country: row.country || "India",
    region: row.delivery_zone || row.region || "",
    estimated_delivery_days: num(row.estimated_delivery_days),
    delivery_zone: row.delivery_zone || "",
    warehouse_id: row.warehouse_id ? String(row.warehouse_id) : null,
    outlet_id: row.outlet_id ? String(row.outlet_id) : null,
    is_active: isTruthy(row.is_active),
  };
}

async function listServiceableRegions(zcql, filters = {}) {
  let query =
    "SELECT ROWID, pincode, city, state, country, estimated_delivery_days, delivery_zone, is_active FROM Serviceable_Pincodes";
  const clauses = [];
  if (filters.active_only === true || filters.active_only === "true") {
    clauses.push("is_active = true");
  }
  if (filters.pincode) {
    clauses.push("pincode = " + sqlString(normalizePincode(filters.pincode)));
  }
  if (filters.city) {
    clauses.push("city = " + sqlString(String(filters.city).trim()));
  }
  if (filters.state) {
    clauses.push("state = " + sqlString(String(filters.state).trim()));
  }
  if (clauses.length) {
    query += " WHERE " + clauses.join(" AND ");
  }
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Serviceable_Pincodes");
  return rows.map(mapServiceabilityRecord);
}

async function getServiceableRegion(zcql, id) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, pincode, city, state, country, estimated_delivery_days, delivery_zone, is_active FROM Serviceable_Pincodes WHERE ROWID = " +
        asId(id, "id")
    ),
    "Serviceable_Pincodes"
  );
  return mapServiceabilityRecord(row);
}

async function findServiceableByPincode(zcql, pincode) {
  const normalized = normalizePincode(pincode);
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, pincode, city, state, country, estimated_delivery_days, delivery_zone, is_active FROM Serviceable_Pincodes WHERE pincode = " +
        sqlString(normalized)
    ),
    "Serviceable_Pincodes"
  );
  return mapServiceabilityRecord(row);
}

async function validateServiceabilityReferences(zcql, body) {
  const errors = [];
  if (body.warehouse_id) {
    const wh = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Warehouses WHERE ROWID = " +
          asId(body.warehouse_id, "warehouse_id") +
          " AND is_active = true"
      ),
      "Warehouses"
    );
    if (!wh) {
      errors.push({ field: "warehouse_id", code: "WAREHOUSE_NOT_FOUND", message: "Warehouse not found" });
    }
  }
  if (body.outlet_id) {
    const outlet = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Outlets WHERE ROWID = " + asId(body.outlet_id, "outlet_id") + " AND is_active = true"
      ),
      "Outlets"
    );
    if (!outlet) {
      errors.push({ field: "outlet_id", code: "OUTLET_NOT_FOUND", message: "Outlet not found" });
    }
  }
  return errors;
}

async function upsertServiceableRegion(app, body) {
  const zcql = app.zcql();
  const pincode = normalizePincode(body.pincode);
  const errors = await validateServiceabilityReferences(zcql, body);
  if (errors.length) {
    const error = new Error(errors.map((item) => item.message).join("; "));
    error.status = 400;
    error.code = errors[0].code;
    error.details = errors;
    throw error;
  }

  const existing = await findServiceableByPincode(zcql, pincode);
  const payload = {
    pincode,
    city: String(body.city || "").trim(),
    state: String(body.state || "").trim(),
    country: String(body.country || "India").trim(),
    estimated_delivery_days: Math.max(0, Math.round(num(body.estimated_delivery_days) || 3)),
    delivery_zone: String(body.delivery_zone || body.region || "").trim(),
    is_active: body.is_active === false || body.is_active === "false" ? false : true,
  };

  if (existing && body.id && String(body.id) !== existing.id) {
    const error = new Error("Duplicate pincode: " + pincode);
    error.status = 409;
    error.code = "DUPLICATE_PINCODE";
    throw error;
  }

  if (existing) {
    await app.datastore().table("Serviceable_Pincodes").updateRow({
      ROWID: existing.id,
      ...payload,
    });
    return { action: "UPDATE", region: { ...existing, ...payload, id: existing.id } };
  }

  const inserted = await app.datastore().table("Serviceable_Pincodes").insertRow(payload);
  const id = inserted && inserted.ROWID ? String(inserted.ROWID) : inserted;
  return { action: "CREATE", region: { id: String(id), ...payload } };
}

async function deactivateServiceableRegion(app, id) {
  const zcql = app.zcql();
  const existing = await getServiceableRegion(zcql, id);
  if (!existing) {
    const error = new Error("Serviceable region not found");
    error.status = 404;
    throw error;
  }
  await app.datastore().table("Serviceable_Pincodes").updateRow({
    ROWID: id,
    is_active: false,
  });
  return { ...existing, is_active: false };
}

/**
 * Serviceability precedence (documented):
 * 1. Geographic Quick serviceability (Haversine + outlet hours + radius) — authoritative for Quick
 * 2. Pincode/region eligibility — additive for Standard pincode messaging, not a Quick override
 * 3. Outlet active + delivery_enabled + store_type
 */
function evaluateServiceabilityPrecedence({ geoQuickServiceable, pincodeServiceable, outletActive, deliveryEnabled }) {
  return {
    quick_allowed: geoQuickServiceable === true && outletActive !== false && deliveryEnabled !== false,
    standard_pincode_allowed: pincodeServiceable === true,
    pincode_overrides_geo: false,
  };
}

module.exports = {
  listServiceableRegions,
  getServiceableRegion,
  findServiceableByPincode,
  upsertServiceableRegion,
  deactivateServiceableRegion,
  evaluateServiceabilityPrecedence,
  mapServiceabilityRecord,
};
