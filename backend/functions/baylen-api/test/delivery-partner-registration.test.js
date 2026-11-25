"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  REGISTRATION_PHASE,
  normalizeRegistrationPhase,
  inferRegistrationPhase,
  validatePasswordPair,
  hashPassword,
  verifyPassword,
  savePersonalProfile,
} = require("../lib/delivery-partner-registration");

describe("delivery partner registration", () => {
  it("normalizes registration phases", () => {
    assert.equal(normalizeRegistrationPhase("profile_complete"), REGISTRATION_PHASE.PROFILE_COMPLETE);
    assert.equal(normalizeRegistrationPhase(""), REGISTRATION_PHASE.OTP_VERIFIED);
  });

  it("validates password rules", () => {
    assert.throws(
      () => validatePasswordPair("short1!", "short1!"),
      (error) => error.status === 422
    );
    const password = validatePasswordPair("Secure1!", "Secure1!");
    assert.equal(password, "Secure1!");
  });

  it("hashes and verifies passwords", () => {
    const { salt, hash } = hashPassword("Secure1!");
    assert.equal(verifyPassword("Secure1!", salt, hash), true);
    assert.equal(verifyPassword("Wrong1!", salt, hash), false);
  });

  it("infers registration phase from stored profile data", () => {
    assert.equal(
      inferRegistrationPhase({
        first_name: "A",
        address_line1: "Home",
        postal_code: "834001",
      }),
      REGISTRATION_PHASE.PROFILE_COMPLETE
    );
    assert.equal(
      inferRegistrationPhase({
        registration_phase: "otp_verified",
        first_name: "A",
        address_line1: "Home",
        postal_code: "834001",
      }),
      REGISTRATION_PHASE.PROFILE_COMPLETE
    );
    assert.equal(
      inferRegistrationPhase({
        selfie_file_id: "file-1",
        selfie_folder_id: "folder-1",
      }),
      REGISTRATION_PHASE.PHOTOS_COMPLETE
    );
    assert.equal(
      inferRegistrationPhase({
        passport_photo_file_id: "file-2",
        passport_photo_folder_id: "folder-2",
      }),
      REGISTRATION_PHASE.PHOTOS_COMPLETE
    );
    assert.equal(inferRegistrationPhase({}), REGISTRATION_PHASE.OTP_VERIFIED);
  });

  it("saves personal profile into partner and KYC tables", async () => {
    const tables = { Delivery_Partners: [], Delivery_Partner_KYC: [] };
    const app = {
      zcql() {
        return {
          async executeZCQLQuery(query) {
            const sql = String(query);
            if (sql.includes("FROM Outlets")) {
              return [{ Outlets: { ROWID: "10", name: "Baylen", city: "Ranchi", state: "Jharkhand", is_active: true } }];
            }
            if (sql.includes("FROM Delivery_Partners")) {
              return [{ Delivery_Partners: { ROWID: "55", phone: "+919999999999", status: "pending_kyc" } }];
            }
            if (sql.includes("FROM Delivery_Partner_KYC")) {
              return [];
            }
            if (sql.includes("FROM Warehouses")) {
              return [];
            }
            if (sql.includes("Serviceable_Pincodes")) {
              return [];
            }
            return [];
          },
        };
      },
      datastore() {
        return {
          table(name) {
            return {
              async updateRow(row) {
                tables[name].push(row);
                return row;
              },
              async insertRow(row) {
                const next = { ROWID: String(tables[name].length + 1), ...row };
                tables[name].push(next);
                return next;
              },
            };
          },
        };
      },
    };
    const result = await savePersonalProfile(
      { catalystApp: app },
      { delivery_partner_id: "dp_55" },
      {
        first_name: "Ravi",
        last_name: "Singh",
        age: 28,
        date_of_birth: "1998-01-15",
        gender: "MALE",
        email: "ravi@example.com",
        state: "Jharkhand",
        district: "Ranchi",
        pincode: "834001",
        address_line1: "Main Road",
      }
    );
    assert.equal(tables.Delivery_Partners.some((row) => row.first_name === "Ravi"), true);
    assert.equal(tables.Delivery_Partner_KYC.length, 1);
    assert.equal(tables.Delivery_Partner_KYC[0].email, "ravi@example.com");
  });

  it("finds legacy KYC rows linked by truncated delivery_partner_id", async () => {
    const { findKycRegRow } = require("../lib/delivery-partner-registration");
    const partnerRowId = "36851000000403039";
    const zcql = {
      async executeZCQLQuery(query) {
        const sql = String(query);
        if (sql.includes("partner_row_id = '36851000000403039'")) {
          return [];
        }
        if (sql.includes("delivery_partner_id = 36851000000403039")) {
          return [];
        }
        if (sql.includes("FROM Delivery_Partners WHERE ROWID = 36851000000403039")) {
          return [
            {
              Delivery_Partners: {
                ROWID: partnerRowId,
                first_name: "Priya",
                last_name: "singh",
                phone: "+918825391754",
              },
            },
          ];
        }
        if (
          sql.includes("delivery_partner_id = 3685100000") &&
          sql.includes("first_name = 'Priya'")
        ) {
          return [
            {
              Delivery_Partner_KYC: {
                ROWID: "36851000000406034",
                delivery_partner_id: "3685100000",
                first_name: "Priya",
                last_name: "singh",
                address_line1: "Doranda",
                postal_code: "834001",
                registration_phase: "profile_complete",
              },
            },
          ];
        }
        return [];
      },
    };

    const kyc = await findKycRegRow(zcql, partnerRowId);
    assert.equal(kyc?.address_line1, "Doranda");
    assert.equal(kyc?.registration_phase, "profile_complete");
    assert.equal(kyc?.partner_row_id, partnerRowId);
  });
});
