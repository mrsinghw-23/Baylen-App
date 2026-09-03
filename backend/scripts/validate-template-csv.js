#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { ALL_HEADERS, REQUIRED_HEADERS, splitPipe } = require("../functions/baylen-api/lib/csv-contract");

const csvPath = path.join(__dirname, "..", "docs", "catalog-import", "baylen-product-import-template.csv");

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(d));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
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
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v || "").trim()));
}

function isNumberLike(v) {
  const s = String(v || "").trim();
  if (!s) return false;
  return /^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""));
}

(async () => {
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  const headers = rows[0].map((h) => String(h || "").trim());
  const headerOk =
    headers.length === ALL_HEADERS.length && headers.every((h, i) => h === ALL_HEADERS[i]);

  const brandsJson = await get(
    "https://baylen-app-60069781151.development.catalystserverless.in/v1/catalog/brands"
  );
  const brandNames = (brandsJson.data.brands || []).map((b) => String(b.name || ""));
  const brandSlugs = (brandsJson.data.brands || []).map((b) => String(b.slug || "").toLowerCase());

  function brandExists(name) {
    const n = String(name || "").trim().toLowerCase();
    return (
      brandNames.some((b) => b.toLowerCase() === n) ||
      brandSlugs.includes(n.replace(/\s+/g, "-"))
    );
  }

  const report = {
    file: csvPath,
    catalyst_products_total: 0,
    header_matches_contract: headerOk,
    data_rows: rows.length - 1,
    rows: [],
    blocking_issues: [],
  };

  const productsJson = await get(
    "https://baylen-app-60069781151.development.catalystserverless.in/v1/catalog/products?page=1&limit=1"
  );
  report.catalyst_products_total = productsJson.data?.pagination?.total ?? null;

  const seenCodes = new Map();
  const seenSkus = new Map();

  for (let i = 1; i < rows.length; i++) {
    const raw = {};
    headers.forEach((h, idx) => {
      raw[h] = String(rows[i][idx] ?? "").trim();
    });
    const issues = [];
    const missingRequired = REQUIRED_HEADERS.filter((k) => !raw[k]);
    if (missingRequired.length) issues.push("Missing required: " + missingRequired.join(", "));

    if (raw.product_type && !["SIMPLE", "VARIABLE"].includes(raw.product_type.toUpperCase())) {
      issues.push(
        `Invalid product_type "${raw.product_type}" (must be SIMPLE or VARIABLE, not a product category name)`
      );
    }
    for (const moneyField of ["mrp", "selling_price", "cost_price", "tax_percent"]) {
      if (raw[moneyField] && !isNumberLike(raw[moneyField])) {
        issues.push(`Invalid ${moneyField} "${raw[moneyField]}" (numbers only, no currency symbol/? )`);
      }
    }
    if (raw.status && !["ACTIVE", "DRAFT", "ARCHIVED", "INACTIVE"].includes(raw.status.toUpperCase())) {
      issues.push(`Unusual status "${raw.status}" (expected ACTIVE/DRAFT/ARCHIVED/INACTIVE)`);
    }
    if (raw.brand && !brandExists(raw.brand)) {
      issues.push(`Brand not found in live Brands table: "${raw.brand}"`);
    }
    for (const rel of ["skin_types", "hair_types", "concerns", "ingredients", "tags"]) {
      if (raw[rel] && raw[rel].includes(";") && !raw[rel].includes("|")) {
        issues.push(`${rel} uses ';' — contract requires '|' delimiter`);
      }
    }
    if (raw.extra_categories && raw.extra_categories.includes(";") && !raw.extra_categories.includes("|")) {
      issues.push(`extra_categories uses ';' — multiple paths must be delimited by '|'`);
    }
    if (raw.warehouse_code && raw.warehouse_code !== "HQ") {
      issues.push(
        `warehouse_code "${raw.warehouse_code}" may not exist (default warehouse is HQ unless created)`
      );
    }

    const codeKey = raw.product_code.toUpperCase();
    const skuKey = raw.sku.toUpperCase();
    if (codeKey) {
      if (seenCodes.has(codeKey) && seenCodes.get(codeKey) !== i + 1) {
        // same product_code across variants is OK if different SKU
      }
      seenCodes.set(codeKey, (seenCodes.get(codeKey) || 0) + 1);
    }
    if (skuKey) {
      if (seenSkus.has(skuKey)) {
        issues.push(`Duplicate SKU in file: ${raw.sku}`);
      }
      seenSkus.set(skuKey, i + 1);
    }

    const rowReport = {
      row: i + 1,
      product_code: raw.product_code,
      sku: raw.sku,
      product_name: raw.product_name,
      brand: raw.brand,
      category_path: raw.category_path,
      product_type: raw.product_type,
      variant: {
        variant_name: raw.variant_name,
        size: raw.size,
        unit: raw.unit,
        color: raw.color,
        shade: raw.shade,
        finish: raw.finish,
      },
      pricing: {
        mrp: raw.mrp,
        selling_price: raw.selling_price,
        cost_price: raw.cost_price,
      },
      tax_hsn: { tax_percent: raw.tax_percent, hsn_code: raw.hsn_code },
      media: { image_1: raw.image_1, image_2: raw.image_2, image_3: raw.image_3, video_url: raw.video_url },
      inventory: {
        warehouse_code: raw.warehouse_code,
        stock: raw.stock,
        reorder_level: raw.reorder_level,
        reorder_quantity: raw.reorder_quantity,
        safety_stock: raw.safety_stock,
      },
      missing_required: missingRequired,
      issues,
    };
    report.rows.push(rowReport);
    for (const issue of issues) {
      report.blocking_issues.push(`Row ${i + 1} (${raw.sku || raw.product_code}): ${issue}`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
