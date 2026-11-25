"use strict";

const { asId, num, sendOk, optionalText, rowOf, rowsOf, sqlString } = require("../lib/http");
const { evaluateFulfillment, evaluateProductAvailability } = require("../lib/fulfillment-engine");
const { parseLocation, requireCoordinates } = require("../lib/geo-coords");
const { signedInUser, guestSessionId } = require("../lib/session");

function fulfillmentRoutes(app) {
  /**
   * POST /v1/fulfillment/check
   * Body: { latitude, longitude, items: [{ product_id, variant_id?, quantity }] }
   * Or { latitude, longitude, use_cart: true }
   */
  app.post("/v1/fulfillment/check", async (req, res, next) => {
    try {
      const body = req.body || {};
      let latitude = null;
      let longitude = null;
      if (body.latitude != null || body.longitude != null) {
        ({ latitude, longitude } = requireCoordinates(body.latitude, body.longitude));
      }
      let items = Array.isArray(body.items) ? body.items : [];

      if (body.use_cart === true || body.use_cart === "true") {
        const zcql = req.catalystApp.zcql();
        let cartRow = null;
        const user = signedInUser(req);
        if (user && user.user_id) {
          cartRow = rowOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID FROM Carts WHERE user_id = " +
                user.user_id +
                " AND status = 'ACTIVE' AND is_active = true"
            ),
            "Carts"
          );
        }
        if (!cartRow) {
          const guest = guestSessionId(req) || optionalText(req.headers["x-baylen-guest-session"], "guest", 80);
          if (guest) {
            cartRow = rowOf(
              await zcql.executeZCQLQuery(
                "SELECT ROWID FROM Carts WHERE guest_session_id = " +
                  sqlString(guest) +
                  " AND status = 'ACTIVE' AND is_active = true"
              ),
              "Carts"
            );
          }
        }
        if (!cartRow) {
          const error = new Error("Cart is empty");
          error.status = 400;
          throw error;
        }
        const cartItems = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT product_id, variant_id, quantity, unit_price FROM Cart_Items WHERE cart_id = " +
              cartRow.ROWID +
              " AND is_active = true"
          ),
          "Cart_Items"
        );
        items = cartItems.map((row) => ({
          product_id: row.product_id,
          variant_id: row.variant_id || null,
          quantity: row.quantity,
          unit_price: row.unit_price,
        }));
      }

      const result = await evaluateFulfillment(req.catalystApp, {
        latitude,
        longitude,
        items,
      });
      sendOk(res, { fulfillment: result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/fulfillment/product-availability", async (req, res, next) => {
    try {
      const productId = asId(req.query.product_id || req.query.id, "product_id");
      const variantId = req.query.variant_id ? asId(req.query.variant_id, "variant_id") : null;
      const quantity = Math.max(1, Math.round(num(req.query.quantity) || 1));
      const location = parseLocation(req.query.latitude, req.query.longitude);
      const availability = await evaluateProductAvailability(req.catalystApp, {
        productId,
        variantId,
        quantity,
        latitude: location ? location.latitude : null,
        longitude: location ? location.longitude : null,
      });
      sendOk(res, { availability });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = fulfillmentRoutes;
