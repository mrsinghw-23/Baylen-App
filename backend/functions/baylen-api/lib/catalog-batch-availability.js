"use strict";

const { num } = require("./http");
const { aggregateAvailable, availableInWarehouses } = require("./inventory-ops");
const { loadFulfillmentTopology } = require("./fulfillment-topology");
const {
  buildDarkStoreCandidatesFromTopology,
  evaluateFulfillmentLine,
  loadProductsByIds,
  inventoryForProductIds,
  inventoryRowsForItem,
} = require("./fulfillment-engine");
const { mapProductModeFlags, parseLocation } = require("./catalog-availability-shared");

function toCatalogAvailabilityFields(line, totalAvailable, productFlags) {
  return {
    available_quantity: totalAvailable,
    quick_available: line.quick_commerce?.available === true,
    standard_available: line.standard_ecommerce?.available === true,
    quick_available_quantity: num(line.quick_commerce?.available_quantity),
    quick_eta: line.quick_commerce?.eta_label || "",
    standard_available_quantity: num(line.standard_ecommerce?.available_quantity),
    standard_eta: line.standard_ecommerce?.eta_label || "",
    ...productFlags,
  };
}

/**
 * Batch catalog availability — one topology + batched product/inventory load.
 * items: [{ product_id, variant_id?, quantity? }]
 */
async function buildCatalogAvailabilityBatch(app, { items, latitude = null, longitude = null, now = undefined }) {
  const zcql = app.zcql();
  const location = parseLocation(latitude, longitude);
  const darkStoreOptions = now != null ? { now } : {};
  const normalizedItems = (items || []).map((item) => ({
    product_id: String(item.product_id),
    variant_id: item.variant_id ? String(item.variant_id) : null,
    quantity: Math.max(1, Math.round(num(item.quantity) || 1)),
  }));

  if (!normalizedItems.length) {
    return { items: [], query_stats: { warehouse_queries: 0, outlet_queries: 0, product_queries: 0, inventory_queries: 0, total: 0 } };
  }

  const stats = { warehouse_queries: 0, outlet_queries: 0, product_queries: 0, inventory_queries: 0, total: 0 };

  let topology = null;
  let darkStores = [];
  if (location) {
    topology = await loadFulfillmentTopology(zcql);
    stats.warehouse_queries += 1;
    stats.outlet_queries += 1;
    stats.total += 2;
    darkStores = buildDarkStoreCandidatesFromTopology(
      topology,
      location.latitude,
      location.longitude,
      darkStoreOptions
    );
  }

  const productIds = [...new Set(normalizedItems.map((item) => item.product_id))];
  const productsById = await loadProductsByIds(zcql, productIds);
  stats.product_queries += productIds.length ? 1 : 0;
  stats.total += productIds.length ? 1 : 0;

  const inventoryRows = await inventoryForProductIds(zcql, productIds);
  stats.inventory_queries += productIds.length ? 1 : 0;
  stats.total += productIds.length ? 1 : 0;

  if (!topology) {
    topology = await loadFulfillmentTopology(zcql);
    stats.warehouse_queries += 1;
    stats.outlet_queries += 1;
    stats.total += 2;
  }

  const results = [];
  for (const item of normalizedItems) {
    const product = productsById.get(item.product_id);
    const invRows = inventoryRowsForItem(inventoryRows, item.product_id, item.variant_id);
    const invForTotal = item.variant_id
      ? invRows.filter((row) => String(row.variant_id) === String(item.variant_id))
      : invRows;
    const totalAvailable = aggregateAvailable(invForTotal.length ? invForTotal : invRows);

    if (location) {
      const line = evaluateFulfillmentLine({
        product,
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: item.quantity,
        hasLocation: true,
        darkStores,
        topology,
        invRows,
        latitude: location.latitude,
        longitude: location.longitude,
      });
      results.push({
        product_id: item.product_id,
        variant_id: item.variant_id,
        ...toCatalogAvailabilityFields(line, totalAvailable, mapProductModeFlags(product)),
      });
      continue;
    }

    const centralIds = topology.centralWarehouseIds;
    const standardQty = availableInWarehouses(invRows, centralIds);
    results.push({
      product_id: item.product_id,
      variant_id: item.variant_id,
      available_quantity: totalAvailable,
      quick_available: false,
      standard_available: standardQty >= item.quantity,
      quick_available_quantity: 0,
      quick_eta: "",
      standard_available_quantity: standardQty,
      standard_eta: "",
      ...mapProductModeFlags(product),
    });
  }

  return { items: results, query_stats: stats };
}

async function buildCatalogAvailability(app, options) {
  const batch = await buildCatalogAvailabilityBatch(app, {
    items: [
      {
        product_id: options.productId,
        variant_id: options.variantId || null,
        quantity: options.quantity || 1,
      },
    ],
    latitude: options.latitude,
    longitude: options.longitude,
  });
  return batch.items[0] || {
    available_quantity: 0,
    quick_available: false,
    standard_available: false,
    quick_available_quantity: 0,
    quick_eta: "",
    standard_available_quantity: 0,
    standard_eta: "",
    ...mapProductModeFlags(null),
  };
}

module.exports = {
  buildCatalogAvailabilityBatch,
  buildCatalogAvailability,
  toCatalogAvailabilityFields,
};
