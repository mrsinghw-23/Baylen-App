const { asId, asQty, rowOf, rowsOf, num, sendOk, sqlString } = require("../lib/http");
const { money, normalizeCode, validateCouponForSubtotal } = require("../lib/coupons");
const { requireUser, signedInUser, guestSessionId } = require("../lib/session");
const { totalAvailableForProduct } = require("../lib/inventory-ops");
const { canFulfillQuantity, parseLocation } = require("../lib/product-availability");

const MAX_QTY = 99;

function usableImage(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "";
  }
  if (
    value.indexOf("placehold.co") !== -1 ||
    value.indexOf("placeholder") !== -1 ||
    value.indexOf("books-image") !== -1
  ) {
    return "";
  }
  return value;
}

function mapOffer(row) {
  return {
    id: String(row.ROWID),
    title: row.title || row.code || "",
    code: row.code || "",
    description: row.description || "",
    discount_type: row.discount_type || "",
    discount_value: money(row.discount_value),
    min_order_value: money(row.min_order_value),
  };
}

function mapCatalogProduct(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug || "",
    sku: row.sku || "",
    category_id: row.category_id ? String(row.category_id) : "",
    brand_id: row.brand_id ? String(row.brand_id) : "",
    brand_name: row.brand_name || "",
    short_description: row.short_description || "",
    description: row.description || "",
    mrp: money(row.mrp),
    selling_price: money(row.selling_price),
    currency: row.currency || "INR",
    tax_percent: num(row.tax_percent),
    thumbnail_url: usableImage(row.thumbnail_url),
    has_variants: row.has_variants === true || row.has_variants === "true",
    is_featured: row.is_featured === true || row.is_featured === "true",
    available_quantity: num(row.available_quantity),
    status: row.status || "ACTIVE",
  };
}

async function loadProduct(zcql, productId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, category_id, thumbnail_url, mrp, selling_price, currency, tax_percent, status FROM Products WHERE ROWID = " +
        productId +
        " AND status = 'ACTIVE'"
    ),
    "Products"
  );
}

async function loadVariant(zcql, productId, variantId) {
  if (!variantId) {
    return null;
  }
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, sku, variant_name, variant_value, mrp, selling_price, currency FROM Product_Variants WHERE ROWID = " +
        variantId +
        " AND product_id = " +
        productId +
        " AND is_active = true"
    ),
    "Product_Variants"
  );
}

function cartLocation(req) {
  const body = req.body || {};
  return (
    parseLocation(
      body.latitude != null ? body.latitude : req.query.latitude,
      body.longitude != null ? body.longitude : req.query.longitude
    ) || null
  );
}

async function availableStock(zcql, productId, variantId) {
  return totalAvailableForProduct(zcql, productId, variantId);
}

async function assertFulfillable(req, productId, variantId, requestedQty) {
  const location = cartLocation(req);
  const ok = await canFulfillQuantity(req.catalystApp, {
    productId,
    variantId,
    quantity: requestedQty,
    latitude: location && location.latitude,
    longitude: location && location.longitude,
  });
  if (!ok) {
    const available = await availableStock(req.catalystApp.zcql(), productId, variantId);
    assertStock(available, requestedQty);
  }
}

function assertStock(available, requested) {
  if (available < requested) {
    const remaining = Math.max(0, available);
    const error = new Error(
      remaining === 0
        ? "This product is out of stock"
        : "Insufficient stock. Only " + remaining + " remaining."
    );
    error.status = 409;
    throw error;
  }
}

function includedTax(items, payable) {
  const subtotal = items.reduce((sum, item) => sum + item.line_total, 0);
  if (subtotal <= 0 || payable <= 0) {
    return 0;
  }
  let tax = 0;
  items.forEach((item) => {
    const pct = num(item.tax_percent);
    if (pct <= 0) {
      return;
    }
    const portion = payable * (item.line_total / subtotal);
    tax += portion * (pct / (100 + pct));
  });
  return money(tax);
}

function emptyCartPayload(isGuest) {
  return {
    id: "",
    currency: "INR",
    status: "ACTIVE",
    is_guest: isGuest === true,
    items: [],
    item_count: 0,
    mrp_total: 0,
    subtotal: 0,
    item_savings: 0,
    discount_amount: 0,
    tax_amount: 0,
    tax_included: true,
    shipping_amount: 0,
    shipping_label: "Free delivery",
    total: 0,
    coupon: null,
    coupon_error: "",
  };
}

function resolveActor(req, options) {
  const requireActor = !options || options.requireActor !== false;
  const user = signedInUser(req);
  if (user) {
    return { userId: user.user_id, guestSessionId: "", isGuest: false };
  }
  const guestId = guestSessionId(req);
  if (guestId) {
    return { userId: "", guestSessionId: guestId, isGuest: true };
  }
  if (requireActor) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  return { userId: "", guestSessionId: "", isGuest: true };
}

async function findCart(req, actor) {
  const zcql = req.catalystApp.zcql();
  if (actor.userId) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, status, currency, coupon_code, discount_amount FROM Carts WHERE user_id = " +
          actor.userId +
          " AND status = 'ACTIVE' AND is_active = true"
      ),
      "Carts"
    );
  }
  if (actor.guestSessionId) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, status, currency, coupon_code, discount_amount FROM Carts WHERE guest_session_id = " +
          sqlString(actor.guestSessionId) +
          " AND status = 'ACTIVE' AND is_active = true"
      ),
      "Carts"
    );
  }
  return null;
}

async function getOrCreateCart(req, actor) {
  if (!actor || (!actor.userId && !actor.guestSessionId)) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  const existing = await findCart(req, actor);
  if (existing) {
    return existing;
  }
  const payload = {
    status: "ACTIVE",
    currency: "INR",
    coupon_code: null,
    discount_amount: 0,
    is_active: true,
  };
  if (actor.userId) {
    payload.user_id = actor.userId;
  }
  if (actor.guestSessionId) {
    payload.guest_session_id = actor.guestSessionId;
  }
  await req.catalystApp.datastore().table("Carts").insertRow(payload);
  const created = await findCart(req, actor);
  if (!created) {
    const error = new Error("Could not create cart");
    error.status = 500;
    throw error;
  }
  return created;
}

async function loadRecommendations(req, cartItems) {
  const zcql = req.catalystApp.zcql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, category_id, brand_id, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status FROM Products WHERE status = 'ACTIVE'"
    ),
    "Products"
  );
  const inCart = new Set(
    (cartItems || []).map((item) => String(item.product_id || "")).filter(Boolean)
  );
  const categoryIds = new Set(
    (cartItems || []).map((item) => String(item.category_id || "")).filter(Boolean)
  );
  const available = rows
    .filter((row) => !inCart.has(String(row.ROWID)))
    .map(mapCatalogProduct);
  const featured = available.filter((product) => product.is_featured);
  const related = available.filter(
    (product) => product.category_id && categoryIds.has(product.category_id)
  );
  const pool = featured.length > 0 ? featured : available;
  const relatedPool = related.length > 0 ? related : pool;
  return {
    last_minute_additions: pool.slice(0, 8),
    you_may_also_like: relatedPool.slice(0, 8),
    frequently_bought_together: relatedPool.slice(0, 4),
  };
}

async function loadOffers(req) {
  try {
    const rows = rowsOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, title, code, description, discount_type, discount_value, min_order_value FROM Coupons WHERE is_active = true"
        ),
      "Coupons"
    );
    return rows.map(mapOffer);
  } catch (_) {
    return [];
  }
}

async function loadCartPayload(req, cart, options) {
  const ignoreCoupon = options && options.ignoreCoupon === true;
  const isGuest = options && options.isGuest === true;
  if (!cart) {
    const recs = await loadRecommendations(req, []);
    const offers = await loadOffers(req);
    return {
      cart: emptyCartPayload(isGuest),
      recommendations: recs,
      offers,
    };
  }
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
    if (!product) {
      items.push({
        id: String(row.ROWID),
        product_id: String(row.product_id),
        variant_id: row.variant_id ? String(row.variant_id) : "",
        name: "Product unavailable",
        variant_label: "",
        thumbnail_url: "",
        quantity: Math.max(0, num(row.quantity)),
        unit_mrp: money(row.unit_mrp),
        unit_price: money(row.unit_price),
        line_total: 0,
        line_mrp: 0,
        tax_percent: 0,
        available_quantity: 0,
        in_stock: false,
        unavailable: true,
        currency: cart.currency || "INR",
        category_id: "",
      });
      continue;
    }
    const variant = await loadVariant(
      zcql,
      asId(row.product_id, "product_id"),
      row.variant_id ? asId(row.variant_id, "variant_id") : null
    );
    const quantity = Math.max(0, num(row.quantity));
    const catalogUnitPrice =
      variant && num(variant.selling_price) > 0
        ? num(variant.selling_price)
        : num(product.selling_price);
    const catalogUnitMrp =
      variant && num(variant.mrp) > 0 ? num(variant.mrp) : num(product.mrp);
    const unitPrice = money(catalogUnitPrice > 0 ? catalogUnitPrice : row.unit_price);
    const unitMrp = money(catalogUnitMrp > 0 ? catalogUnitMrp : row.unit_mrp);
    const available = await availableStock(
      zcql,
      asId(row.product_id, "product_id"),
      row.variant_id ? asId(row.variant_id, "variant_id") : null
    );
    const variantLabel = variant
      ? [variant.variant_name, variant.variant_value].filter(Boolean).join(" ")
      : "";
    items.push({
      id: String(row.ROWID),
      product_id: String(row.product_id),
      variant_id: row.variant_id ? String(row.variant_id) : "",
      name: product.name || "Product",
      variant_label: variantLabel,
      thumbnail_url: usableImage(product.thumbnail_url),
      quantity,
      unit_mrp: unitMrp,
      unit_price: unitPrice,
      line_total: money(unitPrice * quantity),
      line_mrp: money(unitMrp * quantity),
      tax_percent: num(product.tax_percent),
      available_quantity: available,
      in_stock: available >= quantity && available > 0,
      unavailable: false,
      currency: cart.currency || "INR",
      category_id: product.category_id ? String(product.category_id) : "",
    });
  }

  const sellable = items.filter((item) => !item.unavailable);
  const subtotal = money(sellable.reduce((sum, item) => sum + item.line_total, 0));
  const mrpTotal = money(sellable.reduce((sum, item) => sum + item.line_mrp, 0));
  const itemSavings = money(Math.max(0, mrpTotal - subtotal));
  let coupon = null;
  let discountAmount = 0;
  let couponError = "";
  const couponCode = String(cart.coupon_code || "").trim();
  if (!ignoreCoupon && couponCode && subtotal > 0) {
    try {
      const validated = await validateCouponForSubtotal(req, couponCode, subtotal);
      coupon = validated.coupon;
      discountAmount = money(validated.discountAmount);
    } catch (error) {
      couponError = error.message || "Coupon is not valid";
    }
  }
  const shippingAmount = 0;
  const payable = money(Math.max(0, subtotal - discountAmount));
  const taxAmount = includedTax(sellable, payable);
  const total = money(payable + shippingAmount);
  const [recommendations, offers] = await Promise.all([
    loadRecommendations(req, sellable),
    loadOffers(req),
  ]);
  return {
    cart: {
      id: String(cart.ROWID),
      currency: cart.currency || "INR",
      status: cart.status || "ACTIVE",
      is_guest: isGuest === true,
      items,
      item_count: items.reduce((sum, item) => sum + item.quantity, 0),
      mrp_total: mrpTotal,
      subtotal,
      item_savings: itemSavings,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      tax_included: true,
      shipping_amount: shippingAmount,
      shipping_label: "Free delivery",
      total,
      coupon,
      coupon_error: couponError,
    },
    recommendations,
    offers,
  };
}

async function findCartItem(req, cartId, itemId) {
  const zcql = req.catalystApp.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, cart_id, product_id, variant_id, quantity FROM Cart_Items WHERE ROWID = " +
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

function sendCart(res, payload) {
  sendOk(res, payload);
}

function cartRoutes(app) {
  app.get("/v1/cart", async (req, res, next) => {
    try {
      const actor = resolveActor(req, { requireActor: false });
      if (!actor.userId && !actor.guestSessionId) {
        sendCart(res, await loadCartPayload(req, null, { isGuest: true }));
        return;
      }
      const cart = await findCart(req, actor);
      sendCart(res, await loadCartPayload(req, cart, { isGuest: actor.isGuest }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/items", async (req, res, next) => {
    try {
      const actor = resolveActor(req, { requireActor: true });
      const productId = asId(req.body.product_id, "product_id");
      const quantity = req.body.quantity == null ? 1 : asQty(req.body.quantity, "quantity");
      const variantId = req.body.variant_id ? asId(req.body.variant_id, "variant_id") : null;

      const zcql = req.catalystApp.zcql();
      const product = await loadProduct(zcql, productId);
      if (!product) {
        const error = new Error("Product not found");
        error.status = 404;
        throw error;
      }
      const variant = await loadVariant(zcql, productId, variantId);
      if (variantId && !variant) {
        const error = new Error("Variant not found");
        error.status = 404;
        throw error;
      }

      const cart = await getOrCreateCart(req, actor);
      let query =
        "SELECT ROWID, quantity FROM Cart_Items WHERE cart_id = " +
        cart.ROWID +
        " AND product_id = " +
        productId +
        " AND is_active = true";
      query += variantId ? " AND variant_id = " + variantId : " AND variant_id IS NULL";
      const existing = rowOf(await zcql.executeZCQLQuery(query), "Cart_Items");
      const requestedQty = existing ? num(existing.quantity) + quantity : quantity;
      assertStock(await availableStock(zcql, productId, variantId), requestedQty);
      await assertFulfillable(req, productId, variantId, requestedQty);
      const priceSource = variant || product;

      if (existing) {
        const nextQty = Math.min(MAX_QTY, num(existing.quantity) + quantity);
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: existing.ROWID,
          quantity: nextQty,
          unit_price: money(priceSource.selling_price),
          unit_mrp: money(priceSource.mrp),
        });
      } else {
        await req.catalystApp.datastore().table("Cart_Items").insertRow({
          cart_id: cart.ROWID,
          product_id: productId,
          variant_id: variantId,
          quantity: Math.min(MAX_QTY, quantity),
          unit_price: money(priceSource.selling_price),
          unit_mrp: money(priceSource.mrp),
          is_active: true,
        });
      }

      sendCart(res, await loadCartPayload(req, cart, { isGuest: actor.isGuest }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/item/quantity", async (req, res, next) => {
    try {
      const actor = resolveActor(req, { requireActor: true });
      const itemId = asId(req.body.item_id, "item_id");
      const quantity = Number(req.body.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) {
        const error = new Error("quantity must be a whole number");
        error.status = 400;
        throw error;
      }

      const cart = await getOrCreateCart(req, actor);
      const item = await findCartItem(req, cart.ROWID, itemId);

      if (quantity < 1) {
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          is_active: false,
          quantity: 0,
        });
      } else {
        await assertFulfillable(
          req,
          asId(item.product_id, "product_id"),
          item.variant_id ? asId(item.variant_id, "variant_id") : null,
          quantity
        );
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          quantity: Math.min(MAX_QTY, quantity),
        });
      }

      sendCart(res, await loadCartPayload(req, cart, { isGuest: actor.isGuest }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/item/remove", async (req, res, next) => {
    try {
      const actor = resolveActor(req, { requireActor: true });
      const itemId = asId(req.body.item_id, "item_id");
      const cart = await getOrCreateCart(req, actor);
      const item = await findCartItem(req, cart.ROWID, itemId);
      await req.catalystApp.datastore().table("Cart_Items").updateRow({
        ROWID: item.ROWID,
        is_active: false,
        quantity: 0,
      });
      sendCart(res, await loadCartPayload(req, cart, { isGuest: actor.isGuest }));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/coupon", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const code = normalizeCode(req.body.coupon_code || req.body.code);
      const cart = await getOrCreateCart(req, { userId: user.user_id, guestSessionId: "" });
      const payload = await loadCartPayload(req, cart, { ignoreCoupon: true });
      const subtotal = payload.cart.subtotal;
      if (subtotal <= 0) {
        const error = new Error("Cart is empty");
        error.status = 400;
        throw error;
      }
      const validated = await validateCouponForSubtotal(req, code, subtotal);
      await req.catalystApp.datastore().table("Carts").updateRow({
        ROWID: cart.ROWID,
        coupon_code: code,
        discount_amount: money(validated.discountAmount),
      });
      sendCart(
        res,
        await loadCartPayload(req, {
          ...cart,
          coupon_code: code,
          discount_amount: money(validated.discountAmount),
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/cart/coupon/remove", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const cart = await getOrCreateCart(req, { userId: user.user_id, guestSessionId: "" });
      await req.catalystApp.datastore().table("Carts").updateRow({
        ROWID: cart.ROWID,
        coupon_code: null,
        discount_amount: 0,
      });
      sendCart(
        res,
        await loadCartPayload(req, { ...cart, coupon_code: "", discount_amount: 0 })
      );
    } catch (error) {
      next(error);
    }
  });
}

module.exports = cartRoutes;
