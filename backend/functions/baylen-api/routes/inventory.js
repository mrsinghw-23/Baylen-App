const { asId, asQty, rowOf, rowsOf, num, sendOk } = require("../lib/http");

function inventoryRoutes(app) {
  app.post("/v1/inventory/check", async (req, res, next) => {
    try {
      const productId = asId(req.body.product_id, "product_id");
      const quantity = asQty(req.body.quantity, "quantity");
      const variantId = req.body.variant_id
        ? asId(req.body.variant_id, "variant_id")
        : null;
      const warehouseId = req.body.warehouse_id
        ? asId(req.body.warehouse_id, "warehouse_id")
        : null;

      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, status FROM Inventory WHERE product_id = " +
        productId +
        " AND is_active = true AND status = 'ACTIVE'";
      if (variantId) {
        query += " AND variant_id = " + variantId;
      }
      if (warehouseId) {
        query += " AND warehouse_id = " + warehouseId;
      }

      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
      const available = rows.reduce((sum, row) => {
        return sum + Math.max(0, num(row.quantity_on_hand) - num(row.quantity_reserved));
      }, 0);

      sendOk(res, {
        product_id: productId,
        variant_id: variantId,
        warehouse_id: warehouseId,
        requested: quantity,
        available,
        can_fulfill: available >= quantity,
        locations: rows.map((row) => ({
          inventory_id: row.ROWID,
          warehouse_id: row.warehouse_id,
          available: Math.max(0, num(row.quantity_on_hand) - num(row.quantity_reserved)),
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/inventory/reserve", async (req, res, next) => {
    try {
      const productId = asId(req.body.product_id, "product_id");
      const quantity = asQty(req.body.quantity, "quantity");
      const warehouseId = asId(req.body.warehouse_id, "warehouse_id");
      const variantId = req.body.variant_id
        ? asId(req.body.variant_id, "variant_id")
        : null;
      const referenceType = req.body.reference_type ? "ORDER" : "MANUAL";
      const referenceId = req.body.reference_id
        ? asId(req.body.reference_id, "reference_id")
        : null;

      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, quantity_on_hand, quantity_reserved FROM Inventory WHERE product_id = " +
        productId +
        " AND warehouse_id = " +
        warehouseId +
        " AND is_active = true AND status = 'ACTIVE'";
      if (variantId) {
        query += " AND variant_id = " + variantId;
      } else {
        query += " AND variant_id IS NULL";
      }

      const row = rowOf(await zcql.executeZCQLQuery(query), "Inventory");
      if (!row) {
        const error = new Error("Inventory record not found");
        error.status = 404;
        throw error;
      }

      const onHand = num(row.quantity_on_hand);
      const reserved = num(row.quantity_reserved);
      const available = Math.max(0, onHand - reserved);
      if (available < quantity) {
        const error = new Error("Insufficient stock");
        error.status = 409;
        throw error;
      }

      const nextReserved = reserved + quantity;
      await req.catalystApp.datastore().table("Inventory").updateRow({
        ROWID: row.ROWID,
        quantity_reserved: nextReserved,
      });

      await req.catalystApp.datastore().table("Stock_Movements").insertRow({
        inventory_id: row.ROWID,
        warehouse_id: warehouseId,
        product_id: productId,
        variant_id: variantId,
        movement_type: "RESERVE",
        quantity,
        reference_type: referenceType,
        reference_id: referenceId,
        notes: "Reserved by baylen-api",
      });

      sendOk(res, {
        inventory_id: row.ROWID,
        reserved: nextReserved,
        available: onHand - nextReserved,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = inventoryRoutes;
