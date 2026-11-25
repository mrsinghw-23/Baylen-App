"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const RULES_PATH = path.resolve(__dirname, "../../../catalyst-user-rules.json");

const REQUIRED_AT_HOME_ROUTES = [
  "/v1/at-home-beauty/serviceability",
  "/v1/at-home-beauty/providers",
  "/v1/at-home-beauty/addons",
  "/v1/at-home-beauty/slots",
  "/v1/at-home-beauty/quote",
  "/v1/at-home-beauty/bookings",
  "/v1/at-home-beauty/bookings/cancel",
  "/v1/at-home-beauty/bookings/reschedule",
  "/v1/at-home-beauty/bookings/confirm-payment",
  "/v1/at-home-beauty/bookings/extra-services/respond",
  "/v1/at-home-beauty/bookings/tracking",
];

describe("at-home-beauty API gateway routes", () => {
  it("registers every customer at-home endpoint in catalyst-user-rules.json", () => {
    const rules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
    const endpoints = new Set(rules.map((rule) => rule.source_endpoint));
    for (const route of REQUIRED_AT_HOME_ROUTES) {
      assert.equal(
        endpoints.has(route),
        true,
        `Missing API gateway route for ${route}`
      );
    }
  });
});
