"use strict";

const { asId, optionalText, sendOk, num } = require("../lib/http");
const {
  requirePickerKey,
  actorId,
  loadOrderSafe,
  loadOrderItems,
  setOrderStatus,
  mapCommerceOrder,
  listPickerQueue,
  assignNearestRider,
  addTimeline,
} = require("../lib/commerce-ops");

function pickerRoutes(app) {
  app.get("/v1/picker/orders", async (req, res, next) => {
    try {
      requirePickerKey(req);
      const storeId = req.query.store_id ? asId(req.query.store_id, "store_id") : "";
      const status = optionalText(req.query.status, "status", 40);
      const rows = await listPickerQueue(req.catalystApp.zcql(), { storeId, status });
      const orders = [];
      for (const row of rows.slice(0, 50)) {
        const items = await loadOrderItems(req.catalystApp.zcql(), row.ROWID);
        orders.push(mapCommerceOrder(row, items));
      }
      sendOk(res, { orders });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/picker/orders/:id", async (req, res, next) => {
    try {
      requirePickerKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      const items = await loadOrderItems(req.catalystApp.zcql(), orderId);
      sendOk(res, { order: mapCommerceOrder(order, items) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/picker/orders/:id/start", async (req, res, next) => {
    try {
      requirePickerKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      const allowed = ["CONFIRMED", "STORE_ASSIGNED", "PROCESSING", "PLACED"];
      if (!allowed.includes(String(order.status || "").toUpperCase())) {
        const error = new Error("Order cannot start picking from status " + order.status);
        error.status = 409;
        throw error;
      }
      const picker = actorId(req, "x-baylen-picker-id");
      const updated = await setOrderStatus(
        req.catalystApp,
        order,
        "PICKING",
        "Picking started by " + picker,
        "PICKER",
        { fulfillment_mode: order.fulfillment_mode || "QUICK_COMMERCE" }
      );
      const items = await loadOrderItems(req.catalystApp.zcql(), orderId);
      for (const item of items) {
        try {
          await req.catalystApp.datastore().table("Order_Items").updateRow({
            ROWID: item.ROWID,
            pick_status: "PENDING",
          });
        } catch (_) {}
      }
      sendOk(res, { order: mapCommerceOrder(updated, items) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/picker/orders/:id/item-status", async (req, res, next) => {
    try {
      requirePickerKey(req);
      const orderId = asId(req.params.id, "id");
      const itemId = asId(req.body.item_id, "item_id");
      const pickStatus = optionalText(req.body.pick_status || req.body.status, "pick_status", 30).toUpperCase();
      const allowed = ["PENDING", "FOUND", "SCANNED", "MISSING", "SUBSTITUTED"];
      if (!allowed.includes(pickStatus)) {
        const error = new Error("Unsupported pick_status");
        error.status = 400;
        throw error;
      }
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      if (String(order.status || "").toUpperCase() !== "PICKING") {
        const error = new Error("Order is not in PICKING status");
        error.status = 409;
        throw error;
      }
      const items = await loadOrderItems(req.catalystApp.zcql(), orderId);
      const item = items.find((row) => String(row.ROWID) === String(itemId));
      if (!item) {
        const error = new Error("Order item not found");
        error.status = 404;
        throw error;
      }
      try {
        await req.catalystApp.datastore().table("Order_Items").updateRow({
          ROWID: itemId,
          pick_status: pickStatus,
          status: pickStatus === "MISSING" ? "UNAVAILABLE" : item.status || "CONFIRMED",
        });
      } catch (e) {
        const error = new Error(
          "Unable to update pick_status. Run hybrid schema provision when Data Store quota is available."
        );
        error.status = 503;
        throw error;
      }
      await addTimeline(
        req.catalystApp,
        orderId,
        "PICKING",
        "Item " + (item.sku || itemId) + " marked " + pickStatus,
        "PICKER"
      );

      const refreshed = await loadOrderItems(req.catalystApp.zcql(), orderId);
      const missing = refreshed.filter((row) => String(row.pick_status || "").toUpperCase() === "MISSING");
      let updatedOrder = order;
      if (missing.length > 0 && missing.length === refreshed.length) {
        updatedOrder = await setOrderStatus(
          req.catalystApp,
          order,
          "CANCELLED",
          "All items unavailable during picking",
          "PICKER"
        );
      } else if (missing.length > 0) {
        updatedOrder = await setOrderStatus(
          req.catalystApp,
          order,
          "PARTIALLY_FULFILLED",
          missing.length + " item(s) unavailable — refund pending review",
          "PICKER"
        );
        // Do not auto-refund; payment gateway must be verified first.
      }
      sendOk(res, {
        order: mapCommerceOrder(updatedOrder, refreshed),
        refund_hint:
          missing.length > 0
            ? {
                required: true,
                auto_refund: false,
                message: "Partial refund must be initiated after payment state is verified",
                missing_item_ids: missing.map((row) => String(row.ROWID)),
                missing_amount: missing.reduce((sum, row) => sum + num(row.line_total), 0),
              }
            : null,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/picker/orders/:id/pack", async (req, res, next) => {
    try {
      requirePickerKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      if (!["PICKING", "PARTIALLY_FULFILLED"].includes(String(order.status || "").toUpperCase())) {
        const error = new Error("Order must be PICKING before pack");
        error.status = 409;
        throw error;
      }
      const items = await loadOrderItems(req.catalystApp.zcql(), orderId);
      const pending = items.filter((row) => {
        const st = String(row.pick_status || "PENDING").toUpperCase();
        return st === "PENDING";
      });
      if (pending.length) {
        const error = new Error("All items must be FOUND/SCANNED/MISSING before pack");
        error.status = 409;
        throw error;
      }
      const packed = await setOrderStatus(
        req.catalystApp,
        order,
        "PACKED",
        "Order packed and ready for rider",
        "PICKER"
      );

      // Attempt nearest rider assignment for Quick Commerce
      let withRider = packed;
      const storeLat = req.body.store_latitude != null ? Number(req.body.store_latitude) : null;
      const storeLng = req.body.store_longitude != null ? Number(req.body.store_longitude) : null;
      if (Number.isFinite(storeLat) && Number.isFinite(storeLng)) {
        const assigned = await assignNearestRider(req.catalystApp, packed, storeLat, storeLng);
        if (assigned) withRider = assigned;
      } else {
        withRider = await setOrderStatus(
          req.catalystApp,
          packed,
          "RIDER_SEARCHING",
          "Packed — waiting for rider assignment",
          "SYSTEM"
        );
      }

      const refreshedItems = await loadOrderItems(req.catalystApp.zcql(), orderId);
      sendOk(res, { order: mapCommerceOrder(withRider, refreshedItems) });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = pickerRoutes;
