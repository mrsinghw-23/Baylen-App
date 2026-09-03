#!/usr/bin/env node
"use strict";

/**
 * Provisions Baylen catalog / inventory / import / search Data Store tables.
 * Uses Catalyst CLI credentials (same path as prior successful schema work).
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
const ORG_ID = 60069781151;
const ENV = "Development";

function varchar(name, max, { mandatory = false, indexed = true, unique = false, def } = {}) {
  const col = {
    column_name: name,
    data_type: "varchar",
    max_length: max,
    is_mandatory: mandatory ? "true" : "false",
    is_unique: unique ? "true" : "false",
    search_index_enabled: indexed ? "true" : "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function text(name, max = 1000, { mandatory = false } = {}) {
  return {
    column_name: name,
    data_type: "text",
    max_length: max,
    is_mandatory: mandatory ? "true" : "false",
    audit_consent: "false",
  };
}

function bigint(name, { mandatory = false, indexed = true, unique = false, def } = {}) {
  const col = {
    column_name: name,
    data_type: "bigint",
    is_mandatory: mandatory ? "true" : "false",
    is_unique: unique ? "true" : "false",
    search_index_enabled: indexed ? "true" : "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function dbl(name, { mandatory = false, indexed = false, def } = {}) {
  const col = {
    column_name: name,
    data_type: "double",
    decimal_digits: 2,
    is_mandatory: mandatory ? "true" : "false",
    search_index_enabled: indexed ? "true" : "false",
    audit_consent: "false",
  };
  if (def !== undefined) col.default_value = String(def);
  return col;
}

function bool(name, { mandatory = true, indexed = false, def = "false" } = {}) {
  return {
    column_name: name,
    data_type: "boolean",
    default_value: String(def),
    is_mandatory: mandatory ? "true" : "false",
    search_index_enabled: indexed ? "true" : "false",
    audit_consent: "false",
  };
}

function datetime(name, { mandatory = false, indexed = true } = {}) {
  return {
    column_name: name,
    data_type: "datetime",
    is_mandatory: mandatory ? "true" : "false",
    search_index_enabled: indexed ? "true" : "false",
    audit_consent: "false",
  };
}

const NEW_TABLES = {
  Product_Categories: [
    bigint("product_id", { mandatory: true }),
    bigint("category_id", { mandatory: true }),
    bool("is_primary", { def: "false" }),
    bool("is_active", { def: "true", indexed: true }),
    bigint("display_order", { mandatory: false, indexed: false, def: 0 }),
  ],
  Product_Tags: [
    bigint("product_id", { mandatory: true }),
    bigint("tag_category_id", { mandatory: true }),
    varchar("tag_name", 100, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Concerns: [
    bigint("product_id", { mandatory: true }),
    bigint("concern_category_id", { mandatory: true }),
    varchar("concern_name", 120, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Skin_Types: [
    bigint("product_id", { mandatory: true }),
    bigint("skin_type_category_id", { mandatory: true }),
    varchar("skin_type_name", 80, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Hair_Types: [
    bigint("product_id", { mandatory: true }),
    bigint("hair_type_category_id", { mandatory: true }),
    varchar("hair_type_name", 80, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Fragrance_Families: [
    bigint("product_id", { mandatory: true }),
    bigint("fragrance_category_id", { mandatory: true }),
    varchar("fragrance_name", 100, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Ingredients: [
    bigint("product_id", { mandatory: true }),
    bigint("ingredient_category_id", { mandatory: false }),
    varchar("ingredient_name", 150, { mandatory: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Product_Attributes: [
    bigint("product_id", { mandatory: true }),
    bigint("variant_id", { mandatory: false }),
    varchar("attr_key", 80, { mandatory: true }),
    varchar("attr_value", 180, { mandatory: true }),
    varchar("attr_unit", 40, { mandatory: false, indexed: false }),
    bool("is_filterable", { def: "true", indexed: true }),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Import_Jobs: [
    varchar("filename", 180, { mandatory: true }),
    varchar("uploaded_by", 120, { mandatory: true }),
    varchar("mode", 20, { mandatory: true, def: "UPSERT" }),
    varchar("status", 30, { mandatory: true, def: "UPLOADED", indexed: true }),
    bigint("total_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("valid_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("invalid_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("created_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("updated_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("skipped_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("failed_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("processed_rows", { mandatory: false, indexed: false, def: 0 }),
    bigint("error_count", { mandatory: false, indexed: false, def: 0 }),
    bigint("progress_percent", { mandatory: false, indexed: false, def: 0 }),
    varchar("file_id", 80, { mandatory: false, indexed: false }),
    text("preview_json", 5000),
    text("summary_json", 3000),
    datetime("started_at"),
    datetime("completed_at"),
    bool("is_active", { def: "true", indexed: true }),
  ],
  Import_Job_Rows: [
    bigint("job_id", { mandatory: true }),
    bigint("row_number", { mandatory: true }),
    varchar("sku", 80, { mandatory: false }),
    varchar("product_code", 80, { mandatory: false }),
    varchar("action", 20, { mandatory: false, indexed: true }),
    varchar("status", 20, { mandatory: true, def: "PENDING", indexed: true }),
    text("payload_json", 5000),
    text("error_message", 1000),
    bigint("product_id", { mandatory: false }),
    bigint("variant_id", { mandatory: false }),
  ],
  Import_Errors: [
    bigint("job_id", { mandatory: true }),
    bigint("row_number", { mandatory: true }),
    varchar("sku", 80, { mandatory: false }),
    varchar("field_name", 80, { mandatory: false }),
    varchar("error_code", 60, { mandatory: true, indexed: true }),
    text("error_message", 1000, { mandatory: true }),
    varchar("severity", 20, { mandatory: true, def: "ERROR" }),
  ],
  Search_Documents: [
    bigint("product_id", { mandatory: true, unique: true }),
    varchar("product_name", 150, { mandatory: true }),
    varchar("slug", 180, { mandatory: true }),
    varchar("product_code", 80, { mandatory: false }),
    varchar("sku_list", 255, { mandatory: false }),
    varchar("barcode_list", 255, { mandatory: false, indexed: false }),
    varchar("brand_name", 150, { mandatory: false }),
    bigint("brand_id", { mandatory: false }),
    varchar("category_names", 255, { mandatory: false }),
    varchar("product_type", 40, { mandatory: false }),
    text("keywords", 2000),
    text("document_text", 5000),
    varchar("status", 20, { mandatory: true, def: "ACTIVE", indexed: true }),
    dbl("selling_price", { mandatory: false, indexed: true }),
    dbl("mrp", { mandatory: false }),
    bool("is_featured", { def: "false", indexed: true }),
    bool("in_stock", { def: "false", indexed: true }),
    datetime("indexed_at"),
    bool("is_active", { def: "true", indexed: true }),
  ],
};

const ALTER_COLUMNS = {
  Products: [
    varchar("product_code", 80, { mandatory: false }),
    dbl("cost_price", { mandatory: false }),
    varchar("gender", 30, { mandatory: false }),
    varchar("age_group", 40, { mandatory: false }),
    varchar("seo_title", 180, { mandatory: false, indexed: false }),
    varchar("seo_description", 255, { mandatory: false, indexed: false }),
    varchar("search_keywords", 255, { mandatory: false }),
    varchar("visibility", 30, { mandatory: false, def: "PUBLISHED" }),
  ],
  Product_Variants: [
    varchar("variant_code", 80, { mandatory: false }),
    varchar("ean", 40, { mandatory: false }),
    varchar("upc", 40, { mandatory: false }),
    varchar("gtin", 40, { mandatory: false }),
    varchar("size_label", 40, { mandatory: false }),
    varchar("size_unit", 20, { mandatory: false, indexed: false }),
    varchar("volume_label", 40, { mandatory: false, indexed: false }),
    varchar("weight_label", 40, { mandatory: false, indexed: false }),
    varchar("color_name", 60, { mandatory: false }),
    varchar("shade", 60, { mandatory: false }),
    varchar("finish", 60, { mandatory: false }),
    dbl("cost_price", { mandatory: false }),
    dbl("tax_percent", { mandatory: false }),
  ],
  Inventory: [
    bigint("quantity_committed", { mandatory: false, indexed: false, def: 0 }),
    bigint("quantity_in_transit", { mandatory: false, indexed: false, def: 0 }),
    bigint("quantity_damaged", { mandatory: false, indexed: false, def: 0 }),
    bigint("safety_stock", { mandatory: false, indexed: false, def: 0 }),
    bigint("reorder_quantity", { mandatory: false, indexed: false, def: 0 }),
    bool("allow_negative", { def: "false" }),
  ],
  Stock_Movements: [
    bigint("before_quantity", { mandatory: false, indexed: false, def: 0 }),
    bigint("after_quantity", { mandatory: false, indexed: false, def: 0 }),
    varchar("performed_by", 120, { mandatory: false }),
    varchar("reason", 120, { mandatory: false, indexed: false }),
  ],
  Categories: [
    varchar("status", 20, { mandatory: false, def: "PUBLISHED" }),
    varchar("seo_title", 180, { mandatory: false, indexed: false }),
    varchar("seo_description", 255, { mandatory: false, indexed: false }),
    varchar("meta_keywords", 255, { mandatory: false, indexed: false }),
    varchar("canonical_url", 255, { mandatory: false, indexed: false }),
  ],
  Brands: [
    varchar("seo_title", 180, { mandatory: false, indexed: false }),
    varchar("seo_description", 255, { mandatory: false, indexed: false }),
    varchar("status", 20, { mandatory: false, def: "PUBLISHED" }),
  ],
};

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTable(api, name) {
  const res = await api.post(`/baas/v1/project/${PROJECT_ID}/table`, {
    body: { table_name: name },
    json: true,
    headers: { "Catalyst-org": ORG_ID, Environment: ENV },
  });
  if (res.status >= 400 || res.body?.status === "failure") {
    throw new Error(`createTable ${name}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}

async function addColumns(api, tableId, columns) {
  if (!columns.length) return [];
  const url = `/baas/v1/project/${PROJECT_ID}/table/${tableId}/column`;
  const res = await api.post(url, {
    body: columns,
    json: true,
    headers: { "Catalyst-org": ORG_ID, Environment: ENV },
  });
  if (res.status >= 400 || res.body?.status === "failure") {
    throw new Error(`addColumns ${tableId}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data || [];
}

async function main() {
  const dc = getActiveDC();
  Credential.init(config.get(dc + ".credential"));
  const api = new API({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  });
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: String(ORG_ID),
  });

  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), t.table_id || t.id])
  );

  const report = { createdTables: [], alteredTables: [], skipped: [], errors: [] };

  for (const [name, columns] of Object.entries(NEW_TABLES)) {
    try {
      let tableId = byName.get(name);
      if (!tableId) {
        const created = await createTable(api, name);
        tableId = created.table_id || created.id;
        byName.set(name, tableId);
        report.createdTables.push(name);
        console.log("CREATED TABLE", name, tableId);
        await sleep(400);
      } else {
        console.log("TABLE EXISTS", name, tableId);
      }

      const existing = await ds.getColumnDetails(tableId);
      const existingNames = new Set(existing.map((c) => c.column_name));
      // product_id may already exist on Product_Categories from probe
      const missing = columns.filter((c) => !existingNames.has(c.column_name));
      if (!missing.length) {
        report.skipped.push(name + ":columns");
        continue;
      }
      // batch in chunks of 6
      for (let i = 0; i < missing.length; i += 6) {
        const chunk = missing.slice(i, i + 6);
        await addColumns(api, tableId, chunk);
        console.log("ADDED", name, chunk.map((c) => c.column_name).join(", "));
        await sleep(350);
      }
      report.alteredTables.push(name);
    } catch (error) {
      report.errors.push({ table: name, error: error.message });
      console.error("ERROR", name, error.message);
    }
  }

  for (const [name, columns] of Object.entries(ALTER_COLUMNS)) {
    try {
      const tableId = byName.get(name);
      if (!tableId) {
        report.errors.push({ table: name, error: "table missing" });
        continue;
      }
      const existing = await ds.getColumnDetails(tableId);
      const existingNames = new Set(existing.map((c) => c.column_name));
      const missing = columns.filter((c) => !existingNames.has(c.column_name));
      if (!missing.length) {
        report.skipped.push(name + ":no-new-cols");
        continue;
      }
      for (let i = 0; i < missing.length; i += 5) {
        const chunk = missing.slice(i, i + 5);
        await addColumns(api, tableId, chunk);
        console.log("ALTERED", name, chunk.map((c) => c.column_name).join(", "));
        await sleep(350);
      }
      report.alteredTables.push(name);
    } catch (error) {
      report.errors.push({ table: name, error: error.message });
      console.error("ERROR ALTER", name, error.message);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
