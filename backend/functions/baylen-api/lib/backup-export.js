"use strict";

const { fetchAllTableRows } = require("./paged");
const {
  SCHEMA_VERSION,
  assertExportScope,
  classifyTable,
  TABLE_CLASSIFICATION,
} = require("./backup-table-scope");

function sortRowsDeterministic(rows) {
  return [...rows].sort((left, right) => {
    const leftId = Number(left.ROWID || left.rowid || 0);
    const rightId = Number(right.ROWID || right.rowid || 0);
    if (leftId !== rightId) {
      return leftId - rightId;
    }
    return JSON.stringify(left).localeCompare(JSON.stringify(right));
  });
}

async function listDatastoreTables(app) {
  const tables = await app.datastore().getAllTables();
  return (tables || []).map((table) => String(table.table_name || table.name || "")).filter(Boolean);
}

async function exportTableRows(app, tableName) {
  const rows = await fetchAllTableRows(app, tableName);
  return sortRowsDeterministic(rows);
}

async function exportDatastoreSnapshot(app, options = {}) {
  const tableNames = [...(options.tables || [])].sort((a, b) => a.localeCompare(b));
  assertExportScope(tableNames);

  const available = await listDatastoreTables(app);
  const missing = tableNames.filter((name) => !available.includes(name));
  const missingCritical = missing.filter(
    (name) => classifyTable(name) === "PRODUCTION_CRITICAL"
  );
  if (missingCritical.length) {
    const error = new Error(
      "Datastore tables missing in target environment: " + missingCritical.join(", ")
    );
    error.code = "TABLES_MISSING";
    error.missingTables = missingCritical;
    throw error;
  }
  const exportTables = tableNames.filter((name) => available.includes(name));
  const skippedOptional = missing.filter((name) => classifyTable(name) !== "PRODUCTION_CRITICAL");

  const exportedAt = options.exportedAt || new Date().toISOString();
  const tables = {};
  const rowCounts = {};
  const tableErrors = {};

  for (const tableName of exportTables) {
    try {
      const rows = await exportTableRows(app, tableName);
      tables[tableName] = rows;
      rowCounts[tableName] = rows.length;
    } catch (error) {
      tableErrors[tableName] = error.message || String(error);
      throw error;
    }
  }

  return {
    export_metadata: {
      schema_version: SCHEMA_VERSION,
      exported_at: exportedAt,
      environment: options.environment,
      project_id: options.projectId,
      table_order: exportTables,
      skipped_optional_tables: skippedOptional,
    },
    tables,
    row_counts: rowCounts,
    table_errors: tableErrors,
  };
}

module.exports = {
  sortRowsDeterministic,
  listDatastoreTables,
  exportTableRows,
  exportDatastoreSnapshot,
};
