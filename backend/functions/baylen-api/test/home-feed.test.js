"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  inDisplayWindow,
  mapBanner,
  mapTrending,
  mapCategory,
  haversineKm,
} = require("../routes/home");

describe("home feed mappers", () => {
  it("maps banner fields from Data Store rows", () => {
    const banner = mapBanner({
      ROWID: "10",
      title: "Summer Sale",
      subtitle: "Up to 30% off",
      image_url: "https://example.com/banner.png",
      action_type: "SHOP",
      action_value: "1",
      display_order: 2,
    });
    assert.equal(banner.id, "10");
    assert.equal(banner.title, "Summer Sale");
    assert.equal(banner.action_type, "SHOP");
    assert.equal(banner.display_order, 2);
  });

  it("maps trending and category items", () => {
    const trending = mapTrending({
      ROWID: "5",
      name: "Keratin Treatment",
      image_url: "https://example.com/t.jpg",
      tag: "Trending",
      type: "service",
      reference_id: "42",
    });
    assert.equal(trending.type, "service");
    assert.equal(trending.reference_id, "42");

    const category = mapCategory({
      ROWID: "7",
      name: "Hair",
      slug: "hair",
      icon_key: "hair",
      display_order: 1,
    });
    assert.equal(category.slug, "hair");
    assert.equal(category.icon_key, "hair");
  });
});

describe("home display windows", () => {
  it("excludes items outside active date range", () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal(inDisplayWindow({ start_date: future }), false);
    assert.equal(inDisplayWindow({ end_date: past }), false);
    assert.equal(inDisplayWindow({}), true);
  });
});

describe("nearby outlet distance", () => {
  it("computes haversine distance for Ranchi test coordinates", () => {
    const distance = haversineKm(23.3782, 85.3315, 23.36, 85.33);
    assert.ok(distance > 0);
    assert.ok(distance < 5);
  });
});
