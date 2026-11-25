"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  partnerHasStoredPhoto,
  employeeProfilePhotoPath,
  adminProfilePhotoPath,
  customerBookingPhotoPath,
  mapPartnerPhotoUrls,
  detectImageContentType,
} = require("../lib/delivery-partner-photo");

describe("delivery partner photo", () => {
  it("detects stored photos from KYC file id or filestore ref", () => {
    assert.equal(partnerHasStoredPhoto(null, { profile_photo_file_id: "123" }), true);
    assert.equal(
      partnerHasStoredPhoto({ profile_photo_url: "filestore:abc" }, null),
      true
    );
    assert.equal(
      partnerHasStoredPhoto({ profile_photo_url: "https://cdn.example/photo.jpg" }, null),
      true
    );
    assert.equal(partnerHasStoredPhoto({ profile_photo_url: "" }, null), false);
  });

  it("builds scoped fetch URLs for employee, admin, and customer", () => {
    const partnerRow = { profile_photo_url: "filestore:abc" };
    const kycRow = { profile_photo_file_id: "123" };

    const employee = mapPartnerPhotoUrls("42", partnerRow, kycRow, { scope: "employee" });
    assert.equal(employee.has_profile_photo, true);
    assert.equal(employee.profile_photo_fetch_url, employeeProfilePhotoPath());

    const admin = mapPartnerPhotoUrls("42", partnerRow, kycRow, { scope: "admin" });
    assert.equal(admin.profile_photo_fetch_url, adminProfilePhotoPath("42"));

    const customer = mapPartnerPhotoUrls("42", partnerRow, kycRow, {
      scope: "customer",
      booking_row_id: "99",
    });
    assert.equal(customer.profile_photo_fetch_url, customerBookingPhotoPath("99"));
  });

  it("returns direct http URL without fetch path", () => {
    const mapped = mapPartnerPhotoUrls(
      "42",
      { profile_photo_url: "https://cdn.example/photo.jpg" },
      null,
      { scope: "employee" }
    );
    assert.equal(mapped.profile_photo_url, "https://cdn.example/photo.jpg");
    assert.equal(mapped.profile_photo_fetch_url, "");
    assert.equal(mapped.has_profile_photo, true);
  });

  it("detects image content types from magic bytes", () => {
    assert.equal(detectImageContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47])), "image/png");
    assert.equal(detectImageContentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
    assert.equal(detectImageContentType(Buffer.from([0x00, 0x00])), "image/jpeg");
  });
});
