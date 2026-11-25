#!/usr/bin/env node
"use strict";

/**
 * List employee (Delivery Partner) login data stored in Dev Catalyst.
 *
 * Usage:
 *   node backend/scripts/list-employee-login-data.js
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));

async function safeCount(zcql, sql, table) {
  try {
    const rows = unwrap(await zcql.query(sql), table);
    const row = rows[0] || {};
    return Number(row.c || row.COUNT || rows.length || 0);
  } catch (_) {
    return null;
  }
}

async function main() {
  const ctx = await createDevCatalystClient();
  const zcql = ctx.zcql;

  const partners = unwrap(
    await zcql.query(
      "SELECT ROWID, phone, first_name, last_name, status, registration_phase, online_status, profile_photo_url, qualification, service_zone, outlet_id, kyc_approved_at, email, gender, district, city, state, postal_code, CREATEDTIME FROM Delivery_Partners ORDER BY ROWID DESC LIMIT 100"
    ),
    "Delivery_Partners"
  );

  const kycRows = unwrap(
    await zcql.query(
      "SELECT ROWID, delivery_partner_id, partner_row_id, first_name, last_name, registration_phase, profile_photo_file_id, profile_photo_folder_id, identity_document_file_id, identity_document_folder_id, address_document_file_id, address_document_folder_id, pan_last4, aadhaar_last4, submitted_at, reviewed_at, rejection_reason, email, city, state, postal_code FROM Delivery_Partner_KYC ORDER BY ROWID DESC LIMIT 100"
    ),
    "Delivery_Partner_KYC"
  );

  const kycByPartner = new Map();
  for (const row of kycRows) {
    const key = String(row.partner_row_id || row.delivery_partner_id || "");
    if (key) kycByPartner.set(key, row);
  }

  const report = {
    environment: "Development",
    queried_at: new Date().toISOString(),
    table_counts: {
      delivery_partners: partners.length,
      delivery_partner_kyc: kycRows.length,
      partner_notifications: await safeCount(
        zcql,
        "SELECT COUNT(ROWID) as c FROM Partner_Notifications",
        "Partner_Notifications"
      ),
      service_jobs_with_partner: await safeCount(
        zcql,
        "SELECT COUNT(ROWID) as c FROM Service_Jobs WHERE delivery_partner_row_id IS NOT NULL",
        "Service_Jobs"
      ),
    },
    employee_accounts: partners.map((p) => {
      const kyc = kycByPartner.get(String(p.ROWID)) || null;
      return {
        delivery_partner_id: "dp_" + p.ROWID,
        row_id: String(p.ROWID),
        phone: p.phone || "",
        name: `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        status: p.status || "",
        registration_phase: p.registration_phase || "",
        online_status: p.online_status || "OFFLINE",
        kyc_approved_at: p.kyc_approved_at || "",
        can_go_online: String(p.status || "").toLowerCase() === "active",
        profile: {
          email: p.email || kyc?.email || "",
          gender: p.gender || "",
          qualification: p.qualification || "",
          service_zone: p.service_zone || "",
          district: p.district || "",
          city: p.city || kyc?.city || "",
          state: p.state || kyc?.state || "",
          pincode: p.postal_code || kyc?.postal_code || "",
          profile_photo: p.profile_photo_url || (kyc?.profile_photo_file_id ? "filestore:" + kyc.profile_photo_file_id : ""),
        },
        kyc: kyc
          ? {
              kyc_row_id: String(kyc.ROWID),
              registration_phase: kyc.registration_phase || "",
              pan_saved: Boolean(kyc.pan_last4),
              pan_masked: kyc.pan_last4 ? "XXXXX" + kyc.pan_last4 + "X" : "",
              aadhaar_saved: Boolean(kyc.aadhaar_last4),
              aadhaar_masked: kyc.aadhaar_last4 ? "XXXX XXXX " + kyc.aadhaar_last4 : "",
              documents: {
                profile_photo: Boolean(kyc.profile_photo_file_id),
                aadhaar_front: Boolean(kyc.identity_document_file_id),
                aadhaar_back: Boolean(kyc.address_document_file_id),
              },
              submitted_at: kyc.submitted_at || "",
              reviewed_at: kyc.reviewed_at || "",
              rejection_reason: kyc.rejection_reason || "",
            }
          : null,
        created: p.CREATEDTIME || "",
      };
    }),
    stored_data_fields: [
      "Delivery_Partners: phone, password_hash, first_name, last_name, status, registration_phase, online_status, profile_photo_url, qualification, service_zone, address, outlet_id, kyc_approved_at",
      "Delivery_Partner_KYC: PAN hash, Aadhaar hash, bank hash, address, Aadhaar front/back file IDs, profile photo file ID, submitted/reviewed timestamps",
      "Auth: OTP challenges for delivery_partner purpose (temporary, not listed here)",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
