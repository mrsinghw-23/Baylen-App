"use strict";

const { rowOf, rowsOf, sqlString } = require("./http");
const { canonicalMobile } = require("./phone-identity");
const { normalizePartnerStatus } = require("./delivery-partner-kyc");

const DP_SELECT =
  "ROWID, phone, outlet_id, outlet_row_id, status, first_name, last_name, age, qualification, service_zone, availability_schedule, online_status, legacy_provider_id, legacy_rider_id, legacy_provider_row_id, legacy_rider_row_id, profile_photo_url, rating, country, kyc_approved_at, state, district, city, postal_code, CREATEDTIME, MODIFIEDTIME";

function formatDeliveryPartnerId(rowId) {
  return "dp_" + String(rowId || "").trim();
}

function parseDeliveryPartnerId(value) {
  const text = String(value || "").trim();
  if (/^dp_\d+$/.test(text)) {
    return text.slice(3);
  }
  if (/^\d+$/.test(text)) {
    return text;
  }
  return "";
}

function mapDeliveryPartner(row) {
  if (!row) {
    return null;
  }
  return {
    delivery_partner_id: formatDeliveryPartnerId(row.ROWID),
    row_id: String(row.ROWID),
    phone: row.phone || "",
    outlet_id: row.outlet_id != null && row.outlet_id !== "" ? String(row.outlet_id) : "",
    outlet_row_id:
      row.outlet_row_id != null && row.outlet_row_id !== ""
        ? String(row.outlet_row_id)
        : row.outlet_id != null && row.outlet_id !== ""
          ? String(row.outlet_id)
          : "",
    status: normalizePartnerStatus(row.status),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    age: row.age != null && row.age !== "" ? Number(row.age) : null,
    qualification: row.qualification || "",
    service_zone: row.service_zone || "",
    availability_schedule: row.availability_schedule || "",
    online_status: String(row.online_status || "OFFLINE").trim().toUpperCase() || "OFFLINE",
    legacy_provider_id:
      row.legacy_provider_id != null && row.legacy_provider_id !== ""
        ? String(row.legacy_provider_id)
        : "",
    legacy_rider_id:
      row.legacy_rider_id != null && row.legacy_rider_id !== ""
        ? String(row.legacy_rider_id)
        : "",
    profile_photo_url: row.profile_photo_url || "",
    rating: row.rating != null && row.rating !== "" ? Number(row.rating) : null,
    registration_phase: row.registration_phase || "otp_verified",
    has_password: row.has_password === true,
    country: row.country || "India",
    kyc_approved_at: row.kyc_approved_at || "",
    state: row.state || "",
    district: row.district || "",
    city: row.city || "",
    postal_code: row.postal_code || "",
    created_at: row.CREATEDTIME || "",
    updated_at: row.MODIFIEDTIME || "",
  };
}

async function findDeliveryPartnerByPhone(zcql, mobile) {
  const canonical = canonicalMobile(mobile);
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE phone = " + sqlString(canonical)
    ),
    "Delivery_Partners"
  );
  return mapDeliveryPartner(row);
}

async function findDeliveryPartnerById(zcql, deliveryPartnerId) {
  const rowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!rowId) {
    return null;
  }
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE ROWID = " + rowId
    ),
    "Delivery_Partners"
  );
  return mapDeliveryPartner(row);
}

async function ensureDeliveryPartnerAccount(req, mobile) {
  const canonical = canonicalMobile(mobile);
  const zcql = req.catalystApp.zcql();
  let partner = await findDeliveryPartnerByPhone(zcql, canonical);
  let isNew = false;
  if (!partner) {
    isNew = true;
    const inserted = await req.catalystApp.datastore().table("Delivery_Partners").insertRow({
      phone: canonical,
      outlet_id: null,
      status: "pending_kyc",
      first_name: null,
      last_name: null,
    });
    const rowId =
      inserted && inserted.ROWID
        ? String(inserted.ROWID)
        : inserted &&
            typeof inserted === "object" &&
            inserted.Delivery_Partners &&
            inserted.Delivery_Partners.ROWID
          ? String(inserted.Delivery_Partners.ROWID)
          : "";
    if (rowId) {
      partner = await findDeliveryPartnerById(zcql, rowId);
    } else {
      partner = await findDeliveryPartnerByPhone(zcql, canonical);
    }
  }
  if (!partner) {
    const error = new Error("Could not create delivery partner account");
    error.status = 500;
    throw error;
  }
  return { ...partner, is_new_partner: isNew };
}

function deliveryPartnerSessionPayload(partner) {
  return {
    sub: partner.delivery_partner_id,
    role: "delivery_partner",
    delivery_partner_id: partner.delivery_partner_id,
    outlet_id: partner.outlet_id || "",
    phone: partner.phone,
    status: partner.status,
    first_name: partner.first_name || "",
    last_name: partner.last_name || "",
  };
}

module.exports = {
  DP_SELECT,
  formatDeliveryPartnerId,
  parseDeliveryPartnerId,
  mapDeliveryPartner,
  findDeliveryPartnerByPhone,
  findDeliveryPartnerById,
  ensureDeliveryPartnerAccount,
  deliveryPartnerSessionPayload,
};
