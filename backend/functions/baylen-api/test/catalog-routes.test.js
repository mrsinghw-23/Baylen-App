"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { discountPercent } = require("../routes/catalog");

describe("catalog product list filters", () => {
  it("computes discount percent from mrp and selling price", () => {
    assert.equal(
      discountPercent({ mrp: 100, selling_price: 80 }),
      20
    );
    assert.equal(discountPercent({ mrp: 0, selling_price: 50 }), 0);
  });

  it("supports post-availability filter reassignment", () => {
    let rows = [
      { mrp: 100, selling_price: 70, available_quantity: 2, rating: 4 },
      { mrp: 100, selling_price: 95, available_quantity: 1, rating: 5 },
    ];
    const minDiscount = 20;
    if (Number.isFinite(minDiscount) && minDiscount > 0) {
      rows = rows.filter((row) => discountPercent(row) >= minDiscount);
    }
    assert.equal(rows.length, 1);
    assert.equal(rows[0].selling_price, 70);
  });
});
