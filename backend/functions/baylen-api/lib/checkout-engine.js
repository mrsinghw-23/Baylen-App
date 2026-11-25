"use strict";

const { asId, rowOf, rowsOf, num, sqlString, isTruthy } = require("./http");
const { money, validateCouponForSubtotal } = require("./coupons");
const { totalAvailableForProduct } = require("./inventory-ops");
const { requireServiceablePincode, normalizePincode } = require("./pincode");

function fail(message, status, code, details) {
  const error = new Error(message);
  error.status = status || 400;
  error.code = code || "";
  if (details) {
    error.details = details;
  }
  throw error;
}

function normalizePaymentMethod(value) {
  const method = String(value || "COD").trim().toUpperCase();
  if (["COD", "CASH_ON_DELIVERY"].includes(method)) {
    return "COD";
  }
  if (["RAZORPAY", "UPI", "CARD", "NETBANKING"].includes(method)) {
    return method === "RAZORPAY" ? "RAZORPAY" : method;
  }
  if (method === "CASHFREE") {
    return "CASHFREE";
  }
  fail("Unsupported payment method", 400, "INVALID_PAYMENT_METHOD");
}

function gatewayProviderFor(method) {
  if (method === "CASHFREE") {
    return "CASHFREE";
  }
  if (["RAZORPAY", "UPI", "CARD", "NETBANKING"].includes(method)) {
    return "RAZORPAY";
  }
  return "";
}

async function loadActiveCart(zcql, userId) {
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, currency, coupon_code FROM Carts WHERE user_id = " +
        userId +
        " AND status = 'ACTIVE' AND is_active = true"
    ),
    "Carts"
  );
}

async function liveStock(zcql, productId, variantId) {
  return totalAvailableForProduct(zcql, productId, variantId);
}

async function buildPricedLines(zcql, cartItems) {
  const lines = [];
  for (const item of cartItems) {
    const productId = asId(item.product_id, "product_id");
    const product = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku, mrp, selling_price, tax_percent, status FROM Products WHERE ROWID = " +
          productId +
          " AND status = 'ACTIVE'"
      ),
      "Products"
    );
    if (!product) {
      fail("A cart product is no longer available", 409, "PRODUCT_UNAVAILABLE");
    }
    const variantId = item.variant_id ? asId(item.variant_id, "variant_id") : null;
    let variant = null;
    if (variantId) {
      variant = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, sku, variant_name, variant_value, mrp, selling_price, is_active FROM Product_Variants WHERE ROWID = " +
            variantId +
            " AND product_id = " +
            productId
        ),
        "Product_Variants"
      );
      if (!variant) {
        fail("A selected product option is no longer available", 409, "VARIANT_UNAVAILABLE");
      }
      if (variant.is_active != null && variant.is_active !== "" && !isTruthy(variant.is_active)) {
        fail("A selected product option is no longer available", 409, "VARIANT_UNAVAILABLE");
      }
    }
    const quantity = num(item.quantity);
    if (quantity < 1) {
      fail("Cart quantity is invalid", 400, "INVALID_QUANTITY");
    }
    const available = await liveStock(zcql, productId, variantId);
    if (available < quantity) {
      fail(
        available < 1
          ? product.name + " is out of stock"
          : "Only " + available + " unit(s) of " + product.name + " remain",
        409,
        "INSUFFICIENT_STOCK"
      );
    }
    const unitPrice = money(variant ? variant.selling_price : product.selling_price);
    const unitMrp = money(variant ? variant.mrp : product.mrp);
    if (unitPrice <= 0) {
      fail("A cart product does not have a valid price", 409, "INVALID_PRICE");
    }
    lines.push({
      cart_item_id: item.ROWID,
      product_id: productId,
      variant_id: variantId,
      product_name: product.name,
      sku: (variant && variant.sku) || product.sku || "",
      variant_name: variant
        ? variant.variant_name || variant.variant_value || ""
        : "",
      quantity,
      unit_mrp: unitMrp,
      unit_price: unitPrice,
      tax_percent: money(product.tax_percent),
      line_total: money(unitPrice * quantity),
      discount_amount: money(Math.max(0, unitMrp - unitPrice) * quantity),
    });
  }
  return lines;
}

function computeTotals(lines, discountAmount) {
  const subtotal = money(lines.reduce((sum, line) => sum + line.line_total, 0));
  const shippingAmount = 0;
  const payable = money(Math.max(0, subtotal - discountAmount));
  let taxAmount = 0;
  if (subtotal > 0) {
    lines.forEach((line) => {
      const pct = num(line.tax_percent);
      if (pct > 0) {
        taxAmount += payable * (line.line_total / subtotal) * (pct / (100 + pct));
      }
    });
  }
  taxAmount = money(taxAmount);
  return {
    subtotal,
    discount: money(discountAmount),
    tax: taxAmount,
    shipping: shippingAmount,
    grand: money(payable + shippingAmount),
  };
}

const BAYLEN_ORDER_NUMBER_RE = /^BLN-(\d{4})-(\d{6})(?:-\d+)?$/;

function parseBaylenOrderSequence(orderNumber) {
  const match = String(orderNumber || "").trim().match(BAYLEN_ORDER_NUMBER_RE);
  if (!match) {
    return null;
  }
  const sequence = Number(match[2]);
  if (!Number.isFinite(sequence) || sequence < 1) {
    return null;
  }
  return { year: match[1], sequence };
}

function maxOrderSequenceForYear(orderNumbers, year) {
  const yearStr = String(year);
  let maxSeq = 0;
  for (const raw of orderNumbers || []) {
    const parsed = parseBaylenOrderSequence(raw);
    if (!parsed || parsed.year !== yearStr) {
      continue;
    }
    maxSeq = Math.max(maxSeq, parsed.sequence);
  }
  return maxSeq;
}

function formatBaylenOrderNumber(year, sequence) {
  return "BLN-" + String(year) + "-" + String(sequence).padStart(6, "0");
}

async function nextOrderNumber(zcql) {
  const year = String(new Date().getFullYear());
  let rows = [];
  try {
    // Catalyst ZCQL does not return rows for LIKE on order_number; scan and
    // filter in-process so the yearly sequence reflects the highest BLN-YYYY-######
    // value already stored (including duplicate legacy numbers).
    rows = rowsOf(
      await zcql.executeZCQLQuery("SELECT order_number FROM Orders"),
      "Orders"
    );
  } catch (_) {
    rows = [];
  }
  const orderNumbers = rows.map((row) => row.order_number);
  const maxSeq = maxOrderSequenceForYear(orderNumbers, year);
  return formatBaylenOrderNumber(year, maxSeq + 1);
}

async function findIdempotentOrder(zcql, userId, key) {
  if (!key) {
    return null;
  }
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, order_number, status, payment_status FROM Orders WHERE user_id = " +
          userId +
          " AND idempotency_key = " +
          sqlString(key)
      ),
      "Orders"
    );
  } catch (_) {
    return null;
  }
}

async function validateCheckoutCart(req, user) {
  const zcql = req.catalystApp.zcql();
  const cart = await loadActiveCart(zcql, user.user_id);
  if (!cart) {
    fail("Cart is empty", 400, "EMPTY_CART");
  }
  const cartItems = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, variant_id, quantity FROM Cart_Items WHERE cart_id = " +
        cart.ROWID +
        " AND is_active = true"
    ),
    "Cart_Items"
  );
  if (cartItems.length === 0) {
    fail("Cart is empty", 400, "EMPTY_CART");
  }
  const lines = await buildPricedLines(zcql, cartItems);
  let discountAmount = 0;
  let couponCode = "";
  const subtotal = money(lines.reduce((sum, line) => sum + line.line_total, 0));
  if (cart.coupon_code) {
    const validated = await validateCouponForSubtotal(req, cart.coupon_code, subtotal);
    discountAmount = money(validated.discountAmount);
    couponCode = validated.coupon.code;
  }
  return {
    cart,
    lines,
    totals: computeTotals(lines, discountAmount),
    couponCode,
  };
}

async function clearCheckedOutCart(app, cart, lines) {
  for (const line of lines) {
    await app.datastore().table("Cart_Items").updateRow({
      ROWID: line.cart_item_id,
      is_active: false,
      quantity: 0,
    });
  }
  await app.datastore().table("Carts").updateRow({
    ROWID: cart.ROWID,
    status: "CHECKED_OUT",
    is_active: false,
    coupon_code: null,
    discount_amount: 0,
  });
}

async function clearUserActiveCart(app, userId) {
  const zcql = app.zcql();
  const cart = await loadActiveCart(zcql, userId);
  if (!cart) {
    return;
  }
  const items = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Cart_Items WHERE cart_id = " +
        cart.ROWID +
        " AND is_active = true"
    ),
    "Cart_Items"
  );
  for (const item of items) {
    await app.datastore().table("Cart_Items").updateRow({
      ROWID: item.ROWID,
      is_active: false,
      quantity: 0,
    });
  }
  await app.datastore().table("Carts").updateRow({
    ROWID: cart.ROWID,
    status: "CHECKED_OUT",
    is_active: false,
    coupon_code: null,
    discount_amount: 0,
  });
}

module.exports = {
  normalizePaymentMethod,
  gatewayProviderFor,
  validateCheckoutCart,
  requireServiceablePincode,
  normalizePincode,
  parseBaylenOrderSequence,
  maxOrderSequenceForYear,
  formatBaylenOrderNumber,
  nextOrderNumber,
  findIdempotentOrder,
  clearCheckedOutCart,
  clearUserActiveCart,
  money,
};
