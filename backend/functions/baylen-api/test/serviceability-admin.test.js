"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { normalizePincode } = require("../lib/pincode");
const {
  upsertServiceableRegion,
  findServiceableByPincode,
  evaluateServiceabilityPrecedence,
} = require("../lib/serviceability-admin");

function buildServiceabilityApp(rows = []) {
  const table = [...rows];
  return {
    table,
    zcql() {
      return {
        async executeZCQLQuery(query) {
          const sql = String(query);
          if (sql.includes("FROM Serviceable_Pincodes")) {
            if (sql.includes("pincode =")) {
              const match = sql.match(/pincode = '([^']+)'/);
              const pin = match ? match[1] : null;
              const row = table.find((item) => item.pincode === pin);
              return row ? [{ Serviceable_Pincodes: row }] : [];
            }
            return table.map((row) => ({ Serviceable_Pincodes: row }));
          }
          if (sql.includes("FROM Warehouses")) {
            return [{ Warehouses: { ROWID: "11" } }];
          }
          return [];
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async insertRow(payload) {
              const row = { ROWID: String(table.length + 1), ...payload };
              table.push(row);
              return { ROWID: row.ROWID };
            },
            async updateRow(payload) {
              const idx = table.findIndex((row) => String(row.ROWID) === String(payload.ROWID));
              if (idx >= 0) Object.assign(table[idx], payload);
            },
          };
        },
      };
    },
  };
}

describe("pincode validation", () => {
  it("accepts valid 6-digit pincode", () => {
    assert.equal(normalizePincode("834001"), "834001");
  });

  it("rejects invalid pincode", () => {
    assert.throws(() => normalizePincode("123"), /6-digit/);
  });
});

describe("serviceability admin upsert", () => {
  it("creates active region", async () => {
    const app = buildServiceabilityApp();
    const result = await upsertServiceableRegion(app, {
      pincode: "834001",
      city: "Ranchi",
      state: "Jharkhand",
      estimated_delivery_days: 3,
      delivery_zone: "EAST",
    });
    assert.equal(result.action, "CREATE");
    assert.equal(result.region.is_active, true);
  });

  it("rejects duplicate pincode on different id", async () => {
    const app = buildServiceabilityApp([
      {
        ROWID: "1",
        pincode: "834001",
        city: "Ranchi",
        state: "Jharkhand",
        is_active: true,
      },
    ]);
    await assert.rejects(
      () =>
        upsertServiceableRegion(app, {
          id: "99",
          pincode: "834001",
          city: "Other",
          state: "Jharkhand",
        }),
      /Duplicate pincode/
    );
  });
});

describe("serviceability precedence", () => {
  it("pincode does not override geographic Quick serviceability", () => {
    const result = evaluateServiceabilityPrecedence({
      geoQuickServiceable: true,
      pincodeServiceable: false,
      outletActive: true,
      deliveryEnabled: true,
    });
    assert.equal(result.quick_allowed, true);
    assert.equal(result.pincode_overrides_geo, false);
  });

  it("inactive pincode does not block Quick when geo serviceable", () => {
    const result = evaluateServiceabilityPrecedence({
      geoQuickServiceable: true,
      pincodeServiceable: false,
      outletActive: true,
      deliveryEnabled: true,
    });
    assert.equal(result.standard_pincode_allowed, false);
    assert.equal(result.quick_allowed, true);
  });
});
