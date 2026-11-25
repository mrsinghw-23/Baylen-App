"use strict";

const { rowOf, rowsOf, isTruthy } = require("./http");

const OUTLET_SELECT_EXTENDED =
  "ROWID, name, address_line1, city, state, latitude, longitude, opening_time, closing_time, is_active, delivery_enabled, service_radius_km, store_type";
const OUTLET_SELECT_BASIC =
  "ROWID, name, address_line1, city, state, latitude, longitude, opening_time, closing_time, is_active";

async function loadWarehouses(zcql) {
  return rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, code, outlet_id, address_line1, city, state, is_active, is_default FROM Warehouses WHERE is_active = true"
    ),
    "Warehouses"
  );
}

async function loadActiveOutlets(zcql) {
  try {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " + OUTLET_SELECT_EXTENDED + " FROM Outlets WHERE is_active = true"
      ),
      "Outlets"
    );
  } catch (_) {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " + OUTLET_SELECT_BASIC + " FROM Outlets WHERE is_active = true"
      ),
      "Outlets"
    );
  }
}

function indexOutletsById(outlets) {
  const map = new Map();
  for (const outlet of outlets || []) {
    map.set(String(outlet.ROWID), outlet);
  }
  return map;
}

function centralWarehousesFromList(warehouses) {
  const defaults = (warehouses || []).filter(
    (row) => isTruthy(row.is_default) || String(row.code || "").toUpperCase() === "HQ"
  );
  return defaults.length ? defaults : warehouses || [];
}

/**
 * Request-scoped fulfillment topology. Not globally mutable.
 */
async function loadFulfillmentTopology(zcql) {
  const warehouses = await loadWarehouses(zcql);
  const outlets = await loadActiveOutlets(zcql);
  const outletsById = indexOutletsById(outlets);
  const central = centralWarehousesFromList(warehouses);
  const centralIds = central.map((row) => String(row.ROWID));
  const qcWarehouses = warehouses.filter(
    (row) => row.outlet_id && !centralIds.includes(String(row.ROWID))
  );
  return {
    warehouses,
    outletsById,
    centralWarehouses: central,
    centralWarehouseIds: centralIds,
    qcWarehouses,
  };
}

function maxServiceRadiusKm(outletsById, warehouses, defaultRadiusKm) {
  let maxRadius = Number(defaultRadiusKm) || 3;
  for (const wh of warehouses || []) {
    const outlet = wh.outlet_id ? outletsById.get(String(wh.outlet_id)) : null;
    const configured = Number(outlet && outlet.service_radius_km);
    if (Number.isFinite(configured) && configured > maxRadius) {
      maxRadius = configured;
    }
  }
  return maxRadius;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Cheap bounding-box pre-filter before exact Haversine.
 * Box is sized from the largest configured service radius so we never false-negative.
 */
function passesBoundingBox(latitude, longitude, outletLat, outletLng, maxRadiusKm) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const oLat = Number(outletLat);
  const oLng = Number(outletLng);
  if (![lat, lng, oLat, oLng].every((value) => Number.isFinite(value))) {
    return false;
  }
  const radius = Math.max(1, Number(maxRadiusKm) || 3);
  const latDelta = radius / 111;
  const lngScale = Math.max(0.2, Math.cos(toRad(lat)));
  const lngDelta = radius / (111 * lngScale);
  return Math.abs(oLat - lat) <= latDelta && Math.abs(oLng - lng) <= lngDelta;
}

function getOutletFromTopology(topology, outletId) {
  if (!outletId) {
    return null;
  }
  return topology.outletsById.get(String(outletId)) || null;
}

module.exports = {
  loadWarehouses,
  loadActiveOutlets,
  loadFulfillmentTopology,
  indexOutletsById,
  maxServiceRadiusKm,
  passesBoundingBox,
  getOutletFromTopology,
};
