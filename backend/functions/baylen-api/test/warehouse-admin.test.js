"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  normalizeWarehouseCode,
  normalizeWarehouseType,
  warehouseTypeFromRow,
  roleFlagsFromType,
  mapAdminWarehouse,
  upsertWarehouse,
  setWarehouseStatus,
  listAdminWarehouses,
} = require("../lib/warehouse-admin");
const { resolveWarehouse } = require("../lib/inventory-ops");

function mockApp(state) {
  const tables = state.tables || {};
  return {
    zcql() {
      return {
        async executeZCQLQuery(query) {
          state.queries = state.queries || [];
          state.queries.push(query);
          if (query.includes("FROM Warehouses WHERE code = 'WH-DUP'")) {
            return [{ Warehouses: { ROWID: "99", code: "WH-DUP", name: "Dup" } }];
          }
          if (query.includes("FROM Warehouses WHERE ROWID = 404")) {
            return [];
          }
          if (query.includes("FROM Warehouses WHERE ROWID = 10")) {
            const row = (tables.Warehouses || []).find((item) => String(item.ROWID) === "10") || {
              ROWID: "10",
              code: "WH-OLD",
              name: "Old",
              outlet_id: "501",
              is_default: false,
              is_active: true,
            };
            return [{ Warehouses: row }];
          }
          if (state.inserted && query.includes("FROM Warehouses WHERE ROWID = " + state.inserted.ROWID)) {
            return [{ Warehouses: state.inserted }];
          }
          if (query.includes("FROM Outlets WHERE ROWID = 404")) {
            return [];
          }
          if (query.includes("FROM Outlets WHERE ROWID = 501")) {
            return [
              {
                Outlets: {
                  ROWID: "501",
                  name: "Test Outlet",
                  code: "OUT-001",
                  city: "Metro",
                  state: "ST",
                  latitude: 12.9,
                  longitude: 77.6,
                  is_active: true,
                  delivery_enabled: true,
                  service_radius_km: 3,
                  store_type: "RETAIL",
                },
              },
            ];
          }
          if (query.includes("is_default = true")) {
            return state.defaultWarehouse ? [{ Warehouses: state.defaultWarehouse }] : [];
          }
          if (query.includes("FROM Warehouses WHERE code = 'HQ'")) {
            return [{ Warehouses: { ROWID: "1", code: "HQ", name: "HQ" } }];
          }
          if (query.includes("FROM Warehouses WHERE code = 'WH-BAD'")) {
            return [];
          }
          if (query.includes("FROM Warehouses ORDER BY")) {
            return (tables.Warehouses || []).map((row) => ({ Warehouses: row }));
          }
          if (query.includes("FROM Outlets") && !query.includes("ROWID =")) {
            return (tables.Outlets || []).map((row) => ({ Outlets: row }));
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
              const row = { ROWID: state.nextId || "100", ...payload };
              state.nextId = String(Number(state.nextId || 100) + 1);
              tables[name] = tables[name] || [];
              tables[name].push(row);
              state.inserted = row;
              return { ROWID: row.ROWID };
            },
            async updateRow(payload) {
              state.updated = payload;
              tables[name] = tables[name] || [];
              const existingRow = tables[name].find((item) => String(item.ROWID) === String(payload.ROWID));
              if (existingRow) {
                Object.assign(existingRow, payload);
              } else if (String(payload.ROWID) === "10") {
                tables[name].push({
                  ROWID: "10",
                  code: "WH-OLD",
                  name: "Old",
                  outlet_id: "501",
                  is_default: false,
                  is_active: true,
                  ...payload,
                });
              }
              return payload;
            },
          };
        },
      };
    },
  };
}

describe("warehouse-admin validation", () => {
  it("normalizes warehouse codes consistently", () => {
    assert.equal(normalizeWarehouseCode(" wh-rnc-001 "), "WH-RNC-001");
  });

  it("rejects invalid warehouse type", () => {
    assert.throws(
      () => normalizeWarehouseType("INVALID"),
      (error) => error.code === "INVALID_WAREHOUSE_TYPE"
    );
  });

  it("maps Quick Commerce types to non-default outlet-required role", () => {
    assert.deepEqual(roleFlagsFromType("DARK_STORE"), {
      is_default: false,
      requires_outlet: true,
      type: "DARK_STORE",
    });
  });

  it("maps central types to default warehouse role", () => {
    assert.deepEqual(roleFlagsFromType("CENTRAL"), {
      is_default: true,
      requires_outlet: false,
      type: "CENTRAL",
    });
  });

  it("derives warehouse type from stored row", () => {
    assert.equal(
      warehouseTypeFromRow({ is_default: true, code: "WH-BAN01", outlet_id: "1" }),
      "CENTRAL"
    );
    assert.equal(
      warehouseTypeFromRow({ is_default: false, code: "WH-RNC-001", outlet_id: "1" }),
      "DARK_STORE"
    );
  });
});

describe("warehouse upsert", () => {
  it("creates a valid Quick Commerce warehouse", async () => {
    const state = { nextId: "200", defaultWarehouse: { ROWID: "1", code: "HQ" } };
    const app = mockApp(state);
    const result = await upsertWarehouse(app, {
      code: "WH-NEW-001",
      name: "New QC Stock",
      type: "DARK_STORE",
      outlet_id: "501",
    });
    assert.equal(result.action, "created");
    assert.equal(result.warehouse.code, "WH-NEW-001");
    assert.equal(result.warehouse.type, "DARK_STORE");
    assert.equal(result.warehouse.outlet_id, "501");
    assert.equal(result.warehouse.is_default, false);
  });

  it("rejects duplicate warehouse code", async () => {
    const app = mockApp({});
    await assert.rejects(
      () =>
        upsertWarehouse(app, {
          code: "WH-DUP",
          name: "Dup",
          type: "DARK_STORE",
          outlet_id: "501",
        }),
      (error) => error.code === "DUPLICATE_WAREHOUSE_CODE"
    );
  });

  it("rejects warehouse with nonexistent outlet", async () => {
    const app = mockApp({});
    await assert.rejects(
      () =>
        upsertWarehouse(app, {
          code: "WH-NEW-002",
          name: "Bad Outlet",
          type: "DARK_STORE",
          outlet_id: "404",
        }),
      (error) => error.code === "OUTLET_NOT_FOUND"
    );
  });

  it("rejects DARK_STORE without outlet", async () => {
    const app = mockApp({});
    await assert.rejects(
      () =>
        upsertWarehouse(app, {
          code: "WH-NEW-003",
          name: "No Outlet",
          type: "DARK_STORE",
        }),
      (error) => error.code === "OUTLET_REQUIRED"
    );
  });

  it("updates an existing warehouse", async () => {
    const app = mockApp({});
    const result = await upsertWarehouse(app, {
      id: "10",
      name: "Renamed",
      code: "WH-OLD",
    });
    assert.equal(result.action, "updated");
    assert.equal(result.warehouse.name, "Renamed");
  });

  it("rejects update for nonexistent warehouse", async () => {
    const app = mockApp({});
    await assert.rejects(
      () =>
        upsertWarehouse(app, {
          id: "404",
          name: "Missing",
          code: "WH-MISSING",
          type: "DARK_STORE",
          outlet_id: "501",
        }),
      (error) => error.code === "WAREHOUSE_NOT_FOUND"
    );
  });

  it("deactivates and reactivates warehouse", async () => {
    const app = mockApp({
      tables: {
        Warehouses: [
          {
            ROWID: "10",
            code: "WH-OLD",
            name: "Old",
            outlet_id: "501",
            is_default: false,
            is_active: true,
          },
        ],
      },
    });
    const deactivated = await setWarehouseStatus(app, "10", false);
    assert.equal(deactivated.is_active, false);
    const reactivated = await setWarehouseStatus(app, "10", true);
    assert.equal(reactivated.is_active, true);
  });

  it("lists warehouses with linked outlet summary", async () => {
    const app = mockApp({
      tables: {
        Warehouses: [
          {
            ROWID: "10",
            code: "WH-OLD",
            name: "Old",
            outlet_id: "501",
            is_default: false,
            is_active: true,
          },
        ],
        Outlets: [
          {
            ROWID: "501",
            name: "Test Outlet",
            code: "OUT-001",
            city: "Metro",
            state: "ST",
            is_active: true,
          },
        ],
      },
    });
    const warehouses = await listAdminWarehouses(app);
    assert.equal(warehouses.length, 1);
    assert.equal(warehouses[0].outlet_name, "Test Outlet");
  });
});

describe("resolveWarehouse strict code behavior", () => {
  it("returns HQ/default behavior when warehouse code is omitted", async () => {
    const zcql = {
      executeZCQLQuery: async (query) => {
        if (query.includes("code = 'HQ'")) {
          return [{ Warehouses: { ROWID: "1", code: "HQ", name: "HQ" } }];
        }
        return [];
      },
    };
    const row = await resolveWarehouse(zcql, null, undefined);
    assert.equal(row.code, "HQ");
  });

  it("does not silently fallback when explicit warehouse code is invalid", async () => {
    const zcql = {
      executeZCQLQuery: async (query) => {
        if (query.includes("code = 'WH-BAD'")) {
          return [];
        }
        if (query.includes("is_default = true")) {
          return [{ Warehouses: { ROWID: "1", code: "HQ", name: "HQ" } }];
        }
        return [];
      },
    };
    await assert.rejects(
      () => resolveWarehouse(zcql, null, "WH-BAD"),
      (error) => error.code === "WAREHOUSE_NOT_FOUND"
    );
  });
});

describe("fulfillment compatibility", () => {
  it("existing central warehouse discovery logic remains unchanged", () => {
    const { centralWarehouses } = require("../lib/fulfillment-engine");
    const central = centralWarehouses([
      { ROWID: "1", code: "WH-RNC-001", is_default: false },
      { ROWID: "2", code: "WH-BAN01", is_default: true },
    ]);
    assert.equal(central.length, 1);
    assert.equal(central[0].code, "WH-BAN01");
  });
});
