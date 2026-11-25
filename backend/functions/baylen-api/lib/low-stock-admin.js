"use strict";

const { rowsOf, asId, num } = require("./http");
const { dedupeToCanonicalInventoryRows } = require("./inventory-identity");
const {
  mapLowStockRow,
  summarizeLowStockRows,
  matchesLowStockFilters,
} = require("./low-stock-engine");
const { scanAndRecordLowStockAlerts } = require("./low-stock-alerts");

async function loadLowStockInventoryRows(zcql, { warehouseId = null, productId = null } = {}) {
  let query =
    "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, reorder_level, reorder_quantity, safety_stock, is_active, status FROM Inventory WHERE is_active = true AND status = 'ACTIVE'";
  if (warehouseId) {
    query += " AND warehouse_id = " + asId(warehouseId, "warehouse_id");
  }
  if (productId) {
    query += " AND product_id = " + asId(productId, "product_id");
  }
  return dedupeToCanonicalInventoryRows(rowsOf(await zcql.executeZCQLQuery(query), "Inventory"));
}

async function loadLowStockMetadata(zcql, inventoryRows) {
  const warehouseIds = [...new Set(inventoryRows.map((row) => String(row.warehouse_id)))];
  const productIds = [...new Set(inventoryRows.map((row) => String(row.product_id)))];
  const variantIds = [
    ...new Set(inventoryRows.filter((row) => row.variant_id).map((row) => String(row.variant_id))),
  ];

  const warehousesById = new Map();
  const productsById = new Map();
  const variantsById = new Map();

  if (warehouseIds.length) {
    const whRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, code, name FROM Warehouses WHERE ROWID IN (" +
          warehouseIds.map((id) => asId(id, "warehouse_id")).join(",") +
          ")"
      ),
      "Warehouses"
    );
    for (const row of whRows) {
      warehousesById.set(String(row.ROWID), row);
    }
  }

  if (productIds.length) {
    const productRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku FROM Products WHERE ROWID IN (" +
          productIds.map((id) => asId(id, "product_id")).join(",") +
          ")"
      ),
      "Products"
    );
    for (const row of productRows) {
      productsById.set(String(row.ROWID), row);
    }
  }

  if (variantIds.length) {
    const variantRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, variant_name, sku FROM Product_Variants WHERE ROWID IN (" +
          variantIds.map((id) => asId(id, "variant_id")).join(",") +
          ")"
      ),
      "Product_Variants"
    );
    for (const row of variantRows) {
      variantsById.set(String(row.ROWID), row);
    }
  }

  return { warehousesById, productsById, variantsById };
}

async function listLowStock(app, filters = {}, options = {}) {
  const zcql = app.zcql();
  const inventoryRows = await loadLowStockInventoryRows(zcql, {
    warehouseId: filters.warehouse_id,
    productId: filters.product_id,
  });
  const meta = await loadLowStockMetadata(zcql, inventoryRows);

  const mapped = inventoryRows.map((row) => {
    const wh = meta.warehousesById.get(String(row.warehouse_id)) || {};
    const product = meta.productsById.get(String(row.product_id)) || {};
    const variant = row.variant_id ? meta.variantsById.get(String(row.variant_id)) || {} : {};
    return mapLowStockRow(row, {
      warehouse_code: wh.code || "",
      warehouse_name: wh.name || "",
      sku: variant.sku || product.sku || "",
      product_name: product.name || "",
      variant_name: variant.variant_name || "",
    });
  });

  const filtered = mapped.filter((row) => matchesLowStockFilters(row, filters));
  const limit = Math.min(500, Math.max(1, num(options.limit) || 200));
  const offset = Math.max(0, num(options.offset) || 0);
  const page = filtered.slice(offset, offset + limit);

  let alertTransitions = [];
  if (options.record_alerts === true) {
    alertTransitions = await scanAndRecordLowStockAlerts(app, page, { actor: options.actor || "ADMIN" });
  }

  return {
    items: page,
    summary: summarizeLowStockRows(filtered),
    total: filtered.length,
    offset,
    limit,
    alert_transitions: alertTransitions,
  };
}

async function lowStockSummary(app, filters = {}) {
  const result = await listLowStock(app, filters, { limit: 5000, offset: 0 });
  return result.summary;
}

module.exports = {
  listLowStock,
  lowStockSummary,
  loadLowStockInventoryRows,
};
