"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  zoneRowMatches,
  buildZoneLabel,
  pickZoneLabelFromRows,
} = require("../lib/service-zone-resolve");

describe("service zone resolve", () => {
  it("matches beauty zones by city and pincode prefix", () => {
    const zones = [
      { city: "Ranchi", state: "Jharkhand", pincode_prefix: "834", is_active: true },
      { city: "Bengaluru", state: "Karnataka", pincode_prefix: "560", is_active: true },
    ];
    assert.equal(
      pickZoneLabelFromRows(zones, {
        visit_city: "Ranchi",
        visit_state: "Jharkhand",
        pincode: "834001",
      }),
      "Ranchi · PIN 834"
    );
  });

  it("falls back to district label when no zone rows match", () => {
    const label = buildZoneLabel(null, {
      visit_city: "Mumbai",
      visit_district: "Andheri",
      pincode: "400053",
    });
    assert.equal(label, "Mumbai · Andheri");
  });

  it("rejects zones outside state", () => {
    assert.equal(
      zoneRowMatches(
        { city: "Ranchi", state: "Jharkhand", pincode_prefix: "834", is_active: true },
        { visit_city: "Patna", visit_state: "Bihar", pincode: "800001" }
      ),
      false
    );
  });
});
