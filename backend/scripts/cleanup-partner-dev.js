#!/usr/bin/env node
"use strict";

/**
 * Dev-only: clear stale partner notifications + reset assigned professional jobs.
 *
 * Usage:
 *   node backend/scripts/cleanup-partner-dev.js --name "Priya Singh"
 *   node backend/scripts/cleanup-partner-dev.js --phone +918825391754
 *   node backend/scripts/cleanup-partner-dev.js --name "Priya Singh" --keep-home-offer
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));

function parseArgs(argv) {
  const args = { name: "", phone: "", keepHomeOffer: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--name" && argv[i + 1]) args.name = String(argv[++i]).trim();
    else if (token === "--phone" && argv[i + 1]) args.phone = String(argv[++i]).trim();
    else if (token === "--keep-home-offer") args.keepHomeOffer = true;
  }
  return args;
}

async function findPartner(zcql, { name, phone }) {
  if (phone) {
    const normalized = phone.replace(/[\s\-()]/g, "");
    const rows = unwrap(
      await zcql.query(
        "SELECT ROWID, first_name, last_name, phone, status FROM Delivery_Partners WHERE phone = '" +
          normalized.replace(/'/g, "''") +
          "' LIMIT 1"
      ),
      "Delivery_Partners"
    );
    return rows[0] || null;
  }
  if (name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0].replace(/'/g, "''");
    const last = (parts.slice(1).join(" ") || parts[0]).replace(/'/g, "''");
    const rows = unwrap(
      await zcql.query(
        "SELECT ROWID, first_name, last_name, phone, status FROM Delivery_Partners WHERE first_name = '" +
          first +
          "' AND last_name = '" +
          last +
          "' ORDER BY MODIFIEDTIME DESC LIMIT 1"
      ),
      "Delivery_Partners"
    );
    return rows[0] || null;
  }
  return null;
}

async function deleteRowsByQuery(ctx, table, query) {
  const rows = unwrap(await ctx.zcql.query(query), table);
  let deleted = 0;
  for (const row of rows) {
    try {
      await ctx.zcql.query("DELETE FROM " + table + " WHERE ROWID = " + row.ROWID);
      deleted += 1;
    } catch (_) {
      try {
        await ctx.updateRow(table, {
          ROWID: row.ROWID,
          read_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        });
        deleted += 1;
      } catch (_) {}
    }
  }
  return { found: rows.length, deleted };
}

async function resetProfessionalJob(ctx, row, { keepHomeOffer }) {
  if (
    keepHomeOffer &&
    row.job_type === "HOME_SERVICE" &&
    String(row.job_status || "").toUpperCase() === "ASSIGNED"
  ) {
    return { skipped: true, reason: "kept_home_offer" };
  }
  await ctx.updateRow("Professional_Jobs", {
    ROWID: row.ROWID,
    job_status: "ASSIGNMENT_PENDING",
    assigned_at: "",
    accepted_at: "",
    offer_expires_at: "",
    metadata_json: "",
  });
  await ctx.clearBigIntColumn("Professional_Jobs", row.ROWID, "delivery_partner_row_id");
  return { reset: true, job_type: row.job_type, previous_status: row.job_status };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.name && !args.phone)) {
    console.log(`Usage:
  node backend/scripts/cleanup-partner-dev.js --name "Priya Singh"
  node backend/scripts/cleanup-partner-dev.js --phone +918825391754`);
    process.exit(args.help ? 0 : 1);
  }

  const ctx = await createDevCatalystClient();
  const partner = await findPartner(ctx.zcql, args);
  if (!partner) {
    throw new Error("Partner not found");
  }
  const partnerRowId = String(partner.ROWID);

  const notifications = await deleteRowsByQuery(
    ctx,
    "Partner_Notifications",
    "SELECT ROWID, notification_type, title, professional_job_row_id FROM Partner_Notifications WHERE partner_row_id = '" +
      partnerRowId +
      "' ORDER BY CREATEDTIME DESC LIMIT 200"
  );

  const resetStatuses = [
    "ASSIGNED",
    "ACCEPTED",
    "REASSIGNMENT_REQUIRED",
    "EN_ROUTE",
    "STARTED",
    "IN_PROGRESS",
    "GOING_TO_PICKUP",
    "ARRIVED",
    "ARRIVED_PICKUP",
  ];
  const assignedJobs = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, job_type, job_status, job_number FROM Professional_Jobs WHERE delivery_partner_row_id = " +
        partnerRowId +
        " AND job_status IN ('" +
        resetStatuses.join("','") +
        "') ORDER BY CREATEDTIME DESC LIMIT 50"
    ),
    "Professional_Jobs"
  );

  const jobResets = [];
  for (const row of assignedJobs) {
    jobResets.push(await resetProfessionalJob(ctx, row, args));
  }

  const remaining = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, job_type, job_status FROM Professional_Jobs WHERE delivery_partner_row_id = " +
        partnerRowId +
        " ORDER BY CREATEDTIME DESC LIMIT 20"
    ),
    "Professional_Jobs"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        partner: {
          name: [partner.first_name, partner.last_name].filter(Boolean).join(" "),
          phone: partner.phone,
          delivery_partner_id: "dp_" + partnerRowId,
          status: partner.status,
        },
        cleared: {
          notifications,
          professional_jobs_reset: jobResets.filter((item) => item.reset),
          professional_jobs_kept: jobResets.filter((item) => item.skipped),
        },
        remaining_jobs: remaining,
        next:
          "Run: node backend/scripts/device-check-partner-offer.js --name \"" +
          [partner.first_name, partner.last_name].filter(Boolean).join(" ") +
          '"',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
