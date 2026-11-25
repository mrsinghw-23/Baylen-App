"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  nationalDigits,
  canonicalMobile,
  phoneLookupKeys,
  phonesMatch,
  pickOldestUser,
  identityFromSession,
} = require("../lib/phone-identity");

describe("phone identity", () => {
  it("normalizes Indian numbers into one canonical +91 format", () => {
    assert.equal(canonicalMobile("9876543210"), "+919876543210");
    assert.equal(canonicalMobile("+91 98765 43210"), "+919876543210");
    assert.equal(canonicalMobile("919876543210"), "+919876543210");
    assert.equal(canonicalMobile("09876543210"), "+919876543210");
  });

  it("treats format variants as the same phone", () => {
    assert.equal(phonesMatch("+919876543210", "9876543210"), true);
    assert.equal(phonesMatch("919876543210", "09876543210"), true);
    assert.equal(phonesMatch("9876543210", "9876543211"), false);
  });

  it("looks up every stored format for the last 10 digits", () => {
    const keys = phoneLookupKeys("+91-98765-43210");
    assert.deepEqual(keys.sort(), ["09876543210", "919876543210", "9876543210", "+919876543210"].sort());
    assert.equal(nationalDigits("+919876543210"), "9876543210");
  });

  it("reuses the oldest user when duplicate phone rows exist", () => {
    const chosen = pickOldestUser([
      { ROWID: "2", CREATEDTIME: "2026-04-01 10:00:00" },
      { ROWID: "1", CREATEDTIME: "2025-01-01 09:00:00" },
      { ROWID: "3", CREATEDTIME: "2026-08-01 12:00:00" },
    ]);
    assert.equal(chosen.ROWID, "1");
  });

  it("creates no user identity from a client-supplied phone number", () => {
    const sessionUser = { user_id: "111" };
    const recoveredId = identityFromSession(
      sessionUser,
      { phone: "+919999999999", user_id: "222" },
      { mobile: "8888888888", user_id: "333" }
    );
    assert.equal(recoveredId, "111");
  });

  it("rejects recovery without a signed-in session user", () => {
    assert.throws(() => identityFromSession(null, { phone: "9876543210" }), /Sign in required/);
    assert.throws(() => identityFromSession({}, {}), /Sign in required/);
  });
});
