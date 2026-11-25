"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  validateCoordinateRange,
  parseLocation,
  requireCoordinates,
} = require("../lib/geo-coords");

describe("geo coordinate validation", () => {
  it("accepts valid Ranchi test coordinates", () => {
    const parsed = parseLocation(23.3782, 85.3315);
    assert.deepEqual(parsed, { latitude: 23.3782, longitude: 85.3315 });
  });

  it("rejects missing coordinates", () => {
    assert.equal(parseLocation(null, 85.3315), null);
    assert.equal(parseLocation(23.3782, ""), null);
  });

  it("rejects out-of-range latitude and longitude", () => {
    assert.equal(parseLocation(91, 0), null);
    assert.equal(parseLocation(-91, 0), null);
    assert.equal(parseLocation(0, 181), null);
    assert.equal(parseLocation(0, -181), null);
  });

  it("requireCoordinates throws for invalid pairs", () => {
    assert.throws(
      () => requireCoordinates(999, 85.3315),
      (error) => error.code === "INVALID_COORDINATES"
    );
    assert.throws(
      () => requireCoordinates(undefined, 85.3315),
      (error) => error.status === 400
    );
    assert.throws(
      () => requireCoordinates(23.3782, undefined),
      (error) => error.status === 400
    );
  });

  it("validateCoordinateRange guards NaN", () => {
    assert.equal(validateCoordinateRange(Number.NaN, 1), false);
    assert.equal(validateCoordinateRange(1, Number.NaN), false);
  });

  it("treats null latitude/longitude as missing, not 0,0", () => {
    assert.equal(parseLocation(null, null), null);
    assert.equal(parseLocation(null, 85.3315), null);
    assert.equal(parseLocation(23.3782, null), null);
  });
});
