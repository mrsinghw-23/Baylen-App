"use strict";

const crypto = require("crypto");
const {
  rowOf,
  rowsOf,
  asId,
  optionalText,
  sqlString,
  num,
} = require("./http");
const { parseDeliveryPartnerId, findDeliveryPartnerByPhone, mapDeliveryPartner, formatDeliveryPartnerId } = require("./delivery-partner");
const { findServiceableByPincode } = require("./serviceability-admin");
const { normalizePincode } = require("./pincode");
const { citiesMatch } = require("./salon-engine");
const {
  uploadKycDocument,
  computeAgeFromDob,
} = require("./delivery-partner-kyc");
const { canonicalMobile } = require("./phone-identity");
const { getAuthSessionSecret } = require("./runtime-config");

const REGISTRATION_PHASE = {
  OTP_VERIFIED: "otp_verified",
  PROFILE_COMPLETE: "profile_complete",
  PHOTOS_COMPLETE: "photos_complete",
  PASSWORD_SET: "password_set",
  REGISTERED: "registered",
};

const PHASE_ORDER = [
  REGISTRATION_PHASE.OTP_VERIFIED,
  REGISTRATION_PHASE.PROFILE_COMPLETE,
  REGISTRATION_PHASE.PHOTOS_COMPLETE,
  REGISTRATION_PHASE.PASSWORD_SET,
  REGISTRATION_PHASE.REGISTERED,
];

const GENDER_VALUES = new Set(["MALE", "FEMALE", "OTHER"]);
const REGISTRATION_PHOTO_TYPES = new Set(["selfie", "passport_photo"]);

const DP_CORE_SELECT =
  "ROWID, phone, outlet_id, status, first_name, last_name, age, profile_photo_url";

const KYC_REG_SELECT =
  "ROWID, delivery_partner_id, partner_row_id, first_name, last_name, date_of_birth, address_line1, address_line2, city, state, postal_code, country, profile_photo_file_id, profile_photo_folder_id, identity_document_file_id, identity_document_folder_id, registration_phase, email, gender, district, password_hash, password_salt, outlet_id, warehouse_id, qualification, service_zone";

async function safeRow(zcql, query, table) {
  try {
    return rowOf(await zcql.executeZCQLQuery(query), table);
  } catch (_) {
    return null;
  }
}

function legacyTruncatedPartnerId(partnerRowId) {
  const text = String(partnerRowId || "").trim();
  if (text.length <= 10) {
    return text;
  }
  return text.slice(0, 10);
}

async function findKycRegRow(zcql, partnerRowId, partnerHint = null) {
  const partnerId = String(partnerRowId || "").trim();
  if (!partnerId) {
    return null;
  }
  let where =
    " FROM Delivery_Partner_KYC WHERE partner_row_id = " +
    sqlString(partnerId) +
    " ORDER BY ROWID DESC LIMIT 1";
  let kyc = await safeRow(zcql, "SELECT " + KYC_REG_SELECT + where, "Delivery_Partner_KYC");
  if (kyc) {
    return kyc;
  }

  where =
    " FROM Delivery_Partner_KYC WHERE delivery_partner_id = " +
    partnerId +
    " ORDER BY ROWID DESC LIMIT 1";
  kyc = await safeRow(zcql, "SELECT " + KYC_REG_SELECT + where, "Delivery_Partner_KYC");
  if (kyc) {
    return kyc;
  }

  const truncated = legacyTruncatedPartnerId(partnerId);
  if (truncated === partnerId) {
    return null;
  }

  const partner =
    partnerHint ||
    (await safeRow(
      zcql,
      "SELECT ROWID, first_name, last_name, phone FROM Delivery_Partners WHERE ROWID = " + partnerId,
      "Delivery_Partners"
    ));
  if (!partner) {
    return null;
  }

  let legacyWhere =
    " FROM Delivery_Partner_KYC WHERE delivery_partner_id = " +
    truncated +
    " AND first_name = " +
    sqlString(String(partner.first_name || "").trim());
  const lastName = String(partner.last_name || "").trim();
  if (lastName) {
    legacyWhere += " AND last_name = " + sqlString(lastName);
  }
  legacyWhere += " ORDER BY ROWID DESC LIMIT 1";

  kyc = await safeRow(zcql, "SELECT " + KYC_REG_SELECT + legacyWhere, "Delivery_Partner_KYC");
  if (!kyc) {
    kyc = await safeRow(
      zcql,
      "SELECT ROWID, delivery_partner_id, partner_row_id, first_name, last_name, date_of_birth, address_line1, city, state, postal_code, country, profile_photo_file_id, profile_photo_folder_id, identity_document_file_id, identity_document_folder_id, registration_phase, email, gender, district" +
        legacyWhere,
      "Delivery_Partner_KYC"
    );
  }
  if (kyc) {
    kyc.partner_row_id = partnerId;
  }
  return kyc;
}

async function repairKycPartnerLink(app, kyc, partnerRowId) {
  if (!app || !kyc?.ROWID) {
    return;
  }
  const partnerId = String(partnerRowId || "").trim();
  if (!partnerId || String(kyc.partner_row_id || "").trim() === partnerId) {
    return;
  }
  try {
    await app.datastore().table("Delivery_Partner_KYC").updateRow({
      ROWID: kyc.ROWID,
      partner_row_id: partnerId,
    });
    kyc.partner_row_id = partnerId;
  } catch (_) {}
}

function mergeRegistrationBundle(partner, kyc) {
  if (!partner) {
    return null;
  }
  return {
    ROWID: partner.ROWID,
    phone: partner.phone || "",
    outlet_id: partner.outlet_id ?? kyc?.outlet_id ?? null,
    warehouse_id: kyc?.warehouse_id ?? partner.warehouse_id ?? null,
    status: partner.status || "pending_kyc",
    first_name: partner.first_name || kyc?.first_name || "",
    last_name: partner.last_name || kyc?.last_name || "",
    age: partner.age ?? null,
    profile_photo_url: partner.profile_photo_url || "",
    registration_phase: inferRegistrationPhase({
      registration_phase: kyc?.registration_phase || partner.registration_phase,
      status: partner.status,
      password_hash: kyc?.password_hash || partner.password_hash,
      selfie_file_id: kyc?.profile_photo_file_id || partner.selfie_file_id,
      passport_photo_file_id: partner.passport_photo_file_id,
      first_name: partner.first_name || kyc?.first_name,
      address_line1: kyc?.address_line1 || partner.address_line1,
      postal_code: kyc?.postal_code || partner.postal_code,
    }),
    email: kyc?.email || partner.email || "",
    gender: kyc?.gender || partner.gender || "",
    district: kyc?.district || partner.district || "",
    date_of_birth: kyc?.date_of_birth || partner.date_of_birth || "",
    state: kyc?.state || partner.state || "",
    postal_code: kyc?.postal_code || partner.postal_code || "",
    address_line1: kyc?.address_line1 || partner.address_line1 || "",
    city: kyc?.city || partner.city || "",
    qualification: kyc?.qualification || partner.qualification || "",
    service_zone: kyc?.service_zone || partner.service_zone || "",
    password_hash: kyc?.password_hash || partner.password_hash || "",
    password_salt: kyc?.password_salt || partner.password_salt || "",
    selfie_file_id: kyc?.profile_photo_file_id || partner.selfie_file_id || "",
    selfie_folder_id: kyc?.profile_photo_folder_id || partner.selfie_folder_id || "",
    passport_photo_file_id: partner.passport_photo_file_id || "",
    passport_photo_folder_id: partner.passport_photo_folder_id || "",
    kyc_row_id: kyc?.ROWID || null,
  };
}

async function loadRegistrationBundle(zcql, deliveryPartnerId) {
  const rowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!rowId) {
    return null;
  }
  let partner = await safeRow(
    zcql,
    "SELECT " + DP_CORE_SELECT + " FROM Delivery_Partners WHERE ROWID = " + rowId,
    "Delivery_Partners"
  );
  if (!partner) {
    return null;
  }
  const kyc = await findKycRegRow(zcql, rowId, partner);
  return mergeRegistrationBundle(partner, kyc);
}

async function updatePartnerRowSafe(app, payload) {
  const core = {
    ROWID: payload.ROWID,
    first_name: payload.first_name,
    last_name: payload.last_name,
    age: payload.age,
    outlet_id: payload.outlet_id,
    profile_photo_url: payload.profile_photo_url,
    status: payload.status,
    qualification: payload.qualification,
    service_zone: payload.service_zone,
    state: payload.state,
    district: payload.district,
    city: payload.city,
    postal_code: payload.postal_code,
    country: payload.country,
    kyc_approved_at: payload.kyc_approved_at,
  };
  const cleaned = Object.fromEntries(
    Object.entries(core).filter(([, value]) => value !== undefined)
  );
  await app.datastore().table("Delivery_Partners").updateRow(cleaned);
}

function hasRegistrationPhoto(row) {
  const hasSelfie = Boolean(row.selfie_file_id && row.selfie_folder_id);
  const hasPassport = Boolean(row.passport_photo_file_id && row.passport_photo_folder_id);
  return hasSelfie || hasPassport;
}

function inferPhaseFromStoredFields(row) {
  const status = String(row.status || "")
    .trim()
    .toLowerCase();
  if (status === "kyc_submitted" || status === "active") {
    return REGISTRATION_PHASE.REGISTERED;
  }
  if (row.password_hash) {
    return REGISTRATION_PHASE.PASSWORD_SET;
  }
  if (hasRegistrationPhoto(row)) {
    return REGISTRATION_PHASE.PHOTOS_COMPLETE;
  }
  if (row.first_name && row.address_line1 && row.postal_code) {
    return REGISTRATION_PHASE.PROFILE_COMPLETE;
  }
  return REGISTRATION_PHASE.OTP_VERIFIED;
}

function inferRegistrationPhase(row) {
  const fromFields = inferPhaseFromStoredFields(row);
  const explicit = normalizeRegistrationPhase(row.registration_phase);
  return phaseIndex(fromFields) > phaseIndex(explicit) ? fromFields : explicit;
}

async function upsertKycRegistration(app, zcql, partnerRowId, payload) {
  const existing = await findKycRegRow(zcql, partnerRowId);
  const coreKeys = new Set([
    "first_name",
    "last_name",
    "date_of_birth",
    "address_line1",
    "address_line2",
    "city",
    "state",
    "postal_code",
    "country",
    "profile_photo_file_id",
    "profile_photo_folder_id",
    "identity_document_file_id",
    "identity_document_folder_id",
    "delivery_partner_id",
    "partner_row_id",
    "registration_phase",
    "email",
    "gender",
    "district",
    "outlet_id",
    "warehouse_id",
    "qualification",
    "service_zone",
  ]);
  const row = {
    delivery_partner_id: partnerRowId,
    partner_row_id: String(partnerRowId),
    country: "India",
    ...payload,
  };

  async function write(data) {
    if (existing?.ROWID) {
      await app.datastore().table("Delivery_Partner_KYC").updateRow({
        ROWID: existing.ROWID,
        ...data,
      });
      return existing.ROWID;
    }
    const inserted = await app.datastore().table("Delivery_Partner_KYC").insertRow(data);
    return inserted?.ROWID || inserted?.rowid || null;
  }

  try {
    return await write(row);
  } catch (firstError) {
    const coreOnly = Object.fromEntries(
      Object.entries(row).filter(([key]) => coreKeys.has(key))
    );
    try {
      return await write(coreOnly);
    } catch (_) {
      throw firstError;
    }
  }
}

async function ensureRegistrationSeed(app, zcql, partnerRowId) {
  const existing = await findKycRegRow(zcql, partnerRowId);
  if (existing) {
    return existing;
  }
  await upsertKycRegistration(app, zcql, partnerRowId, {
    registration_phase: REGISTRATION_PHASE.OTP_VERIFIED,
    country: "India",
  });
  return findKycRegRow(zcql, partnerRowId);
}

function normalizeRegistrationPhase(value) {
  const phase = String(value || REGISTRATION_PHASE.OTP_VERIFIED)
    .trim()
    .toLowerCase();
  return PHASE_ORDER.includes(phase) ? phase : REGISTRATION_PHASE.OTP_VERIFIED;
}

function phaseIndex(phase) {
  return PHASE_ORDER.indexOf(normalizeRegistrationPhase(phase));
}

function assertPhaseAtLeast(current, required) {
  if (phaseIndex(current) < phaseIndex(required)) {
    const error = new Error("Complete the previous registration step first");
    error.status = 409;
    error.code = "REGISTRATION_STEP_REQUIRED";
    throw error;
  }
}

function assertPhaseExactly(current, expected) {
  if (normalizeRegistrationPhase(current) !== expected) {
    const error = new Error("This registration step is not available right now");
    error.status = 409;
    error.code = "REGISTRATION_STEP_MISMATCH";
    throw error;
  }
}

function validationError(message, field) {
  const error = new Error(message);
  error.status = 422;
  error.code = "VALIDATION_ERROR";
  if (field) {
    error.details = [{ field, message }];
  }
  throw error;
}

function normalizeGender(value) {
  const gender = String(value || "")
    .trim()
    .toUpperCase();
  if (!GENDER_VALUES.has(gender)) {
    validationError("Select Male, Female, or Other", "gender");
  }
  return gender;
}

function validateEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) {
    validationError("Email address is required", "email");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    validationError("Enter a valid email address", "email");
  }
  return email;
}

function validatePersonalProfile(body) {
  const firstName = optionalText(body.first_name, "first_name", 80);
  const lastName = optionalText(body.last_name, "last_name", 80);
  if (!firstName) validationError("First name is required", "first_name");
  if (!lastName) validationError("Last name is required", "last_name");

  const dateOfBirth = optionalText(body.date_of_birth, "date_of_birth", 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    validationError("Enter date of birth as YYYY-MM-DD", "date_of_birth");
  }
  const ageFromDob = computeAgeFromDob(dateOfBirth);
  const ageInput = body.age != null && body.age !== "" ? num(body.age) : ageFromDob;
  if (ageInput == null || ageInput < 18 || ageInput > 70) {
    validationError("Age must be between 18 and 70", "age");
  }

  const gender = normalizeGender(body.gender);
  const email = validateEmail(body.email);
  const state = optionalText(body.state, "state", 80);
  const district = optionalText(body.district, "district", 80);
  const pincode = normalizePincode(body.pincode || body.postal_code);
  const addressLine1 = optionalText(body.address_line1 || body.address1, "address_line1", 180);
  const city = optionalText(body.city, "city", 80);

  if (!state) validationError("State is required", "state");
  if (!district) validationError("District is required", "district");
  if (!pincode || pincode.length !== 6) validationError("Enter a valid 6-digit pincode", "pincode");
  if (!addressLine1) validationError("Address is required", "address_line1");

  // Optional enrichment fields — not mandatory but saved when provided
  const qualification = optionalText(body.qualification, "qualification", 150);
  const serviceZone = optionalText(body.service_zone, "service_zone", 80);

  return {
    first_name: firstName,
    last_name: lastName,
    date_of_birth: dateOfBirth,
    age: ageInput,
    gender,
    email,
    state,
    district,
    postal_code: pincode,
    pincode,
    address_line1: addressLine1,
    city: city || district,
    qualification: qualification || "",
    service_zone: serviceZone || "",
  };
}

async function resolveLocationAssociation(zcql, profile) {
  const region = await findServiceableByPincode(zcql, profile.pincode);
  const resolvedCity = profile.city || region?.city || profile.district || "";
  const resolvedState = profile.state || region?.state || "";

  let outlet = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, city, state, postal_code FROM Outlets WHERE is_active = true AND postal_code = " +
        sqlString(profile.pincode) +
        " LIMIT 1"
    ),
    "Outlets"
  );

  if (!outlet && resolvedCity && resolvedState) {
    const outlets = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, city, state, postal_code FROM Outlets WHERE is_active = true"
      ),
      "Outlets"
    );
    outlet =
      outlets.find(
        (row) =>
          citiesMatch(resolvedCity, row.city) &&
          String(row.state || "").trim().toLowerCase() === resolvedState.toLowerCase()
      ) || null;
  }

  let warehouse = null;
  if (outlet) {
    warehouse = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, code, city, state FROM Warehouses WHERE is_active = true AND outlet_id = " +
          outlet.ROWID +
          " LIMIT 1"
      ),
      "Warehouses"
    );
  }
  if (!warehouse && resolvedCity) {
    const warehouses = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, code, city, state FROM Warehouses WHERE is_active = true"
      ),
      "Warehouses"
    );
    warehouse =
      warehouses.find((row) => citiesMatch(resolvedCity, row.city)) ||
      warehouses.find(
        (row) =>
          String(row.state || "").trim().toLowerCase() === resolvedState.toLowerCase()
      ) ||
      null;
  }

  return {
    outlet_id: outlet ? String(outlet.ROWID) : null,
    outlet_name: outlet?.name || "",
    warehouse_id: warehouse ? String(warehouse.ROWID) : null,
    warehouse_name: warehouse?.name || "",
    warehouse_code: warehouse?.code || "",
    city: resolvedCity,
    state: resolvedState,
    serviceable_pincode: Boolean(region?.is_active),
  };
}

async function loadPartnerRegistrationRow(zcql, deliveryPartnerId) {
  return loadRegistrationBundle(zcql, deliveryPartnerId);
}

function mapRegistrationStatus(row, location = {}) {
  if (!row) {
    return null;
  }
  const phase = inferRegistrationPhase(row);
  return {
    delivery_partner_id: "dp_" + String(row.ROWID),
    phone: row.phone || "",
    registration_phase: phase,
    registration_complete: phase === REGISTRATION_PHASE.REGISTERED,
    requires_password_login:
      phase === REGISTRATION_PHASE.REGISTERED && Boolean(row.password_hash),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    email: row.email || "",
    age: row.age != null && row.age !== "" ? Number(row.age) : null,
    date_of_birth: row.date_of_birth || "",
    gender: row.gender || "",
    state: row.state || location.state || "",
    district: row.district || "",
    pincode: row.postal_code || "",
    address_line1: row.address_line1 || "",
    city: row.city || location?.city || "",
    qualification: row.qualification || "",
    service_zone: row.service_zone || "",
    outlet_id: row.outlet_id != null && row.outlet_id !== "" ? String(row.outlet_id) : "",
    warehouse_id:
      row.warehouse_id != null && row.warehouse_id !== "" ? String(row.warehouse_id) : "",
    outlet_name: location.outlet_name || "",
    warehouse_name: location.warehouse_name || "",
    photos: {
      selfie: Boolean(row.selfie_file_id && row.selfie_folder_id),
      passport_photo: Boolean(row.passport_photo_file_id && row.passport_photo_folder_id),
    },
    password_set: Boolean(row.password_hash),
  };
}

async function getRegistrationStatus(req, partnerAuth) {
  const row = await loadPartnerRegistrationRow(
    req.catalystApp.zcql(),
    partnerAuth.delivery_partner_id
  );
  if (!row) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  return mapRegistrationStatus(row);
}

async function savePersonalProfile(req, partnerAuth, body) {
  const zcql = req.catalystApp.zcql();
  const row = await loadPartnerRegistrationRow(zcql, partnerAuth.delivery_partner_id);
  if (!row) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const phase = inferRegistrationPhase(row);
  if (phase === REGISTRATION_PHASE.REGISTERED) {
    validationError("Registration is already complete");
  }
  assertPhaseAtLeast(phase, REGISTRATION_PHASE.OTP_VERIFIED);

  const profile = validatePersonalProfile(body);
  const location = await resolveLocationAssociation(zcql, profile);
  const partnerRowId = String(row.ROWID);

  await updatePartnerRowSafe(req.catalystApp, {
    ROWID: row.ROWID,
    first_name: profile.first_name,
    last_name: profile.last_name,
    age: profile.age,
    outlet_id: location.outlet_id ? asId(location.outlet_id, "outlet_id") : null,
    ...(profile.qualification ? { qualification: profile.qualification } : {}),
    ...(profile.service_zone ? { service_zone: profile.service_zone } : {}),
    ...(profile.state ? { state: profile.state } : {}),
    ...(profile.district ? { district: profile.district } : {}),
    ...(profile.city || location.city ? { city: location.city || profile.city } : {}),
    ...(profile.postal_code ? { postal_code: profile.postal_code } : {}),
    country: "India",
  });

  await upsertKycRegistration(req.catalystApp, zcql, partnerRowId, {
    first_name: profile.first_name,
    last_name: profile.last_name,
    date_of_birth: profile.date_of_birth,
    address_line1: profile.address_line1,
    city: location.city,
    state: profile.state,
    postal_code: profile.pincode,
    country: "India",
    email: profile.email,
    gender: profile.gender,
    district: profile.district,
    outlet_id: location.outlet_id ? asId(location.outlet_id, "outlet_id") : null,
    warehouse_id: location.warehouse_id ? asId(location.warehouse_id, "warehouse_id") : null,
    registration_phase: REGISTRATION_PHASE.PROFILE_COMPLETE,
    ...(profile.qualification ? { qualification: profile.qualification } : {}),
    ...(profile.service_zone ? { service_zone: profile.service_zone } : {}),
  });

  const savedKyc = await findKycRegRow(zcql, partnerRowId, {
    ROWID: row.ROWID,
    first_name: profile.first_name,
    last_name: profile.last_name,
  });
  await repairKycPartnerLink(req.catalystApp, savedKyc, partnerRowId);

  const refreshed = await loadRegistrationBundle(zcql, partnerAuth.delivery_partner_id);
  const registration = mapRegistrationStatus(
    {
      ...refreshed,
      first_name: profile.first_name,
      last_name: profile.last_name,
      address_line1: profile.address_line1,
      postal_code: profile.pincode,
      state: profile.state,
      email: profile.email,
      gender: profile.gender,
      district: profile.district,
      date_of_birth: profile.date_of_birth,
      age: profile.age,
      qualification: profile.qualification || refreshed?.qualification || "",
      service_zone: profile.service_zone || refreshed?.service_zone || "",
      registration_phase: REGISTRATION_PHASE.PROFILE_COMPLETE,
    },
    location
  );
  return {
    registration,
    location,
  };
}

async function decodeRegistrationPhoto(body) {
  const documentType = String(body.document_type || body.photo_type || "")
    .trim()
    .toLowerCase();
  if (!REGISTRATION_PHOTO_TYPES.has(documentType)) {
    validationError("Photo type must be selfie or passport_photo", "document_type");
  }
  const fileName = String(body.file_name || documentType + ".jpg")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  const contentType = String(body.content_type || "image/jpeg")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  if (!/^(image\/jpeg|image\/png|image\/webp)$/.test(contentType)) {
    validationError("Only JPG, PNG, or WEBP photos are allowed", "content_type");
  }
  const rawBase64 = String(body.base64 || "").trim();
  const base64 = rawBase64.includes(",") ? rawBase64.split(",").pop() : rawBase64;
  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch (_) {
    validationError("Photo payload is not valid base64");
  }
  if (!bytes.length) {
    validationError("Photo file is empty");
  }
  if (bytes.length > 5 * 1024 * 1024) {
    validationError("Photo must be 5 MB or smaller");
  }
  return { documentType, fileName, contentType, bytes };
}

async function saveRegistrationPhoto(req, partnerAuth, body) {
  const input = await decodeRegistrationPhoto(body);

  const zcql = req.catalystApp.zcql();
  const row = await loadPartnerRegistrationRow(zcql, partnerAuth.delivery_partner_id);
  if (!row) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const savedKyc = await findKycRegRow(zcql, String(row.ROWID), row);
  await repairKycPartnerLink(req.catalystApp, savedKyc, String(row.ROWID));
  if (savedKyc && (!row.address_line1 || !row.postal_code)) {
    Object.assign(row, {
      address_line1: savedKyc.address_line1 || row.address_line1,
      postal_code: savedKyc.postal_code || row.postal_code,
      registration_phase: savedKyc.registration_phase || row.registration_phase,
      email: savedKyc.email || row.email,
      gender: savedKyc.gender || row.gender,
      district: savedKyc.district || row.district,
    });
  }
  assertPhaseAtLeast(
    inferRegistrationPhase(row),
    REGISTRATION_PHASE.PROFILE_COMPLETE
  );

  const uploaded = await uploadKycDocument(req, String(row.ROWID), {
    document_type: input.documentType === "selfie" ? "profile_photo" : "identity_document",
    file_name: input.fileName,
    content_type: input.contentType,
    base64: body.base64,
  });

  const kycUpdate =
    input.documentType === "selfie"
      ? {
          profile_photo_file_id: uploaded.file_id,
          profile_photo_folder_id: uploaded.folder_id,
        }
      : {};

  if (input.documentType === "selfie") {
    await updatePartnerRowSafe(req.catalystApp, {
      ROWID: row.ROWID,
      profile_photo_url: "filestore:" + uploaded.file_id,
    });
  } else {
    await updatePartnerRowSafe(req.catalystApp, {
      ROWID: row.ROWID,
      passport_photo_file_id: uploaded.file_id,
      passport_photo_folder_id: uploaded.folder_id,
    });
  }

  if (Object.keys(kycUpdate).length) {
    await upsertKycRegistration(req.catalystApp, zcql, String(row.ROWID), kycUpdate);
  }

  const refreshed = await loadRegistrationBundle(zcql, partnerAuth.delivery_partner_id);
  if (input.documentType === "selfie") {
    refreshed.selfie_file_id = uploaded.file_id;
    refreshed.selfie_folder_id = uploaded.folder_id;
  } else {
    refreshed.passport_photo_file_id = uploaded.file_id;
    refreshed.passport_photo_folder_id = uploaded.folder_id;
  }
  const phase = inferRegistrationPhase(refreshed);
  const hasSelfie = Boolean(refreshed.selfie_file_id && refreshed.selfie_folder_id);
  const hasPassport = Boolean(
    refreshed.passport_photo_file_id && refreshed.passport_photo_folder_id
  );
  if (
    (hasSelfie || hasPassport) &&
    phaseIndex(phase) < phaseIndex(REGISTRATION_PHASE.PHOTOS_COMPLETE)
  ) {
    await upsertKycRegistration(req.catalystApp, zcql, String(row.ROWID), {
      registration_phase: REGISTRATION_PHASE.PHOTOS_COMPLETE,
    });
    refreshed.registration_phase = REGISTRATION_PHASE.PHOTOS_COMPLETE;
  }

  return {
    registration: mapRegistrationStatus(refreshed),
    upload: uploaded,
  };
}

function validatePasswordPair(password, confirmPassword) {
  const pass = String(password || "");
  const confirm = String(confirmPassword || "");
  if (pass.length < 8) {
    validationError("Password must be at least 8 characters", "password");
  }
  if (!/[0-9]/.test(pass)) {
    validationError("Password must include a number", "password");
  }
  if (!/[A-Za-z]/.test(pass)) {
    validationError("Password must include a letter", "password");
  }
  if (!/[^A-Za-z0-9]/.test(pass)) {
    validationError("Password must include a special character", "password");
  }
  if (pass !== confirm) {
    validationError("Passwords do not match", "confirm_password");
  }
  return pass;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) {
    return false;
  }
  const computed = crypto.scryptSync(String(password), String(salt), 64).toString("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(String(hash), "hex"));
  } catch (_) {
    return false;
  }
}

async function saveRegistrationPassword(req, partnerAuth, body) {
  const zcql = req.catalystApp.zcql();
  const row = await loadPartnerRegistrationRow(zcql, partnerAuth.delivery_partner_id);
  if (!row) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  assertPhaseAtLeast(inferRegistrationPhase(row), REGISTRATION_PHASE.PROFILE_COMPLETE);

  const password = validatePasswordPair(body.password, body.confirm_password);
  const { salt, hash } = hashPassword(password);
  await upsertKycRegistration(req.catalystApp, zcql, String(row.ROWID), {
    password_salt: salt,
    password_hash: hash,
    registration_phase: REGISTRATION_PHASE.PASSWORD_SET,
  });
  const refreshed = await loadRegistrationBundle(zcql, partnerAuth.delivery_partner_id);
  return mapRegistrationStatus(refreshed);
}

async function completeRegistration(req, partnerAuth) {
  const zcql = req.catalystApp.zcql();
  const row = await loadPartnerRegistrationRow(zcql, partnerAuth.delivery_partner_id);
  if (!row) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  assertPhaseExactly(inferRegistrationPhase(row), REGISTRATION_PHASE.PASSWORD_SET);
  if (!row.password_hash) {
    validationError("Create a password before completing registration");
  }

  await upsertKycRegistration(req.catalystApp, zcql, String(row.ROWID), {
    registration_phase: REGISTRATION_PHASE.REGISTERED,
  });
  await updatePartnerRowSafe(req.catalystApp, {
    ROWID: row.ROWID,
    status: "pending_kyc",
    registration_phase: REGISTRATION_PHASE.REGISTERED,
  });
  const refreshed = await loadRegistrationBundle(zcql, partnerAuth.delivery_partner_id);
  return mapRegistrationStatus(refreshed);
}

async function partnerRequiresPasswordLogin(zcql, deliveryPartnerId) {
  const bundle = await loadRegistrationBundle(zcql, deliveryPartnerId);
  if (!bundle) {
    return false;
  }
  const phase = inferRegistrationPhase(bundle);
  return phase === REGISTRATION_PHASE.REGISTERED && Boolean(bundle.password_hash);
}

async function loginWithPassword(req, mobile, password) {
  const canonical = canonicalMobile(mobile);
  const zcql = req.catalystApp.zcql();
  const partner = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + DP_CORE_SELECT + " FROM Delivery_Partners WHERE phone = " + sqlString(canonical)
    ),
    "Delivery_Partners"
  );
  if (!partner) {
    const error = new Error("Invalid mobile number or password");
    error.status = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  const bundle = mergeRegistrationBundle(partner, await findKycRegRow(zcql, String(partner.ROWID)));
  if (!bundle.password_hash) {
    const error = new Error("Invalid mobile number or password");
    error.status = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  if (normalizeRegistrationPhase(bundle.registration_phase) !== REGISTRATION_PHASE.REGISTERED) {
    const error = new Error("Complete employee registration before signing in");
    error.status = 409;
    error.code = "REGISTRATION_INCOMPLETE";
    throw error;
  }
  if (!verifyPassword(password, bundle.password_salt, bundle.password_hash)) {
    const error = new Error("Invalid mobile number or password");
    error.status = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  return mapDeliveryPartner({
    ...partner,
    registration_phase: bundle.registration_phase,
    has_password: true,
  });
}

function resetToken(mobile) {
  return crypto
    .createHmac("sha256", getAuthSessionSecret())
    .update("dp-reset:" + canonicalMobile(mobile) + ":" + Date.now())
    .digest("hex");
}

async function resetPartnerPasswordByMobile(app, zcql, deliveryPartnerId, password) {
  const rowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!rowId) {
    const error = new Error("Employee account not found");
    error.status = 404;
    error.code = "PARTNER_NOT_FOUND";
    throw error;
  }
  const { salt, hash } = hashPassword(password);
  await upsertKycRegistration(app, zcql, rowId, {
    password_salt: salt,
    password_hash: hash,
  });
  try {
    await app.datastore().table("Delivery_Partners").updateRow({
      ROWID: rowId,
      password_salt: salt,
      password_hash: hash,
    });
  } catch (_) {}
  return { reset: true, delivery_partner_id: formatDeliveryPartnerId(rowId) };
}

module.exports = {
  REGISTRATION_PHASE,
  REGISTRATION_PHOTO_TYPES,
  normalizeRegistrationPhase,
  inferRegistrationPhase,
  mapRegistrationStatus,
  getRegistrationStatus,
  savePersonalProfile,
  saveRegistrationPhoto,
  saveRegistrationPassword,
  completeRegistration,
  loginWithPassword,
  partnerRequiresPasswordLogin,
  ensureRegistrationSeed,
  inferRegistrationPhase,
  loadRegistrationBundle,
  findKycRegRow,
  verifyPassword,
  hashPassword,
  validatePasswordPair,
  resetToken,
  resetPartnerPasswordByMobile,
};
