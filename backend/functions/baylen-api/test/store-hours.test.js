"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  parseHm,
  isStoreOpenNow,
  isMinutesWithinBusinessWindow,
  OUTLET_BUSINESS_TIMEZONE,
} = require("../lib/fulfillment-engine");

function dateAtIst(y, month, day, hour, minute) {
  const utcMs =
    Date.UTC(y, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

const outletAmPm = {
  opening_time: "10:00 AM",
  closing_time: "9:00 PM",
};

const outlet24h = {
  opening_time: "10:00",
  closing_time: "21:00",
};

describe("parseHm", () => {
  it("parses 24-hour clock values", () => {
    assert.equal(parseHm("10:00"), 600);
    assert.equal(parseHm("21:00"), 1260);
  });

  it("parses 12-hour clock values with AM/PM", () => {
    assert.equal(parseHm("10:00 AM"), 600);
    assert.equal(parseHm("9:00 PM"), 1260);
    assert.equal(parseHm("12:00 AM"), 0);
    assert.equal(parseHm("12:00 PM"), 720);
  });

  it("returns null for invalid time", () => {
    assert.equal(parseHm("25:00"), null);
    assert.equal(parseHm("9:99 PM"), null);
    assert.equal(parseHm("not-a-time"), null);
    assert.equal(parseHm(""), null);
  });
});

describe("isStoreOpenNow — 10:00 AM – 9:00 PM", () => {
  it("A/B format variants behave the same", () => {
    const atOpen = dateAtIst(2026, 9, 3, 10, 0);
    assert.equal(isStoreOpenNow(outletAmPm, atOpen), true);
    assert.equal(isStoreOpenNow(outlet24h, atOpen), true);
  });

  it("C before opening is closed", () => {
    assert.equal(isStoreOpenNow(outletAmPm, dateAtIst(2026, 9, 3, 9, 59)), false);
  });

  it("D during business hours is open", () => {
    assert.equal(isStoreOpenNow(outletAmPm, dateAtIst(2026, 9, 3, 14, 0)), true);
    assert.equal(isStoreOpenNow(outletAmPm, dateAtIst(2026, 9, 3, 20, 59)), true);
  });

  it("E at closing time is closed", () => {
    assert.equal(isStoreOpenNow(outletAmPm, dateAtIst(2026, 9, 3, 21, 0)), false);
  });
});

describe("isStoreOpenNow — midnight-crossing schedule", () => {
  const overnight = { opening_time: "22:00", closing_time: "02:00" };

  it("F remains open after midnight until close", () => {
    assert.equal(isStoreOpenNow(overnight, dateAtIst(2026, 9, 3, 23, 30)), true);
    assert.equal(isStoreOpenNow(overnight, dateAtIst(2026, 9, 4, 1, 59)), true);
    assert.equal(isStoreOpenNow(overnight, dateAtIst(2026, 9, 4, 2, 0)), false);
  });
});

describe("isStoreOpenNow — invalid and missing hours", () => {
  it("G invalid time is closed", () => {
    assert.equal(
      isStoreOpenNow({ opening_time: "bad", closing_time: "9:00 PM" }, dateAtIst(2026, 9, 3, 14, 0)),
      false
    );
  });

  it("H missing time is closed", () => {
    assert.equal(isStoreOpenNow({ opening_time: "", closing_time: "9:00 PM" }, dateAtIst(2026, 9, 3, 14, 0)), false);
    assert.equal(isStoreOpenNow({ opening_time: "10:00 AM" }, dateAtIst(2026, 9, 3, 14, 0)), false);
  });
});

describe("Asia/Kolkata timezone", () => {
  it("I uses Asia/Kolkata by default", () => {
    assert.equal(OUTLET_BUSINESS_TIMEZONE, "Asia/Kolkata");
    const istMorning = dateAtIst(2026, 9, 3, 11, 0);
    assert.equal(isStoreOpenNow(outletAmPm, istMorning), true);

    // Same instant expressed as UTC noon would be 17:30 IST — still open.
    const utcNoon = new Date(Date.UTC(2026, 8, 3, 12, 0, 0));
    assert.equal(isStoreOpenNow(outletAmPm, utcNoon), true);
  });
});

describe("isMinutesWithinBusinessWindow", () => {
  it("uses a half-open interval for same-day windows", () => {
    assert.equal(isMinutesWithinBusinessWindow(599, 600, 1260), false);
    assert.equal(isMinutesWithinBusinessWindow(600, 600, 1260), true);
    assert.equal(isMinutesWithinBusinessWindow(1259, 600, 1260), true);
    assert.equal(isMinutesWithinBusinessWindow(1260, 600, 1260), false);
  });
});
