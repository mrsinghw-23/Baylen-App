"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  formatDeliveryPartnerId,
  parseDeliveryPartnerId,
  mapDeliveryPartner,
  deliveryPartnerSessionPayload,
} = require("../lib/delivery-partner");
const { buildLeadsQuery } = require("../routes/delivery-partner");

describe("delivery partner identity", () => {
  it("formats and parses delivery partner ids", () => {
    assert.equal(formatDeliveryPartnerId("1029"), "dp_1029");
    assert.equal(parseDeliveryPartnerId("dp_1029"), "1029");
    assert.equal(parseDeliveryPartnerId("1029"), "1029");
  });

  it("maps datastore rows into API shape", () => {
    const mapped = mapDeliveryPartner({
      ROWID: "55",
      phone: "+919876543210",
      outlet_id: "4",
      status: "pending_profile",
      first_name: "",
      last_name: "",
    });
    assert.equal(mapped.delivery_partner_id, "dp_55");
    assert.equal(mapped.phone, "+919876543210");
    assert.equal(mapped.outlet_id, "4");
  });

  it("builds outlet-scoped lead queries with bigint-safe partner refs", () => {
    const longPartnerId = "36851000000379403";
    const longOutletId = "36851000000370001";
    const available = buildLeadsQuery(
      {
        delivery_partner_id: "dp_" + longPartnerId,
        outlet_id: longOutletId,
        outlet_row_id: longOutletId,
      },
      "available"
    );
    assert.match(available, /outlet_row_id = 36851000000370001/);
    assert.match(available, /delivery_partner_row_id IS NULL/);

    const accepted = buildLeadsQuery(
      {
        delivery_partner_id: "dp_" + longPartnerId,
        outlet_id: longOutletId,
        outlet_row_id: longOutletId,
      },
      "accepted"
    );
    assert.match(accepted, /delivery_partner_row_id = 36851000000379403/);
  });

  it("creates independent session payloads per partner phone", () => {
    const payload = deliveryPartnerSessionPayload({
      delivery_partner_id: "dp_1",
      phone: "+919876543210",
      outlet_id: "",
      status: "pending_profile",
    });
    assert.equal(payload.role, "delivery_partner");
    assert.equal(payload.sub, "dp_1");
    assert.equal(payload.phone, "+919876543210");
  });
});
