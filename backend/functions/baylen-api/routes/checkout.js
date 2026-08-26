const { asId, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { validateCouponForSubtotal } = require("../lib/coupons");
const { requireUser } = require("../lib/session");

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function optionalText(value, field, max) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length > max) {
    const error = new Error(`${field} must be at most ${max} characters`);
    error.status = 400;
    throw error;
  }
  return text.replace(/'/g, "");
}

function mapOrder(row, items) {
  const subtotal = money(row.subtotal);
  const status = row.status || "";
  const paymentStatus = row.payment_status || "";
  return {
    id: String(row.ROWID),
    order_number: row.order_number,
    status,
    payment_status: paymentStatus,
    currency: row.currency || "INR",
    subtotal,
    discount_amount: money(row.discount_amount),
    coupon_code: row.coupon_code || "",
    tax_amount: money(row.tax_amount),
    shipping_amount: money(row.shipping_amount),
    grand_total: money(row.grand_total),
    shipping_name: row.shipping_name || "",
    shipping_phone: row.shipping_phone || "",
    shipping_line1: row.shipping_line1 || "",
    shipping_city: row.shipping_city || "",
    shipping_state: row.shipping_state || "",
    shipping_postal_code: row.shipping_postal_code || "",
    can_cancel: ["PLACED", "CONFIRMED", "PROCESSING"].includes(status),
    can_return: ["DELIVERED", "COMPLETED"].includes(status) && paymentStatus === "PAID",
    items: items || [],
  };
}

async function loadOrderItems(zcql, orderId) {
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, product_name, sku, quantity, unit_price, line_total FROM Order_Items WHERE order_id = " +
        orderId
    ),
    "Order_Items"
  );
  return rows.map((row) => ({
    id: String(row.ROWID),
    product_id: String(row.product_id),
    name: row.product_name,
    sku: row.sku || "",
    quantity: num(row.quantity),
    unit_price: money(row.unit_price),
    line_total: money(row.line_total),
  }));
}

async function safeNotification(req, userId, type, title, body, referenceType, referenceId) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: userId,
      type,
      title,
      body,
      reference_type: referenceType,
      reference_id: referenceId,
      delivery_status: "PENDING",
    });
  } catch (_) {
    // Notification storage must not fail the business transaction.
  }
}

async function addTimeline(req, orderId, status, note, actorType) {
  try {
    await req.catalystApp.datastore().table("Order_Timeline").insertRow({
      order_id: orderId,
      status,
      note,
      actor_type: actorType || "CUSTOMER",
      happened_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  } catch (_) {
    // Timeline is useful for tracking, but the order status remains the source of truth.
  }
}

async function loadAddress(zcql, userId, addressId) {
  if (!addressId) {
    return null;
  }
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, full_name, phone, line1, city, state, postal_code FROM Addresses WHERE ROWID = " +
        addressId +
        " AND user_id = " +
        userId +
        " AND is_active = true"
    ),
    "Addresses"
  );
}

async function inventoryRows(zcql, productId, variantId) {
  let query =
    "SELECT ROWID, warehouse_id, quantity_on_hand, quantity_reserved FROM Inventory WHERE product_id = " +
    productId +
    " AND is_active = true AND status = 'ACTIVE'";
  query += variantId ? " AND variant_id = " + variantId : "";
  return rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
}

async function reserveInventory(req, productId, variantId, quantity, referenceId) {
  const zcql = req.catalystApp.zcql();
  const rows = await inventoryRows(zcql, productId, variantId);
  const available = rows.reduce(
    (sum, row) => sum + Math.max(0, num(row.quantity_on_hand) - num(row.quantity_reserved)),
    0
  );
  if (available < quantity) {
    const error = new Error("Insufficient stock for one or more products");
    error.status = 409;
    throw error;
  }

  let remaining = quantity;
  for (const row of rows) {
    if (remaining < 1) {
      break;
    }
    const open = Math.max(0, num(row.quantity_on_hand) - num(row.quantity_reserved));
    const reservedNow = Math.min(open, remaining);
    if (reservedNow < 1) {
      continue;
    }
    await req.catalystApp.datastore().table("Inventory").updateRow({
      ROWID: row.ROWID,
      quantity_reserved: num(row.quantity_reserved) + reservedNow,
    });
    await req.catalystApp.datastore().table("Stock_Movements").insertRow({
      inventory_id: row.ROWID,
      warehouse_id: row.warehouse_id,
      product_id: productId,
      variant_id: variantId,
      movement_type: "RESERVE",
      quantity: reservedNow,
      reference_type: "ORDER",
      reference_id: referenceId,
      notes: "Reserved during checkout",
    });
    remaining -= reservedNow;
  }
}

async function releaseReservedInventory(req, referenceId, reason) {
  const zcql = req.catalystApp.zcql();
  const movements = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, quantity FROM Stock_Movements WHERE reference_type = 'ORDER' AND reference_id = " +
        referenceId +
        " AND movement_type = 'RESERVE'"
    ),
    "Stock_Movements"
  );
  for (const movement of movements) {
    const inventory = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, quantity_reserved FROM Inventory WHERE ROWID = " +
          asId(movement.inventory_id, "inventory_id")
      ),
      "Inventory"
    );
    if (!inventory) {
      continue;
    }
    const released = num(movement.quantity);
    await req.catalystApp.datastore().table("Inventory").updateRow({
      ROWID: inventory.ROWID,
      quantity_reserved: Math.max(0, num(inventory.quantity_reserved) - released),
    });
    await req.catalystApp.datastore().table("Stock_Movements").insertRow({
      inventory_id: movement.inventory_id,
      warehouse_id: movement.warehouse_id,
      product_id: movement.product_id,
      variant_id: movement.variant_id || null,
      movement_type: "RELEASE",
      quantity: released,
      reference_type: "ORDER",
      reference_id: referenceId,
      notes: reason || "Released reserved stock",
    });
  }
}

async function loadOrderForUser(zcql, userId, orderId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
        orderId +
        " AND user_id = " +
        userId
    ),
    "Orders"
  );
  if (!row) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  return row;
}

function checkoutRoutes(app) {
  app.post("/v1/checkout", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const zcql = req.catalystApp.zcql();

      const cart = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, currency, coupon_code FROM Carts WHERE user_id = " +
            user.user_id +
            " AND status = 'ACTIVE' AND is_active = true"
        ),
        "Carts"
      );
      if (!cart) {
        const error = new Error("Cart is empty");
        error.status = 400;
        throw error;
      }

      const cartItems = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, product_id, variant_id, quantity, unit_mrp, unit_price FROM Cart_Items WHERE cart_id = " +
            cart.ROWID +
            " AND is_active = true"
        ),
        "Cart_Items"
      );
      if (cartItems.length === 0) {
        const error = new Error("Cart is empty");
        error.status = 400;
        throw error;
      }

      const lines = [];
      for (const item of cartItems) {
        const productId = asId(item.product_id, "product_id");
        const product = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, name, sku, tax_percent, status FROM Products WHERE ROWID = " +
              productId +
              " AND status = 'ACTIVE'"
          ),
          "Products"
        );
        if (!product) {
          const error = new Error("A cart product is no longer available");
          error.status = 409;
          throw error;
        }
        const quantity = num(item.quantity);
        const unitPrice = money(item.unit_price);
        lines.push({
          cart_item_id: item.ROWID,
          product_id: productId,
          variant_id: item.variant_id ? String(item.variant_id) : null,
          product_name: product.name,
          sku: product.sku || "",
          quantity,
          unit_mrp: money(item.unit_mrp),
          unit_price: unitPrice,
          tax_percent: money(product.tax_percent),
          line_total: money(unitPrice * quantity),
        });
      }

      const subtotal = money(lines.reduce((sum, line) => sum + line.line_total, 0));
      let discountAmount = 0;
      let couponCode = "";
      if (cart.coupon_code) {
        const validated = await validateCouponForSubtotal(req, cart.coupon_code, subtotal);
        discountAmount = money(validated.discountAmount);
        couponCode = validated.coupon.code;
      }
      const grandTotal = money(Math.max(0, subtotal - discountAmount));
      const orderNumber = ("BLN" + Date.now()).slice(0, 30);
      const addressId = body.address_id ? asId(body.address_id, "address_id") : null;
      const savedAddress = await loadAddress(zcql, user.user_id, addressId);
      const shippingName =
        optionalText(body.shipping_name, "shipping_name", 100) ||
        (savedAddress ? savedAddress.full_name || "" : "");
      const shippingPhone =
        optionalText(body.shipping_phone, "shipping_phone", 20) ||
        (savedAddress ? savedAddress.phone || "" : "");
      const shippingLine1 =
        optionalText(body.shipping_line1, "shipping_line1", 255) ||
        (savedAddress ? savedAddress.line1 || "" : "");
      const shippingCity =
        optionalText(body.shipping_city, "shipping_city", 100) ||
        (savedAddress ? savedAddress.city || "" : "");
      const shippingState =
        optionalText(body.shipping_state, "shipping_state", 100) ||
        (savedAddress ? savedAddress.state || "" : "");
      const shippingPostal =
        optionalText(body.shipping_postal_code, "shipping_postal_code", 20) ||
        (savedAddress ? savedAddress.postal_code || "" : "");

      const inserted = await req.catalystApp.datastore().table("Orders").insertRow({
        user_id: user.user_id,
        order_number: orderNumber,
        status: "PLACED",
        payment_status: "PENDING",
        currency: cart.currency || "INR",
        subtotal,
        discount_amount: discountAmount,
        tax_amount: 0,
        shipping_amount: 0,
        grand_total: grandTotal,
        coupon_code: couponCode || null,
        shipping_name: shippingName || null,
        shipping_phone: shippingPhone || null,
        shipping_line1: shippingLine1 || null,
        shipping_city: shippingCity || null,
        shipping_state: shippingState || null,
        shipping_postal_code: shippingPostal || null,
        shipping_country: "India",
        notes: optionalText(body.notes, "notes", 255) || null,
      });

      const orderId = inserted.ROWID || inserted.rowid;
      if (!orderId) {
        const error = new Error("Could not create order");
        error.status = 500;
        throw error;
      }

      for (const line of lines) {
        await reserveInventory(
          req,
          line.product_id,
          line.variant_id,
          line.quantity,
          asId(orderId, "order_id")
        );
        await req.catalystApp.datastore().table("Order_Items").insertRow({
          order_id: orderId,
          product_id: line.product_id,
          variant_id: line.variant_id,
          product_name: line.product_name,
          sku: line.sku || null,
          quantity: line.quantity,
          unit_mrp: line.unit_mrp,
          unit_price: line.unit_price,
          tax_percent: line.tax_percent,
          line_total: line.line_total,
          status: "CONFIRMED",
        });
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: line.cart_item_id,
          is_active: false,
          quantity: 0,
        });
      }

      await addTimeline(req, asId(orderId, "order_id"), "PLACED", "Order placed", "SYSTEM");
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Order placed",
        "Your Baylen order has been placed.",
        "ORDER",
        asId(orderId, "order_id")
      );

      await req.catalystApp.datastore().table("Carts").updateRow({
        ROWID: cart.ROWID,
        status: "CHECKED_OUT",
        is_active: false,
        coupon_code: null,
        discount_amount: 0,
      });

      const order = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, order_number, status, payment_status, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
            asId(orderId, "order_id")
        ),
        "Orders"
      );
      sendOk(res, { order: mapOrder(order, await loadOrderItems(zcql, asId(orderId, "order_id"))) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/orders", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const orderId = asId(req.query.id, "id");
        const row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
              orderId +
              " AND user_id = " +
              user.user_id
          ),
          "Orders"
        );
        if (!row) {
          const error = new Error("Order not found");
          error.status = 404;
          throw error;
        }
        sendOk(res, { order: mapOrder(row, await loadOrderItems(zcql, orderId)) });
        return;
      }
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, order_number, status, payment_status, currency, subtotal, discount_amount, coupon_code, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE user_id = " +
            user.user_id
        ),
        "Orders"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { orders: rows.map((row) => mapOrder(row, [])) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/order/timeline", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const orderId = asId(req.query.id, "id");
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      let timeline = [];
      try {
        timeline = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, status, note, actor_type, happened_at FROM Order_Timeline WHERE order_id = " +
              orderId
          ),
          "Order_Timeline"
        ).map((row) => ({
          id: String(row.ROWID),
          status: row.status || "",
          note: row.note || "",
          actor_type: row.actor_type || "",
          happened_at: row.happened_at || "",
        }));
      } catch (_) {
        timeline = [];
      }
      if (timeline.length === 0) {
        timeline.push({
          id: "current",
          status: order.status,
          note: "Current order status",
          actor_type: "SYSTEM",
          happened_at: "",
        });
      }
      sendOk(res, { timeline });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/order/cancel", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const orderId = asId(req.body.order_id, "order_id");
      const reason = optionalText(req.body.reason, "reason", 255) || "Cancelled by customer";
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      if (!["PLACED", "CONFIRMED", "PROCESSING"].includes(order.status)) {
        const error = new Error("This order cannot be cancelled now");
        error.status = 409;
        throw error;
      }

      await releaseReservedInventory(req, orderId, "Released after order cancellation");
      await req.catalystApp.datastore().table("Orders").updateRow({
        ROWID: order.ROWID,
        status: "CANCELLED",
        payment_status: order.payment_status === "PAID" ? "REFUND_PENDING" : order.payment_status,
        notes: reason,
      });
      const items = await loadOrderItems(zcql, orderId);
      for (const item of items) {
        await req.catalystApp.datastore().table("Order_Items").updateRow({
          ROWID: item.id,
          status: "CANCELLED",
        });
      }
      if (order.payment_status === "PAID") {
        await req.catalystApp.datastore().table("Refunds").insertRow({
          user_id: user.user_id,
          reference_type: "ORDER",
          reference_id: orderId,
          amount: money(order.grand_total),
          currency: order.currency || "INR",
          reason,
          status: "REQUESTED",
        });
      }
      await addTimeline(req, orderId, "CANCELLED", reason, "CUSTOMER");
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Order cancelled",
        "Your Baylen order has been cancelled.",
        "ORDER",
        orderId
      );
      const updated = await loadOrderForUser(zcql, user.user_id, orderId);
      sendOk(res, { order: mapOrder(updated, await loadOrderItems(zcql, orderId)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/order/return", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const orderId = asId(req.body.order_id, "order_id");
      const orderItemId = req.body.order_item_id
        ? asId(req.body.order_item_id, "order_item_id")
        : null;
      const reason = optionalText(req.body.reason, "reason", 255);
      if (!reason) {
        const error = new Error("reason is required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const order = await loadOrderForUser(zcql, user.user_id, orderId);
      if (!["DELIVERED", "COMPLETED"].includes(order.status)) {
        const error = new Error("Return is available only after delivery");
        error.status = 409;
        throw error;
      }
      if (order.payment_status !== "PAID") {
        const error = new Error("Return requires a paid order");
        error.status = 409;
        throw error;
      }
      if (orderItemId) {
        const item = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID FROM Order_Items WHERE ROWID = " +
              orderItemId +
              " AND order_id = " +
              orderId
          ),
          "Order_Items"
        );
        if (!item) {
          const error = new Error("Order item not found");
          error.status = 404;
          throw error;
        }
      }
      await req.catalystApp.datastore().table("Returns").insertRow({
        user_id: user.user_id,
        order_id: orderId,
        order_item_id: orderItemId,
        reason,
        status: "REQUESTED",
      });
      await req.catalystApp.datastore().table("Orders").updateRow({
        ROWID: order.ROWID,
        status: "RETURN_REQUESTED",
      });
      await addTimeline(req, orderId, "RETURN_REQUESTED", reason, "CUSTOMER");
      await safeNotification(
        req,
        user.user_id,
        "ORDER",
        "Return requested",
        "Your Baylen return request has been received.",
        "ORDER",
        orderId
      );
      const updated = await loadOrderForUser(zcql, user.user_id, orderId);
      sendOk(res, { order: mapOrder(updated, await loadOrderItems(zcql, orderId)) });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = checkoutRoutes;
