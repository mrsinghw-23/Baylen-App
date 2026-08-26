const { rowsOf, num, sendOk } = require("../lib/http");

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

async function safeRows(req, query, tableName) {
  try {
    const rows = await req.catalystApp.zcql().executeZCQLQuery(query);
    return rowsOf(rows, tableName);
  } catch (_) {
    return [];
  }
}

function mapBanner(row) {
  return {
    id: String(row.ROWID),
    title: row.title || "Baylen Beauty Picks",
    subtitle: row.subtitle || "Featured products for daily glow",
    image_url: row.image_url || "",
    video_url: row.video_url || "",
    month: row.month || "",
    action_type: row.action_type || "TAB",
    action_value: row.action_value || "0",
    cta_label: row.cta_label || "Book Now",
    display_order: num(row.display_order),
  };
}

function mapOffer(row) {
  return {
    id: String(row.ROWID),
    title: row.title || row.code || "",
    description: row.description || "",
    code: row.code || "",
    discount_type: row.discount_type || "",
    discount_value: num(row.discount_value),
  };
}

function mapProduct(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    brand_id: row.brand_id ? String(row.brand_id) : "",
    category_id: row.category_id ? String(row.category_id) : "",
    thumbnail_url: row.thumbnail_url || "",
    mrp: money(row.mrp),
    selling_price: money(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapOutlet(row) {
  const latitude = num(row.latitude);
  const longitude = num(row.longitude);
  return {
    id: String(row.ROWID),
    name: row.name || "",
    salon_category: row.salon_category || "",
    address_line1: row.address_line1 || "",
    city: row.city || "",
    state: row.state || "",
    area: row.area || "",
    phone: row.phone || "",
    opening_time: row.opening_time || "",
    closing_time: row.closing_time || "",
    image_url: row.image_url || "",
    video_url: row.video_url || "",
    google_maps_url:
      row.google_maps_url ||
      (latitude && longitude
        ? `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=walking`
        : ""),
    rating: num(row.rating),
    review_count: num(row.review_count),
    latitude,
    longitude,
  };
}

function mapService(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    category_id: row.category_id ? String(row.category_id) : "",
    description: row.description || "",
    image_url: row.image_url || "",
    duration_minutes: num(row.duration_minutes),
    selling_price: money(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapBrand(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    logo_url: row.logo_url || "",
    banner_url: row.banner_url || "",
    description: row.description || "",
  };
}

function mapCategory(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    icon_key: row.icon_key || "more",
    image_url: row.image_url || "",
    display_order: num(row.display_order),
  };
}

function mapTrending(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    image_url: row.image_url || "",
    tag: row.tag || "",
    type: row.type || "service",
    reference_id: row.reference_id ? String(row.reference_id) : "",
  };
}

function bool(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value || "").toLowerCase();
  return text === "true" || text === "1" || text === "yes";
}

function inDisplayWindow(row) {
  const now = Date.now();
  const start = row.start_date || row.starts_at;
  const end = row.end_date || row.ends_at;

  if (start && !isNaN(Date.parse(start)) && Date.parse(start) > now) {
    return false;
  }
  if (end && !isNaN(Date.parse(end)) && Date.parse(end) < now) {
    return false;
  }
  return true;
}

function mapLaunchItem(row, type) {
  return {
    id: String(row.ROWID),
    type,
    title: row.title || "",
    subtitle: row.subtitle || "",
    body: row.body || row.description || "",
    image_url: row.image_url || "",
    video_url: row.video_url || "",
    button_label: row.button_label || "",
    secondary_button_label: row.secondary_button_label || "",
    action_type: row.action_type || "",
    action_value: row.action_value || "",
    audience: row.audience || "ALL",
    show_once: bool(row.show_once),
    display_order: num(row.display_order),
  };
}

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinate(value, name) {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    const error = new Error(name + " is required");
    error.status = 400;
    throw error;
  }
  return parsed;
}

function isOpenNow(row) {
  const open = String(row.opening_time || "").trim();
  const close = String(row.closing_time || "").trim();
  if (!open || !close) {
    return false;
  }

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (value) => {
    const match = String(value || "")
      .trim()
      .match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const meridiem = match[3] ? match[3].toUpperCase() : "";
    if (hour > 23 || minute > 59) return null;
    if (meridiem === "AM") {
      if (hour === 12) hour = 0;
    } else if (meridiem === "PM" && hour < 12) {
      hour += 12;
    }
    return hour * 60 + minute;
  };

  const openMinutes = toMinutes(open);
  const closeMinutes = toMinutes(close);
  if (openMinutes === null || closeMinutes === null) {
    return false;
  }
  if (closeMinutes < openMinutes) {
    return currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
  }
  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

function mapNearbyOutlet(row, userLat, userLng) {
  const outletLat = num(row.latitude);
  const outletLng = num(row.longitude);
  let distance = null;
  if (outletLat && outletLng) {
    distance = haversineKm(userLat, userLng, outletLat, outletLng);
  }

  return {
    ...mapOutlet(row),
    distance_km: distance === null ? 999999 : Math.round(distance * 10) / 10,
    availability:
      isOpenNow(row) || !row.opening_time || !row.closing_time ? "AVAILABLE" : "CLOSED",
    relevant_services: [],
  };
}

async function nearbyOutletsPayload(req, source) {
  const latitude = parseCoordinate(source.lat ?? source.latitude, "latitude");
  const longitude = parseCoordinate(source.lng ?? source.longitude, "longitude");
  const limit = Math.min(Math.max(parseInt(source.limit || "20", 10) || 20, 1), 100);

  const outlets = await safeRows(
    req,
    "SELECT ROWID, name, salon_category, address_line1, city, state, area, phone, opening_time, closing_time, image_url, video_url, google_maps_url, rating, review_count, latitude, longitude FROM Outlets WHERE is_active = true",
    "Outlets"
  );

  const mapped = outlets
    .map((row) => mapNearbyOutlet(row, latitude, longitude))
    .filter((outlet) => outlet.latitude && outlet.longitude)
    .sort((a, b) => a.distance_km - b.distance_km);

  return {
    user_location: { latitude, longitude },
    outlets: mapped.slice(0, limit),
  };
}

async function nearbyStoresPayload(req, source) {
  const latitude = parseCoordinate(source.lat ?? source.latitude, "latitude");
  const longitude = parseCoordinate(source.lng ?? source.longitude, "longitude");
  const limit = Math.min(Math.max(parseInt(source.limit || "100", 10) || 100, 1), 100);
  const stores = await safeRows(
    req,
    "SELECT ROWID, store_name, latitude, longitude, address FROM Stores",
    "Stores"
  );

  const mapped = stores
    .map((row) => {
      const storeLat = num(row.latitude);
      const storeLng = num(row.longitude);
      const distance = storeLat && storeLng
        ? haversineKm(latitude, longitude, storeLat, storeLng)
        : 999999;
      return {
        id: String(row.ROWID),
        store_name: row.store_name || "",
        latitude: storeLat,
        longitude: storeLng,
        address: row.address || "",
        distance_km: Math.round(distance * 10) / 10,
      };
    })
    .filter((store) => store.latitude && store.longitude)
    .sort((storeA, storeB) => storeA.distance_km - storeB.distance_km);

  return mapped.slice(0, limit);
}

function homeRoutes(app) {
  app.get("/v1/launch", async (req, res, next) => {
    try {
      const [popups, slides] = await Promise.all([
        safeRows(
          req,
          "SELECT ROWID, title, subtitle, body, image_url, video_url, button_label, secondary_button_label, action_type, action_value, audience, show_once, start_date, end_date, display_order FROM Launch_Promos WHERE is_active = true",
          "Launch_Promos"
        ),
        safeRows(
          req,
          "SELECT ROWID, title, subtitle, body, image_url, video_url, button_label, secondary_button_label, action_type, action_value, audience, show_once, start_date, end_date, display_order FROM Onboarding_Slides WHERE is_active = true",
          "Onboarding_Slides"
        ),
      ]);

      const activePopups = popups
        .filter(inDisplayWindow)
        .map((row) => mapLaunchItem(row, "popup"))
        .sort((a, b) => a.display_order - b.display_order);
      const activeSlides = slides
        .filter(inDisplayWindow)
        .map((row) => mapLaunchItem(row, "slide"))
        .sort((a, b) => a.display_order - b.display_order);

      sendOk(res, {
        popups: activePopups,
        slides: activeSlides,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/home", async (req, res, next) => {
    try {
      const [banners, offers, products, outlets, services, brands, categories, trending] =
        await Promise.all([
          safeRows(
            req,
            "SELECT ROWID, title, subtitle, image_url, video_url, action_type, action_value, display_order FROM Home_Banners WHERE is_active = true",
            "Home_Banners"
          ),
          safeRows(
            req,
            "SELECT ROWID, title, code, description, discount_type, discount_value FROM Coupons WHERE is_active = true",
            "Coupons"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, brand_id, category_id, thumbnail_url, mrp, selling_price, currency FROM Products WHERE status = 'ACTIVE' AND is_featured = true",
            "Products"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, salon_category, address_line1, city, state, area, image_url, rating, review_count, latitude, longitude FROM Outlets WHERE is_active = true",
            "Outlets"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, category_id, description, image_url, duration_minutes, selling_price, currency FROM Salon_Services WHERE status = 'ACTIVE' AND is_active = true",
            "Salon_Services"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, slug, logo_url, banner_url, description FROM Brands WHERE is_active = true",
            "Brands"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, slug, icon_key, image_url, display_order FROM Service_Categories WHERE is_active = true",
            "Service_Categories"
          ),
          safeRows(
            req,
            "SELECT ROWID, name, image_url, tag, type, reference_id FROM Trending WHERE is_active = true",
            "Trending"
          ),
        ]);

      let bannerItems = banners.map(mapBanner);
      if (bannerItems.length === 0) {
        bannerItems = [
          {
            id: "gallery_aug_1",
            title: "STRAIGHTENING DAY",
            subtitle: "Flat 30% OFF - Every 24th of the Month",
            image_url: "assets/gallery/2026/August/straightening-day.png",
            month: "August 2026",
            action_type: "SALON",
            action_value: "0",
            cta_label: "Book Straightening",
            display_order: 1,
            is_active: true,
          },
          {
            id: "gallery_aug_2",
            title: "HAIR SPA DAY",
            subtitle: "30% OFF - Nourish, Repair & Revive",
            image_url: "assets/gallery/2026/August/hair-spa-day.png",
            month: "August 2026",
            action_type: "SALON",
            action_value: "0",
            cta_label: "Book Hair Spa",
            display_order: 2,
            is_active: true,
          },
          {
            id: "gallery_aug_3",
            title: "FEEL LIKE YOURSELF",
            subtitle: "Premium Hair, Beauty, Makeup & Nails",
            image_url: "assets/gallery/2026/August/feel-like-yourself.jpg",
            month: "August 2026",
            action_type: "SERVICE",
            action_value: "0",
            cta_label: "Explore Services",
            display_order: 3,
            is_active: true,
          },
        ];
      }

      sendOk(res, {
        banners: bannerItems,
        offers: offers.slice(0, 8).map(mapOffer),
        featured_products: products.slice(0, 12).map(mapProduct),
        featured_outlets: outlets.slice(0, 8).map(mapOutlet),
        featured_services: services.slice(0, 12).map(mapService),
        brands: brands.slice(0, 10).map(mapBrand),
        beauty_categories: categories.slice(0, 8).map(mapCategory),
        trending: trending.slice(0, 10).map(mapTrending),
      });
    } catch (error) {
      next(error);
    }
  });

  // Nearby outlets with Haversine distance
  app.get("/v1/outlets/nearby", async (req, res, next) => {
    try {
      sendOk(res, await nearbyOutletsPayload(req, req.query || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/outlets/nearby", async (req, res, next) => {
    try {
      sendOk(res, await nearbyOutletsPayload(req, req.body || {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/stores/nearby", async (req, res, next) => {
    try {
      res.status(200).json({
        ok: true,
        data: await nearbyStoresPayload(req, req.body || {}),
      });
    } catch (error) {
      next(error);
    }
  });

  // Notification unread count
  app.get("/v1/notifications/count", async (req, res, next) => {
    try {
      const userId = req.baylenUser?.userId;
      if (!userId) {
        return sendOk(res, { count: 0 });
      }
      const rows = await safeRows(
        req,
        `SELECT ROWID FROM Notifications WHERE user_id = '${userId}' AND is_read = false`,
        "Notifications"
      );
      sendOk(res, { count: rows.length });
    } catch (_) {
      sendOk(res, { count: 0 });
    }
  });
}

module.exports = homeRoutes;
