"use strict";

/**
 * Catalog/cart availability helpers — delegates to batch engine (Phase 5.8).
 */

const { aggregateAvailable, totalAvailableForProduct } = require("./inventory-ops");
const { evaluateProductAvailability } = require("./fulfillment-engine");
const {
  buildCatalogAvailability,
  buildCatalogAvailabilityBatch,
} = require("./catalog-batch-availability");
const { mapProductModeFlags, parseLocation } = require("./catalog-availability-shared");

async function loadWarehouseTopology(zcql) {
  const { loadFulfillmentTopology } = require("./fulfillment-topology");
  const topology = await loadFulfillmentTopology(zcql);
  return {
    centralIds: topology.centralWarehouseIds,
    qcIds: topology.qcWarehouses.map((row) => String(row.ROWID)),
  };
}

async function canFulfillQuantity(
  app,
  { productId, variantId = null, quantity, latitude = null, longitude = null }
) {
  const need = Math.max(1, Math.round(Number(quantity) || 1));
  const location = parseLocation(latitude, longitude);

  if (location) {
    const availability = await evaluateProductAvailability(app, {
      productId,
      variantId,
      quantity: need,
      latitude: location.latitude,
      longitude: location.longitude,
    });
    return (
      availability.quick_commerce?.available === true ||
      availability.standard_ecommerce?.available === true
    );
  }

  const total = await totalAvailableForProduct(app.zcql(), productId, variantId);
  return total >= need;
}

module.exports = {
  buildCatalogAvailability,
  buildCatalogAvailabilityBatch,
  canFulfillQuantity,
  mapProductModeFlags,
  parseLocation,
  loadWarehouseTopology,
};
