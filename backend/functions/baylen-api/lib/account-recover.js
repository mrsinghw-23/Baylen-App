"use strict";

const { isTruthy, num, rowOf, rowsOf } = require("./http");
const { USER_SELECT, identityFromSession } = require("./phone-identity");
const { writeCustomerAudit } = require("./audit");

const ORDER_LIMIT = 20;
const BOOKING_LIMIT = 30;
const WISHLIST_LIMIT = 50;
const PAYMENT_LIMIT = 20;

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function asBool(value, fallback) {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return fallback;
}

function newestFirst(rows, limit) {
  const copy = Array.isArray(rows) ? rows.slice() : [];
  copy.sort((a, b) => String(b.ROWID || "").localeCompare(String(a.ROWID || "")));
  return copy.slice(0, limit);
}

async function safeRows(zcql, query, tableName) {
  try {
    return rowsOf(await zcql.executeZCQLQuery(query), tableName);
  } catch (_) {
    return [];
  }
}

function mapAddress(row) {
  return {
    id: String(row.ROWID),
    label: row.label || row.address_type || "",
    full_name: row.full_name || row.recipient_name || "",
    phone: row.phone || row.recipient_phone || "",
    line1: row.line1 || row.address_line1 || "",
    line2: row.line2 || row.address_line2 || "",
    landmark: row.landmark || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    country: row.country || "India",
    latitude: row.latitude || "",
    longitude: row.longitude || "",
    is_default: row.is_default === true || row.is_default === "true",
  };
}

function mapOrderSummary(row) {
  return {
    id: String(row.ROWID),
    order_number: row.order_number || "",
    status: row.status || "",
    payment_status: row.payment_status || "",
    payment_method: row.payment_method || "",
    currency: row.currency || "INR",
    subtotal: money(row.subtotal),
    grand_total: money(row.grand_total),
    shipping_name: row.shipping_name || "",
    shipping_phone: row.shipping_phone || "",
    shipping_line1: row.shipping_line1 || "",
    shipping_city: row.shipping_city || "",
    shipping_state: row.shipping_state || "",
    shipping_postal_code: row.shipping_postal_code || "",
    fulfillment_mode: row.fulfillment_mode || "",
    created_at: row.CREATEDTIME || "",
    items: [],
    children: [],
  };
}

function mapAppointmentSummary(row) {
  const dateText = String(row.appointment_date || "");
  const iso = dateText.match(/^(\d{4}-\d{2}-\d{2})/);
  return {
    id: String(row.ROWID),
    type: "salon",
    appointment_number: row.appointment_number || "",
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    staff_id: row.staff_id ? String(row.staff_id) : "",
    appointment_date: iso ? iso[1] : dateText.slice(0, 10),
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    status: row.status || "",
    payment_status: row.payment_status || "",
    currency: row.currency || "INR",
    grand_total: money(row.grand_total),
    items: [],
  };
}

function mapJobSummary(row) {
  return {
    id: String(row.ROWID),
    type: "home_service",
    appointment_id: row.appointment_id ? String(row.appointment_id) : "",
    provider_id: row.provider_id ? String(row.provider_id) : "",
    status: row.status || "",
    visit_line1: row.visit_line1 || "",
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    scheduled_at: row.scheduled_at || "",
    requested_at: row.requested_at || "",
    grand_total: money(row.grand_total),
    currency: row.currency || "INR",
  };
}

function mapWishlist(row) {
  return {
    id: String(row.ROWID),
    product_id: row.product_id ? String(row.product_id) : "",
    variant_id: row.variant_id ? String(row.variant_id) : "",
    name: row.name || "",
    thumbnail_url: row.thumbnail_url || "",
    mrp: num(row.mrp),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapPreferences(row) {
  return {
    push_enabled: row ? asBool(row.push_enabled, true) : true,
    email_enabled: row ? asBool(row.email_enabled, true) : true,
    order_updates: row ? asBool(row.order_updates, true) : true,
    booking_updates: row ? asBool(row.booking_updates, true) : true,
    service_tracking: row ? asBool(row.service_tracking, true) : true,
    offers: row ? asBool(row.offers, true) : true,
  };
}

function mapPayment(row) {
  return {
    id: String(row.ROWID),
    reference_type: row.reference_type || "",
    reference_id: row.reference_id ? String(row.reference_id) : "",
    provider: row.provider || "",
    provider_order_id: row.provider_order_id || "",
    provider_payment_id: row.provider_payment_id || "",
    amount: money(row.amount),
    currency: row.currency || "INR",
    status: row.status || "",
  };
}

function mapReturn(row) {
  return {
    id: String(row.ROWID),
    order_id: row.order_id ? String(row.order_id) : "",
    status: row.status || "",
    reason: row.reason || "",
    created_at: row.CREATEDTIME || "",
  };
}

function realEmail(value) {
  const email = String(value || "");
  return email.includes(".local") ? "" : email;
}

function displayNameParts(firstName, lastName) {
  const first = String(firstName || "");
  const last = String(lastName || "");
  return {
    first_name: first === "Pending" || first === "Baylen" ? "" : first,
    last_name: last === "Registration" || last === "Customer" ? "" : last,
  };
}

function mapUserIdentity(userRow, profileRow) {
  const names = displayNameParts(userRow.First_Name, userRow.Last_Name);
  const profileName = String(profileRow && profileRow.full_name ? profileRow.full_name : "").trim();
  const split = profileName.split(/\s+/).filter(Boolean);
  const firstName = names.first_name || split[0] || "";
  const lastName = names.last_name || split.slice(1).join(" ") || "";
  const email = realEmail((profileRow && profileRow.email) || userRow.Email);
  const mobile = (profileRow && profileRow.mobile) || userRow.Phone || "";
  const isComplete = Boolean(
    firstName.trim().length >= 2 &&
      lastName.trim().length >= 1 &&
      email.trim().length > 3 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
  return {
    user_id: String(userRow.ROWID),
    email,
    first_name: firstName,
    last_name: lastName,
    mobile,
    gender: (profileRow && profileRow.gender) || userRow.gender || "",
    date_of_birth: (profileRow && profileRow.date_of_birth) || userRow.date_of_birth || "",
    profile_photo_url:
      (profileRow && profileRow.profile_photo_url) || userRow.profile_image || "",
    created_at: userRow.CREATEDTIME || "",
    is_profile_complete: isComplete,
  };
}

function mapProfile(userRow, profileRow) {
  const identity = mapUserIdentity(userRow, profileRow);
  return {
    user_id: identity.user_id,
    full_name:
      (profileRow && profileRow.full_name) ||
      [identity.first_name, identity.last_name].filter(Boolean).join(" "),
    mobile: identity.mobile,
    email: identity.email,
    gender: identity.gender,
    date_of_birth: identity.date_of_birth,
    profile_photo_url: identity.profile_photo_url,
    loyalty_tier: profileRow && profileRow.loyalty_tier ? profileRow.loyalty_tier : "Base",
    loyalty_points: Number(profileRow && profileRow.loyalty_points ? profileRow.loyalty_points : 0),
    created_at: identity.created_at,
    default_address_id:
      profileRow && profileRow.default_address_id ? String(profileRow.default_address_id) : "",
  };
}

async function loadCustomerRow(req, userId) {
  const zcql = req.catalystApp.zcql();
  const userRow = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + USER_SELECT + " FROM Users WHERE ROWID = " + userId
    ),
    "Users"
  );
  if (!userRow) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  const profileRow = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, full_name, mobile, email, gender, date_of_birth, profile_photo_url, loyalty_tier, loyalty_points, default_address_id, is_active FROM User_Profiles WHERE user_id = " +
        userId
    ),
    "User_Profiles"
  );
  if (
    profileRow &&
    profileRow.is_active !== undefined &&
    profileRow.is_active !== null &&
    profileRow.is_active !== "" &&
    !isTruthy(profileRow.is_active)
  ) {
    const error = new Error("Account is inactive");
    error.status = 403;
    throw error;
  }
  return { userRow, profileRow };
}

async function loadCustomerIdentity(req, userId) {
  const { userRow, profileRow } = await loadCustomerRow(req, userId);
  return mapUserIdentity(userRow, profileRow);
}

async function loadActiveAddresses(zcql, userId) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, label, address_type, full_name, recipient_name, phone, recipient_phone, line1, address_line1, line2, address_line2, landmark, city, state, postal_code, country, latitude, longitude, is_default, is_active FROM Addresses WHERE user_id = " +
      userId +
      " AND is_active = true",
    "Addresses"
  );
  return rows.filter((row) => isTruthy(row.is_active) || row.is_active === undefined).map(mapAddress);
}

async function loadOrderSummaries(zcql, userId, limit) {
  let rows = await safeRows(
    zcql,
    "SELECT ROWID, user_id, order_number, status, payment_status, payment_method, currency, subtotal, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code, fulfillment_mode, parent_order_id, CREATEDTIME FROM Orders WHERE user_id = " +
      userId,
    "Orders"
  );
  if (rows.length === 0) {
    rows = await safeRows(
      zcql,
      "SELECT ROWID, user_id, order_number, status, payment_status, currency, subtotal, grand_total, shipping_name, shipping_phone, shipping_line1, shipping_city, shipping_state, shipping_postal_code, CREATEDTIME FROM Orders WHERE user_id = " +
        userId,
      "Orders"
    );
  }
  const parents = rows.filter((row) => !row.parent_order_id);
  return newestFirst(parents, limit).map(mapOrderSummary);
}

async function loadAppointmentSummaries(zcql, userId, limit) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, outlet_id, staff_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, grand_total FROM Appointments WHERE user_id = " +
      userId,
    "Appointments"
  );
  return newestFirst(rows, limit).map(mapAppointmentSummary);
}

async function loadJobSummaries(zcql, userId, limit) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, appointment_id, provider_id, status, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE user_id = " +
      userId,
    "Service_Jobs"
  );
  return newestFirst(rows, limit).map(mapJobSummary);
}

async function loadWishlistSummaries(zcql, userId, limit) {
  const rows = newestFirst(
    await safeRows(
      zcql,
      "SELECT ROWID, product_id, variant_id FROM Wishlist WHERE user_id = " +
        userId +
        " AND is_active = true",
      "Wishlist"
    ),
    limit
  );
  const productIds = [
    ...new Set(rows.map((row) => String(row.product_id || "")).filter((id) => /^\d+$/.test(id))),
  ];
  const products = new Map();
  if (productIds.length > 0) {
    const productRows = await safeRows(
      zcql,
      "SELECT ROWID, name, thumbnail_url, mrp, selling_price, currency FROM Products WHERE ROWID IN (" +
        productIds.join(",") +
        ")",
      "Products"
    );
    for (const product of productRows) {
      products.set(String(product.ROWID), product);
    }
  }
  return rows.map((row) => {
    const product = products.get(String(row.product_id || ""));
    return mapWishlist({
      ...row,
      name: product ? product.name : "",
      thumbnail_url: product ? product.thumbnail_url || "" : "",
      mrp: product ? product.mrp : 0,
      selling_price: product ? product.selling_price : 0,
      currency: product ? product.currency || "INR" : "INR",
    });
  });
}

async function loadPreferences(zcql, userId) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, push_enabled, email_enabled, order_updates, booking_updates, service_tracking, offers FROM Notification_Preferences WHERE user_id = " +
      userId,
    "Notification_Preferences"
  );
  return mapPreferences(rows[0] || null);
}

async function loadPayments(zcql, userId, limit) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, reference_type, reference_id, provider, provider_order_id, provider_payment_id, amount, currency, status FROM Payments WHERE user_id = " +
      userId,
    "Payments"
  );
  return newestFirst(rows, limit).map(mapPayment);
}

async function loadReturns(zcql, userId, limit) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, order_id, status, reason, CREATEDTIME FROM Returns WHERE user_id = " + userId,
    "Returns"
  );
  return newestFirst(rows, limit).map(mapReturn);
}

function parseLimit(query, fallback, max) {
  const value = Number(query && query.limit);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), 1), max);
}

async function loadAccountSnapshot(req, sessionUser) {
  const userId = identityFromSession(sessionUser, req.query || {}, req.body || {});
  const { userRow, profileRow } = await loadCustomerRow(req, userId);
  const zcql = req.catalystApp.zcql();
  const orderLimit = parseLimit(req.query, ORDER_LIMIT, 50);
  const bookingLimit = parseLimit(req.query, BOOKING_LIMIT, 50);

  const [addresses, orders, appointments, jobs, wishlist, preferences, payments, returns] =
    await Promise.all([
      loadActiveAddresses(zcql, userId),
      loadOrderSummaries(zcql, userId, orderLimit),
      loadAppointmentSummaries(zcql, userId, bookingLimit),
      loadJobSummaries(zcql, userId, bookingLimit),
      loadWishlistSummaries(zcql, userId, WISHLIST_LIMIT),
      loadPreferences(zcql, userId),
      loadPayments(zcql, userId, PAYMENT_LIMIT),
      loadReturns(zcql, userId, PAYMENT_LIMIT),
    ]);

  const bookings = [...appointments, ...jobs];
  const snapshot = {
    user: mapUserIdentity(userRow, profileRow),
    profile: mapProfile(userRow, profileRow),
    addresses,
    orders,
    bookings,
    appointments,
    jobs,
    wishlist,
    preferences,
    payments,
    returns,
  };

  await writeCustomerAudit(req, userId, "ACCOUNT_RECOVER", "Users", userId, null, {
    addresses: addresses.length,
    orders: orders.length,
    bookings: bookings.length,
    wishlist: wishlist.length,
  });

  return snapshot;
}

module.exports = {
  identityFromSession,
  loadCustomerIdentity,
  loadAccountSnapshot,
  mapAddress,
  mapOrderSummary,
  mapAppointmentSummary,
  mapJobSummary,
  mapPreferences,
  newestFirst,
};
