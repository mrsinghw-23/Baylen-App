"use strict";

const { rowOf, rowsOf, sqlString } = require("./http");
const { parseDeliveryPartnerId, formatDeliveryPartnerId } = require("./delivery-partner");
const {
  KYC_SELECT,
  KYC_DOCUMENT_TYPES,
  PARTNER_STATUS,
  normalizePartnerStatus,
  isKycEditable,
  canSubmitKyc,
  isPartnerOperational,
  normalizeKycInput,
  validateKycPayload,
  kycRowToStorage,
  mapKycRow,
  assertSubmitReady,
  kycSubmitReady,
  nowSql,
  uploadKycDocument,
  documentFieldPrefix,
  resolveKycFolderId,
  transitionError,
  hashSensitive,
  validationError,
  computeAgeFromDob,
} = require("./delivery-partner-kyc");
const { writeDeliveryPartnerAudit } = require("./audit");
const { signSession } = require("./session");
const { deliveryPartnerSessionPayload, findDeliveryPartnerById } = require("./delivery-partner");

async function findPartnerRow(zcql, deliveryPartnerId) {
  const rowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!rowId) {
    return null;
  }
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, phone, outlet_id, status, first_name, last_name, age, qualification, online_status, legacy_provider_id, legacy_rider_id, profile_photo_url, rating FROM Delivery_Partners WHERE ROWID = " +
        rowId
    ),
    "Delivery_Partners"
  );
}

async function findKycByPartnerRowId(zcql, partnerRowId) {
  const partnerId = String(partnerRowId || "").trim();
  if (!partnerId) {
    return null;
  }
  let kyc = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " +
        KYC_SELECT +
        " FROM Delivery_Partner_KYC WHERE partner_row_id = " +
        sqlString(partnerId) +
        " ORDER BY ROWID DESC LIMIT 1"
    ),
    "Delivery_Partner_KYC"
  );
  if (kyc) {
    return kyc;
  }
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " +
        KYC_SELECT +
        " FROM Delivery_Partner_KYC WHERE delivery_partner_id = " +
        partnerId +
        " LIMIT 1"
    ),
    "Delivery_Partner_KYC"
  );
}

function compactKycWrite(storage) {
  const out = {};
  for (const [key, value] of Object.entries(storage || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out;
}

async function assertUniqueIdentity(zcql, partnerRowId, panHash, aadhaarHash) {
  if (panHash) {
    let panDup = null;
    try {
      panDup = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, delivery_partner_id FROM Delivery_Partner_KYC WHERE pan_hash = " +
            sqlString(panHash) +
            " AND delivery_partner_id != " +
            partnerRowId +
            " LIMIT 1"
        ),
        "Delivery_Partner_KYC"
      );
    } catch (error) {
      console.error("[kyc] pan uniqueness check failed", error && error.message);
    }
    if (panDup) {
      const error = new Error("This PAN is already linked to another delivery partner account");
      error.status = 409;
      error.code = "DUPLICATE_IDENTITY";
      throw error;
    }
  }
  if (aadhaarHash) {
    let aadhaarDup = null;
    try {
      aadhaarDup = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, delivery_partner_id FROM Delivery_Partner_KYC WHERE aadhaar_hash = " +
            sqlString(aadhaarHash) +
            " AND delivery_partner_id != " +
            partnerRowId +
            " LIMIT 1"
        ),
        "Delivery_Partner_KYC"
      );
    } catch (error) {
      console.error("[kyc] aadhaar uniqueness check failed", error && error.message);
    }
    if (aadhaarDup) {
      const error = new Error("This Aadhaar is already linked to another delivery partner account");
      error.status = 409;
      error.code = "DUPLICATE_IDENTITY";
      throw error;
    }
  }
}

async function syncPartnerProfile(req, partnerRow, validated) {
  const update = {
    ROWID: partnerRow.ROWID,
    status: normalizePartnerStatus(partnerRow.status),
  };
  if (validated.first_name) {
    update.first_name = validated.first_name;
  }
  if (validated.last_name) {
    update.last_name = validated.last_name;
  }
  if (validated.age != null) {
    update.age = validated.age;
  }
  if (validated.qualification) {
    update.qualification = validated.qualification;
  }
  try {
    await req.catalystApp.datastore().table("Delivery_Partners").updateRow(update);
  } catch (error) {
    console.error("[kyc] partner profile sync failed", error && error.message);
  }
}

async function promoteSubmittedPartnerToActive(req, partnerRow, kycRow) {
  if (!partnerRow) {
    return partnerRow;
  }
  const status = normalizePartnerStatus(partnerRow.status);
  if (status === PARTNER_STATUS.ACTIVE) {
    return partnerRow;
  }
  if (
    status !== PARTNER_STATUS.KYC_SUBMITTED &&
    status !== PARTNER_STATUS.KYC_UNDER_REVIEW
  ) {
    return partnerRow;
  }
  if (!kycRow || !kycSubmitReady(kycRow, partnerRow)) {
    return partnerRow;
  }
  const activatedAt = nowSql();
  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    status: PARTNER_STATUS.ACTIVE,
    kyc_approved_at: partnerRow.kyc_approved_at || activatedAt,
  });
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    reviewed_at: kycRow.reviewed_at || activatedAt,
    reviewed_by: kycRow.reviewed_by || "SELF_KYC",
    rejection_reason: null,
  });
  return {
    ...partnerRow,
    status: PARTNER_STATUS.ACTIVE,
    kyc_approved_at: partnerRow.kyc_approved_at || activatedAt,
  };
}

async function getKycBundle(req, partnerAuth, { adminView = false } = {}) {
  const partnerRowId = parseDeliveryPartnerId(partnerAuth.delivery_partner_id);
  let partnerRow = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  let kycRow = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  if (!kycRow) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    kycRow = await findKycRegRow(req.catalystApp.zcql(), partnerRowId, partnerRow);
  }
  if (!adminView) {
    partnerRow = await promoteSubmittedPartnerToActive(req, partnerRow, kycRow);
  }
  return {
    partnerRow,
    kycRow,
    view: mapKycRow(kycRow, partnerRow.status, {
      adminView,
      partnerRow,
      partnerProfile: {
        age: partnerRow.age,
        qualification: partnerRow.qualification,
      },
    }),
    partner_status: normalizePartnerStatus(partnerRow.status),
  };
}

async function saveKycDraft(req, partnerAuth, body, { createOnly = false } = {}) {
  const partnerRowId = parseDeliveryPartnerId(partnerAuth.delivery_partner_id);
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  if (!isKycEditable(partnerRow.status)) {
    throw transitionError("KYC cannot be edited in the current account status");
  }

  let existing = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  if (!existing) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    existing = await findKycRegRow(req.catalystApp.zcql(), partnerRowId, partnerRow);
  }
  const input = normalizeKycInput(body);
  const validated = validateKycPayload(input, { partial: true });
  const storage = compactKycWrite(kycRowToStorage(validated, existing, { partial: true }));
  if (existing) {
    if (!input.pan_number) {
      storage.pan_last4 = existing.pan_last4 || storage.pan_last4;
      storage.pan_hash = existing.pan_hash || storage.pan_hash;
    }
    if (!input.aadhaar_number) {
      storage.aadhaar_last4 = existing.aadhaar_last4 || storage.aadhaar_last4;
      storage.aadhaar_hash = existing.aadhaar_hash || storage.aadhaar_hash;
    }
    if (!input.bank_account_number) {
      storage.bank_account_last4 =
        existing.bank_account_last4 || storage.bank_account_last4;
      storage.bank_account_hash =
        existing.bank_account_hash || storage.bank_account_hash;
    }
  }

  if (storage.pan_hash || storage.aadhaar_hash) {
    await assertUniqueIdentity(
      req.catalystApp.zcql(),
      partnerRowId,
      storage.pan_hash,
      storage.aadhaar_hash
    );
  }

  let kycRow = existing;
  if (!existing) {
    const inserted = await req.catalystApp.datastore().table("Delivery_Partner_KYC").insertRow({
      delivery_partner_id: partnerRowId,
      partner_row_id: String(partnerRowId),
      ...storage,
    });
    kycRow = await findKycByPartnerRowId(
      req.catalystApp.zcql(),
      partnerRowId
    );
    if (!kycRow && inserted && inserted.ROWID) {
      kycRow = { ROWID: inserted.ROWID, delivery_partner_id: partnerRowId, ...storage };
    }
    await writeDeliveryPartnerAudit(req, partnerAuth.delivery_partner_id, "KYC_CREATE", "Delivery_Partner_KYC", kycRow?.ROWID, null, {
      partner_status: normalizePartnerStatus(partnerRow.status),
    });
  } else {
    try {
      await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
        ROWID: existing.ROWID,
        ...storage,
      });
    } catch (error) {
      console.error("[kyc] draft update failed", error && error.message);
      const friendly = new Error("Could not save these details. Please try again.");
      friendly.status = 422;
      friendly.code = "VALIDATION_ERROR";
      throw friendly;
    }
    await writeDeliveryPartnerAudit(req, partnerAuth.delivery_partner_id, "KYC_UPDATE", "Delivery_Partner_KYC", existing.ROWID, {
      partner_status: normalizePartnerStatus(partnerRow.status),
    }, {
      partner_status: normalizePartnerStatus(partnerRow.status),
    });
    kycRow =
      (await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId)) ||
      { ...existing, ...storage };
  }

  if (
    validated.first_name ||
    validated.last_name ||
    validated.age != null ||
    validated.qualification
  ) {
    await syncPartnerProfile(req, partnerRow, validated);
  }

  const refreshedPartner = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  return mapKycRow(kycRow, refreshedPartner?.status || partnerRow.status, {
    partnerRow: refreshedPartner || partnerRow,
    partnerProfile: {
      age: refreshedPartner?.age ?? validated.age,
      qualification: refreshedPartner?.qualification || validated.qualification || "",
    },
  });
}

async function submitKyc(req, partnerAuth, body = {}) {
  const partnerRowId = parseDeliveryPartnerId(partnerAuth.delivery_partner_id);
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  if (!canSubmitKyc(partnerRow.status)) {
    throw transitionError("KYC cannot be submitted in the current account status");
  }

  const aadhaarNumber = String(body.aadhaar_number || body.aadhaar || "")
    .replace(/\D/g, "")
    .slice(0, 12);
  if (aadhaarNumber.length === 12) {
    await saveKycDraft(req, partnerAuth, { aadhaar_number: aadhaarNumber });
  }

  let kycRow = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  if (!kycRow) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    kycRow = await findKycRegRow(req.catalystApp.zcql(), partnerRowId, partnerRow);
  }
  if (!kycRow) {
    const error = new Error("Complete your KYC details before submitting");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }

  assertSubmitReady(kycRow, partnerRow);

  const submittedAt = nowSql();
  const activatedAt = submittedAt;
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    submitted_at: submittedAt,
    rejection_reason: null,
    reviewed_at: activatedAt,
    reviewed_by: "SELF_KYC",
  });
  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    status: PARTNER_STATUS.ACTIVE,
    kyc_approved_at: activatedAt,
  });

  await writeDeliveryPartnerAudit(req, partnerAuth.delivery_partner_id, "KYC_SUBMIT", "Delivery_Partners", partnerRow.ROWID, {
    status: normalizePartnerStatus(partnerRow.status),
  }, {
    status: PARTNER_STATUS.ACTIVE,
    submitted_at: submittedAt,
    kyc_approved_at: activatedAt,
    activation_mode: "self_kyc",
  });

  const refreshedPartner = {
    ...partnerRow,
    status: PARTNER_STATUS.ACTIVE,
    kyc_approved_at: activatedAt,
  };
  return mapKycRow(
    {
      ...kycRow,
      submitted_at: submittedAt,
      reviewed_at: activatedAt,
      reviewed_by: "SELF_KYC",
      rejection_reason: null,
    },
    PARTNER_STATUS.ACTIVE,
    {
      partnerRow: refreshedPartner,
      partnerProfile: {
        age: partnerRow.age,
        qualification: partnerRow.qualification,
      },
    }
  );
}

async function uploadDocument(req, partnerAuth, body) {
  const partnerRowId = parseDeliveryPartnerId(partnerAuth.delivery_partner_id);
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  if (!isKycEditable(partnerRow.status)) {
    throw transitionError("Documents cannot be uploaded in the current account status");
  }

  let kycRow = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  if (!kycRow) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    kycRow = await findKycRegRow(req.catalystApp.zcql(), partnerRowId, partnerRow);
  }
  if (!kycRow) {
    const inserted = await req.catalystApp.datastore().table("Delivery_Partner_KYC").insertRow({
      delivery_partner_id: partnerRowId,
      partner_row_id: String(partnerRowId),
    });
    kycRow = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
    if (!kycRow && inserted && (inserted.ROWID || inserted.rowid)) {
      kycRow = {
        ROWID: inserted.ROWID || inserted.rowid,
        delivery_partner_id: partnerRowId,
        partner_row_id: String(partnerRowId),
      };
    }
  }
  if (!kycRow || !kycRow.ROWID) {
    throw validationError("Could not prepare KYC for this document. Please try again.");
  }

  const uploaded = await uploadKycDocument(req, partnerRowId, body);
  const prefix = documentFieldPrefix(uploaded.document_type);
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    [`${prefix}_file_id`]: uploaded.file_id,
    [`${prefix}_folder_id`]: uploaded.folder_id,
  });

  await writeDeliveryPartnerAudit(req, partnerAuth.delivery_partner_id, "KYC_DOCUMENT_UPLOAD", "Delivery_Partner_KYC", kycRow.ROWID, null, {
    document_type: uploaded.document_type,
    file_id: uploaded.file_id,
  });

  if (uploaded.document_type === "profile_photo") {
    try {
      await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
        ROWID: partnerRow.ROWID,
        profile_photo_url: "filestore:" + uploaded.file_id,
      });
    } catch (error) {
      console.error("[kyc] partner profile photo sync failed", error && error.message);
    }
  }

  const refreshed = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  return {
    document: uploaded,
    kyc: mapKycRow(refreshed || { ...kycRow, [`${prefix}_file_id`]: uploaded.file_id, [`${prefix}_folder_id`]: uploaded.folder_id }, partnerRow.status, { partnerRow }),
  };
}

async function deleteDocument(req, partnerAuth, documentType) {
  const type = String(documentType || "").trim().toLowerCase();
  if (!KYC_DOCUMENT_TYPES.has(type)) {
    throw validationError("Invalid document type");
  }
  const partnerRowId = parseDeliveryPartnerId(partnerAuth.delivery_partner_id);
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), partnerAuth.delivery_partner_id);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  if (!isKycEditable(partnerRow.status)) {
    throw transitionError("Documents cannot be deleted in the current account status");
  }

  let kycRow = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  if (!kycRow) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    kycRow = await findKycRegRow(req.catalystApp.zcql(), partnerRowId, partnerRow);
  }
  if (!kycRow || !kycRow.ROWID) {
    throw validationError("No KYC document found to delete");
  }

  const prefix = documentFieldPrefix(type);
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    [`${prefix}_file_id`]: "",
    [`${prefix}_folder_id`]: "",
  });

  await writeDeliveryPartnerAudit(
    req,
    partnerAuth.delivery_partner_id,
    "KYC_DOCUMENT_DELETE",
    "Delivery_Partner_KYC",
    kycRow.ROWID,
    { document_type: type },
    { document_type: type, deleted: true }
  );

  const refreshed = await findKycByPartnerRowId(req.catalystApp.zcql(), partnerRowId);
  return {
    deleted: true,
    document_type: type,
    kyc: mapKycRow(
      refreshed || { ...kycRow, [`${prefix}_file_id`]: "", [`${prefix}_folder_id`]: "" },
      partnerRow.status,
      { partnerRow }
    ),
  };
}

function parseFilestoreRef(value) {
  const match = String(value || "").trim().match(/^filestore:(\d+)$/i);
  return match ? match[1] : "";
}

async function resolveDocumentRefs(req, partnerRowId, documentType, partnerRow = null) {
  const zcql = req.catalystApp.zcql();
  const prefix = documentFieldPrefix(documentType);
  const { findKycRegRow } = require("./delivery-partner-registration");
  let kycRow = await findKycRegRow(zcql, partnerRowId, partnerRow);
  if (!kycRow) {
    try {
      kycRow = await findKycByPartnerRowId(zcql, partnerRowId);
    } catch (_) {}
  }

  let fileId = kycRow && kycRow[`${prefix}_file_id`] ? String(kycRow[`${prefix}_file_id`]) : "";
  let folderId =
    kycRow && kycRow[`${prefix}_folder_id`] ? String(kycRow[`${prefix}_folder_id`]) : "";

  if (documentType === "profile_photo" && !fileId) {
    const partner =
      partnerRow ||
      (await findPartnerRow(zcql, formatDeliveryPartnerId(partnerRowId)));
    fileId = parseFilestoreRef(partner && partner.profile_photo_url);
  }

  if (fileId && !folderId) {
    try {
      folderId = resolveKycFolderId();
    } catch (_) {}
  }

  return { fileId, folderId };
}

async function downloadDocument(req, partnerAuth, documentType, { admin = false, targetPartnerId = "" } = {}) {
  const partnerId = admin ? targetPartnerId : partnerAuth.delivery_partner_id;
  const partnerRowId = parseDeliveryPartnerId(partnerId);
  const partnerRow = admin ? null : await findPartnerRow(req.catalystApp.zcql(), partnerId);
  const { fileId, folderId } = await resolveDocumentRefs(
    req,
    partnerRowId,
    documentType,
    partnerRow
  );
  if (!fileId || !folderId) {
    const error = new Error("Document not found");
    error.status = 404;
    throw error;
  }
  const folder = req.catalystApp.filestore().folder(String(folderId));
  const buffer = await folder.downloadFile(String(fileId));
  return { buffer, fileId: String(fileId), folderId: String(folderId) };
}

async function adminGetKyc(req, deliveryPartnerId) {
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const kycRow = await findKycByPartnerRowId(
    req.catalystApp.zcql(),
    parseDeliveryPartnerId(deliveryPartnerId)
  );
  const { mapPartnerPhotoUrls } = require("./delivery-partner-photo");
  const photo = mapPartnerPhotoUrls(String(partnerRow.ROWID), partnerRow, kycRow, {
    scope: "admin",
  });
  return {
    delivery_partner_id: formatDeliveryPartnerId(partnerRow.ROWID),
    phone: partnerRow.phone || "",
    outlet_id: partnerRow.outlet_id != null ? String(partnerRow.outlet_id) : "",
    partner_status: normalizePartnerStatus(partnerRow.status),
    first_name: partnerRow.first_name || kycRow?.first_name || "",
    last_name: partnerRow.last_name || kycRow?.last_name || "",
    profile_photo_url: photo.profile_photo_url,
    has_profile_photo: photo.has_profile_photo,
    profile_photo_fetch_url: photo.profile_photo_fetch_url,
    kyc: mapKycRow(kycRow, partnerRow.status, { adminView: true }),
  };
}

async function adminApproveKyc(req, deliveryPartnerId, reviewer) {
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const status = normalizePartnerStatus(partnerRow.status);
  if (
    status !== PARTNER_STATUS.KYC_SUBMITTED &&
    status !== PARTNER_STATUS.KYC_UNDER_REVIEW &&
    status !== PARTNER_STATUS.KYC_APPROVED
  ) {
    throw transitionError("Only submitted KYC can be approved");
  }
  let kycRow = await findKycByPartnerRowId(
    req.catalystApp.zcql(),
    parseDeliveryPartnerId(deliveryPartnerId)
  );
  if (!kycRow) {
    const { findKycRegRow } = require("./delivery-partner-registration");
    kycRow = await findKycRegRow(
      req.catalystApp.zcql(),
      parseDeliveryPartnerId(deliveryPartnerId),
      partnerRow
    );
  }
  if (!kycRow || !kycRow.submitted_at) {
    throw transitionError("KYC has not been submitted");
  }

  const reviewedAt = nowSql();
  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    status: PARTNER_STATUS.ACTIVE,
    kyc_approved_at: reviewedAt,
  });
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    reviewed_at: reviewedAt,
    reviewed_by: reviewer,
    rejection_reason: null,
  });

  await writeDeliveryPartnerAudit(req, deliveryPartnerId, "KYC_APPROVE", "Delivery_Partners", partnerRow.ROWID, {
    status,
  }, {
    status: PARTNER_STATUS.ACTIVE,
    reviewed_by: reviewer,
    reviewed_at: reviewedAt,
  });

  return adminGetKyc(req, deliveryPartnerId);
}

async function adminRejectKyc(req, deliveryPartnerId, reviewer, reason) {
  const partnerRow = await findPartnerRow(req.catalystApp.zcql(), deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const status = normalizePartnerStatus(partnerRow.status);
  if (
    status !== PARTNER_STATUS.KYC_SUBMITTED &&
    status !== PARTNER_STATUS.KYC_UNDER_REVIEW
  ) {
    throw transitionError("Only submitted KYC can be rejected");
  }
  const rejectionReason = String(reason || "").trim().slice(0, 255);
  if (rejectionReason.length < 5) {
    const error = new Error("Rejection reason must be at least 5 characters");
    error.status = 422;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  const kycRow = await findKycByPartnerRowId(
    req.catalystApp.zcql(),
    parseDeliveryPartnerId(deliveryPartnerId)
  );
  if (!kycRow) {
    const error = new Error("KYC record not found");
    error.status = 404;
    throw error;
  }

  const reviewedAt = nowSql();
  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    status: PARTNER_STATUS.KYC_REJECTED,
  });
  await req.catalystApp.datastore().table("Delivery_Partner_KYC").updateRow({
    ROWID: kycRow.ROWID,
    reviewed_at: reviewedAt,
    reviewed_by: reviewer,
    rejection_reason: rejectionReason,
  });

  await writeDeliveryPartnerAudit(req, deliveryPartnerId, "KYC_REJECT", "Delivery_Partners", partnerRow.ROWID, {
    status,
  }, {
    status: PARTNER_STATUS.KYC_REJECTED,
    reviewed_by: reviewer,
    reviewed_at: reviewedAt,
    rejection_reason: rejectionReason,
  });

  return adminGetKyc(req, deliveryPartnerId);
}

async function refreshPartnerSessionToken(req, partnerAuth) {
  const partner = await findDeliveryPartnerById(
    req.catalystApp.zcql(),
    partnerAuth.delivery_partner_id
  );
  if (!partner) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  return signSession(deliveryPartnerSessionPayload(partner));
}

module.exports = {
  findKycByPartnerRowId,
  getKycBundle,
  saveKycDraft,
  submitKyc,
  uploadDocument,
  deleteDocument,
  downloadDocument,
  resolveDocumentRefs,
  parseFilestoreRef,
  adminGetKyc,
  adminApproveKyc,
  adminRejectKyc,
  refreshPartnerSessionToken,
  assertUniqueIdentity,
  isPartnerOperational,
};
