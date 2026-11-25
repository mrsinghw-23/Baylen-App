"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  citiesMatch,
  cityKey,
  genderMatches,
  staffGenderMatches,
  pickPriceRow,
  generateDaySlots,
  slotsOverlap,
  parseClock,
  groupServiceOffers,
  filterOutletsByLocation,
} = require("../lib/salon-engine");

describe("salon location matching", () => {
  it("matches Delhi aliases and rejects other cities", () => {
    assert.equal(cityKey("Delhi NCR"), "delhi");
    assert.equal(citiesMatch("Delhi", "New Delhi"), true);
    assert.equal(citiesMatch("Delhi", "Ranchi"), false);
    assert.equal(citiesMatch("Mumbai", "Bombay"), true);
    assert.equal(citiesMatch("Ranchi", "Mumbai"), false);
  });

  it("filters outlets on the server by city before any client display", () => {
    const rows = [
      { ROWID: "1", name: "Royal Looks", city: "Delhi", is_active: true, latitude: 28.6, longitude: 77.2 },
      { ROWID: "2", name: "Diamond Luxe", city: "New Delhi", is_active: true, latitude: 28.63, longitude: 77.21 },
      { ROWID: "3", name: "ABC Salon", city: "Mumbai", is_active: true, latitude: 19.07, longitude: 72.87 },
      { ROWID: "4", name: "XYZ Salon", city: "Ranchi", is_active: true, latitude: 23.36, longitude: 85.33 },
      { ROWID: "5", name: "Closed Delhi", city: "Delhi", is_active: false, latitude: 28.6, longitude: 77.2 },
    ];
    const delhi = filterOutletsByLocation(rows, { city: "Delhi" }).map((item) => item.row.name);
    assert.deepEqual(delhi, ["Royal Looks", "Diamond Luxe"]);
  });

  it("does not treat missing coordinates as 0,0", () => {
    const rows = [
      { ROWID: "1", name: "Near Null Island", city: "Test", is_active: true, latitude: 0.1, longitude: 0.1 },
      { ROWID: "2", name: "Ranchi Salon", city: "Ranchi", is_active: true, latitude: 23.36, longitude: 85.33 },
    ];
    const filtered = filterOutletsByLocation(rows, { lat: null, lng: null, radius_km: 5 });
    assert.equal(filtered.length, 2);
  });
});

describe("salon gender pricing", () => {
  it("returns the gender-specific selling price", () => {
    const rows = [
      { gender: "MALE", selling_price: 50, is_active: true },
      { gender: "FEMALE", selling_price: 100, is_active: true },
    ];
    assert.equal(pickPriceRow(rows, "MALE").selling_price, 50);
    assert.equal(pickPriceRow(rows, "FEMALE").selling_price, 100);
    assert.equal(genderMatches("UNISEX", "MALE"), true);
    assert.equal(staffGenderMatches("FEMALE", "MALE"), false);
    assert.equal(staffGenderMatches("MALE", "ANY"), true);
  });

  it("keeps package prices from mixing across services", () => {
    const services = [
      { ROWID: "s1", name: "Hair Cut", slug: "haircut", description: "", status: "ACTIVE", is_active: true, service_type: "Hair", currency: "INR" },
      { ROWID: "s2", name: "Facial", slug: "facial", description: "", status: "ACTIVE", is_active: true, service_type: "Skin", currency: "INR" },
    ];
    const prices = [
      { ROWID: "p1", service_id: "s1", package_id: "royal", gender: "MALE", mrp: 499, selling_price: 499, duration_minutes: 45, is_active: true },
      { ROWID: "p2", service_id: "s2", package_id: "royal", gender: "FEMALE", mrp: 1199, selling_price: 1199, duration_minutes: 60, is_active: true },
    ];
    const hair = groupServiceOffers(services, prices, { service_type: "Hair", q: "hair" });
    assert.equal(hair.length, 1);
    assert.equal(hair[0].name, "Hair Cut");
    assert.equal(hair[0].prices[0].selling_price, 499);
  });
});

describe("salon availability", () => {
  it("does not offer a slot that overlaps an existing booking", () => {
    assert.equal(slotsOverlap(11 * 60, 12 * 60, 11 * 60, 12 * 60), true);
    assert.equal(slotsOverlap(10 * 60, 11 * 60, 11 * 60, 12 * 60), false);
    const slots = generateDaySlots({
      opening: "10:00 AM",
      closing: "1:00 PM",
      duration: 60,
      booked: [{ start: 11 * 60, end: 12 * 60 }],
      isToday: false,
    });
    assert.deepEqual(
      slots.map((slot) => slot.start_time),
      ["10:00", "12:00"]
    );
    assert.equal(parseClock("11:00 AM"), 11 * 60);
  });
});
