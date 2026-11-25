"use strict";

const { rowOf, rowsOf, num, sqlString, isTruthy, asId, optionalText } = require("./http");
const engine = require("./salon-engine");
const { findServiceableByPincode } = require("./serviceability-admin");
const {
  customerStatusLabel,
  canCustomerCancel,
  canReschedule,
  canShowLiveTracking,
} = require("./at-home-beauty-fsm");
const { emitJobEvent } = require("./at-home-beauty-events");
const { ensureHomeServiceJob } = require("./professional-job-engine");

const CATEGORY_ALIASES = {
  hair: ["hair", "haircut", "hair cut", "hair styling"],
  beauty: ["beauty", "grooming"],
  makeup: ["makeup", "make up", "bridal makeup"],
  nails: ["nails", "nail", "manicure", "pedicure"],
  "facial-skin": ["facial", "skin", "skincare", "face"],
  "hair-care": ["hair care", "haircare", "hair spa", "hair treatment"],
};

const JOB_SELECT =
  "ROWID, booking_number, appointment_id, provider_id, outlet_id, status, visit_address_id, visit_line1, visit_city, visit_state, pincode, visit_latitude, visit_longitude, scheduled_at, requested_at, grand_total, currency, payment_status, service_name_snapshot, gender_preference, idempotency_key";

function normalizeGenderPreference(value) {
  const gender = String(value || "")
    .trim()
    .toUpperCase();
  if (gender === "MALE" || gender === "FEMALE" || gender === "UNISEX") {
    return gender;
  }
  return "";
}

function matchesBookingStatusFilter(status, filter) {
  const bucket = String(filter || "all").trim().toLowerCase();
  const normalized = String(status || "").trim().toUpperCase();
  if (bucket === "all") {
    return true;
  }
  if (bucket === "cancelled") {
    return normalized === "CANCELLED";
  }
  if (bucket === "completed") {
    return normalized === "COMPLETED";
  }
  if (bucket === "upcoming") {
    return normalized !== "CANCELLED" && normalized !== "COMPLETED";
  }
  return true;
}

async function findIdempotentBooking(zcql, userId, idempotencyKey) {
  if (!idempotencyKey) {
    return null;
  }
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          JOB_SELECT +
          " FROM Service_Jobs WHERE user_id = " +
          userId +
          " AND idempotency_key = '" +
          sqlString(idempotencyKey) +
          "' LIMIT 1"
      ),
      "Service_Jobs"
    );
  } catch (_) {
    return null;
  }
}

async function listBookings(zcql, userId, options) {
  const limit = Math.min(Math.max(Number(options?.limit) || 20, 1), 50);
  const offset = Math.max(Number(options?.offset) || 0, 0);
  const status = String(options?.status || "all").trim().toLowerCase();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT " + JOB_SELECT + " FROM Service_Jobs WHERE user_id = " + userId
    ),
    "Service_Jobs"
  );
  rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
  const filtered = rows.filter((row) => matchesBookingStatusFilter(row.status, status));
  const page = filtered.slice(offset, offset + limit);
  return {
    bookings: page.map((row) => mapJob(row)),
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + limit < filtered.length,
    },
  };
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function normalizePin(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 6 ? digits : "";
}

function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();
}

function serviceMatchesCategory(serviceType, categorySlug) {
  const slug = String(categorySlug || "").trim().toLowerCase();
  if (!slug) {
    return true;
  }
  const type = String(serviceType || "").trim().toLowerCase();
  const aliases = CATEGORY_ALIASES[slug] || [slug.replace(/-/g, " ")];
  return aliases.some((alias) => type.includes(alias) || alias.includes(type));
}

async function safeRows(zcql, query, table) {
  try {
    return rowsOf(await zcql.executeZCQLQuery(query), table);
  } catch (_) {
    return [];
  }
}

async function loadBeautyZones(zcql) {
  return safeRows(
    zcql,
    "SELECT ROWID, outlet_id, city, state, pincode_prefix, max_radius_km, is_active FROM Beauty_Service_Zones WHERE is_active = true",
    "Beauty_Service_Zones"
  );
}

function zoneMatches(zone, { city, state, pincode }) {
  if (!isTruthy(zone.is_active)) {
    return false;
  }
  const zoneCity = String(zone.city || "").trim();
  const zoneState = String(zone.state || "").trim();
  const prefix = String(zone.pincode_prefix || "").trim();
  if (prefix && pincode && !pincode.startsWith(prefix)) {
    return false;
  }
  if (zoneCity && city && !engine.citiesMatch(city, zoneCity)) {
    return false;
  }
  if (zoneState && state && normalizeSearch(zoneState) !== normalizeSearch(state)) {
    return false;
  }
  return Boolean(zoneCity || prefix);
}

function outletHomeServiceEnabled(outletId, matchedZones) {
  return matchedZones.some((zone) => String(zone.outlet_id) === outletId);
}

async function checkServiceability(zcql, input) {
  const lat = num(input.latitude ?? input.lat);
  const lng = num(input.longitude ?? input.lng);
  const pincode = normalizePin(input.pincode ?? input.postal_code);
  const city = String(input.city || input.location || "").trim();
  const state = String(input.state || "").trim();

  let region = null;
  if (pincode) {
    try {
      region = await findServiceableByPincode(zcql, pincode);
    } catch (_) {
      region = null;
    }
  }

  const zones = await loadBeautyZones(zcql);
  const matchedZones = zones.filter((zone) =>
    zoneMatches(zone, { city, state, pincode })
  );
  const zoneOutletIds = new Set(matchedZones.map((z) => String(z.outlet_id)));

  const radiusKm = Math.min(Math.max(Number(input.radius_km) || 25, 1), 80);
  const nearby = await engine.loadNearbyOutletMatches(zcql, {
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    city,
    pincode,
    postal_code: pincode,
    radius_km: radiusKm,
  });

  const eligible = [];
  for (const item of nearby) {
    const outlet = item.row;
    const outletId = String(outlet.ROWID);
    const homeEnabled = outletHomeServiceEnabled(outletId, matchedZones);
    if (!homeEnabled && !zoneOutletIds.has(outletId)) {
      const cityMatch = city ? engine.citiesMatch(city, outlet.city) : false;
      const pinMatch = pincode && normalizePin(outlet.postal_code) === pincode;
      if (!cityMatch && !pinMatch) {
        continue;
      }
    }
    const maxRadius =
      num(outlet.service_radius_km) ||
      num(matchedZones.find((z) => String(z.outlet_id) === outletId)?.max_radius_km) ||
      12;
    if (item.distance > maxRadius && lat && lng) {
      continue;
    }
    eligible.push({
      outlet_id: outletId,
      name: outlet.name || "",
      city: outlet.city || "",
      state: outlet.state || "",
      distance_km: item.distance || null,
      max_radius_km: maxRadius,
    });
  }

  eligible.sort((a, b) => (a.distance_km ?? 999) - (b.distance_km ?? 999));

  const serviceable = eligible.length > 0;
  return {
    serviceable,
    city: city || region?.city || "",
    state: state || region?.state || "",
    pincode,
    latitude: lat || null,
    longitude: lng || null,
    eligible_outlets: eligible,
    message: serviceable
      ? "Home service is available in your area"
      : "Home service is not available at this location yet",
  };
}

async function listAtHomeServices(zcql, outletId, filters) {
  const categorySlug = String((filters && filters.category) || "").trim().toLowerCase();
  const serviceType = String((filters && filters.service_type) || "").trim();
  const offers = await engine.loadOutletServiceOffers(zcql, outletId, {
    service_type: serviceType || undefined,
    gender: filters?.gender,
    q: filters?.q,
    is_at_home: true,
    fulfillment_mode: "AT_HOME",
  });
  return offers.filter((item) => {
    if (categorySlug && !serviceMatchesCategory(item.service_type, categorySlug)) {
      return false;
    }
    return true;
  });
}

async function isActiveStaffMember(zcql, staffId, outletId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Staff WHERE ROWID = " +
        asId(staffId, "staff_id") +
        " AND outlet_id = " +
        asId(outletId, "outlet_id") +
        " AND is_active = true AND status = 'ACTIVE'"
    ),
    "Staff"
  );
  return Boolean(row);
}

async function resolveEligibleStaffIds(zcql, { outletId, serviceId, gender }) {
  const links = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT staff_id FROM Staff_Services WHERE service_id = " +
        asId(serviceId, "service_id") +
        " AND is_active = true"
    ),
    "Staff_Services"
  );
  const linkedIds = links.map((row) => String(row.staff_id));
  const restrictByService = linkedIds.length > 0;

  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, gender FROM Staff WHERE outlet_id = " +
        asId(outletId, "outlet_id") +
        " AND is_active = true AND status = 'ACTIVE'"
    ),
    "Staff"
  );

  return rows
    .filter((row) => !restrictByService || linkedIds.includes(String(row.ROWID)))
    .filter((row) => engine.staffGenderMatches(row.gender, gender))
    .map((row) => String(row.ROWID));
}

async function resolveEligibleProviderIds(zcql, { outletId, serviceId, city, preferredProviderId }) {
  let providerIds = [];
  if (preferredProviderId) {
    providerIds = [String(preferredProviderId)];
  } else {
    const skilled = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT provider_id FROM Provider_Services WHERE service_id = " +
          asId(serviceId, "service_id") +
          " AND is_active = true"
      ),
      "Provider_Services"
    );
    providerIds = skilled.map((row) => String(row.provider_id));
  }
  if (!providerIds.length) {
    return [];
  }
  const areaRows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT provider_id, city FROM Service_Areas WHERE is_active = true AND provider_id IN (" +
        providerIds.join(",") +
        ")"
    ),
    "Service_Areas"
  );
  let areaIds = new Set(
    areaRows
      .filter((row) => !city || engine.citiesMatch(city, row.city))
      .map((row) => String(row.provider_id))
  );
  const available = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Providers WHERE is_active = true AND status = 'AVAILABLE' AND ROWID IN (" +
        providerIds.join(",") +
        ")"
    ),
    "Providers"
  );
  const availableIds = available.map((row) => String(row.ROWID));
  if (!areaIds.size && availableIds.length) {
    areaIds = new Set(availableIds);
  }
  return availableIds.filter((id) => areaIds.has(id));
}

async function resolveEligibleProfessionalIds(zcql, { outletId, serviceId, city, gender, preferredProviderId }) {
  if (preferredProviderId) {
    const preferred = String(preferredProviderId);
    if (await isActiveStaffMember(zcql, preferred, outletId)) {
      return [preferred];
    }
    const providerIds = await resolveEligibleProviderIds(zcql, {
      outletId,
      serviceId,
      city,
      preferredProviderId: preferred,
    });
    if (providerIds.length) {
      return providerIds;
    }
    return [];
  }
  const providerIds = await resolveEligibleProviderIds(zcql, { outletId, serviceId, city });
  if (providerIds.length) {
    return providerIds;
  }
  return resolveEligibleStaffIds(zcql, { outletId, serviceId, gender });
}

function mapProvider(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return {
    id: String(row.ROWID),
    name,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    phone: row.phone || "",
    rating: num(row.rating),
    status: row.status || "AVAILABLE",
    designation: row.designation || row.specialization || "Beauty Professional",
    profile_photo_url: row.profile_photo_url || row.profile_image || "",
    experience_years: num(row.experience_years),
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
  };
}

function mapStaffAsProvider(row) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return {
    id: String(row.ROWID),
    name,
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    phone: row.phone || "",
    rating: num(row.rating),
    status: "AVAILABLE",
    designation: row.designation || "Beauty Professional",
    profile_photo_url: row.profile_photo_url || row.profile_image || "",
    experience_years: num(row.experience_years),
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
  };
}

async function loadProfessionalRows(zcql, ids) {
  if (!ids.length) {
    return [];
  }
  const idList = ids.join(",");
  let providers = [];
  try {
    providers = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, first_name, last_name, phone, rating, status, designation, specialization, profile_photo_url, profile_image, experience_years, outlet_id FROM Providers WHERE ROWID IN (" +
          idList +
          ")"
      ),
      "Providers"
    );
  } catch (_) {
    providers = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, first_name, last_name, phone, rating, status FROM Providers WHERE ROWID IN (" +
          idList +
          ")"
      ),
      "Providers"
    );
  }
  const found = new Set(providers.map((row) => String(row.ROWID)));
  const missing = ids.filter((id) => !found.has(String(id)));
  let staff = [];
  if (missing.length) {
    staff = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, first_name, last_name, designation, outlet_id, gender, rating, experience_years, profile_photo_url, profile_image, status FROM Staff WHERE ROWID IN (" +
          missing.join(",") +
          ")"
      ),
      "Staff"
    );
  }
  return [...providers.map(mapProvider), ...staff.map(mapStaffAsProvider)];
}

async function resolveProfessionalName(zcql, professionalId) {
  if (!professionalId) {
    return "";
  }
  const id = asId(professionalId, "provider_id");
  const provider = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT first_name, last_name FROM Providers WHERE ROWID = " + id
    ),
    "Providers"
  );
  if (provider) {
    return [provider.first_name, provider.last_name].filter(Boolean).join(" ");
  }
  const staff = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT first_name, last_name FROM Staff WHERE ROWID = " + id
    ),
    "Staff"
  );
  if (staff) {
    return [staff.first_name, staff.last_name].filter(Boolean).join(" ");
  }
  return "";
}

async function listAvailableProviders(zcql, payload) {
  const outletId = asId(payload.outlet_id, "outlet_id");
  const serviceId = asId(payload.service_id, "service_id");
  const outlet = await engine.loadActiveOutlet(zcql, outletId);
  const city = String(payload.city || outlet.city || "").trim();
  const gender = normalizeGenderPreference(payload.gender) || String(payload.gender || "").trim();
  const eligibleIds = await resolveEligibleProfessionalIds(zcql, {
    outletId,
    serviceId,
    city,
    gender,
    preferredProviderId: payload.preferred_provider_id,
  });
  if (!eligibleIds.length) {
    return [];
  }
  const professionals = await loadProfessionalRows(zcql, eligibleIds);
  const order = new Map(eligibleIds.map((id, index) => [String(id), index]));
  return professionals.sort((a, b) => {
    const ratingDiff = b.rating - a.rating;
    if (ratingDiff !== 0) {
      return ratingDiff;
    }
    return (order.get(a.id) || 0) - (order.get(b.id) || 0);
  });
}

async function generateAtHomeSlots(zcql, outletId, serviceId, slotDate, preferredProviderId, gender) {
  const outlet = await engine.loadActiveOutlet(zcql, outletId);
  const service = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, duration_minutes, selling_price, currency, is_at_home FROM Salon_Services WHERE ROWID = " +
        asId(serviceId, "service_id")
    ),
    "Salon_Services"
  );
  if (!service) {
    const error = new Error("Service not found");
    error.status = 404;
    throw error;
  }
  if (service.is_at_home !== undefined && service.is_at_home !== null && !engine.isAtHomeEnabled(service.is_at_home)) {
    const error = new Error("This service is not available for home service");
    error.status = 409;
    error.code = "NOT_AT_HOME";
    throw error;
  }

  const priced = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT duration_minutes, selling_price FROM Outlet_Service_Prices WHERE outlet_id = " +
        outletId +
        " AND service_id = " +
        asId(serviceId, "service_id") +
        " AND is_active = true"
    ),
    "Outlet_Service_Prices"
  );

  const duration = num(priced?.duration_minutes) || num(service.duration_minutes) || 45;
  const day = engine.isoDate(slotDate);
  const dayEnd = (() => {
    const parts = String(day).split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  })();

  const eligibleIds = await resolveEligibleProfessionalIds(zcql, {
    outletId,
    serviceId,
    city: outlet.city || "",
    gender,
    preferredProviderId,
  });
  if (!eligibleIds.length) {
    return [];
  }

  const availableProviders = eligibleIds.map((id) => ({ ROWID: id }));

  const booked = await safeRows(
    zcql,
    "SELECT scheduled_at, status FROM Service_Jobs WHERE status NOT IN ('CANCELLED','COMPLETED') AND scheduled_at >= '" +
      day +
      " 00:00:00' AND scheduled_at < '" +
      dayEnd +
      " 00:00:00'",
    "Service_Jobs"
  );

  const bookedStarts = booked
    .map((row) => {
      const text = String(row.scheduled_at || "");
      const match = text.match(/(\d{2}:\d{2})/);
      return match ? engine.parseClock(match[1]) : null;
    })
    .filter((value) => value != null);

  const isToday = day === engine.todayIsoInIst();
  const slots = engine.generateDaySlots({
    opening: outlet.opening_time || "09:00",
    closing: outlet.closing_time || "20:00",
    duration,
    booked: bookedStarts.map((start) => ({ start, end: start + duration })),
    isToday,
  });

  return slots.map((slot, index) => ({
    id: day + "-" + slot.start_time + "-" + index,
    slot_date: day,
    start_time: slot.start_time,
    end_time: slot.end_time,
    provider_count: availableProviders.length,
    available: availableProviders.length > 0,
  }));
}

async function quoteBooking(zcql, payload) {
  const outletId = asId(payload.outlet_id, "outlet_id");
  const serviceId = asId(payload.service_id, "service_id");
  const addonIds = Array.isArray(payload.addon_ids) ? payload.addon_ids.map(String) : [];

  const serviceability = await checkServiceability(zcql, payload);
  if (!serviceability.serviceable) {
    const error = new Error(serviceability.message);
    error.status = 409;
    error.code = "NOT_SERVICEABLE";
    throw error;
  }

  const eligibleIds = new Set(serviceability.eligible_outlets.map((item) => item.outlet_id));
  if (!eligibleIds.has(String(outletId))) {
    const error = new Error("Selected salon does not serve your location for home service");
    error.status = 409;
    error.code = "OUTLET_NOT_ELIGIBLE";
    throw error;
  }

  await engine.loadActiveOutlet(zcql, outletId);
  const services = await listAtHomeServices(zcql, outletId, {
    category: payload.category,
    service_type: payload.service_type,
    gender: payload.gender,
  });
  const service = services.find((item) => String(item.id) === String(serviceId));
  if (!service) {
    const error = new Error("Selected service is not available for home service");
    error.status = 404;
    throw error;
  }

  const priceRows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT gender, mrp, selling_price, duration_minutes FROM Outlet_Service_Prices WHERE outlet_id = " +
        outletId +
        " AND service_id = " +
        serviceId +
        " AND is_active = true"
    ),
    "Outlet_Service_Prices"
  );
  const picked =
    engine.pickPriceRow(priceRows, payload.gender) ||
    (service.prices && service.prices.length
      ? engine.pickPriceRow(
          service.prices.map((item) => ({
            gender: item.gender,
            mrp: item.mrp,
            selling_price: item.selling_price,
            duration_minutes: item.duration_minutes,
          })),
          payload.gender
        )
      : null);

  let addonsTotal = 0;
  const addons = [];
  if (addonIds.length) {
    const addonRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, service_id, name, price, is_active FROM Beauty_Service_Addons WHERE is_active = true AND service_id = " +
          serviceId
      ),
      "Beauty_Service_Addons"
    );
    for (const addonId of addonIds) {
      const row = addonRows.find((item) => String(item.ROWID) === addonId);
      if (row) {
        const price = num(row.price);
        addonsTotal += price;
        addons.push({ id: String(row.ROWID), name: row.name || "", price });
      }
    }
  }

  const outlet = await engine.loadActiveOutlet(zcql, outletId);
  const base = num(picked?.selling_price) || num(service.selling_price);
  const durationMinutes =
    num(picked?.duration_minutes) || num(service.duration_minutes) || 45;
  const subtotal = engine.money(base + addonsTotal);
  const convenienceFee = 50;
  return {
    outlet: { id: String(outlet.ROWID), name: outlet.name || "", city: outlet.city || "" },
    service: {
      id: String(service.id),
      name: service.name,
      duration_minutes: durationMinutes,
      unit_price: base,
      gender: payload.gender || picked?.gender || service.gender || "UNISEX",
    },
    addons,
    subtotal,
    convenience_fee: convenienceFee,
    tax_amount: 0,
    grand_total: engine.money(subtotal + convenienceFee),
    currency: service.currency || "INR",
  };
}

async function resolveBookingStartTime(zcql, payload, slotDate) {
  const slots = await generateAtHomeSlots(
    zcql,
    payload.outlet_id,
    payload.service_id,
    slotDate,
    payload.preferred_provider_id,
    normalizeGenderPreference(payload.gender)
  );
  let startTime = String(payload.start_time || "").trim();
  if (!startTime) {
    const first = slots.find((slot) => slot.available);
    if (!first) {
      const error = new Error("No home service availability on the selected date");
      error.status = 409;
      error.code = "NO_SLOTS";
      throw error;
    }
    startTime = first.start_time;
  }
  const slotOk = slots.some((slot) => slot.start_time === startTime && slot.available);
  if (!slotOk) {
    const error = new Error("Selected date is no longer available for home service");
    error.status = 409;
    error.code = "SLOT_UNAVAILABLE";
    throw error;
  }
  return {
    startTime,
    scheduledAt: slotDate + " " + startTime + ":00",
  };
}

function mapJob(row, extras) {
  const status = row.status || "REQUESTED";
  return {
    id: String(row.ROWID),
    booking_number: row.booking_number || "",
    appointment_id: row.appointment_id ? String(row.appointment_id) : "",
    provider_id: row.provider_id ? String(row.provider_id) : "",
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    status,
    customer_status: customerStatusLabel(status),
    visit_line1: row.visit_line1 || "",
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    pincode: row.pincode || "",
    visit_latitude: num(row.visit_latitude) || null,
    visit_longitude: num(row.visit_longitude) || null,
    scheduled_at: row.scheduled_at || "",
    requested_at: row.requested_at || "",
    grand_total: num(row.grand_total),
    currency: row.currency || "INR",
    payment_status: row.payment_status || "PENDING",
    service_name: row.service_name_snapshot || "",
    gender_preference: row.gender_preference || "",
    can_cancel: canCustomerCancel(status),
    can_reschedule: canReschedule(status),
    live_tracking: canShowLiveTracking(status),
    ...(extras || {}),
  };
}

async function createBooking(app, user, payload) {
  const zcql = app.zcql();
  const idempotencyKey = optionalText(
    payload.idempotency_key || payload.idempotencyKey,
    "idempotency_key",
    80
  );
  if (idempotencyKey) {
    const existing = await findIdempotentBooking(zcql, user.user_id, idempotencyKey);
    if (existing) {
      return {
        booking: mapJob(existing),
        idempotent: true,
      };
    }
  }

  const quote = await quoteBooking(zcql, payload);

  if (payload.address_id) {
    let ownedAddress = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Addresses WHERE ROWID = " +
          asId(payload.address_id, "address_id") +
          " AND user_id = " +
          user.user_id
      ),
      "Addresses"
    );
    if (!ownedAddress) {
      try {
        ownedAddress = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID FROM User_Addresses WHERE ROWID = " +
              asId(payload.address_id, "address_id") +
              " AND user_id = " +
              user.user_id
          ),
          "User_Addresses"
        );
      } catch (_) {
        ownedAddress = null;
      }
    }
    if (!ownedAddress) {
      const error = new Error("Address not found");
      error.status = 404;
      throw error;
    }
  }

  const slotDate = engine.isoDate(payload.slot_date);
  const { startTime, scheduledAt } = await resolveBookingStartTime(zcql, payload, slotDate);
  const bookingNumber = ("HS" + Date.now()).slice(0, 20);

  const jobPayload = {
    user_id: user.user_id,
    outlet_id: asId(payload.outlet_id, "outlet_id"),
    provider_id: payload.preferred_provider_id ? asId(payload.preferred_provider_id, "preferred_provider_id") : null,
    visit_address_id: payload.address_id ? asId(payload.address_id, "address_id") : null,
    visit_line1: String(payload.address_line1 || payload.visit_line1 || "").trim(),
    visit_city: String(payload.city || payload.visit_city || quote.outlet.city || "").trim(),
    visit_district: String(
      payload.district || payload.visit_district || payload.city || payload.visit_city || ""
    ).trim(),
    visit_state: String(payload.state || payload.visit_state || "").trim(),
    pincode: normalizePin(payload.pincode),
    visit_latitude: num(payload.latitude),
    visit_longitude: num(payload.longitude),
    status: "REQUESTED",
    payment_status: "PENDING",
    requested_at: nowSql(),
    scheduled_at: scheduledAt,
    grand_total: quote.grand_total,
    currency: quote.currency,
    booking_number: bookingNumber,
    service_name_snapshot: quote.service.name,
    gender_preference: normalizeGenderPreference(payload.gender),
    idempotency_key: idempotencyKey || null,
  };

  const inserted = await app.datastore().table("Service_Jobs").insertRow(jobPayload);
  const jobId = String(inserted.ROWID || inserted.rowid || "");
  if (!jobId) {
    const error = new Error("Could not create booking");
    error.status = 500;
    throw error;
  }

  await app.datastore().table("Job_Items").insertRow({
    job_id: jobId,
    service_id: asId(payload.service_id, "service_id"),
    service_name: quote.service.name,
    quantity: 1,
    unit_price: quote.grand_total,
    line_total: quote.grand_total,
  });

  await app.datastore().table("Job_Timeline").insertRow({
    job_id: jobId,
    provider_id: jobPayload.provider_id,
    status: "REQUESTED",
    note: "Home service booking created",
    happened_at: nowSql(),
  });

  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + JOB_SELECT + " FROM Service_Jobs WHERE ROWID = " + jobId
    ),
    "Service_Jobs"
  );

  return {
    booking: mapJob(row, { quote }),
    idempotent: false,
  };
}

async function autoDispatchJob(app, jobId) {
  const zcql = app.zcql();
  const job = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status, provider_id, visit_city, outlet_id, gender_preference FROM Service_Jobs WHERE ROWID = " +
        asId(jobId, "job_id")
    ),
    "Service_Jobs"
  );
  if (!job || !["CONFIRMED", "REQUESTED"].includes(String(job.status || "").toUpperCase())) {
    return null;
  }

  if (job.provider_id) {
    const name = await resolveProfessionalName(zcql, job.provider_id);
    if (name) {
      const now = nowSql();
      await app.datastore().table("Service_Jobs").updateRow({
        ROWID: jobId,
        provider_id: job.provider_id,
        status: "ASSIGNED",
      });
      await app.datastore().table("Job_Timeline").insertRow({
        job_id: jobId,
        provider_id: job.provider_id,
        status: "ASSIGNED",
        note: "Preferred professional assigned",
        happened_at: now,
      });
      const jobRow = rowOf(
        await zcql.executeZCQLQuery("SELECT user_id FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")),
        "Service_Jobs"
      );
      if (jobRow?.user_id) {
        await emitJobEvent(app, {
          jobId,
          userId: jobRow.user_id,
          providerId: job.provider_id,
          event: "PROVIDER_ASSIGNED",
          status: "ASSIGNED",
        });
      }
      return {
        job_id: jobId,
        provider_id: String(job.provider_id),
        provider_name: name,
        status: "ASSIGNED",
      };
    }
  }

  const items = rowsOf(
    await zcql.executeZCQLQuery("SELECT service_id FROM Job_Items WHERE job_id = " + asId(jobId, "job_id")),
    "Job_Items"
  );
  if (!items.length) {
    return null;
  }

  const serviceId = items[0].service_id;
  const city = String(job.visit_city || "").replace(/'/g, "");
  const gender = normalizeGenderPreference(job.gender_preference);

  const skilled = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT provider_id FROM Provider_Services WHERE service_id = " +
        serviceId +
        " AND is_active = true"
    ),
    "Provider_Services"
  );
  let providerIds = skilled.map((row) => String(row.provider_id));
  if (!providerIds.length && job.outlet_id) {
    providerIds = await resolveEligibleStaffIds(zcql, {
      outletId: job.outlet_id,
      serviceId,
      gender,
    });
  }
  if (!providerIds.length) {
    return null;
  }

  const areaRows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT provider_id, city FROM Service_Areas WHERE is_active = true AND provider_id IN (" +
        providerIds.join(",") +
        ")"
    ),
    "Service_Areas"
  );
  let areaIds = areaRows
    .filter((row) => !city || engine.citiesMatch(city, row.city))
    .map((row) => String(row.provider_id));
  if (!areaIds.length) {
    areaIds = providerIds.slice();
  }
  if (!areaIds.length) {
    return null;
  }

  let providers = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, first_name, last_name, status FROM Providers WHERE is_active = true AND status = 'AVAILABLE' AND ROWID IN (" +
        areaIds.join(",") +
        ")"
    ),
    "Providers"
  );
  let provider = providers[0];
  if (!provider) {
    const staffRows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, first_name, last_name, status FROM Staff WHERE is_active = true AND status = 'ACTIVE' AND ROWID IN (" +
          areaIds.join(",") +
          ")"
      ),
      "Staff"
    );
    provider = staffRows[0];
  }
  if (!provider) {
    return null;
  }
  const now = nowSql();
  await app.datastore().table("Job_Dispatch").insertRow({
    job_id: jobId,
    provider_id: provider.ROWID,
    status: "OFFERED",
    offered_at: now,
    notes: "Auto-dispatch after booking confirmation",
  });
  await app.datastore().table("Service_Jobs").updateRow({
    ROWID: jobId,
    provider_id: provider.ROWID,
    status: "ASSIGNED",
  });
  await app.datastore().table("Job_Timeline").insertRow({
    job_id: jobId,
    provider_id: provider.ROWID,
    status: "ASSIGNED",
    note: "Professional assigned",
    happened_at: now,
  });

  const jobRow = rowOf(
    await zcql.executeZCQLQuery("SELECT user_id FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")),
    "Service_Jobs"
  );
  if (jobRow?.user_id) {
    await emitJobEvent(app, {
      jobId,
      userId: jobRow.user_id,
      providerId: provider.ROWID,
      event: "PROVIDER_ASSIGNED",
      status: "ASSIGNED",
    });
  }

  return {
    job_id: jobId,
    provider_id: String(provider.ROWID),
    provider_name: [provider.first_name, provider.last_name].filter(Boolean).join(" "),
    status: "ASSIGNED",
  };
}

async function cancelBooking(app, user, jobId, reason) {
  const zcql = app.zcql();
  const job = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, status FROM Service_Jobs WHERE ROWID = " +
        asId(jobId, "job_id") +
        " AND user_id = " +
        user.user_id
    ),
    "Service_Jobs"
  );
  if (!job) {
    const error = new Error("Booking not found");
    error.status = 404;
    throw error;
  }
  if (!canCustomerCancel(job.status)) {
    const error = new Error("This booking can no longer be cancelled");
    error.status = 409;
    throw error;
  }
  await app.datastore().table("Service_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "CANCELLED",
  });
  await app.datastore().table("Job_Timeline").insertRow({
    job_id: job.ROWID,
    status: "CANCELLED",
    note: reason || "Cancelled by customer",
    happened_at: nowSql(),
  });
  try {
    const { cancelProfessionalJobForReference } = require("./professional-job-lifecycle");
    await cancelProfessionalJobForReference(app, "SERVICE_JOB", job.ROWID, {
      actorRole: "CUSTOMER",
      actorId: user.user_id,
      reason: reason || "Cancelled by customer",
      reasonCode: "CUSTOMER_REQUEST",
    });
  } catch (_) {}
  try {
    const { emitJobEvent } = require("./at-home-beauty-events");
    await emitJobEvent(app, {
      jobId: job.ROWID,
      userId: user.user_id,
      event: "BOOKING_CANCELLED",
      status: "CANCELLED",
      note: reason || "Cancelled by customer",
    });
  } catch (_) {}
  return mapJob({ ...job, status: "CANCELLED" });
}

async function rescheduleBooking(app, user, jobId, payload) {
  const zcql = app.zcql();
  const job = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, status, outlet_id FROM Service_Jobs WHERE ROWID = " +
        asId(jobId, "job_id") +
        " AND user_id = " +
        user.user_id
    ),
    "Service_Jobs"
  );
  if (!job) {
    const error = new Error("Booking not found");
    error.status = 404;
    throw error;
  }
  if (!canReschedule(job.status)) {
    const error = new Error("This booking cannot be rescheduled");
    error.status = 409;
    throw error;
  }

  const items = rowsOf(
    await zcql.executeZCQLQuery("SELECT service_id FROM Job_Items WHERE job_id = " + job.ROWID),
    "Job_Items"
  );
  const serviceId = items[0]?.service_id;
  if (!serviceId) {
    const error = new Error("Booking has no service item");
    error.status = 409;
    throw error;
  }

  const slotDate = engine.isoDate(payload.slot_date);
  const { scheduledAt } = await resolveBookingStartTime(
    zcql,
    {
      outlet_id: job.outlet_id || payload.outlet_id,
      service_id: serviceId,
      preferred_provider_id: job.provider_id || payload.preferred_provider_id,
      start_time: payload.start_time,
    },
    slotDate
  );
  await app.datastore().table("Service_Jobs").updateRow({
    ROWID: job.ROWID,
    scheduled_at: scheduledAt,
    status: "CONFIRMED",
  });
  await app.datastore().table("Job_Timeline").insertRow({
    job_id: job.ROWID,
    status: "RESCHEDULED",
    note: "Rescheduled to " + scheduledAt,
    happened_at: nowSql(),
  });
  try {
    const { handleServiceJobReschedule } = require("./professional-job-lifecycle");
    await handleServiceJobReschedule(app, job.ROWID, { scheduledAt });
  } catch (_) {}
  try {
    const { emitJobEvent } = require("./at-home-beauty-events");
    await emitJobEvent(app, {
      jobId: job.ROWID,
      userId: user.user_id,
      event: "BOOKING_CONFIRMED",
      status: "RESCHEDULED",
      note: "Rescheduled to " + scheduledAt,
    });
  } catch (_) {}
  return mapJob({ ...job, status: "CONFIRMED", scheduled_at: scheduledAt });
}

async function notifyAtHomeBooking(req, user, jobId, booking) {
  const {
    sendBookingWhatsapp,
    recordBookingNotification,
    bookingMessage,
    resolveBookingMobile,
  } = require("./booking-notify");
  const {
    resolveCustomerDisplayName,
  } = require("./whatsapp-user-mobile");
  const zcql = req.catalystApp.zcql();
  const items = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT service_name FROM Job_Items WHERE job_id = " + asId(jobId, "job_id") + " LIMIT 1"
    ),
    "Job_Items"
  );
  let outletName = "";
  if (booking.outlet_id) {
    const outlet = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT name FROM Outlets WHERE ROWID = " + asId(booking.outlet_id, "outlet_id")
      ),
      "Outlets"
    );
    outletName = outlet?.name || "";
  }
  let providerName = "";
  if (booking.provider_id) {
    providerName = await resolveProfessionalName(zcql, booking.provider_id);
  }
  const scheduled = String(booking.scheduled_at || "");
  const parts = scheduled.split(" ");
  const payload = {
    name: await resolveCustomerDisplayName(req, user),
    mobile: await resolveBookingMobile(req, user),
    salon: outletName || "Baylen Home Service",
    location: [booking.visit_line1, booking.visit_city].filter(Boolean).join(", "),
    packageName: "Home Service",
    service: items[0]?.service_name || booking.service_name || "",
    gender: booking.gender_preference || "",
    expert: providerName || "Assigning soon",
    date: parts[0] || scheduled,
    time: parts[1] ? parts[1].slice(0, 5) : "Flexible",
    amount: String(booking.grand_total ?? ""),
    bookingId: booking.booking_number || booking.id || String(jobId),
  };
  let result = { status: "FAILED", reason: "Customer mobile is missing" };
  if (payload.mobile) {
    try {
      result = await sendBookingWhatsapp(payload);
    } catch (error) {
      result = { status: "FAILED", reason: error.message || "WhatsApp failed" };
    }
  }
  await recordBookingNotification(
    req,
    user.user_id,
    jobId,
    result,
    "Home service booking confirmed",
    bookingMessage(payload).slice(0, 500),
    {
      mobile: payload.mobile,
      templateParameters: result.templateParameters || [],
      reference_type: "SERVICE_JOB",
      notification_type: "HOME_SERVICE_CONFIRMED",
    }
  );
  return result;
}

async function confirmPaidBooking(app, jobId, user) {
  const zcql = app.zcql();
  const job = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status, user_id FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")
    ),
    "Service_Jobs"
  );
  if (!job) {
    return null;
  }
  if (user && String(job.user_id) !== String(user.user_id)) {
    const error = new Error("Booking not found");
    error.status = 404;
    throw error;
  }
  const payments = rowsOf(await zcql.executeZCQLQuery(
    "SELECT ROWID, amount, currency, status, metadata FROM Payments WHERE reference_type = 'JOB' AND reference_id = " +
      asId(jobId, "job_id") + " AND user_id = " + asId(job.user_id, "user_id") + " AND status = 'SUCCESS'"
  ), "Payments");
  const jobTotal = rowOf(await zcql.executeZCQLQuery(
    "SELECT grand_total, currency FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")
  ), "Service_Jobs");
  const verified = payments.some((payment) => {
    let proof;
    try { proof = JSON.parse(payment.metadata || "{}"); } catch (_) { return false; }
    return proof.verified === true && jobTotal &&
      Math.round(num(payment.amount) * 100) === Math.round(num(jobTotal.grand_total) * 100) &&
      payment.currency === jobTotal.currency;
  });
  if (!verified) {
    const error = new Error("Payment is not yet verified. Complete payment or check its status.");
    error.status = 409;
    error.code = "PAYMENT_NOT_VERIFIED";
    throw error;
  }
  if (["CANCELLED", "REJECTED", "EXPIRED"].includes(String(job.status).toUpperCase())) {
    const error = new Error("This booking is no longer available. Contact support for a refund.");
    error.status = 409;
    throw error;
  }
  if (String(job.status || "").toUpperCase() !== "REQUESTED") {
    try {
      await ensureHomeServiceJob(app, jobId, {
        actorId: user?.user_id || "system",
        actorRole: user ? "customer" : "system",
        userId: user?.user_id,
      });
    } catch (jobError) {
      console.error("[at-home-beauty] professional job ensure failed", jobId, jobError.message);
    }
    const existing = rowOf(await zcql.executeZCQLQuery(
      "SELECT " + JOB_SELECT + " FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")
    ), "Service_Jobs");
    return mapJob(existing || job);
  }
  await app.datastore().table("Service_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "CONFIRMED",
    payment_status: "PAID",
  });
  await app.datastore().table("Job_Timeline").insertRow({
    job_id: job.ROWID,
    status: "CONFIRMED",
    note: "Payment received",
    happened_at: nowSql(),
  });
  const confirmedJob = rowOf(
    await zcql.executeZCQLQuery("SELECT user_id FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")),
    "Service_Jobs"
  );
  if (confirmedJob?.user_id) {
    await emitJobEvent(app, {
      jobId,
      userId: confirmedJob.user_id,
      event: "BOOKING_CONFIRMED",
      status: "CONFIRMED",
    });
  }
  await autoDispatchJob(app, jobId);
  try {
    await ensureHomeServiceJob(app, jobId, {
      actorId: user?.user_id || "system",
      actorRole: user ? "customer" : "system",
      userId: user?.user_id,
    });
  } catch (jobError) {
    console.error("[at-home-beauty] professional job create failed", jobId, jobError.message);
  }
  const updated = rowOf(
    await zcql.executeZCQLQuery("SELECT " + JOB_SELECT + " FROM Service_Jobs WHERE ROWID = " + jobId),
    "Service_Jobs"
  );
  return mapJob(updated);
}

module.exports = {
  JOB_SELECT,
  normalizeGenderPreference,
  matchesBookingStatusFilter,
  findIdempotentBooking,
  listBookings,
  customerStatusLabel,
  checkServiceability,
  listAtHomeServices,
  listAvailableProviders,
  generateAtHomeSlots,
  quoteBooking,
  createBooking,
  autoDispatchJob,
  cancelBooking,
  rescheduleBooking,
  confirmPaidBooking,
  notifyAtHomeBooking,
  mapJob,
};
