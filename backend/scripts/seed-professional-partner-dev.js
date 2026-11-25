#!/usr/bin/env node
"use strict";

/**
 * Seeds Development Professional Partner (Delivery_Partners) data for PP-001.
 *
 * Usage:
 *   node backend/scripts/seed-professional-partner-dev.js
 */

const path = require("path");
const CLI_LIB = path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "zcatalyst-cli",
  "lib"
);
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const API = require(path.join(CLI_LIB, "internal", "api")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";

const ACTIVE_PHONE = "+919825391754";
const PENDING_PHONE = "+919876543211";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(rows, table) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => row[table] || row).filter(Boolean);
}

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function todaySchedule(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zcql = await endpoints.zcqlAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );

  async function insertRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    await sleep(300);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [payload],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("insert " + tableName + ": " + JSON.stringify(res.body));
    }
    const data = res.body.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first && first[tableName] ? first[tableName] : first;
  }

  async function updateRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined && value !== "") {
        clean[key] = value;
      }
    }
    await sleep(300);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.put(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [clean],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("update " + tableName + ": " + JSON.stringify(res.body));
    }
    return res.body.data;
  }

  function partnerPayload(spec) {
    const payload = {
      phone: spec.phone,
      outlet_id: spec.outlet_id,
      outlet_row_id: spec.outlet_row_id != null ? spec.outlet_row_id : spec.outlet_id,
      status: spec.status,
      first_name: spec.first_name,
      last_name: spec.last_name,
      age: spec.age,
      qualification: spec.qualification,
      online_status: spec.online_status || "OFFLINE",
    };
    if (spec.legacy_provider_id) {
      payload.legacy_provider_id = spec.legacy_provider_id;
      payload.legacy_provider_row_id = spec.legacy_provider_row_id || spec.legacy_provider_id;
    }
    if (spec.legacy_rider_id) {
      payload.legacy_rider_id = spec.legacy_rider_id;
      payload.legacy_rider_row_id = spec.legacy_rider_row_id || spec.legacy_rider_id;
    }
    if (spec.profile_photo_url) payload.profile_photo_url = spec.profile_photo_url;
    if (spec.rating != null && spec.rating !== "") payload.rating = spec.rating;
    return payload;
  }

  const report = {
    partners: [],
    jobs: [],
    bridges: {},
    errors: [],
  };

  const outlets = unwrap(
    await zcql.query(
      "SELECT ROWID, name, city FROM Outlets WHERE is_active = true ORDER BY ROWID ASC LIMIT 2"
    ),
    "Outlets"
  );
  if (outlets.length < 2) {
    report.errors.push("Need at least 2 active Outlets for PP-001 seed data");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const outletA = outlets[0];
  const outletB = outlets[1];

  const providers = unwrap(
    await zcql
      .query("SELECT ROWID, phone FROM Providers WHERE is_active = true ORDER BY ROWID ASC LIMIT 1")
      .catch(() => []),
    "Providers"
  );
  const riders = unwrap(
    await zcql.query("SELECT ROWID, phone FROM Riders ORDER BY ROWID ASC LIMIT 1").catch(() => []),
    "Riders"
  );

  const legacyProviderId = providers[0] ? providers[0].ROWID : null;
  const legacyRiderId = riders[0] ? riders[0].ROWID : null;
  report.bridges = {
    legacy_provider_id: legacyProviderId ? String(legacyProviderId) : "",
    legacy_rider_id: legacyRiderId ? String(legacyRiderId) : "",
  };

  const users = unwrap(
    await zcql.query("SELECT ROWID FROM Users ORDER BY ROWID ASC LIMIT 1"),
    "Users"
  );
  const seedUserId = users[0] ? users[0].ROWID : null;
  if (!seedUserId) {
    report.errors.push("Need at least one Users row to seed Service_Jobs");
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  async function ensurePartner(spec) {
    const existing = unwrap(
      await zcql.query(
        "SELECT ROWID FROM Delivery_Partners WHERE phone = '" +
          spec.phone.replace(/'/g, "''") +
          "' LIMIT 1"
      ),
      "Delivery_Partners"
    );
    const payload = partnerPayload(spec);
    if (existing[0]) {
      await updateRow("Delivery_Partners", { ROWID: existing[0].ROWID, ...payload });
      return existing[0].ROWID;
    }
    const inserted = await insertRow("Delivery_Partners", payload);
    return inserted.ROWID || inserted.rowid;
  }

  const activePartnerId = await ensurePartner({
    phone: ACTIVE_PHONE,
    outlet_id: outletA.ROWID,
    status: "active",
    first_name: "Neha",
    last_name: "Singh",
    age: 28,
    qualification: "graduation",
    online_status: "ONLINE_AVAILABLE",
    legacy_provider_id: legacyProviderId,
    legacy_rider_id: legacyRiderId,
    rating: 4.7,
  });

  const pendingPartnerId = await ensurePartner({
    phone: PENDING_PHONE,
    outlet_id: outletB.ROWID,
    status: "pending_kyc",
    first_name: "Priya",
    last_name: "Sharma",
    age: 24,
    qualification: "intermediate",
    online_status: "OFFLINE",
  });

  report.partners.push({
    delivery_partner_id: "dp_" + activePartnerId,
    phone: ACTIVE_PHONE,
    outlet_id: String(outletA.ROWID),
    outlet_name: outletA.name || "",
    status: "active",
  });
  report.partners.push({
    delivery_partner_id: "dp_" + pendingPartnerId,
    phone: PENDING_PHONE,
    outlet_id: String(outletB.ROWID),
    outlet_name: outletB.name || "",
    status: "pending_kyc",
  });

  async function ensureAssignedJob(partnerRowId, outletId, spec) {
    const existing = unwrap(
      await zcql.query(
        "SELECT ROWID FROM Service_Jobs WHERE booking_number = '" +
          spec.booking_number.replace(/'/g, "''") +
          "' LIMIT 1"
      ),
      "Service_Jobs"
    );
    const payload = {
      user_id: seedUserId,
      job_number: spec.booking_number,
      scheduled_date: todayDateOnly(),
      start_time: spec.start_time,
      subtotal: spec.grand_total,
      discount_amount: 0,
      tax_amount: 0,
      booking_number: spec.booking_number,
      outlet_id: outletId,
      outlet_row_id: outletId,
      delivery_partner_id: partnerRowId,
      delivery_partner_row_id: partnerRowId,
      status: spec.status,
      visit_line1: spec.visit_line1,
      visit_city: spec.visit_city,
      visit_state: spec.visit_state || "",
      pincode: spec.pincode || "834001",
      scheduled_date: todayDateOnly(),
      scheduled_at: spec.scheduled_at,
      grand_total: spec.grand_total,
      currency: "INR",
      payment_status: "PAID",
      service_name_snapshot: spec.service_name_snapshot,
      gender_preference: "any",
    };
    if (existing[0]) {
      await updateRow("Service_Jobs", { ROWID: existing[0].ROWID, ...payload });
      return existing[0].ROWID;
    }
    const inserted = await insertRow("Service_Jobs", payload);
    return inserted.ROWID || inserted.rowid;
  }

  const jobOneId = await ensureAssignedJob(activePartnerId, outletA.ROWID, {
    booking_number: "PP001-SEED-JOB-1",
    start_time: "11:00:00",
    status: "ACCEPTED",
    visit_line1: "12 MG Road",
    visit_city: outletA.city || "Ranchi",
    visit_state: "Jharkhand",
    pincode: "834001",
    scheduled_at: todaySchedule(11),
    grand_total: 1299,
    service_name_snapshot: "Home Facial",
  });
  const jobTwoId = await ensureAssignedJob(activePartnerId, outletA.ROWID, {
    booking_number: "PP001-SEED-JOB-2",
    start_time: "09:00:00",
    status: "COMPLETED",
    visit_line1: "45 Circular Road",
    visit_city: outletA.city || "Ranchi",
    visit_state: "Jharkhand",
    pincode: "834002",
    scheduled_at: todaySchedule(9),
    grand_total: 899,
    service_name_snapshot: "Hair Spa",
  });

  report.jobs.push({ rowid: String(jobOneId), booking_number: "PP001-SEED-JOB-1" });
  report.jobs.push({ rowid: String(jobTwoId), booking_number: "PP001-SEED-JOB-2" });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
