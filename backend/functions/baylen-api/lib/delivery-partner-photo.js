"use strict";

const { rowOf, asId } = require("./http");
const { formatDeliveryPartnerId, parseDeliveryPartnerId } = require("./delivery-partner");
const {
  downloadDocument,
  resolveDocumentRefs,
  parseFilestoreRef,
} = require("./delivery-partner-kyc-engine");
const { findKycRegRow } = require("./delivery-partner-registration");

function partnerHasStoredPhoto(partnerRow, kycRow) {
  if (!partnerRow && !kycRow) {
    return false;
  }
  if (kycRow?.profile_photo_file_id) {
    return true;
  }
  if (String(partnerRow?.profile_photo_url || "").startsWith("filestore:")) {
    return true;
  }
  if (String(partnerRow?.profile_photo_url || "").startsWith("http")) {
    return true;
  }
  return false;
}

function employeeProfilePhotoPath() {
  // Static path — Dev API Gateway does not route {documentType} path params.
  return "/v1/delivery-partner/profile-photo";
}

function adminProfilePhotoPath(deliveryPartnerId) {
  const id = formatDeliveryPartnerId(parseDeliveryPartnerId(deliveryPartnerId));
  return "/v1/admin/delivery-partners/" + encodeURIComponent(id) + "/kyc/documents/profile_photo";
}

function customerBookingPhotoPath(bookingRowId) {
  return "/v1/at-home-beauty/bookings/" + encodeURIComponent(String(bookingRowId)) + "/professional-photo";
}

function mapPartnerPhotoUrls(partnerRowId, partnerRow, kycRow, options = {}) {
  const hasPhoto = partnerHasStoredPhoto(partnerRow, kycRow);
  const directUrl = String(partnerRow?.profile_photo_url || "").trim();
  const httpUrl = directUrl.startsWith("http") ? directUrl : "";
  const scope = options.scope || "public";
  let profile_photo_fetch_url = "";
  if (hasPhoto && !httpUrl) {
    if (scope === "employee") {
      profile_photo_fetch_url = employeeProfilePhotoPath();
    } else if (scope === "admin") {
      profile_photo_fetch_url = adminProfilePhotoPath(partnerRowId);
    } else if (scope === "customer" && options.booking_row_id) {
      profile_photo_fetch_url = customerBookingPhotoPath(options.booking_row_id);
    }
  }
  return {
    profile_photo_url: httpUrl || directUrl,
    has_profile_photo: hasPhoto,
    profile_photo_fetch_url,
  };
}

function detectImageContentType(buffer) {
  if (!buffer || buffer.length < 4) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF") {
    return "image/webp";
  }
  return "image/jpeg";
}

async function fetchPartnerProfilePhotoBuffer(req, partnerRowId) {
  const refs = await resolveDocumentRefs(req, partnerRowId, "profile_photo");
  if (!refs.fileId || !refs.folderId) {
    const error = new Error("Profile photo not found");
    error.status = 404;
    throw error;
  }
  const buffer = await req.catalystApp
    .filestore()
    .folder(String(refs.folderId))
    .downloadFile(String(refs.fileId));
  return { buffer, fileId: String(refs.fileId), folderId: String(refs.folderId) };
}

async function streamPartnerProfilePhoto(req, res, partnerRowId, options = {}) {
  let file;
  if (options.admin) {
    file = await downloadDocument(req, null, "profile_photo", {
      admin: true,
      targetPartnerId: formatDeliveryPartnerId(partnerRowId),
    });
  } else if (options.internal) {
    file = await fetchPartnerProfilePhotoBuffer(req, partnerRowId);
  } else {
    file = await downloadDocument(req, options.partnerAuth, "profile_photo");
  }
  const contentType = detectImageContentType(file.buffer);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).send(file.buffer);
}

async function loadPartnerPhotoBundle(zcql, partnerRowId, partnerRow = null) {
  const row =
    partnerRow ||
    rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, profile_photo_url, first_name, last_name FROM Delivery_Partners WHERE ROWID = " +
          asId(partnerRowId, "partner_id")
      ),
      "Delivery_Partners"
    );
  const kyc = await findKycRegRow(zcql, String(partnerRowId), row);
  return { partnerRow: row, kycRow: kyc, photo: mapPartnerPhotoUrls(partnerRowId, row, kyc) };
}

async function assertCustomerOwnsBooking(zcql, bookingRowId, userId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, user_id, delivery_partner_row_id FROM Service_Jobs WHERE ROWID = " +
        asId(bookingRowId, "booking_id")
    ),
    "Service_Jobs"
  );
  if (!row || String(row.user_id) !== String(userId)) {
    const error = new Error("Booking not found");
    error.status = 404;
    throw error;
  }
  return row;
}

module.exports = {
  partnerHasStoredPhoto,
  employeeProfilePhotoPath,
  adminProfilePhotoPath,
  customerBookingPhotoPath,
  mapPartnerPhotoUrls,
  detectImageContentType,
  fetchPartnerProfilePhotoBuffer,
  streamPartnerProfilePhoto,
  loadPartnerPhotoBundle,
  assertCustomerOwnsBooking,
  parseFilestoreRef,
  resolveDocumentRefs,
};
