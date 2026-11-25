"use strict";

const { asId, isTruthy, num, rowOf, rowsOf, sqlString } = require("./http");
const { parseLocation } = require("./geo-coords");

const PACKAGE_ORDER = ["Bronze", "Silver", "Gold", "Royal", "Luxury", "Diamond"];
const CITY_ALIASES = {
  delhi: ["delhi", "new delhi", "delhi ncr", "ncr", "newdelhi"],
  mumbai: ["mumbai", "bombay"],
  bengaluru: ["bengaluru", "bangalore"],
  kolkata: ["kolkata", "calcutta"],
};

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function normalizeCity(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearch(value) {
  const spaced = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    spaced,
    compact: spaced.replace(/\s+/g, ""),
  };
}

function cityKey(value) {
  const normalized = normalizeCity(value);
  if (!normalized || normalized === "current location") {
    return "";
  }
  for (const [key, aliases] of Object.entries(CITY_ALIASES)) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) {
      return key;
    }
  }
  return normalized.split(" ")[0];
}

function citiesMatch(selected, outletCity) {
  const left = cityKey(selected);
  const right = cityKey(outletCity);
  return Boolean(left && right && left === right);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseClock(value) {
  const text = String(value || "").trim();
  const ampm = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    const mer = ampm[3].toUpperCase();
    if (mer === "PM" && hour < 12) hour += 12;
    if (mer === "AM" && hour === 12) hour = 0;
    return hour * 60 + minute;
  }
  const h24 = text.match(/^(\d{1,2}):(\d{2})/);
  if (h24) {
    return Number(h24[1]) * 60 + Number(h24[2]);
  }
  return null;
}

function formatClock(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, "0");
  return String(hour).padStart(2, "0") + ":" + minute;
}

function isoDate(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : text.slice(0, 10);
}

function isAtHomeEnabled(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function genderMatches(offered, requested) {
  const have = String(offered || "UNISEX").toUpperCase();
  const want = String(requested || "").toUpperCase();
  if (!want || want === "ANY" || want === "BOTH" || want === "UNISEX") {
    return true;
  }
  return have === want || have === "UNISEX" || have === "BOTH" || have === "ANY";
}

function staffGenderMatches(staffGender, requested) {
  const have = String(staffGender || "UNISEX").toUpperCase();
  const want = String(requested || "").toUpperCase();
  if (!want || want === "ANY" || want === "BOTH" || want === "UNISEX") {
    return true;
  }
  return have === want || have === "UNISEX" || have === "BOTH" || have === "ANY";
}

async function safeRows(zcql, query, tableName) {
  try {
    return rowsOf(await zcql.executeZCQLQuery(query), tableName);
  } catch (_) {
    return [];
  }
}

function mapOutlet(row, extras = {}) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    code: row.code || "",
    salon_category: row.salon_category || "",
    address_line1: row.address_line1 || "",
    area: row.area || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    phone: row.phone || "",
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    opening_time: row.opening_time || "",
    closing_time: row.closing_time || "",
    rating: num(row.rating),
    review_count: num(row.review_count),
    image_url: row.image_url || "",
    google_maps_url: row.google_maps_url || "",
    is_active: isTruthy(row.is_active) || row.is_active === undefined,
    packages: extras.packages || [],
    distance_km: extras.distance_km || 0,
    availability: extras.availability || "",
  };
}

function mapPackage(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    sort_order: num(row.sort_order),
  };
}

function mapServiceOffer(service, priceRow) {
  return {
    id: String(service.ROWID),
    price_id: priceRow ? String(priceRow.ROWID) : "",
    name: service.name || "",
    slug: service.slug || "",
    description: service.description || "",
    image_url: service.image_url || "",
    service_type: service.service_type || serviceTypeFromCategory(service),
    category_id: service.category_id ? String(service.category_id) : "",
    gender: priceRow ? priceRow.gender || "UNISEX" : service.gender || "UNISEX",
    duration_minutes: priceRow ? num(priceRow.duration_minutes) : num(service.duration_minutes),
    mrp: money(priceRow ? priceRow.mrp : service.mrp),
    selling_price: money(priceRow ? priceRow.selling_price : service.selling_price),
    currency: service.currency || "INR",
    package_id: priceRow && priceRow.package_id ? String(priceRow.package_id) : "",
  };
}

function serviceTypeFromCategory(service) {
  const slug = String(service.slug || "").toLowerCase();
  const name = String(service.name || "").toLowerCase();
  if (name.includes("bridal") || slug.includes("bridal")) return "Bridal";
  if (name.includes("spa") || slug.includes("spa")) return "Spa";
  if (name.includes("facial") || name.includes("cleanup") || name.includes("skin")) return "Skin";
  if (name.includes("manicure") || name.includes("nail")) return "Nails";
  return service.service_type || "Hair";
}

function filterOutletsByLocation(outlets, query) {
  const city = String(query.city || query.location || "").trim();
  const pincode = String(query.pincode || query.postal_code || "").trim();
  const coords = parseLocation(
    query.lat ?? query.latitude,
    query.lng ?? query.longitude
  );
  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const radius = Math.min(Math.max(Number(query.radius_km) || 25, 1), 80);
  const hasCity = Boolean(cityKey(city));
  const hasPin = /^\d{6}$/.test(pincode);
  const hasCoords = coords !== null;

  return outlets
    .filter((row) => isTruthy(row.is_active) || row.is_active === undefined)
    .filter((row) => {
      if (hasPin) {
        return String(row.postal_code || "") === pincode;
      }
      if (hasCoords) {
        const outletLat = num(row.latitude);
        const outletLng = num(row.longitude);
        if (!outletLat || !outletLng) return false;
        return haversineKm(lat, lng, outletLat, outletLng) <= radius;
      }
      if (hasCity) {
        return citiesMatch(city, row.city);
      }
      return true;
    })
    .map((row) => {
      let distance = 0;
      if (hasCoords && num(row.latitude) && num(row.longitude)) {
        distance = Math.round(haversineKm(lat, lng, num(row.latitude), num(row.longitude)) * 10) / 10;
      }
      return { row, distance };
    })
    .sort((a, b) => a.distance - b.distance);
}

async function loadPackages(zcql) {
  const rows = await safeRows(
    zcql,
    "SELECT ROWID, name, slug, sort_order, is_active FROM Salon_Packages WHERE is_active = true",
    "Salon_Packages"
  );
  rows.sort((a, b) => num(a.sort_order) - num(b.sort_order));
  return rows.map(mapPackage);
}

async function loadOutletPackages(zcql, outletId) {
  const links = await safeRows(
    zcql,
    "SELECT ROWID, outlet_id, package_id, is_active FROM Outlet_Packages WHERE outlet_id = " +
      outletId +
      " AND is_active = true",
    "Outlet_Packages"
  );
  if (!links.length) {
    return [];
  }
  const packages = await loadPackages(zcql);
  const linked = new Set(links.map((row) => String(row.package_id)));
  const pricedRows = await safeRows(
    zcql,
    "SELECT package_id FROM Outlet_Service_Prices WHERE outlet_id = " +
      outletId +
      " AND is_active = true",
    "Outlet_Service_Prices"
  );
  const priced = new Set(pricedRows.map((row) => String(row.package_id)));
  return packages.filter((item) => item.id && linked.has(item.id) && priced.has(item.id));
}

async function loadActiveOutlet(zcql, outletId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, google_maps_url, is_active FROM Outlets WHERE ROWID = " +
        outletId
    ),
    "Outlets"
  );
  if (!row || (row.is_active !== undefined && !isTruthy(row.is_active))) {
    const error = new Error("This salon is not available");
    error.status = 404;
    throw error;
  }
  return row;
}

function slotsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function nowMinutesInIst() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number((parts.find((part) => part.type === "hour") || {}).value);
  const minute = Number((parts.find((part) => part.type === "minute") || {}).value);
  return hour * 60 + minute;
}

function todayIsoInIst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = (parts.find((part) => part.type === "year") || {}).value;
  const month = (parts.find((part) => part.type === "month") || {}).value;
  const day = (parts.find((part) => part.type === "day") || {}).value;
  return year + "-" + month + "-" + day;
}

function generateDaySlots(options) {
  const duration = Math.max(num(options.duration) || 45, 15);
  const open = parseClock(options.opening) ?? 10 * 60;
  const close = parseClock(options.closing) ?? 21 * 60;
  const booked = Array.isArray(options.booked) ? options.booked : [];
  const isToday = Boolean(options.isToday);
  const nowMinutes = Number.isFinite(options.nowMinutes) ? options.nowMinutes : nowMinutesInIst();
  const slots = [];
  for (let start = open; start + duration <= close; start += duration) {
    const end = start + duration;
    if (isToday && start < nowMinutes + 15) {
      continue;
    }
    const busy = booked.some((item) =>
      slotsOverlap(start, end, num(item.start), num(item.end))
    );
    if (!busy) {
      slots.push({
        start_time: formatClock(start),
        end_time: formatClock(end),
        duration_minutes: duration,
      });
    }
  }
  return slots;
}

function groupServiceOffers(services, priceRows, filters) {
  const typeFilter = String((filters && filters.service_type) || "").trim().toLowerCase();
  const genderFilter = String((filters && filters.gender) || "").trim();
  const atHomeOnly =
    isAtHomeEnabled(filters && filters.is_at_home) ||
    String((filters && filters.fulfillment_mode) || "").trim().toUpperCase() === "AT_HOME";
  const needle = normalizeSearch((filters && filters.q) || "");
  const byId = new Map(services.map((row) => [String(row.ROWID), row]));
  const grouped = new Map();

  for (const price of priceRows) {
    if (!isTruthy(price.is_active) && price.is_active !== undefined) {
      continue;
    }
    if (genderFilter && !genderMatches(price.gender, genderFilter)) {
      continue;
    }
    const service = byId.get(String(price.service_id));
    if (!service) {
      continue;
    }
    if (service.status && String(service.status).toUpperCase() !== "ACTIVE") {
      continue;
    }
    if (service.is_active !== undefined && !isTruthy(service.is_active)) {
      continue;
    }
    if (atHomeOnly && service.is_at_home !== undefined && service.is_at_home !== null && !isAtHomeEnabled(service.is_at_home)) {
      continue;
    }
    const type = service.service_type || serviceTypeFromCategory(service);
    if (typeFilter && typeFilter !== "all" && type.toLowerCase() !== typeFilter) {
      continue;
    }
    const haystack = normalizeSearch([service.name, service.description, type, service.slug].join(" "));
    if (
      needle.spaced &&
      !haystack.spaced.includes(needle.spaced) &&
      !haystack.compact.includes(needle.compact)
    ) {
      continue;
    }
    const id = String(service.ROWID);
    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        name: service.name || "",
        slug: service.slug || "",
        description: service.description || "",
        image_url: service.image_url || "",
        service_type: type,
        category_id: service.category_id ? String(service.category_id) : "",
        currency: service.currency || "INR",
        package_id: price.package_id ? String(price.package_id) : "",
        is_at_home: isAtHomeEnabled(service.is_at_home),
        prices: [],
        genders: [],
      });
    }
    const item = grouped.get(id);
    const gender = String(price.gender || "UNISEX").toUpperCase();
    item.prices.push({
      price_id: String(price.ROWID || ""),
      gender,
      mrp: money(price.mrp),
      selling_price: money(price.selling_price),
      duration_minutes: num(price.duration_minutes) || num(service.duration_minutes),
    });
    if (!item.genders.includes(gender)) {
      item.genders.push(gender);
    }
  }

  return Array.from(grouped.values()).map((item) => {
    const preferred =
      item.prices.find((price) => price.gender === "UNISEX") || item.prices[0] || {};
    return {
      ...item,
      gender: item.genders.length === 1 ? item.genders[0] : "UNISEX",
      mrp: preferred.mrp || 0,
      selling_price: preferred.selling_price || 0,
      duration_minutes: preferred.duration_minutes || 0,
    };
  });
}

function pickPriceRow(priceRows, gender) {
  const want = String(gender || "UNISEX").toUpperCase();
  const rows = priceRows.filter(
    (row) => isTruthy(row.is_active) || row.is_active === undefined
  );
  return (
    rows.find((row) => String(row.gender || "").toUpperCase() === want) ||
    rows.find((row) => String(row.gender || "").toUpperCase() === "UNISEX") ||
    rows.find((row) => ["BOTH", "ANY"].includes(String(row.gender || "").toUpperCase())) ||
    null
  );
}

function bookingNumber(outletCode, appointmentId) {
  const prefix = String(outletCode || "BAY").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "BAY";
  const suffix = String(appointmentId || Date.now()).slice(-6);
  return (prefix + suffix).slice(0, 30);
}

function locationLabel(row) {
  return [row.area, row.address_line1, row.city, row.state]
    .filter(Boolean)
    .join(", ");
}

async function loadActiveOutlets(zcql) {
  return safeRows(
    zcql,
    "SELECT ROWID, name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, google_maps_url, is_active, service_radius_km FROM Outlets WHERE is_active = true",
    "Outlets"
  );
}

async function loadOutletServiceOffers(zcql, outletId, filters = {}) {
  await loadActiveOutlet(zcql, outletId);
  const packageId = filters.package_id ? String(filters.package_id) : "";
  let priceQuery =
    "SELECT ROWID, outlet_id, package_id, service_id, gender, mrp, selling_price, duration_minutes, is_active FROM Outlet_Service_Prices WHERE outlet_id = " +
    outletId +
    " AND is_active = true";
  if (packageId) {
    priceQuery += " AND package_id = " + packageId;
  }
  const priceRows = rowsOf(await zcql.executeZCQLQuery(priceQuery), "Outlet_Service_Prices");
  const services = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency, status, is_active, service_type, is_at_home FROM Salon_Services"
    ),
    "Salon_Services"
  );
  return groupServiceOffers(services, priceRows, filters);
}

async function loadNearbyOutletMatches(zcql, query = {}) {
  const rows = await loadActiveOutlets(zcql);
  return filterOutletsByLocation(rows, query);
}

module.exports = {
  PACKAGE_ORDER,
  money,
  citiesMatch,
  cityKey,
  normalizeSearch,
  haversineKm,
  parseClock,
  formatClock,
  isoDate,
  genderMatches,
  staffGenderMatches,
  safeRows,
  mapOutlet,
  mapPackage,
  mapServiceOffer,
  serviceTypeFromCategory,
  filterOutletsByLocation,
  loadPackages,
  loadOutletPackages,
  loadActiveOutlet,
  slotsOverlap,
  nowMinutesInIst,
  todayIsoInIst,
  generateDaySlots,
  groupServiceOffers,
  pickPriceRow,
  bookingNumber,
  locationLabel,
  isAtHomeEnabled,
  loadActiveOutlets,
  loadOutletServiceOffers,
  loadNearbyOutletMatches,
};
