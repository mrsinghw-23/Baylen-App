"use strict";

const { asId, asQty, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const {
  availableOf,
  reserveStock,
  releaseReservation,
  commitReservation,
  adjustStock,
  transferStock,
  resolveWarehouse,
  loadInventoryRow,
} = require("../lib/inventory-ops");
const { buildInventoryDuplicateReport } = require("../lib/inventory-identity");

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_KEY;
  const crypto = require("crypto");
  const a = Buffer.from(String(req.headers["x-baylen-admin-key"] || ""));
  const b = Buffer.from(String(expected || ""));
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const error = new Error("Admin authorization required");
    error.status = 403;
    throw error;
  }
}

function inventoryRoutes(app) {
  app.post("/v1/inventory/check", async (req, res, next) => {
    try {
      const productId = asId(req.body.product_id, "product_id");
      const quantity = asQty(req.body.quantity, "quantity");
      const variantId = req.body.variant_id ? asId(req.body.variant_id, "variant_id") : null;
      const warehouseId = req.body.warehouse_id ? asId(req.body.warehouse_id, "warehouse_id") : null;

      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, status FROM Inventory WHERE product_id = " +
        productId +
        " AND is_active = true AND status = 'ACTIVE'";
      if (variantId) query += " AND variant_id = " + variantId;
      if (warehouseId) query += " AND warehouse_id = " + warehouseId;

      const rows = dedupeToCanonicalInventoryRows(
        rowsOf(await zcql.executeZCQLQuery(query), "Inventory")
      );
      const available = rows.reduce((sum, row) => sum + availableOf(row), 0);

      sendOk(res, {
        product_id: productId,
        variant_id: variantId,
        warehouse_id: warehouseId,
        requested: quantity,
        available,
        can_fulfill: available >= quantity,
        locations: rows.map((row) => ({
          inventory_id: String(row.ROWID),
          warehouse_id: String(row.warehouse_id),
          available: availableOf(row),
          quantity_on_hand: num(row.quantity_on_hand),
          quantity_reserved: num(row.quantity_reserved),
          quantity_committed: num(row.quantity_committed),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/inventory/reserve", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await reserveStock(req.catalystApp, {
        productId: asId(req.body.product_id, "product_id"),
        variantId: req.body.variant_id ? asId(req.body.variant_id, "variant_id") : null,
        quantity: asQty(req.body.quantity, "quantity"),
        warehouseId: req.body.warehouse_id ? asId(req.body.warehouse_id, "warehouse_id") : null,
        referenceType: req.body.reference_type || "ORDER",
        referenceId: req.body.reference_id ? asId(req.body.reference_id, "reference_id") : null,
      });
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/inventory/release", async (req, res, next) => {
    try {
      requireAdmin(req);
      const referenceId = asId(req.body.reference_id, "reference_id");
      await releaseReservation(req.catalystApp, referenceId, req.body.reason || "Released");
      sendOk(res, { released: true, reference_id: referenceId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/inventory/commit", async (req, res, next) => {
    try {
      requireAdmin(req);
      const referenceId = asId(req.body.reference_id, "reference_id");
      await commitReservation(req.catalystApp, referenceId);
      sendOk(res, { committed: true, reference_id: referenceId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/inventory/:sku", async (req, res, next) => {
    try {
      const sku = String(req.params.sku || "").trim();
      const zcql = req.catalystApp.zcql();
      const variant = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, product_id, sku, variant_name FROM Product_Variants WHERE sku = '" +
            sku.replace(/'/g, "''") +
            "'"
        ),
        "Product_Variants"
      );
      const product = variant
        ? null
        : rowOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID, sku, name FROM Products WHERE sku = '" + sku.replace(/'/g, "''") + "'"
            ),
            "Products"
          );
      if (!variant && !product) {
        const error = new Error("SKU not found");
        error.status = 404;
        throw error;
      }
      const productId = variant ? String(variant.product_id) : String(product.ROWID);
      const variantId = variant ? String(variant.ROWID) : null;
      let query =
        "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, quantity_committed, quantity_in_transit, quantity_damaged, reorder_level, safety_stock, status FROM Inventory WHERE product_id = " +
        productId +
        " AND is_active = true";
      if (variantId) query += " AND variant_id = " + variantId;
      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
      sendOk(res, {
        sku,
        product_id: productId,
        variant_id: variantId,
        locations: rows.map((row) => ({
          inventory_id: String(row.ROWID),
          warehouse_id: String(row.warehouse_id),
          quantity_on_hand: num(row.quantity_on_hand),
          quantity_reserved: num(row.quantity_reserved),
          quantity_committed: num(row.quantity_committed),
          quantity_in_transit: num(row.quantity_in_transit),
          quantity_damaged: num(row.quantity_damaged),
          available: availableOf(row),
          reorder_level: num(row.reorder_level),
          safety_stock: num(row.safety_stock),
          status: row.status,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/inventory/duplicate-scan", async (req, res, next) => {
    try {
      requireAdmin(req);
      const includeInactive = req.query.include_inactive !== "false";
      const report = await buildInventoryDuplicateReport(req.catalystApp.zcql(), { includeInactive });
      sendOk(res, { report });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/inventory/adjust", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await adjustStock(
        req.catalystApp,
        req.body || {},
        req.headers["x-baylen-admin-user"] || "ADMIN"
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/inventory/transfer", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await transferStock(
        req.catalystApp,
        req.body || {},
        req.headers["x-baylen-admin-user"] || "ADMIN"
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = inventoryRoutes;
