#!/usr/bin/env node
"use strict";

/**
 * Seeds Development home-service data:
 * - marks eligible Salon_Services.is_at_home = true
 * - ensures Beauty_Service_Zones for active outlets
 * - ensures Providers + Provider_Services + Service_Areas when missing
 *
 * Usage: node backend/scripts/seed-home-service-data.js
 */

const path = require("path");
const catalyst = require(path.join(
  __dirname,
  "../functions/baylen-api/node_modules/zcatalyst-sdk-node"
));

const HOME_SERVICE_TYPES = new Set(["Hair", "Skin", "Nails", "Spa"]);
const SKIP_SERVICE_KEYWORDS = ["bridal", "wedding", "party makeup"];

function rowOf(rows, table) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const first = rows[0];
  if (first && first[table]) return first[table];
  return first;
}

function rowsOf(rows, table) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => row[table] || row).filter(Boolean);
}

function shouldEnableAtHome(service) {
  const type = String(service.service_type || "").trim();
  const name = String(service.name || "").toLowerCase();
  if (SKIP_SERVICE_KEYWORDS.some((word) => name.includes(word))) {
    return false;
  }
  if (HOME_SERVICE_TYPES.has(type)) return true;
  return false;
}

async function main() {
  const app = catalyst.initialize({}, { scope: "admin" });
  const zcql = app.zcql();
  const report = {
    services_updated: 0,
    zones_added: 0,
    providers_added: 0,
    provider_links: 0,
    areas_added: 0,
    skipped: [],
    errors: [],
  };

  const services = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, service_type, is_at_home, status, is_active FROM Salon_Services WHERE status = 'ACTIVE' AND is_active = true"
    ),
    "Salon_Services"
  );

  for (const service of services) {
    if (!shouldEnableAtHome(service)) continue;
    if (service.is_at_home === true || service.is_at_home === "true") {
      report.skipped.push("service already at_home " + service.ROWID);
      continue;
    }
    try {
      await app.datastore().table("Salon_Services").updateRow({
        ROWID: service.ROWID,
        is_at_home: true,
      });
      report.services_updated += 1;
    } catch (error) {
      report.errors.push("service " + service.ROWID + ": " + (error.message || error));
    }
  }

  const outlets = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, city, state FROM Outlets WHERE is_active = true"
    ),
    "Outlets"
  );

  const existingZones = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, outlet_id FROM Beauty_Service_Zones WHERE is_active = true"
    ).catch(() => []),
    "Beauty_Service_Zones"
  );
  const zonedOutlets = new Set(existingZones.map((row) => String(row.outlet_id)));

  for (const outlet of outlets) {
    if (zonedOutlets.has(String(outlet.ROWID))) continue;
    try {
      await app.datastore().table("Beauty_Service_Zones").insertRow({
        outlet_id: outlet.ROWID,
        city: outlet.city || "",
        state: outlet.state || "",
        pincode_prefix: "",
        max_radius_km: 15,
        is_active: true,
      });
      report.zones_added += 1;
    } catch (error) {
      report.errors.push("zone " + outlet.ROWID + ": " + (error.message || error));
    }
  }

  const homeServices = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, service_type FROM Salon_Services WHERE is_at_home = true AND status = 'ACTIVE' AND is_active = true LIMIT 20"
    ),
    "Salon_Services"
  );

  if (!homeServices.length) {
    report.errors.push("No is_at_home services found after update");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const existingProviders = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, first_name, last_name, status, is_active FROM Providers WHERE is_active = true"
    ).catch(() => []),
    "Providers"
  );

  const cities = [...new Set(outlets.map((o) => String(o.city || "").trim()).filter(Boolean))];

  async function ensureProviderLink(providerId, serviceId) {
    const existing = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Provider_Services WHERE provider_id = " +
          providerId +
          " AND service_id = " +
          serviceId +
          " LIMIT 1"
      ),
      "Provider_Services"
    );
    if (existing) return;
    await app.datastore().table("Provider_Services").insertRow({
      provider_id: providerId,
      service_id: serviceId,
      is_active: true,
    });
    report.provider_links += 1;
  }

  async function ensureServiceArea(providerId, city) {
    if (!city) return;
    const existing = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Service_Areas WHERE provider_id = " +
          providerId +
          " AND city = '" +
          String(city).replace(/'/g, "''") +
          "' LIMIT 1"
      ),
      "Service_Areas"
    );
    if (existing) return;
    await app.datastore().table("Service_Areas").insertRow({
      provider_id: providerId,
      city,
      is_active: true,
    });
    report.areas_added += 1;
  }

  if (existingProviders.length === 0) {
    const sampleNames = [
      ["Neha", "Singh"],
      ["Priya", "Sharma"],
      ["Ananya", "Verma"],
    ];
    for (let i = 0; i < Math.min(sampleNames.length, cities.length || 1); i += 1) {
      const [first, last] = sampleNames[i];
      try {
        const inserted = await app.datastore().table("Providers").insertRow({
          first_name: first,
          last_name: last,
          phone: "+91900000000" + String(i + 1),
          rating: 4.7 + i * 0.1,
          status: "AVAILABLE",
          is_active: true,
        });
        const providerId = inserted.ROWID;
        report.providers_added += 1;
        for (const service of homeServices.slice(0, 4)) {
          await ensureProviderLink(providerId, service.ROWID);
        }
        for (const city of cities.slice(0, 3)) {
          await ensureServiceArea(providerId, city);
        }
      } catch (error) {
        report.errors.push("provider seed: " + (error.message || error));
      }
    }
  } else {
    for (const provider of existingProviders) {
      for (const service of homeServices.slice(0, 6)) {
        try {
          await ensureProviderLink(provider.ROWID, service.ROWID);
        } catch (error) {
          report.errors.push(
            "link " + provider.ROWID + "/" + service.ROWID + ": " + (error.message || error)
          );
        }
      }
      for (const city of cities) {
        try {
          await ensureServiceArea(provider.ROWID, city);
        } catch (error) {
          report.errors.push(
            "area " + provider.ROWID + "/" + city + ": " + (error.message || error)
          );
        }
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
