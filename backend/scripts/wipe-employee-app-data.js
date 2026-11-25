#!/usr/bin/env node
"use strict";

/**
 * Dev-only: wipe ALL employee / delivery partner app data for a fresh onboarding test.
 * Does NOT delete customer User_Profiles, salon Staff, or Providers.
 *
 * Usage:
 *   node backend/scripts/wipe-employee-app-data.js --confirm
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));

function parseArgs(argv) {
  const args = { confirm: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--confirm") args.confirm = true;
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

async function listPartners(zcql) {
  return unwrap(
    await zcql.query(
      "SELECT ROWID, phone, first_name, last_name, status, online_status, registration_phase, profile_photo_url, CREATEDTIME FROM Delivery_Partners ORDER BY ROWID DESC LIMIT 200"
    ),
    "Delivery_Partners"
  );
}

async function deleteAllRows(ctx, table) {
  let deleted = 0;
  let found = 0;
  const errors = [];
  for (let pass = 0; pass < 20; pass += 1) {
    const rows = unwrap(
      await ctx.zcql.query("SELECT ROWID FROM " + table + " LIMIT 200"),
      table
    );
    if (!rows.length) break;
    found += rows.length;
    for (const row of rows) {
      try {
        await ctx.zcql.query("DELETE FROM " + table + " WHERE ROWID = " + row.ROWID);
        deleted += 1;
      } catch (err) {
        errors.push({ row_id: row.ROWID, error: err.message || String(err) });
      }
    }
    if (rows.length < 200) break;
  }
  return { found, deleted, errors };
}

async function resetPartnerJobs(ctx) {
  const rows = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, job_type, job_status, delivery_partner_row_id FROM Professional_Jobs WHERE delivery_partner_row_id IS NOT NULL ORDER BY ROWID DESC LIMIT 200"
    ),
    "Professional_Jobs"
  );
  let reset = 0;
  for (const row of rows) {
    await ctx.updateRow("Professional_Jobs", {
      ROWID: row.ROWID,
      job_status: "ASSIGNMENT_PENDING",
      assigned_at: "",
      accepted_at: "",
      offer_expires_at: "",
      metadata_json: "",
    });
    await ctx.clearBigIntColumn("Professional_Jobs", row.ROWID, "delivery_partner_row_id");
    reset += 1;
  }
  return { found: rows.length, reset };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.confirm) {
    console.log(`Usage:
  node backend/scripts/wipe-employee-app-data.js --confirm

WARNING: Deletes ALL Delivery_Partners, Delivery_Partner_KYC, partner notifications,
support tickets, partner earnings rows, and unlinks professional jobs in Development.`);
    process.exit(args.help ? 0 : 1);
  }

  const ctx = await createDevCatalystClient();
  const beforePartners = await listPartners(ctx.zcql);

  const before = {
    delivery_partners: beforePartners.length,
    delivery_partner_kyc: unwrap(
      await ctx.zcql.query("SELECT ROWID FROM Delivery_Partner_KYC LIMIT 200"),
      "Delivery_Partner_KYC"
    ).length,
    partner_notifications: unwrap(
      await ctx.zcql.query("SELECT ROWID FROM Partner_Notifications LIMIT 200"),
      "Partner_Notifications"
    ).length,
    partner_support_tickets: unwrap(
      await ctx.zcql.query("SELECT ROWID FROM Partner_Support_Tickets LIMIT 200"),
      "Partner_Support_Tickets"
    ).length,
    professional_earnings: unwrap(
      await ctx.zcql.query("SELECT ROWID FROM Professional_Earnings LIMIT 200"),
      "Professional_Earnings"
    ).length,
    employee_accounts: beforePartners.map((p) => ({
      delivery_partner_id: "dp_" + p.ROWID,
      phone: p.phone || "",
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      status: p.status || "",
      online_status: p.online_status || "",
      registration_phase: p.registration_phase || "",
      has_profile_photo: Boolean(p.profile_photo_url),
      created: p.CREATEDTIME || "",
    })),
  };

  const wiped = {
    partner_notifications: await deleteAllRows(ctx, "Partner_Notifications"),
    partner_support_tickets: await deleteAllRows(ctx, "Partner_Support_Tickets"),
    professional_earnings: await deleteAllRows(ctx, "Professional_Earnings"),
    professional_jobs_unlinked: await resetPartnerJobs(ctx),
    delivery_partner_kyc: await deleteAllRows(ctx, "Delivery_Partner_KYC"),
    delivery_partners: await deleteAllRows(ctx, "Delivery_Partners"),
  };

  const afterPartners = await listPartners(ctx.zcql);

  console.log(
    JSON.stringify(
      {
        ok: true,
        environment: "Development",
        wiped_at: new Date().toISOString(),
        before,
        wiped,
        after: {
          delivery_partners: afterPartners.length,
          employee_accounts: afterPartners,
        },
        not_deleted: [
          "Customer User_Profiles (customer app login)",
          "Salon Staff / Providers (salon catalog)",
          "File Store photos (orphaned files may remain)",
        ],
        new_employee_flow:
          "OTP login → Registration steps → KYC (Aadhaar/PAN) → Admin approval → Dashboard → Go online",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
