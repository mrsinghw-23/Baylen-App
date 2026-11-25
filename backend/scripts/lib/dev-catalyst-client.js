"use strict";

/**
 * Development-only Catalyst CLI client helpers for smoke/fixture scripts.
 * Never import from production runtime code.
 */

const path = require("path");
const CLI_LIB = path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "zcatalyst-cli",
  "lib"
);
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const API = require(path.join(CLI_LIB, "internal", "api")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";

function assertDevelopmentOnly() {
  if (String(process.env.BAYLEN_ENV || ENV).toLowerCase() === "production") {
    throw new Error("Dev Catalyst client refused: BAYLEN_ENV=production");
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(rows, table) {
  return (rows || []).map((row) => row[table] || row).filter(Boolean);
}

async function createDevCatalystClient() {
  assertDevelopmentOnly();
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zcql = await endpoints.zcqlAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );
  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };

  async function insertRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    await sleep(200);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [payload],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("insert " + tableName + ": " + JSON.stringify(res.body));
    }
    const data = res.body.data;
    const first = Array.isArray(data) ? data[0] : data;
    return first && first[tableName] ? first[tableName] : first;
  }

  async function updateRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined && value !== "") {
        clean[key] = value;
      }
    }
    await sleep(200);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.put(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [clean],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("update " + tableName + ": " + JSON.stringify(res.body));
    }
    return res.body.data;
  }

  async function clearBigIntColumn(tableName, rowId, column) {
    await zcql.query(
      "UPDATE " +
        tableName +
        " SET " +
        column +
        " = NULL WHERE ROWID = " +
        String(rowId)
    );
  }

  const memoryCache = new Map();

  const app = {
    zcql() {
      return {
        executeZCQLQuery(query) {
          return zcql.query(String(query));
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async updateRow(payload) {
              return updateRow(name, payload);
            },
            async insertRow(payload) {
              return insertRow(name, payload);
            },
          };
        },
      };
    },
    cache() {
      return {
        segment() {
          return {
            async getValue(key) {
              return memoryCache.get(String(key)) ?? null;
            },
            async put(key, value) {
              memoryCache.set(String(key), value);
            },
            async delete(key) {
              memoryCache.delete(String(key));
            },
          };
        },
      };
    },
  };

  return {
    PROJECT_ID,
    ORG_ID,
    ENV,
    zcql,
    app,
    insertRow,
    updateRow,
    clearBigIntColumn,
    unwrap,
    sleep,
  };
}

module.exports = {
  PROJECT_ID,
  ORG_ID,
  ENV,
  assertDevelopmentOnly,
  createDevCatalystClient,
  unwrap,
  sleep,
};
