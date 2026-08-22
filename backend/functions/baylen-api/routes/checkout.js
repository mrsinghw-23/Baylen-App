const { asId, rowOf, rowsOf, num, sendOk } = require("../lib/http");
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
  return {
    id: String(row.ROWID),
    order_number: row.order_number,
    status: row.status,
    payment_status: row.payment_status,
    currency: row.currency || "INR",
    subtotal,
    discount_amount: money(row.discount_amount),
    tax_amount: money(row.tax_amount),
    shipping_amount: money(row.shipping_amount),
    grand_total: money(row.grand_total),
    shipping_name: row.shipping_name || "",
    shipping_phone: row.shipping_phone || "",
    shipping_line1: row.shipping_line1 || "",
    shipping_city: row.shipping_city || "",
    shipping_state: row.shipping_state || "",
    shipping_postal_code: row.shipping_postal_code || "",
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

function checkoutRoutes(app) {
  app.post("/v1/checkout", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const zcql = req.catalystApp.zcql();

      const cart = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, currency FROM Carts WHERE user_id = " +
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
      const orderNumber = ("BLN" + Date.now()).slice(0, 30);
      const shippingName = optionalText(body.shipping_name, "shipping_name", 100);
      const shippingPhone = optionalText(body.shipping_phone, "shipping_phone", 20);
      const shippingLine1 = optionalText(body.shipping_line1, "shipping_line1", 255);
      const shippingCity = optionalText(body.shipping_city, "shipping_city", 100);
      const shippingState = optionalText(body.shipping_state, "shipping_state", 100);
      const shippingPostal = optionalText(body.shipping_postal_code, "shipping_postal_code", 20);

      const inserted = await req.catalystApp.datastore().table("Orders").insertRow({
        user_id: user.user_id,
        order_number: orderNumber,
        status: "PLACED",
        payment_status: "PENDING",
        currency: cart.currency || "INR",
        subtotal,
        discount_amount: 0,
        tax_amount: 0,
        shipping_amount: 0,
        grand_total: subtotal,
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

      await req.catalystApp.datastore().table("Carts").updateRow({
        ROWID: cart.ROWID,
        status: "CHECKED_OUT",
        is_active: false,
      });

      const order = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, order_number, status, payment_status, currency, subtotal, discount_amount, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
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
            "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, discount_amount, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE ROWID = " +
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
          "SELECT ROWID, order_number, status, payment_status, currency, subtotal, discount_amount, tax_amount, shipping_amount, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code FROM Orders WHERE user_id = " +
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
}

module.exports = checkoutRoutes;
