"use strict";

const { asId, optionalText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const {
  requireRiderKey,
  actorId,
  loadOrderSafe,
  loadOrderItems,
  setOrderStatus,
  mapCommerceOrder,
  loadRider,
  listAvailableRiders,
  assignNearestRider,
  writeDeliveryTracking,
  distanceKm,
} = require("../lib/commerce-ops");

function riderRoutes(app) {
  app.get("/v1/rider/orders", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const riderId = actorId(req, "x-baylen-rider-id");
      const zcql = req.catalystApp.zcql();
      let rows = [];
      try {
        rows = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code, fulfillment_mode, fulfillment_store_id, fulfillment_rider_id, fulfillment_rider_name, fulfillment_rider_phone, rider_latitude, rider_longitude FROM Orders WHERE status IN ('PACKED','RIDER_SEARCHING','RIDER_ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY') "
          ),
          "Orders"
        );
      } catch (_) {
        rows = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city FROM Orders WHERE status IN ('PACKED','OUT_FOR_DELIVERY')"
          ),
          "Orders"
        );
      }
      const mine = rows.filter((row) => {
        const assigned = String(row.fulfillment_rider_id || "");
        if (!assigned) return ["PACKED", "RIDER_SEARCHING"].includes(String(row.status || "").toUpperCase());
        return assigned === String(riderId);
      });
      const orders = [];
      for (const row of mine.slice(0, 50)) {
        orders.push(mapCommerceOrder(row, await loadOrderItems(zcql, row.ROWID)));
      }
      sendOk(res, { orders, rider_id: riderId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/orders/:id/accept", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const orderId = asId(req.params.id, "id");
      const riderId = actorId(req, "x-baylen-rider-id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      const status = String(order.status || "").toUpperCase();
      if (!["PACKED", "RIDER_SEARCHING", "RIDER_ASSIGNED"].includes(status)) {
        const error = new Error("Order cannot be accepted in status " + order.status);
        error.status = 409;
        throw error;
      }
      if (
        order.fulfillment_rider_id &&
        String(order.fulfillment_rider_id) !== String(riderId) &&
        status === "RIDER_ASSIGNED"
      ) {
        const error = new Error("Order already assigned to another rider");
        error.status = 409;
        throw error;
      }

      let riderName = optionalText(req.body.rider_name, "rider_name", 120) || "";
      let riderPhone = optionalText(req.body.rider_phone, "rider_phone", 30) || "";
      const rider = await loadRider(req.catalystApp.zcql(), riderId);
      if (rider) {
        riderName = rider.name || riderName;
        riderPhone = rider.phone || riderPhone;
        try {
          await req.catalystApp.datastore().table("Riders").updateRow({
            ROWID: rider.ROWID,
            is_available: "false",
            current_order_id: orderId,
          });
        } catch (_) {}
      }

      const updated = await setOrderStatus(
        req.catalystApp,
        order,
        "RIDER_ASSIGNED",
        "Rider accepted order",
        "RIDER",
        {
          fulfillment_rider_id: riderId,
          fulfillment_rider_name: riderName,
          fulfillment_rider_phone: riderPhone,
        }
      );
      sendOk(res, {
        order: mapCommerceOrder(updated, await loadOrderItems(req.catalystApp.zcql(), orderId)),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/orders/:id/arrived-store", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      await setOrderStatus(req.catalystApp, order, "RIDER_ASSIGNED", "Rider arrived at store", "RIDER");
      sendOk(res, { ok: true, status: "ARRIVED_AT_STORE" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/orders/:id/pickup", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      if (!["RIDER_ASSIGNED", "PACKED"].includes(String(order.status || "").toUpperCase())) {
        const error = new Error("Order must be assigned before pickup");
        error.status = 409;
        throw error;
      }
      const updated = await setOrderStatus(req.catalystApp, order, "PICKED_UP", "Rider picked up order", "RIDER");
      sendOk(res, {
        order: mapCommerceOrder(updated, await loadOrderItems(req.catalystApp.zcql(), orderId)),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/orders/:id/start-delivery", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      if (!["PICKED_UP", "RIDER_ASSIGNED"].includes(String(order.status || "").toUpperCase())) {
        const error = new Error("Order must be picked up before start delivery");
        error.status = 409;
        throw error;
      }
      const updated = await setOrderStatus(
        req.catalystApp,
        order,
        "OUT_FOR_DELIVERY",
        "Out for delivery",
        "RIDER"
      );
      sendOk(res, {
        order: mapCommerceOrder(updated, await loadOrderItems(req.catalystApp.zcql(), orderId)),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/orders/:id/delivered", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      if (String(order.status || "").toUpperCase() !== "OUT_FOR_DELIVERY") {
        const error = new Error("Order must be OUT_FOR_DELIVERY before delivered");
        error.status = 409;
        throw error;
      }
      const updated = await setOrderStatus(req.catalystApp, order, "DELIVERED", "Order delivered", "RIDER");
      if (order.fulfillment_rider_id) {
        try {
          await req.catalystApp.datastore().table("Riders").updateRow({
            ROWID: order.fulfillment_rider_id,
            is_available: "true",
            current_order_id: null,
          });
        } catch (_) {}
      }
      sendOk(res, {
        order: mapCommerceOrder(updated, await loadOrderItems(req.catalystApp.zcql(), orderId)),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/rider/location", async (req, res, next) => {
    try {
      requireRiderKey(req);
      const riderId = actorId(req, "x-baylen-rider-id");
      const orderId = req.body.order_id ? asId(req.body.order_id, "order_id") : "";
      const latitude = Number(req.body.latitude);
      const longitude = Number(req.body.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        const error = new Error("latitude and longitude are required");
        error.status = 400;
        throw error;
      }
      if (orderId) {
        await writeDeliveryTracking(req.catalystApp, {
          orderId,
          riderId,
          latitude,
          longitude,
          status: optionalText(req.body.status, "status", 30) || "MOVING",
        });
      }
      try {
        await req.catalystApp.datastore().table("Riders").updateRow({
          ROWID: riderId,
          latitude,
          longitude,
        });
      } catch (_) {}
      sendOk(res, {
        ok: true,
        rider_id: riderId,
        order_id: orderId || null,
        latitude,
        longitude,
        recorded_at: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  });

  /** Admin/system: assign nearest rider */
  app.post("/v1/admin/orders/:id/assign-rider", async (req, res, next) => {
    try {
      const crypto = require("crypto");
      const expected = process.env.ADMIN_API_KEY;
      if (!expected) {
        const error = new Error("ADMIN_API_KEY is not configured");
        error.status = 503;
        throw error;
      }
      const a = Buffer.from(String(req.headers["x-baylen-admin-key"] || ""));
      const b = Buffer.from(String(expected));
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const error = new Error("Admin authorization required");
        error.status = 403;
        throw error;
      }
      const orderId = asId(req.params.id, "id");
      const order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }
      const storeLat = Number(req.body.store_latitude);
      const storeLng = Number(req.body.store_longitude);
      if (!Number.isFinite(storeLat) || !Number.isFinite(storeLng)) {
        const error = new Error("store_latitude and store_longitude are required");
        error.status = 400;
        throw error;
      }
      const updated = await assignNearestRider(req.catalystApp, order, storeLat, storeLng);
      if (!updated) {
        sendOk(res, {
          assigned: false,
          message: "No available riders. Order set to RIDER_SEARCHING.",
          order: mapCommerceOrder(order, await loadOrderItems(req.catalystApp.zcql(), orderId)),
          available_riders: (await listAvailableRiders(req.catalystApp.zcql())).length,
        });
        return;
      }
      sendOk(res, {
        assigned: true,
        order: mapCommerceOrder(updated, await loadOrderItems(req.catalystApp.zcql(), orderId)),
      });
    } catch (error) {
      next(error);
    }
  });

  /** Customer tracking for QC orders */
  app.get("/v1/orders/:id/tracking", async (req, res, next) => {
    try {
      const user = requireUser(req);
      let orderId = asId(req.params.id, "id");
      let order = await loadOrderSafe(req.catalystApp.zcql(), orderId);
      if (!order || String(order.user_id) !== String(user.user_id)) {
        const error = new Error("Order not found");
        error.status = 404;
        throw error;
      }

      // SPLIT master → track Quick Commerce child when present
      if (String(order.fulfillment_mode || "").toUpperCase() === "SPLIT") {
        try {
          const children = rowsOf(
            await req.catalystApp.zcql().executeZCQLQuery(
              "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, fulfillment_mode, fulfillment_store_id, fulfillment_rider_id, fulfillment_rider_name, fulfillment_rider_phone, rider_latitude, rider_longitude, parent_order_id FROM Orders WHERE parent_order_id = " +
                orderId
            ),
            "Orders"
          );
          const qcChild = children.find(
            (row) => String(row.fulfillment_mode || "").toUpperCase() === "QUICK_COMMERCE"
          );
          if (qcChild) {
            order = qcChild;
            orderId = String(qcChild.ROWID);
          }
        } catch (_) {}
      }

      const timeline = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, status, note, actor_type, happened_at FROM Order_Timeline WHERE order_id = " +
              orderId
          ),
        "Order_Timeline"
      );
      let trackPoints = [];
      try {
        trackPoints = rowsOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID, latitude, longitude, status, recorded_at FROM Delivery_Tracking WHERE order_id = " +
                orderId
            ),
          "Delivery_Tracking"
        )
          .slice(-40)
          .map((row) => ({
            latitude: num(row.latitude),
            longitude: num(row.longitude),
            status: row.status || "",
            recorded_at: row.recorded_at || "",
          }));
      } catch (_) {}

      const status = String(order.status || "").toUpperCase();
      const steps = [
        { key: "CONFIRMED", label: "Order Confirmed", done: true },
        {
          key: "PICKING",
          label: "Store Picking",
          done: ["PICKING", "PACKED", "RIDER_SEARCHING", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status),
        },
        {
          key: "PACKED",
          label: "Order Packed",
          done: ["PACKED", "RIDER_SEARCHING", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status),
        },
        {
          key: "RIDER_ASSIGNED",
          label: "Rider Assigned",
          done: ["RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED"].includes(status),
        },
        {
          key: "OUT_FOR_DELIVERY",
          label: "Rider on the way",
          done: ["OUT_FOR_DELIVERY", "DELIVERED"].includes(status),
        },
        { key: "DELIVERED", label: "Delivered", done: status === "DELIVERED" },
      ];

      sendOk(res, {
        order: mapCommerceOrder(order, await loadOrderItems(req.catalystApp.zcql(), orderId)),
        steps,
        timeline: timeline.map((row) => ({
          id: String(row.ROWID),
          status: row.status || "",
          note: row.note || "",
          actor_type: row.actor_type || "",
          happened_at: row.happened_at || "",
        })),
        rider: {
          id: order.fulfillment_rider_id ? String(order.fulfillment_rider_id) : "",
          name: order.fulfillment_rider_name || "",
          phone_masked: order.fulfillment_rider_phone
            ? String(order.fulfillment_rider_phone).replace(/.(?=.{4})/g, "•")
            : "",
          latitude: order.rider_latitude != null ? num(order.rider_latitude) : null,
          longitude: order.rider_longitude != null ? num(order.rider_longitude) : null,
        },
        track_points: trackPoints,
        live:
          order.rider_latitude != null && order.rider_longitude != null
            ? {
                latitude: num(order.rider_latitude),
                longitude: num(order.rider_longitude),
              }
            : null,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = riderRoutes;
