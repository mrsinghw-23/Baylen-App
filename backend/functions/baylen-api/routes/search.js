const { rowsOf, sendOk, sqlString, num } = require("../lib/http");

// Reusable mappers
function mapProduct(row) {
  return {
    type: "product",
    id: String(row.ROWID),
    name: row.name || "",
    description: row.short_description || "",
    category_id: row.category_id ? String(row.category_id) : "",
    thumbnail_url: row.thumbnail_url || "",
    mrp: num(row.mrp),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapService(row) {
  return {
    type: "service",
    id: String(row.ROWID),
    name: row.name || "",
    description: row.description || "",
    category_id: row.category_id ? String(row.category_id) : "",
    image_url: row.image_url || "",
    duration_minutes: num(row.duration_minutes),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapOutlet(row) {
  return {
    type: "outlet",
    id: String(row.ROWID),
    name: row.name || "",
    salon_category: row.salon_category || "",
    address: `${row.address_line1 || ""}, ${row.area || ""}, ${row.city || ""}`.replace(/^[,\s]+|[,\s]+$/g, ''),
    image_url: row.image_url || "",
    rating: num(row.rating),
    review_count: num(row.review_count),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
  };
}

function mapBrand(row) {
  return {
    type: "brand",
    id: String(row.ROWID),
    name: row.name || "",
    description: row.description || "",
    logo_url: row.logo_url || "",
  };
}

// Haversine distance in km
function haversineKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function searchRoutes(app) {
  app.get("/v1/search", async (req, res, next) => {
    try {
      const q = String(req.query.q || "").trim();
      const typeFilter = String(req.query.type || "").trim().toLowerCase(); // e.g., 'product', 'service', 'outlet'
      const userLat = parseFloat(req.query.lat);
      const userLng = parseFloat(req.query.lng);

      if (!q) {
        return sendOk(res, { results: [] });
      }

      const zcql = req.catalystApp.zcql();
      const term = sqlString("%" + q + "%");

      const queries = [];
      const types = [];

      // Build parallel queries based on filter (or all if no filter)
      if (!typeFilter || typeFilter === 'product') {
        queries.push(zcql.executeZCQLQuery(`SELECT ROWID, name, short_description, category_id, thumbnail_url, mrp, selling_price, currency FROM Products WHERE status = 'ACTIVE' AND (name LIKE ${term} OR short_description LIKE ${term})`));
        types.push('product');
      }

      if (!typeFilter || typeFilter === 'service') {
        queries.push(zcql.executeZCQLQuery(`SELECT ROWID, name, description, category_id, image_url, duration_minutes, selling_price, currency FROM Salon_Services WHERE status = 'ACTIVE' AND is_active = true AND (name LIKE ${term} OR description LIKE ${term})`));
        types.push('service');
      }

      if (!typeFilter || typeFilter === 'outlet') {
        queries.push(zcql.executeZCQLQuery(`SELECT ROWID, name, salon_category, address_line1, area, city, image_url, rating, review_count, latitude, longitude FROM Outlets WHERE is_active = true AND (name LIKE ${term} OR city LIKE ${term} OR area LIKE ${term})`));
        types.push('outlet');
      }

      if (!typeFilter || typeFilter === 'brand') {
        queries.push(zcql.executeZCQLQuery(`SELECT ROWID, name, description, logo_url FROM Brands WHERE is_active = true AND name LIKE ${term}`));
        types.push('brand');
      }

      // Execute all needed queries in parallel
      const resultsArray = await Promise.all(queries.map(p => p.catch(() => [])));

      let allResults = [];

      // Parse results
      for (let i = 0; i < resultsArray.length; i++) {
        const rows = rowsOf(resultsArray[i], ["Products", "Salon_Services", "Outlets", "Brands"][i]); // Note: the tableName argument for rowsOf acts as a fallback or strict path, we'll extract cleanly. Actually rowsOf expects the table name exactly. Let's just use a safer parsing.

        // Safe parsing since rowsOf requires exact table name and we varied them
        let parsedRows = [];
        try {
          const rawData = resultsArray[i];
          if (Array.isArray(rawData)) {
            parsedRows = rawData.map(r => {
              const keys = Object.keys(r);
              return r[keys[0]]; // Extract the nested object
            });
          }
        } catch(e) {}

        const t = types[i];
        if (t === 'product') allResults.push(...parsedRows.map(mapProduct));
        if (t === 'service') allResults.push(...parsedRows.map(mapService));
        if (t === 'outlet') {
          const mappedOutlets = parsedRows.map(mapOutlet);
          // Apply distance if coordinates provided
          if (!isNaN(userLat) && !isNaN(userLng)) {
            mappedOutlets.forEach(o => {
              o.distance_km = Math.round(haversineKm(userLat, userLng, o.latitude, o.longitude) * 10) / 10;
            });
          }
          allResults.push(...mappedOutlets);
        }
        if (t === 'brand') allResults.push(...parsedRows.map(mapBrand));
      }

      // Relevance Scoring (Exact matches score higher)
      const exactQ = q.toLowerCase();
      allResults.sort((a, b) => {
        const aName = (a.name || "").toLowerCase();
        const bName = (b.name || "").toLowerCase();

        // Exact name match
        if (aName === exactQ && bName !== exactQ) return -1;
        if (bName === exactQ && aName !== exactQ) return 1;

        // Starts with match
        if (aName.startsWith(exactQ) && !bName.startsWith(exactQ)) return -1;
        if (bName.startsWith(exactQ) && !aName.startsWith(exactQ)) return 1;

        // Distance sorting for outlets
        if (a.type === 'outlet' && b.type === 'outlet' && a.distance_km !== undefined && b.distance_km !== undefined) {
          return a.distance_km - b.distance_km;
        }

        return 0;
      });

      sendOk(res, { results: allResults.slice(0, 50) });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = searchRoutes;
