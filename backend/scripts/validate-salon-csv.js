"use strict";

const fs = require("fs");
const path = require("path");

const {
  PACKAGE_CSV_FILES,
  PACKAGE_CSV_COLUMNS,
  PACKAGE_TIERS,
  SERVICE_CATEGORIES,
  packageCsvHeaderRow,
} = require("../functions/baylen-api/lib/salon-csv-contract");

const salonDir = path.resolve(__dirname, "../seeds/salon");
const expectedHeader = packageCsvHeaderRow();

function parseCsv(text) {
  const lines = String(text || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map((cell) => cell.replace(/^"|"$/g, "").trim());
  const rows = lines.slice(1).map((line) => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
  return { headers, rows };
}

function validateFile(tier, filename) {
  const filePath = path.join(salonDir, filename);
  const errors = [];
  if (!fs.existsSync(filePath)) {
    return [`Missing file: ${filename}`];
  }
  const text = fs.readFileSync(filePath, "utf8");
  const { headers, rows } = parseCsv(text);
  const headerLine = headers.join(",");
  if (headerLine !== expectedHeader) {
    errors.push(`${filename}: header mismatch`);
  }
  const required = PACKAGE_CSV_COLUMNS.filter((col) => col.required).map((col) => col.key);
  const seenServiceKeys = new Set();
  const seenStaffIds = new Set();

  rows.forEach((row, index) => {
    const label = `${filename} row ${index + 2}`;
    for (const key of required) {
      if (!String(row[key] || "").trim()) {
        errors.push(`${label}: missing required ${key}`);
      }
    }
    const pkg = String(row.package_category || "").toUpperCase();
    if (pkg && pkg !== tier) {
      errors.push(`${label}: package_category must be ${tier}, got ${pkg}`);
    }
    const serviceCategory = String(row.service_category || "").trim();
    if (serviceCategory && !SERVICE_CATEGORIES.includes(serviceCategory)) {
      errors.push(`${label}: invalid service_category ${serviceCategory}`);
    }
    const serviceKey = [
      row.salon_code,
      row.package_code,
      row.service_code,
      String(row.service_gender || "BOTH").toUpperCase(),
      row.staff_id || "",
    ].join("|");
    if (row.service_code && seenServiceKeys.has(serviceKey)) {
      errors.push(`${label}: duplicate salon_code+package_code+service_code+service_gender+staff_id`);
    }
    if (row.service_code) seenServiceKeys.add(serviceKey);
    if (row.staff_id) {
      const staffKey = `${row.salon_code}|${row.staff_id}`;
      if (seenStaffIds.has(staffKey) && row.service_code) {
        /* staff may appear on multiple service rows — allowed */
      }
      seenStaffIds.add(staffKey);
    }
  });

  return { errors, rowCount: rows.length };
}

function main() {
  console.log("Salon package CSV validation\n");
  let totalErrors = [];
  let totalRows = 0;

  for (const tier of PACKAGE_TIERS) {
    const filename = PACKAGE_CSV_FILES[tier];
    const result = validateFile(tier, filename);
    if (Array.isArray(result)) {
      totalErrors.push(...result);
      console.log(`${filename}: MISSING`);
      continue;
    }
    totalRows += result.rowCount;
    totalErrors.push(...result.errors);
    console.log(`${filename}: ${result.rowCount} data rows, ${result.errors.length} errors`);
  }

  if (totalRows === 0) {
    console.log("\nNote: templates are header-only — add real data before import.");
  }

  if (totalErrors.length) {
    console.error("\nErrors:");
    totalErrors.slice(0, 40).forEach((item) => console.error("  -", item));
    process.exit(1);
  }

  console.log("\nOK — all salon package CSVs are valid.");
}

main();
