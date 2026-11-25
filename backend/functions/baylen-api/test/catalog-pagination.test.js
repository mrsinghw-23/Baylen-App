"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  encodeCursor,
  decodeCursor,
  fetchProductListPage,
  buildProductListQuery,
} = require("../lib/catalog-pagination");

function buildCatalogZcql(products) {
  let lastQuery = null;
  let queryCount = 0;
  const zcql = {
    async executeZCQLQuery(query) {
      queryCount += 1;
      lastQuery = String(query);
      const match = lastQuery.match(/LIMIT (\d+)/);
      const limit = match ? Number(match[1]) : products.length;
      let rows = products.slice();
      const cursorMatch = lastQuery.match(/ROWID < (\d+)/);
      if (cursorMatch) {
        const cursorId = Number(cursorMatch[1]);
        rows = rows.filter((row) => Number(row.ROWID) < cursorId);
      }
      rows.sort((a, b) => Number(b.ROWID) - Number(a.ROWID));
      return rows.slice(0, limit).map((row) => ({ Products: row }));
    },
    getStats() {
      return { queryCount, lastQuery };
    },
  };
  return { zcql, getStats: () => zcql.getStats() };
}

function generateProducts(count) {
  const rows = [];
  for (let index = count; index >= 1; index -= 1) {
    rows.push({
      ROWID: String(100000 + index),
      name: "Product " + index,
      slug: "product-" + index,
      sku: "SKU-" + index,
      category_id: "1",
      brand_id: "2",
      product_type: "SKU",
      short_description: "",
      description: "",
      mrp: 100,
      selling_price: 50 + (index % 10),
      currency: "INR",
      tax_percent: 18,
      thumbnail_url: "",
      has_variants: false,
      is_featured: index % 50 === 0,
      status: "ACTIVE",
      gender: "",
      age_group: "",
      quick_commerce_enabled: true,
      ecommerce_enabled: true,
      quick_commerce_restriction_reason: "",
      search_keywords: "product",
    });
  }
  return rows;
}

describe("M008 catalog pagination", () => {
  it("buildProductListQuery never selects entire catalog without LIMIT", () => {
    const { query } = buildProductListQuery({}, { limit: 20, cursor: null, sort: "newest" });
    assert.match(query, /LIMIT 21/);
    assert.doesNotMatch(query, /SELECT \* FROM Products/);
  });

  it("page 1 of 10,000 products fetches only limit+1 rows", async () => {
    const products = generateProducts(10000);
    const { zcql, getStats } = buildCatalogZcql(products);
    const page = await fetchProductListPage(zcql, {}, { limit: 20, cursor: null, sort: "newest" });
    assert.equal(page.rows.length, 20);
    assert.equal(page.rows_fetched, 21);
    assert.equal(getStats().queryCount, 1);
    assert.match(getStats().lastQuery, /LIMIT 21/);
  });

  it("cursor traversal has no duplicates across three pages", async () => {
    const products = generateProducts(10000);
    const { zcql } = buildCatalogZcql(products);
    const seen = new Set();
    let cursor = null;
    for (let pageNum = 0; pageNum < 3; pageNum += 1) {
      const page = await fetchProductListPage(zcql, {}, { limit: 50, cursor, sort: "newest" });
      page.rows.forEach((row) => {
        const id = String(row.ROWID);
        assert.equal(seen.has(id), false, "duplicate at page " + pageNum + " id " + id);
        seen.add(id);
      });
      cursor = page.next_cursor;
      assert.equal(page.rows.length, 50);
    }
    assert.equal(seen.size, 150);
  });

  it("invalid cursor fails safely", () => {
    assert.throws(() => decodeCursor("not-valid-cursor"), (error) => error.code === "INVALID_CURSOR");
  });

  it("encodes and decodes cursor payload", () => {
    const raw = encodeCursor({ r: "123", s: "newest", p: 99 });
    const decoded = decodeCursor(raw);
    assert.equal(decoded.r, "123");
    assert.equal(decoded.s, "newest");
    assert.equal(decoded.p, 99);
  });
});
