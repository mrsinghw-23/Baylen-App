#!/usr/bin/env node
"use strict";

/**
 * Stage a home-service job offer for device QA (partner go online → accept).
 * Development Catalyst only.
 *
 * Use an EXISTING partner (recommended):
 *   node backend/scripts/device-check-partner-offer.js --name "Priya Singh"
 *   node backend/scripts/device-check-partner-offer.js --phone +918825391754
 *
 * Or bind the PP004 fixture partner to a new number:
 *   node backend/scripts/device-check-partner-offer.js --phone +919XXXXXXXXX --set-password
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
  PHONE_A,
  BOOKING_HOME_ACCEPT,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const { resolveServiceZoneLabel } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/service-zone-resolve"
));
const { ONLINE_STATUS } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/partner-dashboard"
));
const {
  hashPassword,
  REGISTRATION_PHASE,
} = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner-registration"));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const DEFAULT_DEV_PASSWORD = "Baylen@Test1";

function parseArgs(argv) {
  const args = {
    phone: String(process.env.PARTNER_PHONE || "").trim(),
    name: String(process.env.PARTNER_NAME || "").trim(),
    password: String(process.env.PARTNER_PASSWORD || "").trim(),
    setPassword: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--phone" && argv[i + 1]) {
      args.phone = String(argv[++i]).trim();
    } else if (token === "--name" && argv[i + 1]) {
      args.name = String(argv[++i]).trim();
    } else if (token === "--password" && argv[i + 1]) {
      args.password = String(argv[++i]).trim();
      args.setPassword = true;
    } else if (token === "--set-password") {
      args.setPassword = true;
      if (!args.password) {
        args.password = DEFAULT_DEV_PASSWORD;
      }
    }
  }
  return args;
}

function normalizePhoneInput(value) {
  let text = String(value || "").trim().replace(/[\s\-()]/g, "");
  if (text.startsWith("00")) {
    text = "+" + text.slice(2);
  }
  if (/^\d{10}$/.test(text)) {
    text = "+91" + text;
  }
  if (!/^\+\d{10,15}$/.test(text)) {
    throw new Error("Use --phone with country code, e.g. --phone +919876543210");
  }
  return text;
}

function printUsage() {
  console.log(`Usage:
  node backend/scripts/device-check-partner-offer.js --name "Priya Singh"
  node backend/scripts/device-check-partner-offer.js --phone +918825391754
  node backend/scripts/device-check-partner-offer.js --phone +919XXXXXXXXX --set-password

Existing partner (e.g. Priya Singh you registered):
  Uses your real Dev row — keep your own employee password.

Fixture rebind (fake test number ${PHONE_A}):
  Add --set-password to set Dev password ${DEFAULT_DEV_PASSWORD}.

Then on device:
  Service Professional → Employee Login → go online → Service → Upcoming → Accept`);
}

async function upsertKycRegistrationDirect(app, zcql, partnerRowId, payload) {
  const { findKycRegRow } = require(path.join(
    __dirname,
    "../functions/baylen-api/lib/delivery-partner-registration"
  ));
  const existing = await findKycRegRow(zcql, partnerRowId);
  const row = {
    delivery_partner_id: partnerRowId,
    partner_row_id: String(partnerRowId),
    country: "India",
    ...payload,
  };
  if (existing?.ROWID) {
    await app.datastore().table("Delivery_Partner_KYC").updateRow({
      ROWID: existing.ROWID,
      ...row,
    });
    return existing.ROWID;
  }
  const inserted = await app.datastore().table("Delivery_Partner_KYC").insertRow(row);
  return inserted?.ROWID || inserted?.rowid || null;
}

async function findPartnerByName(zcql, name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const first = parts[0].replace(/'/g, "''");
  const last = (parts.slice(1).join(" ") || parts[0]).replace(/'/g, "''");
  const rows = unwrap(
    await zcql.query(
      "SELECT ROWID, first_name, last_name, phone, status, online_status FROM Delivery_Partners WHERE first_name = '" +
        first +
        "' AND last_name = '" +
        last +
        "' ORDER BY MODIFIEDTIME DESC LIMIT 5"
    ),
    "Delivery_Partners"
  );
  return rows[0] || null;
}

async function resolvePartnerForDevice(ctx, manifest, { phone, name }) {
  const { zcql, updateRow } = ctx;

  if (name) {
    const match = await findPartnerByName(zcql, name);
    if (!match) {
      throw new Error('No Delivery_Partners row found for name "' + name + '"');
    }
    return {
      partnerRowId: String(match.ROWID),
      phone: match.phone,
      rebound: false,
      note: "Using existing partner by name",
    };
  }

  const normalized = normalizePhoneInput(phone);
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID, phone FROM Delivery_Partners WHERE phone = '" +
        normalized.replace(/'/g, "''") +
        "' LIMIT 1"
    ),
    "Delivery_Partners"
  )[0];

  if (existing) {
    return {
      partnerRowId: String(existing.ROWID),
      phone: existing.phone || normalized,
      rebound: false,
      note: "Using your existing Delivery_Partners row",
    };
  }

  const fixturePartnerId = manifest.partners.A;
  await updateRow("Delivery_Partners", {
    ROWID: fixturePartnerId,
    phone: normalized,
  });

  return {
    partnerRowId: String(fixturePartnerId),
    phone: normalized,
    rebound: true,
    note: "Rebound PP004 test partner to your phone",
  };
}

async function ensureEmployeeLogin(ctx, partnerRowId, password) {
  const { app, zcql } = ctx;
  const { salt, hash } = hashPassword(password);
  await upsertKycRegistrationDirect(app, zcql, partnerRowId, {
    registration_phase: REGISTRATION_PHASE.REGISTERED,
    password_salt: salt,
    password_hash: hash,
    first_name: "Device",
    last_name: "Tester",
    address_line1: "PP004 device check",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834001",
    email: "device.tester@baylen.dev",
    gender: "OTHER",
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }
  if (!args.phone && !args.name) {
    console.error(
      "Pass --name \"Priya Singh\" or --phone +91XXXXXXXXXX for an existing partner.\n"
    );
    printUsage();
    process.exit(1);
  }

  const ctx = await createDevCatalystClient();
  const { app, zcql, updateRow } = ctx;
  const manifest = await setupPp004Fixtures();
  const partnerBinding = await resolvePartnerForDevice(ctx, manifest, args);
  const partnerRowId = partnerBinding.partnerRowId;
  const jobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;

  const serviceZone = await resolveServiceZoneLabel(app.zcql(), {
    visit_city: manifest.visit_city || "Ranchi",
    visit_state: "Jharkhand",
    pincode: "834001",
  });

  await updateRow("Delivery_Partners", {
    ROWID: partnerRowId,
    status: "active",
    outlet_id: manifest.outlet_row_id,
    outlet_row_id: manifest.outlet_row_id,
    state: "Jharkhand",
    district: manifest.visit_city || "Ranchi",
    city: manifest.visit_city || "Ranchi",
    postal_code: "834001",
    service_zone: serviceZone || manifest.visit_city || "Ranchi",
    online_status: ONLINE_STATUS.ONLINE_AVAILABLE,
  });

  if (args.setPassword && args.password) {
    await ensureEmployeeLogin(ctx, partnerRowId, args.password);
  }

  const dispatch = await prepareProfessionalJobOffer(ctx, {
    professionalJobId: jobId,
    assignToPartnerRowId: partnerRowId,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });

  await updateRow("Delivery_Partners", {
    ROWID: partnerRowId,
    online_status: ONLINE_STATUS.OFFLINE,
  });

  const partner = unwrap(
    await zcql.query(
      "SELECT ROWID, first_name, last_name, phone, status, online_status FROM Delivery_Partners WHERE ROWID = " +
        partnerRowId
    ),
    "Delivery_Partners"
  )[0];

  const booking = unwrap(
    await zcql.query(
      "SELECT booking_number, service_name_snapshot, visit_city, scheduled_at, grand_total FROM Service_Jobs WHERE ROWID = " +
        serviceJobId
    ),
    "Service_Jobs"
  )[0];

  const summary = {
    ok: dispatch.job_status === "ASSIGNED",
    environment: "Development",
    api_base: "https://baylen-app-60069781151.development.catalystserverless.in",
    partner_binding: partnerBinding,
    login: {
      role: "Service Professional → Employee Login",
      mobile: partner.phone,
      password: args.setPassword ? args.password : "Use the password you set during registration",
      note: args.setPassword
        ? "Dev password was reset by this script"
        : "Existing registration password kept unchanged",
    },
    partner: {
      name: [partner.first_name, partner.last_name].filter(Boolean).join(" "),
      phone: partner.phone,
      delivery_partner_id: "dp_" + partnerRowId,
      status: partner.status,
      online_status: partner.online_status,
    },
    offer: {
      professional_job_id: jobId,
      job_status: dispatch.job_status,
      booking_number: booking?.booking_number || BOOKING_HOME_ACCEPT,
      service: booking?.service_name_snapshot || "PP004 Home Accept Service",
      city: booking?.visit_city || manifest.visit_city,
      scheduled_at: booking?.scheduled_at,
      amount_inr: booking?.grand_total,
      offer_expires_at: dispatch.offer_expires_at,
    },
    device_steps: [
      "flutter run — app already points at Development API",
      "Role picker → Service Professional → Employee Login",
      "Mobile: " + partner.phone + " + your registration password",
      "Home tab → toggle Available for jobs ON",
      "Service tab → Upcoming → Accept PP004 Home Accept Service",
    ],
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
