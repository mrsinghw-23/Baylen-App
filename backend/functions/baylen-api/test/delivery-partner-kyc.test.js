"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  PARTNER_STATUS,
  normalizePartnerStatus,
  partnerStatusLabel,
  isKycEditable,
  isPartnerOperational,
  canSubmitKyc,
  hashSensitive,
  validatePan,
  validateAadhaar,
  validateIfsc,
  validateDob,
  validateBankAccount,
  normalizeKycInput,
  validateKycPayload,
  mapKycRow,
  isRegistrationPassportIdentity,
  assertSubmitReady,
  assertDocumentsPresent,
  decodeDocumentUpload,
  buildSensitiveFields,
} = require("../lib/delivery-partner-kyc");
const { requireUser, requireDeliveryPartner, signSession } = require("../lib/session");
const { assertOperationalPartner } = require("../routes/delivery-partner");

function mockReq(token) {
  return { headers: token ? { "x-baylen-token": token } : {} };
}

const completeKycRow = {
  ROWID: "10",
  delivery_partner_id: "9",
  first_name: "Asha",
  last_name: "Singh",
  date_of_birth: "1995-06-15",
  pan_last4: "1234",
  pan_hash: hashSensitive("pan", "ABCDE1234F"),
  aadhaar_last4: "4321",
  aadhaar_hash: hashSensitive("aadhaar", "123456789012"),
  address_line1: "12 MG Road",
  address_line2: "",
  city: "Ranchi",
  state: "Jharkhand",
  postal_code: "834001",
  country: "India",
  bank_account_last4: "7890",
  bank_account_hash: hashSensitive("bank", "HDFC0001234:1234567890"),
  ifsc: "HDFC0001234",
  account_holder_name: "Asha Singh",
  profile_photo_file_id: "1",
  profile_photo_folder_id: "100",
  identity_document_file_id: "2",
  identity_document_folder_id: "100",
  address_document_file_id: "3",
  address_document_folder_id: "100",
  rejection_reason: "",
  reviewed_by: "",
  submitted_at: "",
  reviewed_at: "",
};

describe("delivery partner KYC lifecycle", () => {
  it("normalizes legacy pending_profile to pending_kyc", () => {
    assert.equal(normalizePartnerStatus("pending_profile"), PARTNER_STATUS.PENDING_KYC);
    assert.equal(normalizePartnerStatus("pending_verification"), PARTNER_STATUS.PENDING_KYC);
  });

  it("labels partner statuses for UI", () => {
    assert.equal(partnerStatusLabel(PARTNER_STATUS.KYC_SUBMITTED), "KYC Submitted");
    assert.equal(partnerStatusLabel(PARTNER_STATUS.KYC_REJECTED), "Rejected");
    assert.equal(partnerStatusLabel(PARTNER_STATUS.ACTIVE), "Active");
  });

  it("allows edit only in draft/rejected states", () => {
    assert.equal(isKycEditable(PARTNER_STATUS.PENDING_KYC), true);
    assert.equal(isKycEditable(PARTNER_STATUS.KYC_REJECTED), true);
    assert.equal(isKycEditable(PARTNER_STATUS.KYC_SUBMITTED), false);
    assert.equal(isKycEditable(PARTNER_STATUS.ACTIVE), false);
  });

  it("treats only active partners as operational", () => {
    assert.equal(isPartnerOperational(PARTNER_STATUS.ACTIVE), true);
    assert.equal(isPartnerOperational(PARTNER_STATUS.KYC_APPROVED), false);
    assert.equal(isPartnerOperational(PARTNER_STATUS.KYC_SUBMITTED), false);
  });

  it("allows submit from draft and rejected states", () => {
    assert.equal(canSubmitKyc(PARTNER_STATUS.PENDING_KYC), true);
    assert.equal(canSubmitKyc(PARTNER_STATUS.KYC_REJECTED), true);
    assert.equal(canSubmitKyc(PARTNER_STATUS.KYC_SUBMITTED), false);
  });
});

describe("delivery partner KYC validation", () => {
  it("validates PAN format", () => {
    assert.equal(validatePan("abcde1234f"), "ABCDE1234F");
    assert.throws(() => validatePan("BADPAN"), (error) => error.status === 422);
  });

  it("validates Aadhaar format", () => {
    assert.equal(validateAadhaar("1234 5678 9012"), "123456789012");
    assert.throws(() => validateAadhaar("123"), (error) => error.status === 422);
  });

  it("validates IFSC format", () => {
    assert.equal(validateIfsc("hdfc0001234"), "HDFC0001234");
    assert.throws(() => validateIfsc("BADIFSC"), (error) => error.status === 422);
  });

  it("validates bank account numbers", () => {
    assert.equal(validateBankAccount("1234567890"), "1234567890");
    assert.throws(() => validateBankAccount("12"), (error) => error.status === 422);
  });

  it("validates DOB and minimum age", () => {
    assert.equal(validateDob("1995-06-15"), "1995-06-15");
    assert.throws(() => validateDob("2020-01-01"), (error) => error.status === 422);
  });

  it("requires all fields for full payload validation", () => {
    const input = normalizeKycInput({
      first_name: "Asha",
      last_name: "Singh",
      date_of_birth: "1995-06-15",
      pan_number: "ABCDE1234F",
      aadhaar_number: "123456789012",
      address_line1: "12 MG Road",
      city: "Ranchi",
      state: "Jharkhand",
      postal_code: "834001",
      bank_account_number: "1234567890",
      ifsc: "HDFC0001234",
      account_holder_name: "Asha Singh",
    });
    const validated = validateKycPayload(input, { partial: false });
    assert.equal(validated.pan_number, "ABCDE1234F");
    assert.equal(validated.ifsc, "HDFC0001234");
  });

  it("stores only hashed sensitive identifiers", () => {
    const sensitive = buildSensitiveFields({
      pan_number: "ABCDE1234F",
      aadhaar_number: "123456789012",
      ifsc: "HDFC0001234",
      bank_account_number: "1234567890",
    });
    assert.equal(sensitive.pan_last4, "1234");
    assert.match(sensitive.pan_hash, /^[a-f0-9]{64}$/);
    assert.equal(sensitive.aadhaar_last4, "9012");
    assert.notEqual(sensitive.pan_hash, "ABCDE1234F");
  });

  it("masks sensitive fields in API responses", () => {
    const view = mapKycRow(completeKycRow, PARTNER_STATUS.PENDING_KYC);
    assert.match(view.pan_masked, /XXXXX/);
    assert.match(view.aadhaar_masked, /XXXX XXXX/);
    assert.match(view.bank_account_masked, /XXXXXX/);
    assert.equal(view.reviewed_by, "");
    assert.equal(view.documents.profile_photo.uploaded, true);
  });

  it("does not expose raw PAN/Aadhaar in mapped responses", () => {
    const view = mapKycRow(completeKycRow, PARTNER_STATUS.PENDING_KYC);
    assert.equal(view.pan_hash, undefined);
    assert.equal(view.aadhaar_hash, undefined);
    assert.equal(view.pan_number, undefined);
  });

  it("does not treat registration passport as Aadhaar front", () => {
    const row = {
      identity_document_file_id: "passport-file",
      identity_document_folder_id: "folder-1",
      address_document_file_id: null,
      aadhaar_hash: "",
      submitted_at: null,
    };
    const partnerRow = {
      passport_photo_file_id: "passport-file",
      registration_phase: "registered",
    };
    assert.equal(isRegistrationPassportIdentity(row, partnerRow), true);
    const view = mapKycRow(row, PARTNER_STATUS.PENDING_KYC, { partnerRow });
    assert.equal(view.documents.aadhaar_front.uploaded, false);
  });

  it("does not mark Aadhaar front uploaded when only back was added", () => {
    const row = {
      identity_document_file_id: "passport-file",
      identity_document_folder_id: "folder-1",
      address_document_file_id: "back-file",
      address_document_folder_id: "folder-1",
      aadhaar_hash: "",
      submitted_at: null,
    };
    const partnerRow = {
      passport_photo_file_id: "passport-file",
      registration_phase: "registered",
    };
    const view = mapKycRow(row, PARTNER_STATUS.PENDING_KYC, { partnerRow });
    assert.equal(view.documents.aadhaar_front.uploaded, false);
    assert.equal(view.documents.aadhaar_back.uploaded, true);
  });

  it("does not treat registration selfie as KYC selfie", () => {
    const row = {
      profile_photo_file_id: "selfie-file",
      profile_photo_folder_id: "folder-1",
      submitted_at: null,
    };
    const partnerRow = {
      selfie_file_id: "selfie-file",
      profile_photo_url: "filestore:selfie-file",
      registration_phase: "registered",
    };
    const view = mapKycRow(row, PARTNER_STATUS.PENDING_KYC, { partnerRow });
    assert.equal(view.documents.profile_photo.uploaded, false);
  });

  it("counts KYC selfie after upload even when profile_photo_url matches", () => {
    const row = {
      profile_photo_file_id: "kyc-selfie-file",
      profile_photo_folder_id: "folder-1",
      submitted_at: null,
    };
    const partnerRow = {
      selfie_file_id: "",
      profile_photo_url: "filestore:kyc-selfie-file",
      registration_phase: "registered",
    };
    const view = mapKycRow(row, PARTNER_STATUS.PENDING_KYC, { partnerRow });
    assert.equal(view.documents.profile_photo.uploaded, true);
    assert.doesNotThrow(() => assertSubmitReady({ ...completeKycRow, ...row }));
  });

  it("rejects missing required documents on submit", () => {
    assert.throws(
      () => assertDocumentsPresent({ ...completeKycRow, identity_document_file_id: null }),
      (error) => error.status === 422
    );
  });

  it("requires aadhaar and documents before submit", () => {
    assert.doesNotThrow(() => assertSubmitReady(completeKycRow));
    assert.throws(
      () =>
        assertSubmitReady({
          ...completeKycRow,
          aadhaar_hash: "",
          aadhaar_last4: "",
        }),
      (error) => error.status === 422
    );
    assert.doesNotThrow(() =>
      assertSubmitReady({
        ...completeKycRow,
        aadhaar_hash: "",
        aadhaar_last4: "4321",
      })
    );
    assert.throws(
      () => assertSubmitReady({ ...completeKycRow, identity_document_file_id: null }),
      (error) => error.status === 422
    );
  });

  it("validates document upload payload", () => {
    const tiny = Buffer.from("hello").toString("base64");
    const decoded = decodeDocumentUpload({
      document_type: "identity_document",
      file_name: "id.pdf",
      content_type: "application/pdf",
      base64: tiny,
    });
    assert.equal(decoded.documentType, "identity_document");
    assert.throws(
      () =>
        decodeDocumentUpload({
          document_type: "identity_document",
          file_name: "id.exe",
          content_type: "application/x-msdownload",
          base64: tiny,
        }),
      (error) => error.status === 422
    );
  });
});

describe("delivery partner KYC authorization", () => {
  it("rejects customer tokens on delivery partner routes", () => {
    const customerToken = signSession({ user_id: "42", role: "customer" });
    assert.throws(
      () => requireDeliveryPartner(mockReq(customerToken)),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
  });

  it("rejects delivery partner tokens on customer routes", () => {
    const dpToken = signSession({
      role: "delivery_partner",
      delivery_partner_id: "dp_9",
      sub: "dp_9",
      phone: "+919876543210",
      status: PARTNER_STATUS.PENDING_KYC,
    });
    assert.throws(
      () => requireUser(mockReq(dpToken)),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
  });

  it("blocks leads until partner is active", () => {
    assert.throws(
      () =>
        assertOperationalPartner({
          delivery_partner_id: "dp_9",
          status: PARTNER_STATUS.KYC_SUBMITTED,
        }),
      (error) => error.status === 403 && error.code === "KYC_REQUIRED"
    );
    assert.doesNotThrow(() =>
      assertOperationalPartner({
        delivery_partner_id: "dp_9",
        status: PARTNER_STATUS.ACTIVE,
      })
    );
  });
});

describe("provision script idempotency contract", () => {
  it("declares Delivery_Partner_KYC table and KYC columns once", () => {
    const script = require("fs").readFileSync(
      require("path").join(__dirname, "../../../scripts/provision-delivery-partner-schema.js"),
      "utf8"
    );
    assert.match(script, /Delivery_Partner_KYC/);
    assert.match(script, /pan_hash/);
    assert.match(script, /identity_document_file_id/);
    assert.match(script, /missing = columns.filter/);
  });
});
