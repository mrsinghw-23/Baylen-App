"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  pickBestOffice,
  mapOfficeToLocation,
} = require("../lib/postal-pincode-lookup");

describe("postal pincode lookup", () => {
  it("prefers delivery head post office", () => {
    const offices = [
      { Name: "Church Road", BranchType: "Sub Post Office", DeliveryStatus: "Non-Delivery", District: "Ranchi", Block: "Ranchi", State: "Jharkhand" },
      { Name: "Ranchi", BranchType: "Head Post Office", DeliveryStatus: "Delivery", District: "Ranchi", Block: "Ranchi", State: "Jharkhand" },
    ];
    const picked = pickBestOffice(offices);
    assert.equal(picked.Name, "Ranchi");
  });

  it("maps office to city/state/district", () => {
    const mapped = mapOfficeToLocation("834001", {
      Name: "Ranchi",
      Block: "Ranchi",
      District: "Ranchi",
      State: "Jharkhand",
      DeliveryStatus: "Delivery",
    });
    assert.equal(mapped.city, "Ranchi");
    assert.equal(mapped.state, "Jharkhand");
    assert.equal(mapped.district, "Ranchi");
    assert.equal(mapped.area, "Ranchi");
  });
});
