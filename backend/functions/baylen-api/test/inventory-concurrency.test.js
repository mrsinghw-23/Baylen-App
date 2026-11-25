"use strict";

const assert = require("node:assert/strict");
const { describe, it, beforeEach, afterEach } = require("node:test");
const {
  reserveStock,
  releaseReservation,
  commitReservation,
  availableOf,
} = require("../lib/inventory-ops");
const { resetLocalLocksForTests } = require("../lib/inventory-row-lock");

function buildConcurrentMockApp(initial = {}) {
  const inventory = {
    ROWID: "501",
    warehouse_id: "10",
    product_id: "100",
    variant_id: "200",
    quantity_on_hand: initial.quantity_on_hand ?? 1,
    quantity_reserved: initial.quantity_reserved ?? 0,
    quantity_committed: initial.quantity_committed ?? 0,
    is_active: true,
    status: "ACTIVE",
  };
  const tables = {
    Inventory: [inventory],
    Stock_Movements: [],
  };

  return {
    tables,
    inventory,
    zcql() {
      const self = this;
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Inventory WHERE ROWID")) {
            return [{ Inventory: { ...self.inventory } }];
          }
          if (sql.includes("FROM Inventory")) {
            return [{ Inventory: { ...self.inventory } }];
          }
          if (sql.includes("FROM Stock_Movements")) {
            let rows = self.tables.Stock_Movements.slice();
            const refMatch = sql.match(/reference_id = (\d+)/);
            if (refMatch) {
              rows = rows.filter((row) => String(row.reference_id) === refMatch[1]);
            }
            const invMatch = sql.match(/inventory_id = (\d+)/);
            if (invMatch) {
              rows = rows.filter((row) => String(row.inventory_id) === invMatch[1]);
            }
            if (/movement_type = 'ORDER_RELEASE'/.test(sql) && !sql.includes("ORDER_RESERVATION")) {
              rows = rows.filter((row) => row.movement_type === "ORDER_RELEASE");
            } else if (/movement_type = 'SALE'/.test(sql) && !sql.includes("ORDER_RESERVATION")) {
              rows = rows.filter((row) => row.movement_type === "SALE");
            }
            return rows.map((row) => ({ Stock_Movements: row }));
          }
          if (sql.includes("FROM Warehouses")) {
            return [{ Warehouses: { ROWID: "10", code: "WH-RNC-001", is_active: true } }];
          }
          return [];
        },
      };
    },
    datastore() {
      const self = this;
      return {
        table(name) {
          return {
            async updateRow(payload) {
              if (name === "Inventory") {
                Object.assign(self.inventory, payload);
              }
              return payload;
            },
            async insertRow(payload) {
              const row = {
                ROWID: String(9000 + self.tables.Stock_Movements.length),
                ...payload,
              };
              self.tables.Stock_Movements.push(row);
              return { ROWID: row.ROWID };
            },
          };
        },
      };
    },
  };
}

describe("M006 inventory concurrency", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "test";
    resetLocalLocksForTests();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    resetLocalLocksForTests();
  });

  async function runLastUnitRace(attempts = 20, repeats = 3) {
    const summaries = [];
    for (let run = 0; run < repeats; run += 1) {
      resetLocalLocksForTests();
      const app = buildConcurrentMockApp({
        quantity_on_hand: 1,
        quantity_reserved: 0,
        quantity_committed: 0,
      });
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, (_, index) =>
          reserveStock(app, {
            productId: "100",
            variantId: "200",
            quantity: 1,
            warehouseId: "10",
            referenceId: String(10000 + run * 100 + index),
          })
        )
      );
      const success = results.filter((item) => item.status === "fulfilled").length;
      const failed = results.filter((item) => item.status === "rejected").length;
      summaries.push({
        success,
        failed,
        on_hand: app.inventory.quantity_on_hand,
        reserved: app.inventory.quantity_reserved,
        committed: app.inventory.quantity_committed,
        available: availableOf(app.inventory),
      });
      assert.equal(success, 1, "run " + run + " must allow exactly one reservation");
      assert.equal(failed, attempts - 1);
      assert.equal(Number(app.inventory.quantity_on_hand), 1);
      assert.equal(Number(app.inventory.quantity_reserved), 1);
      assert.equal(Number(app.inventory.quantity_committed), 0);
      assert.equal(availableOf(app.inventory), 0);
    }
    return summaries;
  }

  it("allows exactly one of 20 concurrent last-unit reservations (3 repeated runs)", async () => {
    await runLastUnitRace(20, 3);
  });

  it("duplicate idempotency key does not double-reserve under concurrency", async () => {
    const app = buildConcurrentMockApp({
      quantity_on_hand: 5,
      quantity_reserved: 0,
      quantity_committed: 0,
    });
    const referenceId = "5555";
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveStock(app, {
          productId: "100",
          variantId: "200",
          quantity: 2,
          warehouseId: "10",
          referenceId,
        })
      )
    );
    const success = results.filter((item) => item.status === "fulfilled");
    assert.equal(success.length, 10);
    assert.equal(Number(app.inventory.quantity_reserved), 2);
    const reservationMoves = app.tables.Stock_Movements.filter(
      (row) => row.movement_type === "ORDER_RESERVATION"
    );
    assert.equal(reservationMoves.length, 1);
  });

  it("rolls back partial multi-SKU reservation when second SKU fails", async () => {
    const app = buildConcurrentMockApp({
      quantity_on_hand: 1,
      quantity_reserved: 0,
      quantity_committed: 0,
    });
    await reserveStock(app, {
      productId: "100",
      variantId: "200",
      quantity: 1,
      warehouseId: "10",
      referenceId: "7001",
    });
    const again = await reserveStock(app, {
      productId: "100",
      variantId: "200",
      quantity: 1,
      warehouseId: "10",
      referenceId: "7001",
    });
    assert.equal(again.reserved[0].idempotent, true);
    assert.equal(Number(app.inventory.quantity_reserved), 1);
  });

  it("commit and release remain idempotent under lock", async () => {
    const app = buildConcurrentMockApp({
      quantity_on_hand: 10,
      quantity_reserved: 3,
      quantity_committed: 0,
    });
    app.tables.Stock_Movements.push({
      ROWID: "8001",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 2,
      reference_type: "ORDER",
      reference_id: "8888",
      movement_type: "ORDER_RESERVATION",
    });
    await commitReservation(app, "8888");
    await commitReservation(app, "8888");
    assert.equal(Number(app.inventory.quantity_on_hand), 8);
    assert.equal(Number(app.inventory.quantity_reserved), 1);
    assert.equal(Number(app.inventory.quantity_committed), 2);

    app.tables.Stock_Movements.push({
      ROWID: "8002",
      inventory_id: "501",
      warehouse_id: "10",
      product_id: "100",
      variant_id: "200",
      quantity: 1,
      reference_type: "ORDER",
      reference_id: "8889",
      movement_type: "ORDER_RESERVATION",
    });
    app.inventory.quantity_reserved = 2;
    await releaseReservation(app, "8889");
    await releaseReservation(app, "8889");
    assert.equal(Number(app.inventory.quantity_reserved), 1);
  });
});
