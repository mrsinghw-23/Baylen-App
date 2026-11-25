"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildCatalogAvailabilityBatch } = require("../lib/catalog-batch-availability");
const { fetchProductListPage } = require("../lib/catalog-pagination");
const { validateCheckoutCart } = require("../lib/checkout-engine");
const { reserveStock } = require("../lib/inventory-ops");

const USER_ID = "36851000000295001";
const CART_ID = "36851000000380001";
const PRODUCT_ID = "100";
const WAREHOUSE_ID = "10";

function dateAtIst(y, month, day, hour, minute) {
  const utcMs =
    Date.UTC(y, month - 1, day, hour, minute) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

const OPEN_OUTLET_NOW = dateAtIst(2026, 9, 3, 14, 0);

function buildOosCatalogApp() {
  const products = [
    {
      ROWID: "1",
      name: "Sold Out Serum",
      sku: "SKU-1",
      status: "ACTIVE",
      selling_price: 499,
      quick_commerce_enabled: true,
      ecommerce_enabled: true,
    },
  ];
  const inventory = [
    {
      ROWID: "1001",
      warehouse_id: "10",
      product_id: "1",
      variant_id: null,
      quantity_on_hand: 0,
      quantity_reserved: 0,
      quantity_committed: 0,
      is_active: true,
      status: "ACTIVE",
    },
  ];
  const warehouses = [{ ROWID: "10", code: "WH-RNC-001", outlet_id: "501", is_active: true }];
  const outlets = [
    {
      ROWID: "501",
      latitude: 23.3782,
      longitude: 85.3315,
      opening_time: "10:00 AM",
      closing_time: "9:00 PM",
      is_active: true,
      delivery_enabled: true,
      service_radius_km: 5,
      store_type: "RETAIL",
    },
  ];
  return {
    zcql() {
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Warehouses")) return warehouses.map((row) => ({ Warehouses: row }));
          if (sql.includes("FROM Outlets")) return outlets.map((row) => ({ Outlets: row }));
          if (sql.includes("FROM Products") && sql.includes(" IN ")) {
            return products.map((row) => ({ Products: row }));
          }
          if (sql.includes("FROM Inventory") && sql.includes(" IN ")) {
            return inventory.map((row) => ({ Inventory: row }));
          }
          return [];
        },
      };
    },
  };
}

function buildCatalogZcql(products) {
  return {
    async executeZCQLQuery(query) {
      const sql = String(query);
      const limitMatch = sql.match(/LIMIT (\d+)/);
      const limit = limitMatch ? Number(limitMatch[1]) : products.length;
      let rows = products.slice();
      const cursorMatch = sql.match(/ROWID < (\d+)/);
      if (cursorMatch) {
        const cursorId = Number(cursorMatch[1]);
        rows = rows.filter((row) => Number(row.ROWID) < cursorId);
      }
      rows.sort((a, b) => Number(b.ROWID) - Number(a.ROWID));
      return rows.slice(0, limit).map((row) => ({ Products: row }));
    },
  };
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
      selling_price: 50,
      currency: "INR",
      tax_percent: 18,
      thumbnail_url: "",
      has_variants: false,
      is_featured: false,
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

function buildCheckoutMockApp({ availableQty }) {
  const state = {
    inventory: [
      {
        ROWID: "501",
        warehouse_id: WAREHOUSE_ID,
        product_id: PRODUCT_ID,
        variant_id: null,
        quantity_on_hand: availableQty,
        quantity_reserved: 0,
        quantity_committed: 0,
        is_active: true,
        status: "ACTIVE",
      },
    ],
    cart: {
      ROWID: CART_ID,
      currency: "INR",
      coupon_code: null,
    },
    cartItems: [
      {
        ROWID: "601",
        product_id: PRODUCT_ID,
        variant_id: null,
        quantity: 2,
      },
    ],
    products: [
      {
        ROWID: PRODUCT_ID,
        name: "Test Serum",
        sku: "SERUM-1",
        mrp: 599,
        selling_price: 499,
        tax_percent: 18,
        status: "ACTIVE",
      },
    ],
    warehouses: [{ ROWID: WAREHOUSE_ID, code: "WH-A", is_active: true }],
    movements: [],
  };

  const zcql = {
    async executeZCQLQuery(query) {
      const sql = String(query);
      if (sql.includes("FROM Carts WHERE user_id")) {
        return [{ Carts: state.cart }];
      }
      if (sql.includes("FROM Cart_Items WHERE cart_id")) {
        return state.cartItems.map((row) => ({ Cart_Items: row }));
      }
      if (sql.includes("FROM Products WHERE ROWID")) {
        return [{ Products: state.products[0] }];
      }
      if (sql.includes("FROM Inventory WHERE product_id")) {
        return state.inventory.map((row) => ({ Inventory: row }));
      }
      if (sql.includes("FROM Inventory WHERE ROWID")) {
        const match = sql.match(/ROWID = (\d+)/);
        const row = state.inventory.find((item) => String(item.ROWID) === match[1]);
        return row ? [{ Inventory: row }] : [];
      }
      if (sql.includes("FROM Warehouses")) {
        return state.warehouses.map((row) => ({ Warehouses: row }));
      }
      if (sql.includes("FROM Stock_Movements")) {
        return state.movements.map((row) => ({ Stock_Movements: row }));
      }
      return [];
    },
  };

  const app = {
    _state: state,
    zcql: () => zcql,
    datastore: () => ({
      table(name) {
        return {
          async insertRow(payload) {
            if (name === "Stock_Movements") {
              const row = { ROWID: String(state.movements.length + 700), ...payload };
              state.movements.push(row);
              return { ROWID: row.ROWID };
            }
            return {};
          },
          async updateRow(payload) {
            if (name === "Inventory") {
              const row = state.inventory.find((item) => String(item.ROWID) === String(payload.ROWID));
              if (row) Object.assign(row, payload);
            }
          },
        };
      },
    }),
  };

  return app;
}

describe("Module 7 product catalog and cart", () => {
  it("out-of-stock product shows as unavailable in catalog batch", async () => {
    const app = buildOosCatalogApp();
    const result = await buildCatalogAvailabilityBatch(app, {
      items: [{ product_id: "1", quantity: 1 }],
      latitude: 23.3782,
      longitude: 85.3315,
      now: OPEN_OUTLET_NOW,
    });
    const item = result.items[0];
    assert.equal(item.available_quantity, 0);
    assert.equal(item.quick_available, false);
    assert.equal(item.standard_available, false);
  });

  it("pagination returns correct page size, limit probe, and has_more", async () => {
    const products = generateProducts(25);
    const zcql = buildCatalogZcql(products);
    const page = await fetchProductListPage(zcql, {}, { limit: 10, cursor: null, sort: "newest" });
    assert.equal(page.rows.length, 10);
    assert.equal(page.rows_fetched, 11);
    assert.equal(page.has_more, true);
    assert.ok(page.next_cursor);
    const page2 = await fetchProductListPage(zcql, {}, { limit: 10, cursor: page.next_cursor, sort: "newest" });
    assert.equal(page2.rows.length, 10);
    assert.equal(page2.has_more, true);
  });

  it("validateCheckoutCart accepts cart lines when stock is available", async () => {
    const app = buildCheckoutMockApp({ availableQty: 10 });
    const req = {
      catalystApp: app,
      body: {},
      query: {},
    };
    const validated = await validateCheckoutCart(req, { user_id: USER_ID });
    assert.equal(validated.lines.length, 1);
    assert.equal(validated.lines[0].quantity, 2);
    assert.ok(validated.totals.grand > 0);
  });

  it("checkout rejects out-of-stock cart items", async () => {
    const app = buildCheckoutMockApp({ availableQty: 0 });
    const req = { catalystApp: app, body: {}, query: {} };
    await assert.rejects(
      () => validateCheckoutCart(req, { user_id: USER_ID }),
      (error) => error.code === "INSUFFICIENT_STOCK" && error.status === 409
    );
  });

  it("checkout placement reserves inventory for order lines", async () => {
    const app = buildCheckoutMockApp({ availableQty: 10 });
    const result = await reserveStock(app, {
      productId: PRODUCT_ID,
      quantity: 2,
      referenceType: "ORDER",
      referenceId: "9001",
      warehouseId: WAREHOUSE_ID,
    });
    assert.equal(result.quantity, 2);
    assert.equal(Number(app._state.inventory[0].quantity_reserved), 2);
    assert.ok(app._state.movements.length >= 1);
  });
});
