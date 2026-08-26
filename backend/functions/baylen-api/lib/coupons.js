const { optionalText, rowOf, num, sqlString } = require("./http");

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function normalizeCode(value) {
  return optionalText(value, "coupon_code", 40).toUpperCase();
}

function parseTime(value) {
  if (!value) {
    return null;
  }
  const time = Date.parse(String(value).replace(" ", "T"));
  return Number.isFinite(time) ? time : null;
}

function mapCoupon(row, discountAmount) {
  return {
    id: String(row.ROWID),
    code: row.code || "",
    title: row.title || row.code || "",
    description: row.description || "",
    discount_type: row.discount_type || "",
    discount_value: money(row.discount_value),
    min_order_value: money(row.min_order_value),
    discount_amount: money(discountAmount),
  };
}

function calculateCouponDiscount(row, subtotal) {
  const minOrderValue = money(row.min_order_value);
  if (subtotal < minOrderValue) {
    const error = new Error("Coupon requires minimum order value of " + minOrderValue);
    error.status = 409;
    throw error;
  }

  const now = Date.now();
  const startsAt = parseTime(row.starts_at);
  const endsAt = parseTime(row.ends_at);
  if (startsAt && now < startsAt) {
    const error = new Error("Coupon is not active yet");
    error.status = 409;
    throw error;
  }
  if (endsAt && now > endsAt) {
    const error = new Error("Coupon has expired");
    error.status = 409;
    throw error;
  }

  const type = String(row.discount_type || "").trim().toUpperCase();
  const value = money(row.discount_value);
  if (value <= 0) {
    const error = new Error("Coupon discount is not valid");
    error.status = 409;
    throw error;
  }

  if (type === "PERCENT" || type === "PERCENTAGE") {
    return money(Math.min(subtotal, subtotal * (value / 100)));
  }
  if (type === "FIXED" || type === "FLAT" || type === "AMOUNT") {
    return money(Math.min(subtotal, value));
  }

  const error = new Error("Coupon discount type is not supported");
  error.status = 409;
  throw error;
}

async function validateCouponForSubtotal(req, codeValue, subtotal) {
  const code = normalizeCode(codeValue);
  if (!code) {
    const error = new Error("coupon_code is required");
    error.status = 400;
    throw error;
  }
  const row = rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, code, title, description, discount_type, discount_value, min_order_value, starts_at, ends_at, usage_limit, is_active FROM Coupons WHERE code = " +
          sqlString(code) +
          " AND is_active = true"
      ),
    "Coupons"
  );
  if (!row) {
    const error = new Error("Coupon not found");
    error.status = 404;
    throw error;
  }

  const discountAmount = calculateCouponDiscount(row, money(subtotal));
  return {
    coupon: mapCoupon(row, discountAmount),
    discountAmount,
  };
}

module.exports = {
  money,
  normalizeCode,
  validateCouponForSubtotal,
};
