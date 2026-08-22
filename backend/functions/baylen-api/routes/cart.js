const { asId, asQty, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");

const MAX_QTY = 99;

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

async function loadProduct(zcql, productId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, thumbnail_url, mrp, selling_price, currency, status FROM Products WHERE ROWID = " +
        productId +
        " AND status = 'ACTIVE'"
    ),
    "Products"
  );
}

async function getOrCreateCart(req, userId) {
  const zcql = req.catalystApp.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status, currency FROM Carts WHERE user_id = " +
        userId +
        " AND status = 'ACTIVE' AND is_active = true"
    ),
    "Carts"
  );
  if (existing) {
    return existing;
  }
  await req.catalystApp.datastore().table("Carts").insertRow({
    user_id: userId,
    status: "ACTIVE",
    currency: "INR",
    is_active: true,
  });
  const created = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status, currency FROM Carts WHERE user_id = " +
        userId +
        " AND status = 'ACTIVE' AND is_active = true"
    ),
    "Carts"
  );
  if (!created) {
    const error = new Error("Could not create cart");
    error.status = 500;
    throw error;
  }
  return created;
}

async function loadCartPayload(req, cart) {
  const zcql = req.catalystApp.zcql();
  const itemRows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, variant_id, quantity, unit_mrp, unit_price FROM Cart_Items WHERE cart_id = " +
        cart.ROWID +
        " AND is_active = true"
    ),
    "Cart_Items"
  );

  const items = [];
  for (const row of itemRows) {
    const product = await loadProduct(zcql, asId(row.product_id, "product_id"));
    const quantity = Math.max(0, num(row.quantity));
    const unitPrice = money(row.unit_price);
    items.push({
      id: String(row.ROWID),
      product_id: String(row.product_id),
      variant_id: row.variant_id ? String(row.variant_id) : "",
      name: product ? product.name : "Product",
      thumbnail_url: product ? product.thumbnail_url || "" : "",
      quantity,
      unit_mrp: money(row.unit_mrp),
      unit_price: unitPrice,
      line_total: money(unitPrice * quantity),
      currency: cart.currency || "INR",
    });
  }

  const subtotal = money(items.reduce((sum, item) => sum + item.line_total, 0));
  return {
    cart: {
      id: String(cart.ROWID),
      currency: cart.currency || "INR",
      status: cart.status || "ACTIVE",
      items,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal,
    },
  };
}

async function findCartItem(req, cartId, itemId) {
  const zcql = req.catalystApp.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, cart_id, quantity FROM Cart_Items WHERE ROWID = " +
        itemId +
        " AND cart_id = " +
        cartId +
        " AND is_active = true"
    ),
    "Cart_Items"
  );
  if (!row) {
    const error = new Error("Cart item not found");
    error.status = 404;
    throw error;
  }
  return row;
}

function cartRoutes(app) {
  app.get("/v1/cart", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const cart = await getOrCreateCart(req, user.user_id);
      sendOk(res, await loadCartPayload(req, cart));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/items", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const productId = asId(req.body.product_id, "product_id");
      const quantity = req.body.quantity == null ? 1 : asQty(req.body.quantity, "quantity");
      const variantId = req.body.variant_id
        ? asId(req.body.variant_id, "variant_id")
        : null;

      const zcql = req.catalystApp.zcql();
      const product = await loadProduct(zcql, productId);
      if (!product) {
        const error = new Error("Product not found");
        error.status = 404;
        throw error;
      }

      const cart = await getOrCreateCart(req, user.user_id);
      let query =
        "SELECT ROWID, quantity FROM Cart_Items WHERE cart_id = " +
        cart.ROWID +
        " AND product_id = " +
        productId +
        " AND is_active = true";
      query += variantId ? " AND variant_id = " + variantId : " AND variant_id IS NULL";
      const existing = rowOf(await zcql.executeZCQLQuery(query), "Cart_Items");

      if (existing) {
        const nextQty = Math.min(MAX_QTY, num(existing.quantity) + quantity);
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: existing.ROWID,
          quantity: nextQty,
          unit_price: money(product.selling_price),
          unit_mrp: money(product.mrp),
        });
      } else {
        await req.catalystApp.datastore().table("Cart_Items").insertRow({
          cart_id: cart.ROWID,
          product_id: productId,
          variant_id: variantId,
          quantity: Math.min(MAX_QTY, quantity),
          unit_price: money(product.selling_price),
          unit_mrp: money(product.mrp),
          is_active: true,
        });
      }

      sendOk(res, await loadCartPayload(req, cart));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/item/quantity", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const itemId = asId(req.body.item_id, "item_id");
      const quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        const error = new Error("quantity must be a whole number");
        error.status = 400;
        throw error;
      }

      const cart = await getOrCreateCart(req, user.user_id);
      const item = await findCartItem(req, cart.ROWID, itemId);

      if (quantity < 1) {
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          is_active: false,
          quantity: 0,
        });
      } else {
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          quantity: Math.min(MAX_QTY, quantity),
        });
      }

      sendOk(res, await loadCartPayload(req, cart));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/item/remove", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const itemId = asId(req.body.item_id, "item_id");
      const cart = await getOrCreateCart(req, user.user_id);
      const item = await findCartItem(req, cart.ROWID, itemId);
      await req.catalystApp.datastore().table("Cart_Items").updateRow({
        ROWID: item.ROWID,
        is_active: false,
        quantity: 0,
      });
      sendOk(res, await loadCartPayload(req, cart));
    } catch (error) {
      next(error);
    }
  });
}

module.exports = cartRoutes;
