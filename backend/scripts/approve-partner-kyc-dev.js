#!/usr/bin/env node
"use strict";

/**
 * Approve a submitted employee KYC on Dev (sets partner status = active).
 *
 * Usage:
 *   node backend/scripts/approve-partner-kyc-dev.js --phone 8825391754
 *   node backend/scripts/approve-partner-kyc-dev.js --id dp_123456789
 *   node backend/scripts/approve-partner-kyc-dev.js --list
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(
  __dirname,
  "lib/dev-catalyst-client"
));

function parseArgs(argv) {
  const args = { phone: "", id: "", list: false };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--phone") args.phone = String(argv[++i] || "").replace(/\D/g, "");
    else if (token === "--id") args.id = String(argv[++i] || "").trim();
    else if (token === "--list") args.list = true;
  }
  if (args.phone.length === 10) args.phone = "91" + args.phone;
  return args;
}

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function main() {
  const args = parseArgs(process.argv);
  const ctx = await createDevCatalystClient();
  const zcql = ctx.zcql;
  const app = ctx.app;

  const partners = unwrap(
    await zcql.query(
      "SELECT ROWID, phone, first_name, last_name, status, kyc_approved_at FROM Delivery_Partners ORDER BY ROWID DESC LIMIT 100"
    ),
    "Delivery_Partners"
  );

  if (args.list) {
    const pending = partners.filter((row) =>
      ["kyc_submitted", "kyc_under_review", "pending_kyc"].includes(
        String(row.status || "").toLowerCase()
      )
    );
    console.log(JSON.stringify({ pending }, null, 2));
    return;
  }

  let partner = null;
  if (args.id) {
    const rowId = args.id.replace(/^dp_/i, "");
    partner = partners.find((row) => String(row.ROWID) === rowId) || null;
  } else if (args.phone) {
    partner =
      partners.find((row) => String(row.phone || "").replace(/\D/g, "") === args.phone) ||
      null;
  }

  if (!partner) {
    console.error("Partner not found. Use --list to see pending accounts.");
    process.exit(1);
  }

  const kycRows = unwrap(
    await zcql.query(
      "SELECT ROWID, submitted_at, reviewed_at FROM Delivery_Partner_KYC WHERE partner_row_id = " +
        partner.ROWID +
        " OR delivery_partner_id = " +
        partner.ROWID +
        " ORDER BY ROWID DESC LIMIT 5"
    ),
    "Delivery_Partner_KYC"
  );
  const kyc = kycRows[0];
  if (!kyc || !kyc.submitted_at) {
    console.error(
      "KYC is not submitted yet for",
      partner.first_name,
      partner.last_name,
      partner.phone
    );
    process.exit(1);
  }

  const reviewedAt = nowSql();
  await app.datastore().table("Delivery_Partners").updateRow({
    ROWID: partner.ROWID,
    status: "active",
    kyc_approved_at: reviewedAt,
  });
  await app.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kyc.ROWID,
    reviewed_at: reviewedAt,
    reviewed_by: "DEV_SCRIPT",
    rejection_reason: null,
  });

  console.log(
    JSON.stringify(
      {
        approved: true,
        partner_id: "dp_" + partner.ROWID,
        phone: partner.phone,
        name: [partner.first_name, partner.last_name].filter(Boolean).join(" "),
        status: "active",
        reviewed_at: reviewedAt,
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
