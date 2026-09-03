"use strict";

const fs = require("fs");
const path = require("path");
const {
  PACKAGE_CSV_COLUMNS,
  PACKAGE_TIERS,
  SERVICE_CATEGORIES,
  packageCsvHeaderRow,
} = require("./salon-csv-contract");
const { fetchAllTableRows } = require("./paged");
const { asId, num, optionalText, rowOf, rowsOf, sqlString, isTruthy } = require("./http");

const REQUIRED_HEADERS = PACKAGE_CSV_COLUMNS.filter((col) => col.required).map((col) => col.key);
const STAFF_EMAIL_DOMAIN = "@staff.baylen.local";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((item) => item.some((value) => String(value || "").trim()));
}

function csvObjects(csvText, { maxRows = 50000 } = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 1) {
    return [];
  }
  const headers = rows[0].map((header) => String(header || "").trim());
  if (rows.length === 1) {
    return [];
  }
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    const error = new Error("CSV missing required headers: " + missing.join(", "));
    error.status = 400;
    error.code = "MISSING_HEADERS";
    throw error;
  }
  if (rows.length - 1 > maxRows) {
    const error = new Error("CSV supports up to " + maxRows + " data rows per import");
    error.status = 400;
    throw error;
  }
  return rows.slice(1).map((row, index) => {
    const record = { row_number: index + 2 };
    headers.forEach((header, columnIndex) => {
      if (header) record[header] = String(row[columnIndex] || "").trim();
    });
    return record;
  });
}

function parseBool(value, defaultValue) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return defaultValue;
  if (["true", "1", "yes", "y"].includes(text)) return true;
  if (["false", "0", "no", "n"].includes(text)) return false;
  return defaultValue;
}

function parseMoney(value) {
  const text = String(value || "").replace(/[,₹]/g, "").trim();
  if (!text) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

function normalizeServiceGenderRow(record) {
  const gender = String(record.service_gender || "")
    .trim()
    .toUpperCase();
  if (!gender || gender === "UNISEX") {
    return record;
  }
  const normalized = { ...record, service_gender: gender };
  if (gender === "MALE") {
    normalized.male_service_available = "true";
    normalized.female_service_available = "false";
    normalized.both_service_available = "false";
  } else if (gender === "FEMALE") {
    normalized.male_service_available = "false";
    normalized.female_service_available = "true";
    normalized.both_service_available = "false";
  }
  return normalized;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
}

function staffImportEmail(staffId) {
  return (
    "import+" +
    String(staffId || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, 80) +
    STAFF_EMAIL_DOMAIN
  );
}

function splitStaffName(fullName) {
  const text = String(fullName || "").trim();
  if (!text) return { first_name: "Staff", last_name: "" };
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

function buildServiceDescription(record) {
  const parts = [String(record.service_description || "").trim()];
  const keywords = String(record.search_keywords || "").trim();
  const aliases = String(record.search_aliases || "").trim();
  const tags = String(record.tags || "").trim();
  if (keywords) parts.push("Keywords: " + keywords);
  if (aliases) parts.push("Aliases: " + aliases);
  if (tags) parts.push("Tags: " + tags);
  return parts.filter(Boolean).join("\n").slice(0, 1000);
}

function combineCsvFiles(filePaths) {
  const chunks = [];
  let headerWritten = false;
  for (const filePath of filePaths) {
    const text = fs.readFileSync(filePath, "utf8");
    const rows = parseCsv(text);
    if (!rows.length) continue;
    const header = rows[0].join(",");
    const body = rows.slice(1).filter((row) => row.some((cell) => String(cell || "").trim()));
    if (!body.length) continue;
    if (!headerWritten) {
      chunks.push(header);
      headerWritten = true;
    }
    chunks.push(...body.map((row) => row.join(",")));
  }
  return chunks.join("\n") + (chunks.length ? "\n" : "");
}

const SERVICE_CATEGORY_SLUGS = {
  Hair: "salon-hair",
  Skin: "salon-skin",
  Nails: "salon-nails",
  Spa: "salon-hair",
  Bridal: "salon-skin",
};

async function loadReferenceMaps(app) {
  const zcql = app.zcql();
  const outlets = rowsOf(
    await zcql.executeZCQLQuery("SELECT ROWID, code FROM Outlets"),
    "Outlets"
  );
  const packages = rowsOf(
    await zcql.executeZCQLQuery("SELECT ROWID, slug, name FROM Salon_Packages"),
    "Salon_Packages"
  );
  const categories = rowsOf(
    await zcql.executeZCQLQuery("SELECT ROWID, slug, name FROM Categories WHERE is_active = true"),
    "Categories"
  );
  const outletByCode = new Map(
    outlets.map((row) => [String(row.code || "").toUpperCase(), String(row.ROWID)])
  );
  const outletById = new Map(outlets.map((row) => [String(row.ROWID), String(row.ROWID)]));
  const packageBySlug = new Map(
    packages.map((row) => [String(row.slug || "").toLowerCase(), String(row.ROWID)])
  );
  const packageByName = new Map(
    packages.map((row) => [String(row.name || "").toLowerCase(), String(row.ROWID)])
  );
  const categoryBySlug = new Map(
    categories.map((row) => [String(row.slug || "").toLowerCase(), String(row.ROWID)])
  );
  const categoryByName = new Map(
    categories.map((row) => [String(row.name || "").toLowerCase(), String(row.ROWID)])
  );
  return { outletByCode, outletById, packageBySlug, packageByName, categoryBySlug, categoryByName };
}

function resolveCategoryId(serviceCategory, refs) {
  const label = String(serviceCategory || "").trim();
  if (!label) return "";
  const slug = SERVICE_CATEGORY_SLUGS[label] || "salon-" + label.toLowerCase();
  return (
    refs.categoryBySlug.get(slug) ||
    refs.categoryByName.get(label.toLowerCase()) ||
    refs.categoryBySlug.get("salon-hair") ||
    ""
  );
}

async function validateSalonRecord(app, record, refs, seenKeys) {
  record = normalizeServiceGenderRow(record);
  const errors = [];
  const warnings = [];
  const rowLabel = "row " + record.row_number;
  const serviceGender = String(record.service_gender || "")
    .trim()
    .toUpperCase();

  let outletId = String(record.salon_id || "").trim();
  const salonCode = String(record.salon_code || "").trim().toUpperCase();
  if (!outletId && salonCode) {
    outletId = refs.outletByCode.get(salonCode) || "";
  }
  if (outletId && !refs.outletById.has(outletId)) {
    errors.push({ field: "salon_id", message: "Unknown salon_id" });
    outletId = refs.outletByCode.get(salonCode) || "";
  }
  if (!outletId) {
    errors.push({ field: "salon_code", message: "salon_code must match an existing Outlets.code" });
  }

  const packageCode = String(record.package_code || "").trim().toLowerCase();
  const packageCategory = String(record.package_category || "").trim().toUpperCase();
  if (packageCategory && !PACKAGE_TIERS.includes(packageCategory)) {
    errors.push({ field: "package_category", message: "Invalid package_category" });
  }
  let packageId =
    refs.packageBySlug.get(packageCode) ||
    refs.packageByName.get(packageCode) ||
    refs.packageByName.get(packageCategory.toLowerCase());
  if (!packageId) {
    errors.push({ field: "package_code", message: "Unknown package_code/package_category" });
  }

  const serviceCategory = String(record.service_category || "").trim();
  if (!SERVICE_CATEGORIES.includes(serviceCategory)) {
    errors.push({ field: "service_category", message: "Invalid service_category" });
  }

  const duration = num(record.duration_minutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    errors.push({ field: "duration_minutes", message: "duration_minutes must be a positive number" });
  }

  const malePrice = parseMoney(record.male_price);
  const femalePrice = parseMoney(record.female_price);
  const bothPrice = parseMoney(record.both_price);
  const maleAvailable = parseBool(record.male_service_available, malePrice != null);
  const femaleAvailable = parseBool(record.female_service_available, femalePrice != null);
  const bothAvailable = parseBool(record.both_service_available, bothPrice != null);

  if (!maleAvailable && !femaleAvailable && !bothAvailable) {
    warnings.push({ field: "service_available", message: "No gender pricing enabled on row" });
  }
  if (serviceGender && !["MALE", "FEMALE", "UNISEX"].includes(serviceGender)) {
    errors.push({ field: "service_gender", message: "service_gender must be MALE, FEMALE, or UNISEX" });
  }
  if (serviceGender === "MALE" && malePrice == null) {
    errors.push({ field: "male_price", message: "male_price required when service_gender is MALE" });
  }
  if (serviceGender === "FEMALE" && femalePrice == null) {
    errors.push({ field: "female_price", message: "female_price required when service_gender is FEMALE" });
  }
  if (maleAvailable && malePrice == null) {
    errors.push({ field: "male_price", message: "male_price required when male_service_available is true" });
  }
  if (femaleAvailable && femalePrice == null) {
    errors.push({ field: "female_price", message: "female_price required when female_service_available is true" });
  }
  if (bothAvailable && bothPrice == null) {
    errors.push({ field: "both_price", message: "both_price required when both_service_available is true" });
  }

  const staffId = String(record.staff_id || "").trim();
  const staffName = String(record.staff_name || "").trim();
  if (staffId && !staffName) {
    errors.push({ field: "staff_name", message: "staff_name required when staff_id is set" });
  }

  const dedupeKey = [
    salonCode,
    packageCode,
    String(record.service_code || "").trim().toUpperCase(),
    serviceGender || "BOTH",
    staffId,
  ].join("|");
  if (seenKeys.has(dedupeKey)) {
    errors.push({ field: "service_code", message: "Duplicate row for salon/package/service/staff" });
  } else {
    seenKeys.add(dedupeKey);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    resolved: {
      outlet_id: outletId,
      package_id: packageId || "",
      male_price: malePrice,
      female_price: femalePrice,
      both_price: bothPrice,
      male_available: maleAvailable,
      female_available: femaleAvailable,
      both_available: bothAvailable,
    },
  };
}

async function previewSalonImport(app, csvText, options = {}) {
  const records = csvObjects(csvText);
  const refs = await loadReferenceMaps(app);
  const seenKeys = new Set();
  const rows = [];
  for (const record of records) {
    const result = await validateSalonRecord(app, record, refs, seenKeys);
    rows.push({
      row_number: record.row_number,
      salon_code: record.salon_code,
      package_code: record.package_code,
      service_code: record.service_code,
      staff_id: record.staff_id || "",
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
      resolved: result.resolved,
    });
  }
  const validRows = rows.filter((row) => row.ok).length;
  return {
    total_rows: records.length,
    valid_rows: validRows,
    invalid_rows: records.length - validRows,
    rows: rows.slice(0, options.previewLimit || 200),
    all_valid: validRows === records.length,
  };
}

async function resolveOutletId(app, record, refs) {
  const explicit = String(record.salon_id || "").trim();
  if (explicit && refs.outletById.has(explicit)) return explicit;
  const code = String(record.salon_code || "").trim().toUpperCase();
  return refs.outletByCode.get(code) || "";
}

async function resolvePackageId(record, refs) {
  const slug = String(record.package_code || "").trim().toLowerCase();
  return (
    refs.packageBySlug.get(slug) ||
    refs.packageByName.get(slug) ||
    refs.packageByName.get(String(record.package_category || "").trim().toLowerCase()) ||
    ""
  );
}

async function upsertSalonService(app, record, refs) {
  const zcql = app.zcql();
  const serviceCode = String(record.service_code || "").trim();
  const slug = slugify(record.service_slug || serviceCode);
  const name = String(record.service_name || "").trim();
  let rowId = String(record.service_id || "").trim();
  const categoryId = resolveCategoryId(record.service_category, refs);

  if (!rowId) {
    const bySlug = rowOf(
      await zcql.executeZCQLQuery("SELECT ROWID FROM Salon_Services WHERE slug = " + sqlString(slug)),
      "Salon_Services"
    );
    rowId = bySlug ? String(bySlug.ROWID) : "";
  }

  const payload = {
    name,
    slug,
    description: buildServiceDescription(record),
    category_id: categoryId || null,
    image_url: optionalText(record.service_image, "service_image", 500) || null,
    duration_minutes: Math.max(1, Math.round(num(record.duration_minutes) || 45)),
    gender: "UNISEX",
    mrp: parseMoney(record.male_price) || parseMoney(record.female_price) || parseMoney(record.both_price),
    selling_price:
      parseMoney(record.male_price) || parseMoney(record.female_price) || parseMoney(record.both_price),
    currency: "INR",
    status: optionalText(record.status, "status", 20) || "ACTIVE",
    is_active: parseBool(record.service_available, true),
    service_type: String(record.service_category || "").trim() || "Hair",
    display_order: Math.max(0, Math.round(num(record.sort_order) || 0)),
  };

  if (rowId) {
    await app.datastore().table("Salon_Services").updateRow({ ROWID: rowId, ...payload });
    return { id: rowId, action: "updated" };
  }
  const inserted = await app.datastore().table("Salon_Services").insertRow(payload);
  rowId = String(inserted.ROWID || inserted.rowid || "");
  return { id: rowId, action: "created" };
}

async function ensureOutletPackage(app, outletId, packageId) {
  const zcql = app.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Outlet_Packages WHERE outlet_id = " +
        outletId +
        " AND package_id = " +
        packageId
    ),
    "Outlet_Packages"
  );
  if (existing) {
    await app.datastore().table("Outlet_Packages").updateRow({
      ROWID: String(existing.ROWID),
      is_active: true,
    });
    return { action: "updated" };
  }
  await app.datastore().table("Outlet_Packages").insertRow({
    outlet_id: outletId,
    package_id: packageId,
    is_active: true,
  });
  return { action: "created" };
}

async function upsertOutletServicePrice(app, outletId, packageId, serviceId, gender, sellingPrice, durationMinutes) {
  const zcql = app.zcql();
  const normalizedGender = String(gender || "UNISEX").toUpperCase();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Outlet_Service_Prices WHERE outlet_id = " +
        outletId +
        " AND package_id = " +
        packageId +
        " AND service_id = " +
        serviceId +
        " AND gender = " +
        sqlString(normalizedGender)
    ),
    "Outlet_Service_Prices"
  );
  const mrp = Math.round((sellingPrice || 0) * 1.2 * 100) / 100;
  const payload = {
    outlet_id: outletId,
    package_id: packageId,
    service_id: serviceId,
    gender: normalizedGender,
    mrp,
    selling_price: sellingPrice,
    duration_minutes: Math.max(1, Math.round(num(durationMinutes) || 45)),
    is_active: true,
  };
  if (existing) {
    await app.datastore().table("Outlet_Service_Prices").updateRow({
      ROWID: String(existing.ROWID),
      ...payload,
    });
    return { id: String(existing.ROWID), action: "updated" };
  }
  const inserted = await app.datastore().table("Outlet_Service_Prices").insertRow(payload);
  return { id: String(inserted.ROWID || inserted.rowid || ""), action: "created" };
}

async function upsertStaffMember(app, outletId, record) {
  const staffId = String(record.staff_id || "").trim();
  const email = staffImportEmail(staffId);
  const zcql = app.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery("SELECT ROWID FROM Staff WHERE email = " + sqlString(email)),
    "Staff"
  );
  const names = splitStaffName(record.staff_name);
  const payload = {
    first_name: names.first_name,
    last_name: names.last_name,
    designation: "Stylist",
    outlet_id: outletId,
    gender: optionalText(record.staff_gender, "staff_gender", 20) || null,
    rating: num(record.staff_rating) || null,
    experience_years: num(record.staff_experience_years) || null,
    profile_photo_url: optionalText(record.staff_profile_image, "staff_profile_image", 500) || null,
    profile_image: optionalText(record.staff_profile_image, "staff_profile_image", 500) || null,
    email,
    status: "ACTIVE",
    is_active: true,
  };
  if (existing) {
    await app.datastore().table("Staff").updateRow({ ROWID: String(existing.ROWID), ...payload });
    return { id: String(existing.ROWID), action: "updated" };
  }
  const inserted = await app.datastore().table("Staff").insertRow(payload);
  return { id: String(inserted.ROWID || inserted.rowid || ""), action: "created" };
}

async function upsertStaffService(app, staffRowId, serviceRowId) {
  const zcql = app.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Staff_Services WHERE staff_id = " +
        staffRowId +
        " AND service_id = " +
        serviceRowId
    ),
    "Staff_Services"
  );
  if (existing) {
    await app.datastore().table("Staff_Services").updateRow({
      ROWID: String(existing.ROWID),
      is_active: true,
    });
    return { id: String(existing.ROWID), action: "updated" };
  }
  const inserted = await app.datastore().table("Staff_Services").insertRow({
    staff_id: staffRowId,
    service_id: serviceRowId,
    is_active: true,
  });
  return { id: String(inserted.ROWID || inserted.rowid || ""), action: "created" };
}

async function importSalonRecords(app, csvText, options = {}) {
  const preview = await previewSalonImport(app, csvText, options);
  if (!preview.all_valid && !options.allow_invalid) {
    const error = new Error("Salon import has " + preview.invalid_rows + " invalid rows");
    error.status = 400;
    error.details = preview.rows.filter((row) => !row.ok);
    throw error;
  }

  const records = csvObjects(csvText);
  const refs = await loadReferenceMaps(app);
  const summary = {
    total_rows: records.length,
    services_created: 0,
    services_updated: 0,
    prices_created: 0,
    prices_updated: 0,
    staff_created: 0,
    staff_updated: 0,
    staff_links_created: 0,
    staff_links_updated: 0,
    skipped_rows: 0,
    failed_rows: 0,
  };

  const seenKeys = new Set();
  for (const rawRecord of records) {
    const record = normalizeServiceGenderRow(rawRecord);
    const validation = await validateSalonRecord(app, record, refs, seenKeys);
    if (!validation.ok) {
      summary.skipped_rows += 1;
      continue;
    }
    try {
      const outletId = validation.resolved.outlet_id;
      const packageId = validation.resolved.package_id;
      const service = await upsertSalonService(app, record, refs);
      if (service.action === "created") summary.services_created += 1;
      else summary.services_updated += 1;

      await ensureOutletPackage(app, outletId, packageId);

      const duration = record.duration_minutes;
      if (validation.resolved.male_available && validation.resolved.male_price != null) {
        const price = await upsertOutletServicePrice(
          app,
          outletId,
          packageId,
          service.id,
          "MALE",
          validation.resolved.male_price,
          duration
        );
        if (price.action === "created") summary.prices_created += 1;
        else summary.prices_updated += 1;
      }
      if (validation.resolved.female_available && validation.resolved.female_price != null) {
        const price = await upsertOutletServicePrice(
          app,
          outletId,
          packageId,
          service.id,
          "FEMALE",
          validation.resolved.female_price,
          duration
        );
        if (price.action === "created") summary.prices_created += 1;
        else summary.prices_updated += 1;
      }
      if (validation.resolved.both_available && validation.resolved.both_price != null) {
        const price = await upsertOutletServicePrice(
          app,
          outletId,
          packageId,
          service.id,
          "UNISEX",
          validation.resolved.both_price,
          duration
        );
        if (price.action === "created") summary.prices_created += 1;
        else summary.prices_updated += 1;
      }

      const staffCode = String(record.staff_id || "").trim();
      if (staffCode) {
        const staff = await upsertStaffMember(app, outletId, record);
        if (staff.action === "created") summary.staff_created += 1;
        else summary.staff_updated += 1;
        const link = await upsertStaffService(app, staff.id, service.id);
        if (link.action === "created") summary.staff_links_created += 1;
        else summary.staff_links_updated += 1;
      }
    } catch (error) {
      summary.failed_rows += 1;
      if (!options.continue_on_error) throw error;
    }
  }

  return { preview, summary };
}

async function cleanupSalonServiceData(app, { dryRun = true } = {}) {
  const tables = ["Staff_Services", "Outlet_Service_Prices", "Salon_Services", "Staff"];
  const backup = {};
  for (const tableName of tables) {
    const rows = await fetchAllTableRows(app, tableName);
    backup[tableName] = rows.length;
    if (!dryRun) {
      for (const row of rows) {
        const id = row.ROWID || row.rowid;
        if (!id) continue;
        await app.datastore().table(tableName).deleteRow(id);
      }
    }
  }
  return { dry_run: dryRun, deleted: backup };
}

function defaultSalonSeedPaths(rootDir) {
  const salonDir = path.join(rootDir, "backend", "seeds", "salon");
  return PACKAGE_TIERS.map((tier) => path.join(salonDir, `salon-${tier.toLowerCase()}.csv`));
}

module.exports = {
  REQUIRED_HEADERS,
  parseCsv,
  csvObjects,
  combineCsvFiles,
  previewSalonImport,
  importSalonRecords,
  cleanupSalonServiceData,
  packageCsvHeaderRow,
  defaultSalonSeedPaths,
};
