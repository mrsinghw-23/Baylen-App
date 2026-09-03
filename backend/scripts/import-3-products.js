#!/usr/bin/env node
"use strict";

/**
 * Fix format-only issues on the 3 user products, ensure brand/warehouse,
 * then import into Catalyst via admin import API.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

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
const endpoints = require(path.join(CLI_LIB, "endpoints"));
const { ALL_HEADERS, templateHeaderRow } = require("../functions/baylen-api/lib/csv-contract");

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";
const BASE = "https://baylen-app-60069781151.development.catalystserverless.in";
const CSV_PATH = path.join(
  __dirname,
  "..",
  "docs",
  "catalog-import",
  "baylen-product-import-template.csv"
);
const READY_PATH = path.join(
  __dirname,
  "..",
  "docs",
  "catalog-import",
  "baylen-3-products-ready.csv"
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(list, table) {
  return (list || []).map((item) => {
    if (item && item[table]) return item[table];
    if (item && typeof item === "object") {
      const nested = Object.values(item)[0];
      if (nested && typeof nested === "object") return nested;
    }
    return item;
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v || "").trim()));
}

function esc(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function cleanMoney(v) {
  return String(v || "")
    .replace(/[^\d.-]/g, "")
    .trim();
}

function semiToPipe(v) {
  return String(v || "")
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .join("|");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function requestJson(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (_) {
            json = { raw: data };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sqlQuote(value) {
  return "'" + String(value || "").replace(/'/g, "''") + "'";
}

async function ensureCategoryPath(zcql, categoryTable, pathValue) {
  const parts = String(pathValue || "")
    .split(">")
    .map((p) => p.trim())
    .filter(Boolean);
  let parentId = null;
  let current = null;
  for (const name of parts) {
    let query =
      "SELECT ROWID, name, slug, parent_category_id FROM Categories WHERE name = " +
      sqlQuote(name) +
      " AND is_active = true";
    if (parentId) query += " AND parent_category_id = " + parentId;
    else query += " AND parent_category_id IS NULL";
    let rows = unwrap(await zcql.query(query), "Categories");
    current = rows[0] || null;
    if (!current) {
      // fallback by slug under same parent
      const slug = slugify(name);
      let slugQuery =
        "SELECT ROWID, name, slug, parent_category_id FROM Categories WHERE slug = " +
        sqlQuote(slug) +
        " AND is_active = true";
      if (parentId) slugQuery += " AND parent_category_id = " + parentId;
      rows = unwrap(await zcql.query(slugQuery), "Categories");
      current = rows[0] || null;
    }
    if (!current) {
      const slugBase = slugify((parentId ? String(parentId) + "-" : "") + name);
      const inserted = await categoryTable.insertRow({
        name,
        slug: slugBase.slice(0, 180),
        category_type: "PRODUCT",
        parent_category_id: parentId,
        display_order: 0,
        is_active: "true",
        status: "PUBLISHED",
        description: name,
        image_url: "",
      });
      current = {
        ROWID: inserted.ROWID || inserted.rowid,
        name,
      };
      await sleep(250);
    }
    parentId = String(current.ROWID);
  }
  return parentId;
}

async function main() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const f = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const funcs = await f.getAllFunctions();
  const fn = funcs.find((x) => x.name === "baylen-api");
  const vars =
    (fn.configuration &&
      fn.configuration.environment &&
      fn.configuration.environment.variables) ||
    {};
  const adminKey = vars.ADMIN_API_KEY || "";
  if (!adminKey) throw new Error("ADMIN_API_KEY missing on baylen-api");

  const zcql = await endpoints.zcqlAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });

  const API = require(path.join(CLI_LIB, "internal", "api")).default;
  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };
  const api = new API(apiOpts);
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );

  async function insertRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    await sleep(300);
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

  const warehouses = unwrap(
    await zcql.query("SELECT ROWID, code, name, is_default, is_active FROM Warehouses"),
    "Warehouses"
  );
  const hq =
    warehouses.find((w) => String(w.code).toUpperCase() === "HQ") ||
    warehouses.find((w) => w.is_default === true || w.is_default === "true") ||
    warehouses[0];
  const warehouseCode = hq ? String(hq.code || "HQ") : "HQ";

  const minimalist = unwrap(
    await zcql.query("SELECT ROWID, name FROM Brands WHERE name = 'Minimalist'"),
    "Brands"
  );
  let brandCreated = null;
  if (!minimalist.length) {
    const created = await insertRow("Brands", {
      name: "Minimalist",
      slug: "minimalist",
      description: "Minimalist",
      logo_url: "",
      banner_url: "",
      website_url: "",
      display_order: 0,
      is_active: "true",
      rating: 0,
      review_count: 0,
    });
    brandCreated = created.ROWID || created.rowid || created;
  } else {
    brandCreated = false;
  }

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  const headers = rows[0].map((h) => String(h || "").trim());
  if (headers.join(",") !== ALL_HEADERS.join(",")) {
    throw new Error("CSV headers do not match contract");
  }

  const formatFixes = [];
  const objects = [];
  for (let i = 1; i < rows.length; i++) {
    const raw = {};
    headers.forEach((h, idx) => {
      raw[h] = String(rows[i][idx] ?? "").trim();
    });

    const before = { ...raw };
    // Format-only fixes (no inventing business content)
    const typeMap = {
      "Face Primer": "SIMPLE",
      "Face Serum": "SIMPLE",
      "Hair Serum": "SIMPLE",
    };
    if (typeMap[raw.product_type]) {
      formatFixes.push({
        row: i + 1,
        field: "product_type",
        from: raw.product_type,
        to: typeMap[raw.product_type],
      });
      raw.product_type = typeMap[raw.product_type];
    }
    for (const f of ["mrp", "selling_price", "cost_price", "tax_percent"]) {
      const cleaned = cleanMoney(raw[f]);
      if (cleaned !== raw[f]) {
        formatFixes.push({ row: i + 1, field: f, from: raw[f], to: cleaned });
        raw[f] = cleaned;
      }
    }
    for (const f of [
      "skin_types",
      "hair_types",
      "concerns",
      "ingredients",
      "tags",
      "extra_categories",
    ]) {
      if (raw[f].includes(";")) {
        const next = semiToPipe(raw[f]);
        formatFixes.push({ row: i + 1, field: f, from: raw[f], to: next });
        raw[f] = next;
      }
    }
    if (raw.status && raw.status.toUpperCase() !== raw.status) {
      formatFixes.push({
        row: i + 1,
        field: "status",
        from: raw.status,
        to: raw.status.toUpperCase(),
      });
      raw.status = raw.status.toUpperCase();
    }
    if (raw.warehouse_code !== warehouseCode) {
      formatFixes.push({
        row: i + 1,
        field: "warehouse_code",
        from: raw.warehouse_code,
        to: warehouseCode,
        reason: "WH-MUM-01 not present; using existing warehouse " + warehouseCode,
      });
      raw.warehouse_code = warehouseCode;
    }

    // Ensure category path exists (create missing nodes if needed)
    await ensureCategoryPath(zcql, { insertRow: (p) => insertRow("Categories", p) }, raw.category_path);
    if (raw.extra_categories) {
      for (const p of raw.extra_categories.split("|").map((x) => x.trim()).filter(Boolean)) {
        await ensureCategoryPath(zcql, { insertRow: (row) => insertRow("Categories", row) }, p);
      }
    }

    objects.push(raw);
  }

  const outLines = [templateHeaderRow()];
  for (const row of objects) {
    outLines.push(ALL_HEADERS.map((h) => esc(row[h] ?? "")).join(","));
  }
  const csvText = outLines.join("\n") + "\n";
  fs.writeFileSync(READY_PATH, csvText);
  // Also update the template file with corrected import-ready rows
  fs.writeFileSync(CSV_PATH, csvText);

  const preview = await requestJson(
    "POST",
    "/v1/admin/imports/preview",
    { csv_text: csvText, mode: "UPSERT" },
    { "X-Baylen-Admin-Key": adminKey }
  );

  const confirm = await requestJson(
    "POST",
    "/v1/admin/imports",
    {
      csv_text: csvText,
      mode: "UPSERT",
      confirm: true,
      filename: "baylen-3-products-ready.csv",
    },
    { "X-Baylen-Admin-Key": adminKey }
  );

  // rebuild search index
  const rebuild = await requestJson(
    "POST",
    "/v1/admin/search/rebuild",
    {},
    { "X-Baylen-Admin-Key": adminKey }
  );

  const products = await requestJson("GET", "/v1/catalog/products?page=1&limit=20", null, {});
  const home = await requestJson("GET", "/v1/catalog/shop-home", null, {});

  console.log(
    JSON.stringify(
      {
        format_fixes: formatFixes,
        brand_created_minimalist: !!brandCreated,
        warehouse_used: warehouseCode,
        warehouses_available: warehouses.map((w) => w.code),
        ready_csv: READY_PATH,
        preview_status: preview.status,
        preview: preview.json,
        import_status: confirm.status,
        import: confirm.json,
        rebuild_status: rebuild.status,
        rebuild: rebuild.json,
        live_products_total: products.json?.data?.pagination?.total,
        live_products: (products.json?.data?.products || []).map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.selling_price,
        })),
        glow_count: (home.json?.data?.glow_products || []).length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
