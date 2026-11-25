"use strict";

const path = require("path");
const { resolveEnvironmentTarget } = require("./backup-env");

const ORG_ID = "60069781151";
const ZCQL_PAGE_SIZE = 300;

function loadCliModules() {
  const cliLib = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
  return {
    config: require(path.join(cliLib, "util_modules", "config-store")).default,
    getActiveDC: require(path.join(cliLib, "util_modules", "dc")).getActiveDC,
    Credential: require(path.join(cliLib, "authentication", "credential")).default,
    endpoints: require(path.join(cliLib, "endpoints")),
  };
}

function unwrapRows(list, tableName) {
  return (list || []).map((item) => (item && item[tableName] ? item[tableName] : item));
}

async function createCliClients(resolvedTarget) {
  const { config, getActiveDC, Credential, endpoints } = loadCliModules();
  Credential.init(config.get(getActiveDC() + ".credential"));
  const projectId = resolvedTarget.projectId;
  const env = resolvedTarget.environment;
  const datastore = await endpoints.datastoreAPI({
    projectId,
    env,
    org: ORG_ID,
  });
  const zcql = await endpoints.zcqlAPI({
    projectId,
    env,
    org: ORG_ID,
  });
  return { datastore, zcql, projectId, env };
}

function createCliCatalystApp(resolvedTarget) {
  let clientsPromise = null;
  async function getClients() {
    if (!clientsPromise) {
      clientsPromise = createCliClients(resolvedTarget);
    }
    return clientsPromise;
  }
  return {
    resolvedTarget,
    datastore() {
      return {
        getAllTables: async () => {
          const { datastore } = await getClients();
          const tables = await datastore.getAllTables();
          return (tables || []).map((table) => ({
            table_name: table.table_name || table.name,
            name: table.table_name || table.name,
          }));
        },
        table: (tableName) => ({
          getPagedRows: async ({ nextToken, maxRows = 200 } = {}) => {
            const { zcql } = await getClients();
            const offset = Number(nextToken || 0);
            const limit = Math.min(Math.max(Number(maxRows) || 200, 1), ZCQL_PAGE_SIZE);
            const result = await zcql.query(
              "SELECT * FROM " + tableName + " LIMIT " + offset + ", " + limit
            );
            const data = unwrapRows(result, tableName);
            const hasMore = data.length === limit;
            return {
              data,
              more_records: hasMore,
              next_token: hasMore ? String(offset + limit) : undefined,
            };
          },
        }),
      };
    },
    connections() {
      return {
        getConnectionCredentials: async () => {
          const error = new Error(
            "Catalyst Connections are unavailable from local CLI backup scripts. " +
              "Configure a WorkDrive Connection in Catalyst Console and run upload from Catalyst function runtime, " +
              "or use --mode export|encrypt for local operations."
          );
          error.code = "WORKDRIVE_CONNECTION_CLI_UNSUPPORTED";
          throw error;
        },
      };
    },
  };
}

async function verifyCatalystTarget(app, resolvedTarget) {
  const tables = await app.datastore().getAllTables();
  if (!Array.isArray(tables) || !tables.length) {
    const error = new Error(
      "Target environment returned zero tables — fail closed for " + resolvedTarget.environment
    );
    error.code = "CATALYST_ENV_VERIFY_FAILED";
    throw error;
  }
  return {
    tableCount: tables.length,
    environment: resolvedTarget.environment,
    projectId: resolvedTarget.projectId,
  };
}

async function createVerifiedCatalystApp(options = {}) {
  const resolved =
    options.resolved || resolveEnvironmentTarget(options);
  const app = createCliCatalystApp(resolved);
  const verification = await verifyCatalystTarget(app, resolved);
  return { app, resolved, verification };
}

module.exports = {
  ORG_ID,
  ZCQL_PAGE_SIZE,
  loadCliModules,
  createCliCatalystApp,
  verifyCatalystTarget,
  createVerifiedCatalystApp,
  unwrapRows,
};
