"use strict";

// KYC v1 (manual): Aadhaar number + front/back photos + passport-size selfie.
// Future DigiLocker: fetch verified Aadhaar/docs and map into same storage fields below.
// See .cursor/rules/kyc-flow-locked.mdc — do not refactor v1 without explicit request.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getAuthSessionSecret } = require("./runtime-config");

const KYC_DOCUMENT_TYPES = new Set([
  "profile_photo",
  "identity_document",
  "address_document",
]);

const KYC_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const KYC_DOC_TYPES = new Set([...KYC_IMAGE_TYPES, "application/pdf"]);
const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;

const PARTNER_STATUS = {
  PENDING_KYC: "pending_kyc",
  KYC_SUBMITTED: "kyc_submitted",
  KYC_UNDER_REVIEW: "kyc_under_review",
  KYC_APPROVED: "kyc_approved",
  ACTIVE: "active",
  KYC_REJECTED: "kyc_rejected",
  SUSPENDED: "suspended",
};

const LEGACY_PENDING = new Set(["pending_profile", "pending_verification"]);

const EDITABLE_PARTNER_STATUSES = new Set([
  PARTNER_STATUS.PENDING_KYC,
  PARTNER_STATUS.KYC_REJECTED,
  ...LEGACY_PENDING,
]);

const SUBMITTABLE_PARTNER_STATUSES = new Set([
  PARTNER_STATUS.PENDING_KYC,
  PARTNER_STATUS.KYC_REJECTED,
  ...LEGACY_PENDING,
]);

// ZCQL allows at most 30 SELECT columns.
const KYC_SELECT =
  "ROWID, delivery_partner_id, partner_row_id, first_name, last_name, date_of_birth, pan_last4, aadhaar_last4, address_line1, address_line2, city, state, postal_code, country, bank_account_last4, ifsc, account_holder_name, profile_photo_file_id, profile_photo_folder_id, identity_document_file_id, identity_document_folder_id, address_document_file_id, address_document_folder_id, rejection_reason, reviewed_by, submitted_at, reviewed_at, CREATEDTIME";

const QUALIFICATION_VALUES = new Set([
  "10th",
  "intermediate",
  "diploma",
  "graduation",
  "post_graduation",
  "other",
]);

function normalizePartnerStatus(status) {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  if (!value || LEGACY_PENDING.has(value)) {
    return PARTNER_STATUS.PENDING_KYC;
  }
  return value;
}

function partnerStatusLabel(status) {
  const normalized = normalizePartnerStatus(status);
  const labels = {
    pending_kyc: "Draft",
    kyc_submitted: "KYC Submitted",
    kyc_under_review: "Under Review",
    kyc_approved: "Approved",
    active: "Active",
    kyc_rejected: "Rejected",
    suspended: "Suspended",
  };
  return labels[normalized] || normalized.replace(/_/g, " ");
}

function isKycEditable(partnerStatus) {
  return EDITABLE_PARTNER_STATUSES.has(String(partnerStatus || "").trim().toLowerCase());
}

function isPartnerOperational(partnerStatus) {
  return normalizePartnerStatus(partnerStatus) === PARTNER_STATUS.ACTIVE;
}

function canSubmitKyc(partnerStatus) {
  return SUBMITTABLE_PARTNER_STATUSES.has(String(partnerStatus || "").trim().toLowerCase());
}

function hashSensitive(kind, value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return crypto
    .createHmac("sha256", getAuthSessionSecret())
    .update(`${kind}:${normalized}`)
    .digest("hex");
}

function last4(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) {
    return "";
  }
  return digits.slice(-4);
}

function maskPan(value) {
  const pan = String(value || "")
    .trim()
    .toUpperCase();
  if (pan.length !== 10) {
    return "";
  }
  return "XXXXX" + pan.slice(5, 9) + "X";
}

function maskAadhaar(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length !== 12) {
    return "";
  }
  return "XXXX XXXX " + digits.slice(-4);
}

function maskBankAccount(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) {
    return "";
  }
  return "XXXXXX" + digits.slice(-4);
}

function validatePan(value) {
  const pan = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    const error = new Error("Enter a valid PAN (e.g. ABCDE1234F)");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return pan;
}

function validateAadhaar(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{12}$/.test(digits)) {
    const error = new Error("Enter a valid 12-digit Aadhaar number");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return digits;
}

function validateIfsc(value) {
  const ifsc = String(value || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    const error = new Error("Enter a valid IFSC code");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return ifsc;
}

function validateDob(value) {
  const text = String(value || "").trim();
  const parsed = Date.parse(text.includes("T") ? text : text + "T00:00:00");
  if (!Number.isFinite(parsed)) {
    const error = new Error("Enter a valid date of birth");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const dob = new Date(parsed);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  if (age < 18) {
    const error = new Error("Delivery partners must be at least 18 years old");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return text.slice(0, 10);
}

function validateBankAccount(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{9,18}$/.test(digits)) {
    const error = new Error("Enter a valid bank account number");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return digits;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 422;
  error.code = "VALIDATION_ERROR";
  return error;
}

function computeAgeFromDob(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text.includes("T") ? text : text + "T00:00:00");
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const dob = new Date(parsed);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

function validateQualification(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) {
    return "";
  }
  if (text === "10th pass" || text === "10th" || text === "10" || text === "tenth") {
    return "10th";
  }
  if (
    text === "intermediate" ||
    text === "12th pass" ||
    text === "12th" ||
    text === "12" ||
    text === "twelfth"
  ) {
    return "intermediate";
  }
  if (text === "diploma") {
    return "diploma";
  }
  if (text === "graduation" || text === "graduate" || text === "grad") {
    return "graduation";
  }
  if (
    text === "post graduation" ||
    text === "post_graduation" ||
    text === "postgraduate" ||
    text === "pg"
  ) {
    return "post_graduation";
  }
  if (text === "other") {
    return "other";
  }
  return String(value || "").trim().slice(0, 20);
}

function validateAge(value, { fromDob = "" } = {}) {
  if (value == null || value === "") {
    if (fromDob) {
      return computeAgeFromDob(fromDob);
    }
    return null;
  }
  const age = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(age) || age < 18 || age > 100) {
    const error = new Error("Enter a valid age (18-100)");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return age;
}

function normalizeKycInput(body) {
  const input = body && typeof body === "object" ? body : {};
  return {
    first_name: String(input.first_name || "").trim().slice(0, 80),
    last_name: String(input.last_name || "").trim().slice(0, 80),
    date_of_birth: String(input.date_of_birth || "").trim().slice(0, 10),
    age: input.age != null && input.age !== "" ? String(input.age).trim() : "",
    qualification: String(input.qualification || "").trim().slice(0, 20),
    pan_number: String(input.pan_number || input.pan || "")
      .trim()
      .toUpperCase()
      .slice(0, 10),
    aadhaar_number: String(input.aadhaar_number || input.aadhaar || "")
      .replace(/\D/g, "")
      .slice(0, 12),
    address_line1: String(input.address_line1 || "").trim().slice(0, 180),
    address_line2: String(input.address_line2 || "").trim().slice(0, 180),
    city: String(input.city || "").trim().slice(0, 80),
    state: String(input.state || "").trim().slice(0, 80),
    postal_code: String(input.postal_code || input.pincode || "")
      .trim()
      .slice(0, 10),
    country: String(input.country || "India").trim().slice(0, 80) || "India",
    bank_account_number: String(input.bank_account_number || input.bank_account || "")
      .replace(/\D/g, "")
      .slice(0, 18),
    ifsc: String(input.ifsc || "")
      .trim()
      .toUpperCase()
      .slice(0, 11),
    account_holder_name: String(input.account_holder_name || "").trim().slice(0, 120),
  };
}

function validateKycPayload(input, { partial = false } = {}) {
  const required = [
    ["first_name", input.first_name, "First name is required"],
    ["last_name", input.last_name, "Last name is required"],
    ["date_of_birth", input.date_of_birth, "Date of birth is required"],
    ["pan_number", input.pan_number, "PAN is required"],
    ["aadhaar_number", input.aadhaar_number, "Aadhaar is required"],
    ["address_line1", input.address_line1, "Address line 1 is required"],
    ["city", input.city, "City is required"],
    ["state", input.state, "State is required"],
    ["postal_code", input.postal_code, "Postal code is required"],
    ["bank_account_number", input.bank_account_number, "Bank account number is required"],
    ["ifsc", input.ifsc, "IFSC is required"],
    ["account_holder_name", input.account_holder_name, "Account holder name is required"],
  ];
  if (!partial) {
    for (const [, value, message] of required) {
      if (!String(value || "").trim()) {
        throw validationError(message);
      }
    }
  }
  const validated = { ...input };
  if (input.pan_number) {
    validated.pan_number = validatePan(input.pan_number);
  }
  if (input.aadhaar_number) {
    validated.aadhaar_number = validateAadhaar(input.aadhaar_number);
  }
  if (input.date_of_birth) {
    validated.date_of_birth = validateDob(input.date_of_birth);
  }
  if (input.qualification) {
    validated.qualification = validateQualification(input.qualification);
  }
  if (input.age || input.date_of_birth) {
    validated.age = validateAge(input.age, { fromDob: validated.date_of_birth || input.date_of_birth });
  }
  if (input.ifsc) {
    validated.ifsc = validateIfsc(input.ifsc);
  }
  if (input.bank_account_number) {
    validated.bank_account_number = validateBankAccount(input.bank_account_number);
  }
  if (input.postal_code && !/^\d{6}$/.test(String(input.postal_code).trim())) {
    throw validationError("Enter a valid 6-digit postal code");
  }
  return validated;
}

function buildSensitiveFields(validated) {
  const bankKey =
    validated.ifsc && validated.bank_account_number
      ? `${validated.ifsc}:${validated.bank_account_number}`
      : "";
  return {
    pan_last4: last4(validated.pan_number),
    pan_hash: hashSensitive("pan", validated.pan_number),
    aadhaar_last4: last4(validated.aadhaar_number),
    aadhaar_hash: hashSensitive("aadhaar", validated.aadhaar_number),
    bank_account_last4: last4(validated.bank_account_number),
    bank_account_hash: hashSensitive("bank", bankKey),
  };
}

function hasStoredProfilePhoto(row, partnerRow) {
  if (row?.profile_photo_file_id && row?.profile_photo_folder_id) {
    return true;
  }
  if (String(partnerRow?.profile_photo_url || "").startsWith("filestore:")) {
    return true;
  }
  return Boolean(partnerRow?.selfie_file_id && partnerRow?.selfie_folder_id);
}

function mapKycRow(row, partnerStatus, { adminView = false, partnerProfile = null, partnerRow = null } = {}) {
  if (!row && !partnerRow) {
    return null;
  }
  const source = row && typeof row === "object" ? row : {};
  const normalizedStatus = normalizePartnerStatus(partnerStatus);
  const profile = partnerProfile && typeof partnerProfile === "object" ? partnerProfile : {};
  const submitReady = row ? kycSubmitReady(row, partnerRow) : false;
  const partnerId = source.delivery_partner_id || partnerRow?.ROWID || "";
  const base = {
    kyc_id: source.ROWID ? String(source.ROWID) : "",
    delivery_partner_id: partnerId ? "dp_" + String(partnerId) : partnerRow?.ROWID ? "dp_" + String(partnerRow.ROWID) : "",
    partner_status: normalizedStatus,
    partner_status_label: partnerStatusLabel(normalizedStatus),
    editable: isKycEditable(partnerStatus),
    can_submit: canSubmitKyc(partnerStatus) && submitReady,
    ready_to_submit: submitReady,
    operational: isPartnerOperational(partnerStatus),
    phone: partnerRow?.phone || "",
    first_name: source.first_name || partnerRow?.first_name || "",
    last_name: source.last_name || partnerRow?.last_name || "",
    date_of_birth: source.date_of_birth || partnerRow?.date_of_birth || "",
    age:
      profile.age != null && profile.age !== ""
        ? Number(profile.age)
        : partnerRow?.age != null && partnerRow?.age !== ""
          ? Number(partnerRow.age)
          : computeAgeFromDob(source.date_of_birth || partnerRow?.date_of_birth),
    qualification: profile.qualification || partnerRow?.qualification || "",
    address_line1: source.address_line1 || partnerRow?.address_line1 || "",
    address_line2: source.address_line2 || "",
    city: source.city || partnerRow?.city || "",
    state: source.state || partnerRow?.state || "",
    postal_code: source.postal_code || partnerRow?.postal_code || "",
    country: source.country || partnerRow?.country || "India",
    email: source.email || partnerRow?.email || "",
    ifsc: source.ifsc || "",
    account_holder_name: source.account_holder_name || "",
    pan_masked: source.pan_last4 ? "XXXXX" + source.pan_last4 + "X" : "",
    aadhaar_masked: source.aadhaar_last4 ? "XXXX XXXX " + source.aadhaar_last4 : "",
    bank_account_masked: source.bank_account_last4 ? "XXXXXX" + source.bank_account_last4 : "",
    documents: {
      profile_photo: documentMeta(source, "profile_photo", partnerRow),
      aadhaar_front: documentMeta(source, "identity_document", partnerRow),
      aadhaar_back: documentMeta(source, "address_document", partnerRow),
      identity_document: documentMeta(source, "identity_document", partnerRow),
      address_document: documentMeta(source, "address_document", partnerRow),
    },
    rejection_reason: source.rejection_reason || "",
    submitted_at: source.submitted_at || "",
    reviewed_at: source.reviewed_at || "",
    reviewed_by: adminView ? source.reviewed_by || "" : "",
    created_at: source.CREATEDTIME || "",
    updated_at: source.reviewed_at || source.submitted_at || source.CREATEDTIME || "",
  };
  return base;
}

function hasStoredAadhaar(row) {
  return Boolean(
    String(row?.aadhaar_hash || "").trim() || String(row?.aadhaar_last4 || "").trim()
  );
}

function isRegistrationPassportIdentity(row, partnerRow) {
  if (!row || !row.identity_document_file_id) {
    return false;
  }
  if (hasStoredAadhaar(row)) {
    return false;
  }
  if (row.submitted_at) {
    return false;
  }
  const identityId = String(row.identity_document_file_id);
  const passportId = partnerRow?.passport_photo_file_id
    ? String(partnerRow.passport_photo_file_id)
    : "";
  if (passportId && passportId === identityId) {
    return true;
  }
  const phase = String(partnerRow?.registration_phase || row.registration_phase || "");
  return ["photos_complete", "password_set", "registered"].includes(phase);
}

function isRegistrationProfilePhoto(row, partnerRow) {
  if (!row?.profile_photo_file_id || !row?.profile_photo_folder_id) {
    return false;
  }
  if (row.submitted_at) {
    return false;
  }
  const profileId = String(row.profile_photo_file_id);
  const regSelfieId = partnerRow?.selfie_file_id ? String(partnerRow.selfie_file_id) : "";
  // Only exclude the exact registration selfie copied into KYC — not fresh KYC uploads
  // (profile_photo_url is synced to the same file id after KYC selfie upload).
  return Boolean(regSelfieId && regSelfieId === profileId);
}

function isKycDocumentUploaded(row, type, partnerRow = null) {
  if (!row) {
    return false;
  }
  const prefix =
    type === "profile_photo"
      ? "profile_photo"
      : type === "identity_document"
        ? "identity_document"
        : "address_document";
  const fileId = row[`${prefix}_file_id`];
  const folderId = row[`${prefix}_folder_id`];
  if (!fileId || !folderId) {
    return false;
  }
  if (type === "identity_document" && isRegistrationPassportIdentity(row, partnerRow)) {
    return false;
  }
  if (type === "profile_photo" && isRegistrationProfilePhoto(row, partnerRow)) {
    return false;
  }
  return true;
}

function documentMeta(row, type, partnerRow = null) {
  const prefix =
    type === "profile_photo"
      ? "profile_photo"
      : type === "identity_document"
        ? "identity_document"
        : "address_document";
  const fileId = row[`${prefix}_file_id`];
  const folderId = row[`${prefix}_folder_id`];
  const uploaded = isKycDocumentUploaded(row, type, partnerRow);
  return {
    uploaded,
    file_id: fileId ? String(fileId) : "",
    folder_id: folderId ? String(folderId) : "",
  };
}

function kycRowToStorage(validated, existingRow, { partial = false } = {}) {
  const sensitive = buildSensitiveFields(validated);
  const storage = {
    first_name: validated.first_name,
    last_name: validated.last_name,
    date_of_birth: validated.date_of_birth,
    address_line1: validated.address_line1,
    address_line2: validated.address_line2 || "",
    city: validated.city,
    state: validated.state,
    postal_code: validated.postal_code,
    country: validated.country,
    ifsc: validated.ifsc,
    account_holder_name: validated.account_holder_name,
    pan_last4: sensitive.pan_last4,
    pan_hash: sensitive.pan_hash,
    aadhaar_last4: sensitive.aadhaar_last4,
    aadhaar_hash: sensitive.aadhaar_hash,
    bank_account_last4: sensitive.bank_account_last4,
    bank_account_hash: sensitive.bank_account_hash,
  };
  if (partial && existingRow) {
    for (const key of [
      "first_name",
      "last_name",
      "date_of_birth",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "postal_code",
      "country",
      "ifsc",
      "account_holder_name",
    ]) {
      if (!String(validated[key] || "").trim() && existingRow[key]) {
        storage[key] = existingRow[key];
      }
    }
  }
  return storage;
}

function assertDocumentsPresent(row, partnerRow = null) {
  const missing = [];
  if (!isKycDocumentUploaded(row, "profile_photo", partnerRow)) {
    missing.push("profile_photo");
  }
  if (!isKycDocumentUploaded(row, "identity_document", partnerRow)) {
    missing.push("aadhaar_front");
  }
  if (!isKycDocumentUploaded(row, "address_document", partnerRow)) {
    missing.push("aadhaar_back");
  }
  if (missing.length) {
    const error = new Error("Missing required documents: " + missing.join(", "));
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
}

function kycSubmitReady(row, partnerRow = null) {
  if (!row) {
    return false;
  }
  try {
    assertSubmitReady(row, partnerRow);
    return true;
  } catch (_) {
    return false;
  }
}

function assertSubmitReady(row, partnerRow = null) {
  if (!hasStoredAadhaar(row)) {
    throw validationError("Aadhaar number is required");
  }
  assertDocumentsPresent(row, partnerRow);
}

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function decodeDocumentUpload(body) {
  const documentType = String(body.document_type || "").trim().toLowerCase();
  if (!KYC_DOCUMENT_TYPES.has(documentType)) {
    throw validationError(
      "document_type must be profile_photo, identity_document (Aadhaar front), or address_document (Aadhaar back)"
    );
  }
  const fileName = String(body.file_name || "document.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120);
  const contentTypeRaw = String(body.content_type || "application/octet-stream")
    .trim()
    .toLowerCase()
    .slice(0, 80);
  const contentType = contentTypeRaw === "image/jpg" ? "image/jpeg" : contentTypeRaw;
  if (!KYC_DOC_TYPES.has(contentType)) {
    throw validationError("Only JPG, PNG, WEBP, or PDF documents are allowed");
  }
  const rawBase64 = String(body.base64 || "").trim();
  const base64 = rawBase64.includes(",") ? rawBase64.split(",").pop() : rawBase64;
  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch (_) {
    throw validationError("Document payload is not valid base64");
  }
  if (!bytes.length) {
    throw validationError("Document file is empty");
  }
  if (bytes.length > MAX_KYC_FILE_BYTES) {
    throw validationError("Document must be 5 MB or smaller");
  }
  return { documentType, fileName, contentType, bytes };
}

function resolveKycFolderId() {
  const value =
    process.env.FILESTORE_KYC_FOLDER_ID ||
    process.env.CATALYST_FILESTORE_KYC_FOLDER_ID ||
    process.env.FILESTORE_MEDIA_FOLDER_ID ||
    process.env.CATALYST_FILESTORE_MEDIA_FOLDER_ID;
  if (!/^\d+$/.test(String(value || "").trim())) {
    throw validationError("Document storage is not ready. Please try again in a moment.");
  }
  return String(value).trim();
}

async function uploadKycDocument(req, partnerRowId, body) {
  const input = decodeDocumentUpload(body);
  const folderId = resolveKycFolderId();
  const safeName =
    "dp-" +
    partnerRowId +
    "-" +
    input.documentType +
    "-" +
    Date.now() +
    "-" +
    input.fileName;
  const tempPath = path.join(os.tmpdir(), crypto.randomUUID() + "-" + safeName);
  fs.writeFileSync(tempPath, input.bytes);
  try {
    const folder = req.catalystApp.filestore().folder(folderId);
    const uploaded = await folder.uploadFile({
      code: fs.createReadStream(tempPath),
      name: safeName,
    });
    const fileId = String(uploaded.id || uploaded.file_id || uploaded.fileId || "");
    if (!fileId) {
      throw validationError("Could not store this document. Please try a smaller JPG or PDF.");
    }
    return {
      document_type: input.documentType,
      folder_id: folderId,
      file_id: fileId,
      file_name: safeName,
      content_type: input.contentType,
      file_size: input.bytes.length,
    };
  } catch (error) {
    if (error && error.status) {
      throw error;
    }
    const wrapped = validationError(
      "Could not upload this photo or document. Use a smaller JPG, PNG, or PDF and try again."
    );
    wrapped.details = String(error && error.message ? error.message : error || "").slice(0, 180);
    throw wrapped;
  } finally {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
  }
}

function documentFieldPrefix(documentType) {
  if (documentType === "profile_photo") {
    return "profile_photo";
  }
  if (documentType === "identity_document") {
    return "identity_document";
  }
  return "address_document";
}

function transitionError(message) {
  const error = new Error(message);
  error.status = 409;
  error.code = "INVALID_STATUS_TRANSITION";
  return error;
}

module.exports = {
  PARTNER_STATUS,
  KYC_SELECT,
  KYC_DOCUMENT_TYPES,
  KYC_DOC_TYPES,
  MAX_KYC_FILE_BYTES,
  QUALIFICATION_VALUES,
  normalizePartnerStatus,
  partnerStatusLabel,
  isKycEditable,
  isPartnerOperational,
  canSubmitKyc,
  hashSensitive,
  last4,
  maskPan,
  maskAadhaar,
  maskBankAccount,
  validatePan,
  validateAadhaar,
  validateIfsc,
  validateDob,
  validateBankAccount,
  validateQualification,
  validateAge,
  computeAgeFromDob,
  normalizeKycInput,
  validateKycPayload,
  buildSensitiveFields,
  mapKycRow,
  isRegistrationPassportIdentity,
  isRegistrationProfilePhoto,
  isKycDocumentUploaded,
  hasStoredProfilePhoto,
  kycSubmitReady,
  kycRowToStorage,
  assertDocumentsPresent,
  assertSubmitReady,
  nowSql,
  decodeDocumentUpload,
  resolveKycFolderId,
  uploadKycDocument,
  documentFieldPrefix,
  transitionError,
  validationError,
};
