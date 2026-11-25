"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  signSession,
  verifySession,
  sessionRole,
  requireRole,
  requireUser,
  requireDeliveryPartner,
} = require("../lib/session");

function mockReq(token) {
  return {
    headers: token ? { "x-baylen-token": token } : {},
  };
}

describe("role guard session", () => {
  it("treats tokens without role claim as customer", () => {
    const token = signSession({ user_id: "42", mobile: "+919876543210" });
    const session = verifySession(token);
    assert.equal(sessionRole(session), "customer");
  });

  it("requireRole rejects mismatched role with 403 FORBIDDEN_ROLE", () => {
    const customerToken = signSession({ user_id: "42", role: "customer" });
    const dpToken = signSession({
      role: "delivery_partner",
      delivery_partner_id: "dp_9",
      sub: "dp_9",
      phone: "+919876543210",
    });

    assert.throws(
      () => requireRole(mockReq(customerToken), "delivery_partner"),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
    assert.throws(
      () => requireRole(mockReq(dpToken), "customer"),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
  });

  it("requireUser rejects delivery partner tokens", () => {
    const dpToken = signSession({
      role: "delivery_partner",
      delivery_partner_id: "dp_9",
      sub: "dp_9",
      phone: "+919876543210",
    });
    assert.throws(
      () => requireUser(mockReq(dpToken)),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
  });

  it("requireDeliveryPartner rejects customer tokens", () => {
    const customerToken = signSession({ user_id: "42", role: "customer" });
    assert.throws(
      () => requireDeliveryPartner(mockReq(customerToken)),
      (error) => error.status === 403 && error.code === "FORBIDDEN_ROLE"
    );
  });

  it("accepts matching role sessions", () => {
    const customerToken = signSession({ user_id: "42", role: "customer", mobile: "+911" });
    const customer = requireUser(mockReq(customerToken));
    assert.equal(customer.user_id, "42");

    const dpToken = signSession({
      role: "delivery_partner",
      delivery_partner_id: "dp_9",
      sub: "dp_9",
      phone: "+919876543210",
      outlet_id: "4",
      status: "pending_profile",
    });
    const partner = requireDeliveryPartner(mockReq(dpToken));
    assert.equal(partner.delivery_partner_id, "dp_9");
    assert.equal(partner.status, "pending_profile");
  });
});
