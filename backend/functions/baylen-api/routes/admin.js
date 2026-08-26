const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { asId, optionalText, rowOf, rowsOf, num, sendOk, sqlString } = require("../lib/http");

const MAX_ADMIN_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = new Set(["product", "service", "outlet"]);
const IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const SCHEMA_CHECKS = [
  ["Categories", ["name", "slug", "description", "category_type", "image_url", "display_order", "is_active"]],
  ["Brands", ["name", "slug", "logo_url", "banner_url", "description", "rating", "review_count", "is_active"]],
  ["Products", ["name", "slug", "sku", "brand_id", "category_id", "product_type", "short_description", "description", "mrp", "selling_price", "currency", "tax_percent", "thumbnail_url", "has_variants", "is_featured", "status"]],
  ["Product_Variants", ["product_id", "sku", "variant_name", "variant_value", "mrp", "selling_price", "currency", "is_active"]],
  ["Product_Media", ["product_id", "variant_id", "media_type", "file_url", "display_order", "is_active"]],
  ["Home_Banners", ["title", "subtitle", "image_url", "video_url", "action_type", "action_value", "display_order", "is_active"]],
  ["Launch_Promos", ["title", "subtitle", "body", "image_url", "video_url", "button_label", "secondary_button_label", "action_type", "action_value", "audience", "show_once", "start_date", "end_date", "display_order", "is_active"]],
  ["Onboarding_Slides", ["title", "subtitle", "body", "image_url", "video_url", "button_label", "secondary_button_label", "action_type", "action_value", "audience", "show_once", "start_date", "end_date", "display_order", "is_active"]],
  ["User_Profiles", ["user_id", "full_name", "mobile", "email", "gender", "date_of_birth", "profile_photo_url", "default_address_id", "loyalty_tier", "loyalty_points", "is_active"]],
  ["Addresses", ["user_id", "label", "full_name", "phone", "line1", "line2", "city", "state", "postal_code", "country", "latitude", "longitude", "is_default", "is_active"]],
  ["Devices", ["user_id", "device_id", "device_type", "platform", "os_version", "app_version", "push_token", "last_active_at", "is_active"]],
  ["Warehouses", ["name", "code", "outlet_id", "address_line1", "city", "state", "is_active"]],
  ["Inventory", ["warehouse_id", "product_id", "variant_id", "quantity_on_hand", "quantity_reserved", "status", "is_active"]],
  ["Stock_Movements", ["inventory_id", "warehouse_id", "product_id", "variant_id", "movement_type", "quantity", "reference_type", "reference_id", "notes"]],
  ["Carts", ["user_id", "guest_session_id", "status", "currency", "coupon_code", "discount_amount", "is_active"]],
  ["Cart_Items", ["cart_id", "product_id", "variant_id", "quantity", "unit_mrp", "unit_price", "is_active"]],
  ["Wishlist", ["user_id", "guest_session_id", "product_id", "variant_id", "is_active"]],
  ["Orders", ["user_id", "order_number", "status", "payment_status", "currency", "subtotal", "discount_amount", "coupon_code", "tax_amount", "shipping_amount", "grand_total", "shipping_name", "shipping_phone", "shipping_line1", "shipping_city", "shipping_state", "shipping_postal_code", "shipping_country", "notes"]],
  ["Order_Items", ["order_id", "product_id", "variant_id", "product_name", "sku", "quantity", "unit_mrp", "unit_price", "tax_percent", "line_total", "status"]],
  ["Order_Timeline", ["order_id", "status", "note", "actor_type", "happened_at"]],
  ["Returns", ["user_id", "order_id", "order_item_id", "reason", "status"]],
  ["Refunds", ["user_id", "reference_type", "reference_id", "payment_id", "amount", "currency", "reason", "status"]],
  ["Outlets", ["name", "slug", "code", "salon_category", "address_line1", "area", "city", "state", "postal_code", "phone", "latitude", "longitude", "opening_time", "closing_time", "rating", "review_count", "image_url", "video_url", "google_maps_url", "is_active"]],
  ["Stores", ["store_name", "latitude", "longitude", "address"]],
  ["Salon_Services", ["name", "slug", "description", "category_id", "image_url", "duration_minutes", "gender", "mrp", "selling_price", "currency", "status", "is_active"]],
  ["Staff", ["first_name", "last_name", "designation", "profile_photo_url", "outlet_id", "experience_years", "rating", "completed_services", "status", "is_active"]],
  ["Staff_Services", ["staff_id", "service_id", "price_override", "is_active"]],
  ["Appointment_Slots", ["outlet_id", "staff_id", "service_id", "slot_date", "start_time", "end_time", "status", "appointment_id"]],
  ["Appointments", ["user_id", "outlet_id", "staff_id", "slot_id", "appointment_number", "appointment_date", "start_time", "end_time", "status", "payment_status", "currency", "subtotal", "discount_amount", "tax_amount", "grand_total"]],
  ["Appointment_Items", ["appointment_id", "service_id", "staff_id", "service_name", "duration_minutes", "quantity", "unit_price", "line_total", "status"]],
  ["Media_Assets", ["media_type", "file_id", "folder_id", "file_name", "file_url", "content_type", "file_size", "mapped_entity_type", "mapped_entity_id", "mapped_field", "is_active"]],
  ["Providers", ["first_name", "last_name", "phone", "rating", "status", "is_active"]],
  ["Provider_Services", ["provider_id", "service_id", "is_active"]],
  ["Service_Areas", ["provider_id", "city", "is_active"]],
  ["Service_Jobs", ["user_id", "appointment_id", "provider_id", "visit_address_id", "visit_line1", "visit_city", "visit_state", "status", "requested_at", "scheduled_at", "grand_total", "currency"]],
  ["Job_Items", ["job_id", "service_id", "service_name", "quantity", "unit_price", "line_total"]],
  ["Job_Dispatch", ["job_id", "provider_id", "status", "offered_at", "accepted_at", "rejected_at", "notes"]],
  ["Job_Timeline", ["job_id", "provider_id", "status", "note", "happened_at"]],
  ["Live_Locations", ["job_id", "provider_id", "latitude", "longitude", "heading", "speed", "status", "recorded_at"]],
  ["Job_Proofs", ["job_id", "provider_id", "file_url", "proof_type", "notes"]],
  ["Reviews", ["user_id", "target_type", "target_id", "rating", "review", "status", "is_active"]],
  ["Coupons", ["code", "title", "description", "discount_type", "discount_value", "min_order_value", "starts_at", "ends_at", "usage_limit", "is_active"]],
  ["Payments", ["user_id", "reference_type", "reference_id", "provider", "provider_order_id", "provider_payment_id", "amount", "currency", "status", "metadata"]],
  ["Notifications", ["user_id", "type", "title", "body", "reference_type", "reference_id", "delivery_status", "read_at"]],
  ["Notification_Preferences", ["user_id", "push_enabled", "email_enabled", "order_updates", "booking_updates", "service_tracking", "offers"]],
  ["Audit_Logs", ["actor_user_id", "actor_type", "action", "entity_type", "entity_id", "before_json", "after_json", "ip_address"]],
];

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    const error = new Error("ADMIN_API_KEY is not configured");
    error.status = 503;
    throw error;
  }
  if (!secureEqual(req.headers["x-baylen-admin-key"], expected)) {
    const error = new Error("Admin authorization required");
    error.status = 403;
    throw error;
  }
}

function adminActor(req) {
  return optionalText(req.headers["x-baylen-admin-user"], "x-baylen-admin-user", 120) || "ADMIN";
}

function jsonText(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value).slice(0, 255);
}

async function writeAuditLog(req, action, entityType, entityId, before, after) {
  try {
    await req.catalystApp.datastore().table("Audit_Logs").insertRow({
      actor_user_id: null,
      actor_type: adminActor(req),
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      before_json: jsonText(before),
      after_json: jsonText(after),
      ip_address:
        optionalText(req.headers["x-forwarded-for"], "x-forwarded-for", 120) ||
        optionalText(req.ip, "ip_address", 120) ||
        null,
    });
  } catch (_) {
    // Audit logging must never break the admin action it is recording.
  }
}

async function safeCount(req, tableName, where) {
  try {
    const query =
      "SELECT ROWID FROM " + tableName + (where ? " WHERE " + where : "");
    const rows = await req.catalystApp.zcql().executeZCQLQuery(query);
    return rowsOf(rows, tableName).length;
  } catch (_) {
    return 0;
  }
}

async function checkSchema(req) {
  const datastore = req.catalystApp.datastore();
  const tables = await datastore.getAllTables();
  const tableMap = new Map();
  for (const table of tables) {
    const details = typeof table.toJSON === "function" ? table.toJSON() : table._tableDetails || {};
    const tableName = details.table_name || details.name || details.tableName || table.identifier;
    const tableId = details.table_id || details.id || table.identifier;
    if (tableName) {
      tableMap.set(String(tableName).toLowerCase(), {
        id: tableId,
        name: tableName,
      });
    }
  }

  const checks = [];
  for (const [tableName, columns] of SCHEMA_CHECKS) {
    const tableMeta = tableMap.get(tableName.toLowerCase());
    if (!tableMeta) {
      checks.push({
        table: tableName,
        ok: false,
        status: "MISSING_TABLE",
        columns,
        present_columns: [],
        missing_columns: columns,
        missing_hint: `Create table ${tableName}, then add ${columns.length} required columns.`,
      });
      continue;
    }

    try {
      const columnDetails = await datastore.table(tableMeta.id || tableName).getAllColumns();
      const presentColumns = columnDetails
        .map((column) => column.column_name || column.name || column.columnName)
        .filter(Boolean)
        .map(String);
      const presentSet = new Set(presentColumns.map((column) => column.toLowerCase()));
      const missingColumns = columns.filter((column) => !presentSet.has(column.toLowerCase()));
      checks.push({
        table: tableName,
        ok: missingColumns.length === 0,
        status: missingColumns.length === 0 ? "READY" : "MISSING_COLUMNS",
        columns,
        present_columns: presentColumns,
        missing_columns: missingColumns,
        missing_hint: missingColumns.length
          ? `Add missing columns: ${missingColumns.join(", ")}`
          : "",
      });
    } catch (error) {
      checks.push({
        table: tableName,
        ok: false,
        status: "CHECK_FAILED",
        columns,
        present_columns: [],
        missing_columns: columns,
        missing_hint: error.message || "Table or one of its columns is missing",
      });
    }
  }
  return checks;
}

function cleanMoney(value) {
  return Math.round(num(value) * 100) / 100;
}

function boolValue(value, defaultValue) {
  if (value === true || value === false) {
    return value;
  }
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) {
    return defaultValue;
  }
  if (["true", "1", "yes", "y"].includes(text)) {
    return true;
  }
  if (["false", "0", "no", "n"].includes(text)) {
    return false;
  }
  return defaultValue;
}

function sanitizeFileName(value) {
  const fallback = "baylen-upload.png";
  const cleaned = String(value || fallback)
    .trim()
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 140);
  return cleaned || fallback;
}

function contentTypeFromName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "application/octet-stream";
}

function resolveMediaFolderId(mediaType) {
  const upper = mediaType.toUpperCase();
  const value =
    process.env["FILESTORE_" + upper + "_FOLDER_ID"] ||
    process.env["CATALYST_FILESTORE_" + upper + "_FOLDER_ID"] ||
    process.env.FILESTORE_MEDIA_FOLDER_ID ||
    process.env.CATALYST_FILESTORE_MEDIA_FOLDER_ID ||
    process.env.CATALYST_FILESTORE_FOLDER_ID;
  if (!value) {
    const error = new Error(
      "Catalyst File Store folder is not configured for " + mediaType + " images"
    );
    error.status = 503;
    throw error;
  }
  return asId(value, "file_store_folder_id");
}

function allowedDownloadFolderIds() {
  return new Set(
    [
      process.env.FILESTORE_PRODUCT_FOLDER_ID,
      process.env.CATALYST_FILESTORE_PRODUCT_FOLDER_ID,
      process.env.FILESTORE_SERVICE_FOLDER_ID,
      process.env.CATALYST_FILESTORE_SERVICE_FOLDER_ID,
      process.env.FILESTORE_OUTLET_FOLDER_ID,
      process.env.CATALYST_FILESTORE_OUTLET_FOLDER_ID,
      process.env.FILESTORE_MEDIA_FOLDER_ID,
      process.env.CATALYST_FILESTORE_MEDIA_FOLDER_ID,
      process.env.CATALYST_FILESTORE_FOLDER_ID,
    ]
      .filter((value) => /^\d+$/.test(String(value || "").trim()))
      .map((value) => String(value).trim())
  );
}

function publicBaseUrl(req) {
  const configured = process.env.APP_PUBLIC_BASE_URL || process.env.API_PUBLIC_BASE_URL;
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return protocol + "://" + host;
}

function mediaDownloadUrl(req, folderId, fileId, fileName) {
  const query = new URLSearchParams({
    folder_id: String(folderId),
    file_id: String(fileId),
    name: fileName,
  });
  return publicBaseUrl(req) + "/v1/files/download?" + query.toString();
}

function decodeImageBody(body) {
  const mediaType = optionalText(body.media_type, "media_type", 20) || "";
  if (!MEDIA_TYPES.has(mediaType)) {
    const error = new Error("media_type must be product, service, or outlet");
    error.status = 400;
    throw error;
  }
  const fileName = sanitizeFileName(optionalText(body.file_name, "file_name", 180));
  const contentType = optionalText(body.content_type, "content_type", 80) || contentTypeFromName(fileName);
  if (!IMAGE_CONTENT_TYPES.has(contentType)) {
    const error = new Error("Only JPG, PNG, WEBP, and GIF images are supported");
    error.status = 400;
    throw error;
  }
  const rawBase64 = optionalText(body.base64, "base64", 7 * 1024 * 1024) || "";
  const base64 = rawBase64.includes(",") ? rawBase64.split(",").pop() : rawBase64;
  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch (_) {
    const error = new Error("Image payload is not valid base64");
    error.status = 400;
    throw error;
  }
  if (!bytes.length) {
    const error = new Error("Image file is empty");
    error.status = 400;
    throw error;
  }
  if (bytes.length > MAX_ADMIN_IMAGE_BYTES) {
    const error = new Error("Image must be 5 MB or smaller");
    error.status = 400;
    throw error;
  }
  return { mediaType, fileName, contentType, bytes };
}

async function uploadMediaFile(req, body) {
  const input = decodeImageBody(body);
  const folderId = resolveMediaFolderId(input.mediaType);
  const safeName = Date.now() + "-" + input.mediaType + "-" + input.fileName;
  const tempPath = path.join(os.tmpdir(), crypto.randomUUID() + "-" + safeName);
  fs.writeFileSync(tempPath, input.bytes);
  try {
    const folder = req.catalystApp.filestore().folder(folderId);
    const uploaded = await folder.uploadFile({
      code: fs.createReadStream(tempPath),
      name: safeName,
    });
    const fileId = String(uploaded.id || uploaded.file_id || "");
    if (!fileId) {
      const error = new Error("Catalyst File Store did not return a file id");
      error.status = 502;
      throw error;
    }
    return {
      file_id: fileId,
      folder_id: String(folderId),
      file_name: uploaded.file_name || safeName,
      file_size: num(uploaded.file_size) || input.bytes.length,
      content_type: input.contentType,
      file_url: mediaDownloadUrl(req, folderId, fileId, uploaded.file_name || safeName),
    };
  } finally {
    fs.promises.unlink(tempPath).catch(() => {});
  }
}

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

function csvObjects(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    const error = new Error("CSV must include a header row and at least one data row");
    error.status = 400;
    throw error;
  }
  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const records = rows.slice(1).map((row, index) => {
    const record = { row_number: index + 2 };
    headers.forEach((header, columnIndex) => {
      if (header) {
        record[header] = String(row[columnIndex] || "").trim();
      }
    });
    return record;
  });
  if (records.length > 500) {
    const error = new Error("CSV import supports up to 500 rows at a time");
    error.status = 400;
    throw error;
  }
  return records;
}

function productPayload(body) {
  const name = optionalText(body.name, "name", 160);
  if (!name) {
    const error = new Error("name is required");
    error.status = 400;
    throw error;
  }
  return {
    name,
    slug: optionalText(body.slug, "slug", 180) || null,
    sku: optionalText(body.sku, "sku", 80) || null,
    brand_id: body.brand_id ? asId(body.brand_id, "brand_id") : null,
    category_id: body.category_id ? asId(body.category_id, "category_id") : null,
    short_description:
      optionalText(body.short_description, "short_description", 255) || null,
    description: optionalText(body.description, "description", 5000) || null,
    mrp: cleanMoney(body.mrp),
    selling_price: cleanMoney(body.selling_price),
    currency: optionalText(body.currency, "currency", 10) || "INR",
    tax_percent: cleanMoney(body.tax_percent),
    thumbnail_url: optionalText(body.thumbnail_url, "thumbnail_url", 500) || null,
    has_variants: boolValue(body.has_variants, false),
    is_featured: boolValue(body.is_featured, false),
    status: optionalText(body.status, "status", 30) || "ACTIVE",
  };
}

async function upsertProduct(req, body) {
  const payload = productPayload(body);
  let rowId = body.id ? asId(body.id, "id") : "";
  if (rowId) {
    await req.catalystApp.datastore().table("Products").updateRow({
      ROWID: rowId,
      ...payload,
    });
    return { id: rowId, action: "updated" };
  }
  const inserted = await req.catalystApp.datastore().table("Products").insertRow(payload);
  rowId = String(inserted.ROWID || inserted.rowid || "");
  return { id: rowId, action: "created" };
}

function servicePayload(body) {
  const name = optionalText(body.name, "name", 160);
  if (!name) {
    const error = new Error("name is required");
    error.status = 400;
    throw error;
  }
  return {
    name,
    slug: optionalText(body.slug, "slug", 180) || null,
    description: optionalText(body.description, "description", 1000) || null,
    category_id: body.category_id ? asId(body.category_id, "category_id") : null,
    duration_minutes: num(body.duration_minutes),
    gender: optionalText(body.gender, "gender", 30) || null,
    image_url: optionalText(body.image_url, "image_url", 500) || null,
    mrp: cleanMoney(body.mrp),
    selling_price: cleanMoney(body.selling_price),
    currency: optionalText(body.currency, "currency", 10) || "INR",
    status: optionalText(body.status, "status", 30) || "ACTIVE",
    is_active: boolValue(body.is_active, true),
  };
}

async function upsertService(req, body) {
  const payload = servicePayload(body);
  let rowId = body.id ? asId(body.id, "id") : "";
  if (!rowId && payload.slug) {
    const existing = rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID FROM Salon_Services WHERE slug = " + sqlString(payload.slug)
        ),
      "Salon_Services"
    );
    rowId = existing ? String(existing.ROWID) : "";
  }
  if (rowId) {
    await req.catalystApp.datastore().table("Salon_Services").updateRow({
      ROWID: rowId,
      ...payload,
    });
    return { id: rowId, action: "updated" };
  }
  const inserted = await req.catalystApp.datastore().table("Salon_Services").insertRow(payload);
  rowId = String(inserted.ROWID || inserted.rowid || "");
  return { id: rowId, action: "created" };
}

function outletPayload(body) {
  const name = optionalText(body.name, "name", 160);
  if (!name) {
    const error = new Error("name is required");
    error.status = 400;
    throw error;
  }
  return {
    name,
    slug: optionalText(body.slug, "slug", 180) || null,
    code: optionalText(body.code, "code", 60) || null,
    salon_category: optionalText(body.salon_category, "salon_category", 40) || null,
    address_line1: optionalText(body.address_line1, "address_line1", 255) || null,
    area: optionalText(body.area, "area", 100) || null,
    city: optionalText(body.city, "city", 100) || null,
    state: optionalText(body.state, "state", 100) || null,
    postal_code: optionalText(body.postal_code, "postal_code", 20) || null,
    phone: optionalText(body.phone, "phone", 20) || null,
    latitude: optionalText(body.latitude, "latitude", 40) || null,
    longitude: optionalText(body.longitude, "longitude", 40) || null,
    opening_time: optionalText(body.opening_time, "opening_time", 20) || null,
    closing_time: optionalText(body.closing_time, "closing_time", 20) || null,
    rating: cleanMoney(body.rating),
    review_count: Math.max(0, Math.round(num(body.review_count))),
    image_url: optionalText(body.image_url, "image_url", 500) || null,
    video_url: optionalText(body.video_url, "video_url", 500) || null,
    google_maps_url: optionalText(body.google_maps_url, "google_maps_url", 255) || null,
    is_active: boolValue(body.is_active, true),
  };
}

async function upsertOutlet(req, body) {
  const payload = outletPayload(body);
  let rowId = body.id ? asId(body.id, "id") : "";
  if (!rowId && payload.code) {
    const existing = rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery("SELECT ROWID FROM Outlets WHERE code = " + sqlString(payload.code)),
      "Outlets"
    );
    rowId = existing ? String(existing.ROWID) : "";
  }
  if (rowId) {
    await req.catalystApp.datastore().table("Outlets").updateRow({
      ROWID: rowId,
      ...payload,
    });
    return { id: rowId, action: "updated" };
  }
  const inserted = await req.catalystApp.datastore().table("Outlets").insertRow(payload);
  rowId = String(inserted.ROWID || inserted.rowid || "");
  return { id: rowId, action: "created" };
}

async function bulkImport(records, importer) {
  const result = {
    total: records.length,
    created: 0,
    updated: 0,
    failed: 0,
    ids: [],
    errors: [],
  };
  for (const record of records) {
    try {
      const imported = await importer(record);
      if (imported.action === "updated") {
        result.updated += 1;
      } else {
        result.created += 1;
      }
      result.ids.push(imported.id);
    } catch (error) {
      result.failed += 1;
      if (result.errors.length < 50) {
        result.errors.push({
          row: record.row_number,
          error: error.message || "Row import failed",
        });
      }
    }
  }
  return result;
}

function mapInventory(row, productNames) {
  const onHand = num(row.quantity_on_hand);
  const reserved = num(row.quantity_reserved);
  return {
    id: String(row.ROWID),
    warehouse_id: row.warehouse_id ? String(row.warehouse_id) : "",
    product_id: row.product_id ? String(row.product_id) : "",
    variant_id: row.variant_id ? String(row.variant_id) : "",
    product_name: productNames.get(String(row.product_id)) || "",
    quantity_on_hand: onHand,
    quantity_reserved: reserved,
    available_quantity: Math.max(0, onHand - reserved),
    status: row.status || "ACTIVE",
    is_active: row.is_active === true || row.is_active === "true",
  };
}

function mapAdminProduct(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    sku: row.sku || "",
    brand_id: row.brand_id ? String(row.brand_id) : "",
    category_id: row.category_id ? String(row.category_id) : "",
    short_description: row.short_description || "",
    description: row.description || "",
    mrp: cleanMoney(row.mrp),
    selling_price: cleanMoney(row.selling_price),
    currency: row.currency || "INR",
    tax_percent: cleanMoney(row.tax_percent),
    thumbnail_url: row.thumbnail_url || "",
    has_variants: boolValue(row.has_variants, false),
    is_featured: boolValue(row.is_featured, false),
    status: row.status || "ACTIVE",
  };
}

function mapAdminService(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    description: row.description || "",
    category_id: row.category_id ? String(row.category_id) : "",
    image_url: row.image_url || "",
    duration_minutes: num(row.duration_minutes),
    gender: row.gender || "UNISEX",
    mrp: cleanMoney(row.mrp),
    selling_price: cleanMoney(row.selling_price),
    currency: row.currency || "INR",
    status: row.status || "ACTIVE",
    is_active: boolValue(row.is_active, true),
  };
}

function mapAdminOutlet(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    code: row.code || "",
    salon_category: row.salon_category || "Gold",
    address_line1: row.address_line1 || "",
    area: row.area || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    phone: row.phone || "",
    latitude: row.latitude || "",
    longitude: row.longitude || "",
    opening_time: row.opening_time || "",
    closing_time: row.closing_time || "",
    rating: cleanMoney(row.rating),
    review_count: Math.max(0, Math.round(num(row.review_count))),
    image_url: row.image_url || "",
    video_url: row.video_url || "",
    google_maps_url: row.google_maps_url || "",
    is_active: boolValue(row.is_active, true),
  };
}

function mapAdminOrder(row) {
  return {
    id: String(row.ROWID),
    user_id: row.user_id ? String(row.user_id) : "",
    order_number: row.order_number || "",
    status: row.status || "PLACED",
    payment_status: row.payment_status || "PENDING",
    currency: row.currency || "INR",
    grand_total: cleanMoney(row.grand_total),
    shipping_name: row.shipping_name || "",
    shipping_city: row.shipping_city || "",
  };
}

function mapAdminBooking(row) {
  return {
    id: String(row.ROWID),
    user_id: row.user_id ? String(row.user_id) : "",
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    staff_id: row.staff_id ? String(row.staff_id) : "",
    slot_id: row.slot_id ? String(row.slot_id) : "",
    appointment_number: row.appointment_number || "",
    appointment_date: row.appointment_date || "",
    start_time: row.start_time || "",
    end_time: row.end_time || "",
    status: row.status || "CONFIRMED",
    payment_status: row.payment_status || "PENDING",
    currency: row.currency || "INR",
    grand_total: cleanMoney(row.grand_total),
  };
}

function mapAdminStockMovement(row) {
  return {
    id: String(row.ROWID),
    inventory_id: row.inventory_id ? String(row.inventory_id) : "",
    warehouse_id: row.warehouse_id ? String(row.warehouse_id) : "",
    product_id: row.product_id ? String(row.product_id) : "",
    variant_id: row.variant_id ? String(row.variant_id) : "",
    movement_type: row.movement_type || "",
    quantity: num(row.quantity),
    reference_type: row.reference_type || "",
    reference_id: row.reference_id ? String(row.reference_id) : "",
    notes: row.notes || "",
  };
}

function mapAuditLog(row) {
  return {
    id: String(row.ROWID),
    actor_type: row.actor_type || "",
    action: row.action || "",
    entity_type: row.entity_type || "",
    entity_id: row.entity_id ? String(row.entity_id) : "",
    before_json: row.before_json || "",
    after_json: row.after_json || "",
    ip_address: row.ip_address || "",
    created_time: row.CREATEDTIME || "",
  };
}

async function loadAdminProduct(req, productId) {
  return rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, name, slug, sku, brand_id, category_id, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status FROM Products WHERE ROWID = " +
          productId
      ),
    "Products"
  );
}

async function loadAdminService(req, serviceId) {
  try {
    return rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency, status, is_active FROM Salon_Services WHERE ROWID = " +
            serviceId
        ),
      "Salon_Services"
    );
  } catch (_) {
    return rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, name, slug, description, category_id, duration_minutes, gender, mrp, selling_price, currency, status, is_active FROM Salon_Services WHERE ROWID = " +
            serviceId
        ),
      "Salon_Services"
    );
  }
}

async function loadAdminOutlet(req, outletId) {
  return rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, video_url, google_maps_url, is_active FROM Outlets WHERE ROWID = " +
          outletId
      ),
    "Outlets"
  );
}

async function loadAdminOrder(req, orderId) {
  return rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_city FROM Orders WHERE ROWID = " +
          orderId
      ),
    "Orders"
  );
}

async function loadAdminBooking(req, appointmentId) {
  return rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, user_id, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, grand_total FROM Appointments WHERE ROWID = " +
          appointmentId
      ),
    "Appointments"
  );
}

async function addOrderTimeline(req, orderId, status, note) {
  try {
    await req.catalystApp.datastore().table("Order_Timeline").insertRow({
      order_id: orderId,
      status,
      note,
      actor_type: "ADMIN",
      happened_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    });
  } catch (_) {}
}

async function addBookingNotification(req, booking, status) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: booking.user_id,
      type: "BOOKING",
      title: "Booking updated",
      body: "Your Baylen booking status is now " + status + ".",
      reference_type: "APPOINTMENT",
      reference_id: booking.ROWID,
      delivery_status: "PENDING",
      read_at: null,
    });
  } catch (_) {}
}

async function addOrderNotification(req, order, status) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: order.user_id,
      type: "ORDER",
      title: "Order updated",
      body: "Your Baylen order status is now " + status + ".",
      reference_type: "ORDER",
      reference_id: order.ROWID,
      delivery_status: "PENDING",
      read_at: null,
    });
  } catch (_) {}
}

function searchRows(rows, query, fields, limit) {
  return rows.filter((row) => includesSearch(row, query, fields)).slice(0, limit);
}

function mapMediaAsset(req, row) {
  const folderId = row.folder_id ? String(row.folder_id) : "";
  const fileId = row.file_id ? String(row.file_id) : "";
  const fileName = row.file_name || "baylen-media";
  return {
    id: String(row.ROWID),
    media_type: row.media_type || "",
    file_id: fileId,
    folder_id: folderId,
    file_name: fileName,
    file_url: row.file_url || (folderId && fileId ? mediaDownloadUrl(req, folderId, fileId, fileName) : ""),
    content_type: row.content_type || contentTypeFromName(fileName),
    file_size: num(row.file_size),
    mapped_entity_type: row.mapped_entity_type || "",
    mapped_entity_id: row.mapped_entity_id ? String(row.mapped_entity_id) : "",
    mapped_field: row.mapped_field || "",
    is_active: row.is_active === true || row.is_active === "true",
  };
}

async function recordMediaAsset(req, mediaType, file) {
  const inserted = await req.catalystApp.datastore().table("Media_Assets").insertRow({
    media_type: mediaType,
    file_id: file.file_id,
    folder_id: file.folder_id,
    file_name: file.file_name,
    file_url: file.file_url,
    content_type: file.content_type,
    file_size: file.file_size,
    mapped_entity_type: null,
    mapped_entity_id: null,
    mapped_field: null,
    is_active: true,
  });
  return String(inserted.ROWID || inserted.rowid || "");
}

async function loadMediaAsset(req, assetId) {
  return rowOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, media_type, file_id, folder_id, file_name, file_url, content_type, file_size, mapped_entity_type, mapped_entity_id, mapped_field, is_active FROM Media_Assets WHERE ROWID = " +
          assetId +
          " AND is_active = true"
      ),
    "Media_Assets"
  );
}

function mediaTarget(mediaType) {
  if (mediaType === "product") {
    return { table: "Products", field: "thumbnail_url" };
  }
  if (mediaType === "service") {
    return { table: "Salon_Services", field: "image_url" };
  }
  if (mediaType === "outlet") {
    return { table: "Outlets", field: "image_url" };
  }
  const error = new Error("media_type must be product, service, or outlet");
  error.status = 400;
  throw error;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function includesSearch(row, query, fields) {
  if (!query) {
    return true;
  }
  return fields.some((field) =>
    String(row[field] || "")
      .toLowerCase()
      .includes(query)
  );
}

function mapMediaTarget(mediaType, row) {
  if (mediaType === "product") {
    return {
      id: String(row.ROWID),
      title: row.name || "Product " + row.ROWID,
      subtitle: [row.sku, row.slug, row.status].filter(Boolean).join(" / "),
      image_url: row.thumbnail_url || "",
      status: row.status || "",
    };
  }
  if (mediaType === "service") {
    return {
      id: String(row.ROWID),
      title: row.name || "Service " + row.ROWID,
      subtitle: [row.slug, row.gender, row.status].filter(Boolean).join(" / "),
      image_url: row.image_url || "",
      status: row.status || "",
    };
  }
  return {
    id: String(row.ROWID),
    title: row.name || "Outlet " + row.ROWID,
    subtitle: [row.code, row.city, row.salon_category].filter(Boolean).join(" / "),
    image_url: row.image_url || "",
    status: row.is_active === true || row.is_active === "true" ? "ACTIVE" : "INACTIVE",
  };
}

async function mediaTargetRows(req, mediaType) {
  const zcql = req.catalystApp.zcql();
  if (mediaType === "product") {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku, slug, thumbnail_url, status FROM Products"
      ),
      "Products"
    );
  }
  if (mediaType === "service") {
    try {
      return rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, gender, image_url, status FROM Salon_Services"
        ),
        "Salon_Services"
      );
    } catch (_) {
      return rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, gender, status FROM Salon_Services"
        ),
        "Salon_Services"
      );
    }
  }
  return rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, code, city, salon_category, image_url, is_active FROM Outlets"
    ),
    "Outlets"
  );
}

async function searchMediaTargets(req, mediaType, query, limit) {
  const rows = await mediaTargetRows(req, mediaType);
  const fields =
    mediaType === "product"
      ? ["ROWID", "name", "sku", "slug"]
      : mediaType === "service"
        ? ["ROWID", "name", "slug", "gender"]
        : ["ROWID", "name", "code", "city", "salon_category"];
  return rows
    .filter((row) => includesSearch(row, query, fields))
    .slice(0, limit)
    .map((row) => mapMediaTarget(mediaType, row));
}

function adminRoutes(app) {
  app.get("/v1/files/download", async (req, res, next) => {
    try {
      const folderId = asId(req.query.folder_id, "folder_id");
      const fileId = asId(req.query.file_id, "file_id");
      const allowedFolders = allowedDownloadFolderIds();
      if (allowedFolders.size && !allowedFolders.has(String(folderId))) {
        const error = new Error("File folder is not available for public media");
        error.status = 403;
        throw error;
      }
      const fileName = sanitizeFileName(req.query.name || "baylen-media");
      const folder = req.catalystApp.filestore().folder(folderId);
      const buffer = await folder.downloadFile(fileId);
      res.set("Content-Type", contentTypeFromName(fileName));
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/summary", async (req, res, next) => {
    try {
      requireAdmin(req);
      const [
        products,
        services,
        outlets,
        orders,
        appointments,
        jobs,
        lowStock,
      ] = await Promise.all([
        safeCount(req, "Products", "status = 'ACTIVE'"),
        safeCount(req, "Salon_Services", "status = 'ACTIVE' AND is_active = true"),
        safeCount(req, "Outlets", "is_active = true"),
        safeCount(req, "Orders", ""),
        safeCount(req, "Appointments", ""),
        safeCount(req, "Service_Jobs", ""),
        safeCount(
          req,
          "Inventory",
          "is_active = true AND status = 'ACTIVE' AND quantity_on_hand - quantity_reserved <= 5"
        ),
      ]);
      sendOk(res, {
        products,
        services,
        outlets,
        orders,
        appointments,
        jobs,
        low_stock_items: lowStock,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/schema/check", async (req, res, next) => {
    try {
      requireAdmin(req);
      const checks = await checkSchema(req);
      const failed = checks.filter((check) => !check.ok);
      sendOk(res, {
        ok: failed.length === 0,
        checked: checks.length,
        failed: failed.length,
        checks,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/inventory", async (req, res, next) => {
    try {
      requireAdmin(req);
      const zcql = req.catalystApp.zcql();
      const inventoryRows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, warehouse_id, product_id, variant_id, quantity_on_hand, quantity_reserved, status, is_active FROM Inventory WHERE is_active = true"
        ),
        "Inventory"
      );
      const productRows = rowsOf(
        await zcql.executeZCQLQuery("SELECT ROWID, name, sku FROM Products"),
        "Products"
      );
      const productNames = new Map(
        productRows.map((row) => [
          String(row.ROWID),
          [row.name, row.sku ? "(" + row.sku + ")" : ""].filter(Boolean).join(" "),
        ])
      );
      const inventory = inventoryRows
        .map((row) => mapInventory(row, productNames))
        .sort((a, b) => a.available_quantity - b.available_quantity)
        .slice(0, Math.min(200, Math.max(1, num(req.query.limit) || 100)));
      sendOk(res, { inventory });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/inventory/movements", async (req, res, next) => {
    try {
      requireAdmin(req);
      const limit = Math.min(200, Math.max(1, num(req.query.limit) || 100));
      let query =
        "SELECT ROWID, inventory_id, warehouse_id, product_id, variant_id, movement_type, quantity, reference_type, reference_id, notes FROM Stock_Movements";
      if (req.query.product_id) {
        query += " WHERE product_id = " + asId(req.query.product_id, "product_id");
      } else if (req.query.inventory_id) {
        query += " WHERE inventory_id = " + asId(req.query.inventory_id, "inventory_id");
      }
      const rows = rowsOf(
        await req.catalystApp.zcql().executeZCQLQuery(query),
        "Stock_Movements"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { movements: rows.slice(0, limit).map(mapAdminStockMovement) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/audit-logs", async (req, res, next) => {
    try {
      requireAdmin(req);
      const limit = Math.min(200, Math.max(1, num(req.query.limit) || 100));
      let query =
        "SELECT ROWID, actor_type, action, entity_type, entity_id, before_json, after_json, ip_address, CREATEDTIME FROM Audit_Logs";
      const filters = [];
      if (req.query.entity_type) {
        filters.push(
          "entity_type = " +
            sqlString(optionalText(req.query.entity_type, "entity_type", 60).toUpperCase())
        );
      }
      if (req.query.entity_id) {
        filters.push("entity_id = " + sqlString(asId(req.query.entity_id, "entity_id")));
      }
      if (filters.length) {
        query += " WHERE " + filters.join(" AND ");
      }
      const rows = rowsOf(
        await req.catalystApp.zcql().executeZCQLQuery(query),
        "Audit_Logs"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { audit_logs: rows.slice(0, limit).map(mapAuditLog) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/orders", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 50));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, user_id, order_number, status, payment_status, currency, grand_total, shipping_name, shipping_city FROM Orders"
          ),
        "Orders"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      const orders = searchRows(
        rows,
        query,
        ["ROWID", "user_id", "order_number", "status", "payment_status", "shipping_name", "shipping_city"],
        limit
      ).map(mapAdminOrder);
      sendOk(res, { orders });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/order/status", async (req, res, next) => {
    try {
      requireAdmin(req);
      const orderId = asId(req.body.id, "id");
      const status = optionalText(req.body.status, "status", 40).toUpperCase();
      const allowed = [
        "PLACED",
        "CONFIRMED",
        "PROCESSING",
        "PACKED",
        "SHIPPED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
        "RETURN_REQUESTED",
        "RETURN_APPROVED",
        "REFUNDED",
      ];
      if (!allowed.includes(status)) {
        const error = new Error("Unsupported order status");
        error.status = 400;
        throw error;
      }
      const before = await loadAdminOrder(req, orderId);
      if (!before) {
        const error = new Error("Order record not found");
        error.status = 404;
        throw error;
      }
      const note =
        optionalText(req.body.note, "note", 255) || "Order status updated by admin";
      await req.catalystApp.datastore().table("Orders").updateRow({
        ROWID: orderId,
        status,
      });
      await addOrderTimeline(req, orderId, status, note);
      await addOrderNotification(req, before, status);
      const after = await loadAdminOrder(req, orderId);
      await writeAuditLog(req, "STATUS", "ORDER", orderId, mapAdminOrder(before), mapAdminOrder(after));
      sendOk(res, { order: mapAdminOrder(after) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/bookings", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 50));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, user_id, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, grand_total FROM Appointments"
          ),
        "Appointments"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      const bookings = searchRows(
        rows,
        query,
        ["ROWID", "user_id", "outlet_id", "staff_id", "appointment_number", "appointment_date", "status", "payment_status"],
        limit
      ).map(mapAdminBooking);
      sendOk(res, { bookings });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/booking/status", async (req, res, next) => {
    try {
      requireAdmin(req);
      const appointmentId = asId(req.body.id, "id");
      const status = optionalText(req.body.status, "status", 40).toUpperCase();
      const allowed = [
        "CONFIRMED",
        "RESCHEDULED",
        "CANCELLED",
        "CHECKED_IN",
        "IN_PROGRESS",
        "COMPLETED",
        "NO_SHOW",
      ];
      if (!allowed.includes(status)) {
        const error = new Error("Unsupported booking status");
        error.status = 400;
        throw error;
      }
      const before = await loadAdminBooking(req, appointmentId);
      if (!before) {
        const error = new Error("Booking record not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Appointments").updateRow({
        ROWID: appointmentId,
        status,
      });
      if (before.slot_id) {
        await req.catalystApp.datastore().table("Appointment_Slots").updateRow({
          ROWID: before.slot_id,
          status: status === "CANCELLED" || status === "NO_SHOW" ? "AVAILABLE" : "BOOKED",
          appointment_id: status === "CANCELLED" || status === "NO_SHOW" ? null : appointmentId,
        });
      }
      await addBookingNotification(req, before, status);
      const after = await loadAdminBooking(req, appointmentId);
      await writeAuditLog(
        req,
        "STATUS",
        "APPOINTMENT",
        appointmentId,
        mapAdminBooking(before),
        mapAdminBooking(after)
      );
      sendOk(res, { booking: mapAdminBooking(after) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/files/upload", async (req, res, next) => {
    try {
      requireAdmin(req);
      const body = req.body || {};
      const mediaType = optionalText(body.media_type, "media_type", 20) || "";
      const file = await uploadMediaFile(req, body);
      const assetId = await recordMediaAsset(req, mediaType, file);
      file.asset_id = assetId;
      await writeAuditLog(req, "UPLOAD", "MEDIA_ASSET", assetId, null, {
        media_type: mediaType,
        file_id: file.file_id,
        folder_id: file.folder_id,
        file_name: file.file_name,
      });
      sendOk(res, { file });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/files", async (req, res, next) => {
    try {
      requireAdmin(req);
      const mediaType = optionalText(req.query.media_type, "media_type", 20) || "";
      if (mediaType && !MEDIA_TYPES.has(mediaType)) {
        const error = new Error("media_type must be product, service, or outlet");
        error.status = 400;
        throw error;
      }
      const limit = Math.min(200, Math.max(1, num(req.query.limit) || 100));
      let query =
        "SELECT ROWID, media_type, file_id, folder_id, file_name, file_url, content_type, file_size, mapped_entity_type, mapped_entity_id, mapped_field, is_active FROM Media_Assets WHERE is_active = true";
      if (mediaType) {
        query += " AND media_type = '" + mediaType + "'";
      }
      const rows = rowsOf(
        await req.catalystApp.zcql().executeZCQLQuery(query),
        "Media_Assets"
      );
      sendOk(res, { media: rows.slice(0, limit).map((row) => mapMediaAsset(req, row)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/files/map", async (req, res, next) => {
    try {
      requireAdmin(req);
      const assetId = asId(req.body.asset_id, "asset_id");
      const targetId = asId(req.body.target_id, "target_id");
      const asset = await loadMediaAsset(req, assetId);
      if (!asset) {
        const error = new Error("Media asset not found");
        error.status = 404;
        throw error;
      }
      const mediaType = asset.media_type || "";
      const target = mediaTarget(mediaType);
      const targetRow = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery("SELECT ROWID FROM " + target.table + " WHERE ROWID = " + targetId),
        target.table
      );
      if (!targetRow) {
        const error = new Error(mediaType + " row not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table(target.table).updateRow({
        ROWID: targetId,
        [target.field]: asset.file_url,
      });
      await req.catalystApp.datastore().table("Media_Assets").updateRow({
        ROWID: assetId,
        mapped_entity_type: mediaType,
        mapped_entity_id: targetId,
        mapped_field: target.field,
      });
      const updated = await loadMediaAsset(req, assetId);
      await writeAuditLog(req, "MAP", "MEDIA_ASSET", assetId, mapMediaAsset(req, asset), mapMediaAsset(req, updated));
      sendOk(res, { media: mapMediaAsset(req, updated) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/media-targets", async (req, res, next) => {
    try {
      requireAdmin(req);
      const mediaType = optionalText(req.query.media_type, "media_type", 20) || "";
      if (!MEDIA_TYPES.has(mediaType)) {
        const error = new Error("media_type must be product, service, or outlet");
        error.status = 400;
        throw error;
      }
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(50, Math.max(1, num(req.query.limit) || 20));
      const targets = await searchMediaTargets(req, mediaType, query, limit);
      sendOk(res, { targets });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/products", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 30));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, name, slug, sku, brand_id, category_id, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status FROM Products"
          ),
        "Products"
      );
      const products = searchRows(rows, query, ["ROWID", "name", "sku", "slug", "status"], limit)
        .map(mapAdminProduct);
      sendOk(res, { products });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/services", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 30));
      let rows;
      try {
        rows = rowsOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID, name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency, status, is_active FROM Salon_Services"
            ),
          "Salon_Services"
        );
      } catch (_) {
        rows = rowsOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID, name, slug, description, category_id, duration_minutes, gender, mrp, selling_price, currency, status, is_active FROM Salon_Services"
            ),
          "Salon_Services"
        );
      }
      const services = searchRows(rows, query, ["ROWID", "name", "slug", "gender", "status"], limit)
        .map(mapAdminService);
      sendOk(res, { services });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/outlets", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 30));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
              "SELECT ROWID, name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, video_url, google_maps_url, is_active FROM Outlets"
          ),
        "Outlets"
      );
      const outlets = searchRows(
        rows,
        query,
        ["ROWID", "name", "slug", "code", "city", "salon_category"],
        limit
      ).map(mapAdminOutlet);
      sendOk(res, { outlets });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/product/upsert", async (req, res, next) => {
    try {
      requireAdmin(req);
      const before = req.body && req.body.id ? await loadAdminProduct(req, asId(req.body.id, "id")) : null;
      const product = await upsertProduct(req, req.body || {});
      const after = await loadAdminProduct(req, product.id);
      await writeAuditLog(
        req,
        product.action.toUpperCase(),
        "PRODUCT",
        product.id,
        before ? mapAdminProduct(before) : null,
        after ? mapAdminProduct(after) : req.body || {}
      );
      sendOk(res, { product_id: product.id });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/products/bulk", async (req, res, next) => {
    try {
      requireAdmin(req);
      const records = csvObjects(req.body.csv_text);
      const result = await bulkImport(records, (record) => upsertProduct(req, record));
      await writeAuditLog(req, "BULK_IMPORT", "PRODUCT", null, null, {
        total: result.total,
        created: result.created,
        updated: result.updated,
        failed: result.failed,
      });
      sendOk(res, { import: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/product/status", async (req, res, next) => {
    try {
      requireAdmin(req);
      const productId = asId(req.body.id, "id");
      const active = boolValue(req.body.active, true);
      const product = await loadAdminProduct(req, productId);
      if (!product) {
        const error = new Error("Product record not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Products").updateRow({
        ROWID: productId,
        status: active ? "ACTIVE" : "INACTIVE",
      });
      const updated = await loadAdminProduct(req, productId);
      await writeAuditLog(req, active ? "ACTIVATE" : "DEACTIVATE", "PRODUCT", productId, mapAdminProduct(product), mapAdminProduct(updated));
      sendOk(res, { product: mapAdminProduct(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/inventory/update", async (req, res, next) => {
    try {
      requireAdmin(req);
      const inventoryId = asId(req.body.inventory_id, "inventory_id");
      const quantityOnHand = num(req.body.quantity_on_hand);
      const quantityReserved = num(req.body.quantity_reserved);
      const inventory = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, warehouse_id, product_id, variant_id FROM Inventory WHERE ROWID = " +
              inventoryId
          ),
        "Inventory"
      );
      if (!inventory) {
        const error = new Error("Inventory record not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Inventory").updateRow({
        ROWID: inventoryId,
        quantity_on_hand: quantityOnHand,
        quantity_reserved: Math.max(0, quantityReserved),
        status: optionalText(req.body.status, "status", 30) || "ACTIVE",
        is_active: req.body.is_active === false || req.body.is_active === "false" ? false : true,
      });
      await req.catalystApp.datastore().table("Stock_Movements").insertRow({
        inventory_id: inventoryId,
        warehouse_id: inventory.warehouse_id,
        product_id: inventory.product_id,
        variant_id: inventory.variant_id || null,
        movement_type: "ADJUST",
        quantity: quantityOnHand,
        reference_type: "ADMIN",
        reference_id: null,
        notes: optionalText(req.body.notes, "notes", 255) || "Admin inventory update",
      });
      await writeAuditLog(req, "UPDATE", "INVENTORY", inventoryId, inventory, {
        quantity_on_hand: quantityOnHand,
        quantity_reserved: Math.max(0, quantityReserved),
        status: optionalText(req.body.status, "status", 30) || "ACTIVE",
      });
      sendOk(res, { updated: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/service/upsert", async (req, res, next) => {
    try {
      requireAdmin(req);
      const before = req.body && req.body.id ? await loadAdminService(req, asId(req.body.id, "id")) : null;
      const service = await upsertService(req, req.body || {});
      const after = await loadAdminService(req, service.id);
      await writeAuditLog(
        req,
        service.action.toUpperCase(),
        "SERVICE",
        service.id,
        before ? mapAdminService(before) : null,
        after ? mapAdminService(after) : req.body || {}
      );
      sendOk(res, { service_id: service.id });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/services/bulk", async (req, res, next) => {
    try {
      requireAdmin(req);
      const records = csvObjects(req.body.csv_text);
      const result = await bulkImport(records, (record) => upsertService(req, record));
      await writeAuditLog(req, "BULK_IMPORT", "SERVICE", null, null, {
        total: result.total,
        created: result.created,
        updated: result.updated,
        failed: result.failed,
      });
      sendOk(res, { import: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/service/status", async (req, res, next) => {
    try {
      requireAdmin(req);
      const serviceId = asId(req.body.id, "id");
      const active = boolValue(req.body.active, true);
      const service = await loadAdminService(req, serviceId);
      if (!service) {
        const error = new Error("Service record not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Salon_Services").updateRow({
        ROWID: serviceId,
        status: active ? "ACTIVE" : "INACTIVE",
        is_active: active,
      });
      const updated = await loadAdminService(req, serviceId);
      await writeAuditLog(req, active ? "ACTIVATE" : "DEACTIVATE", "SERVICE", serviceId, mapAdminService(service), mapAdminService(updated));
      sendOk(res, { service: mapAdminService(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/outlet/upsert", async (req, res, next) => {
    try {
      requireAdmin(req);
      let rowId = req.body.id ? asId(req.body.id, "id") : "";
      if (!rowId && req.body.code) {
        const existing = rowOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID FROM Outlets WHERE code = " +
                sqlString(optionalText(req.body.code, "code", 60))
            ),
          "Outlets"
        );
        rowId = existing ? String(existing.ROWID) : "";
      }
      const before = rowId ? await loadAdminOutlet(req, rowId) : null;
      const outlet = await upsertOutlet(req, { ...(req.body || {}), id: rowId || req.body.id });
      rowId = outlet.id;
      const after = await loadAdminOutlet(req, rowId);
      await writeAuditLog(
        req,
        before ? "UPDATED" : "CREATED",
        "OUTLET",
        rowId,
        before ? mapAdminOutlet(before) : null,
        after ? mapAdminOutlet(after) : req.body || {}
      );
      sendOk(res, { outlet_id: rowId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/outlets/bulk", async (req, res, next) => {
    try {
      requireAdmin(req);
      const records = csvObjects(req.body.csv_text);
      const result = await bulkImport(records, (record) => upsertOutlet(req, record));
      await writeAuditLog(req, "BULK_IMPORT", "OUTLET", null, null, {
        total: result.total,
        created: result.created,
        updated: result.updated,
        failed: result.failed,
      });
      sendOk(res, { import: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/outlet/status", async (req, res, next) => {
    try {
      requireAdmin(req);
      const outletId = asId(req.body.id, "id");
      const active = boolValue(req.body.active, true);
      const outlet = await loadAdminOutlet(req, outletId);
      if (!outlet) {
        const error = new Error("Outlet record not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Outlets").updateRow({
        ROWID: outletId,
        is_active: active,
      });
      const updated = await loadAdminOutlet(req, outletId);
      await writeAuditLog(req, active ? "ACTIVATE" : "DEACTIVATE", "OUTLET", outletId, mapAdminOutlet(outlet), mapAdminOutlet(updated));
      sendOk(res, { outlet: mapAdminOutlet(updated) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/service-jobs", async (req, res, next) => {
    try {
      requireAdmin(req);
      const query = normalizeSearchText(optionalText(req.query.q, "q", 120));
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 50));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, user_id, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs"
          ),
        "Service_Jobs"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      const jobs = searchRows(
        rows,
        query,
        ["ROWID", "user_id", "provider_id", "status", "visit_city", "visit_state"],
        limit
      ).map((row) => ({
        id: String(row.ROWID),
        user_id: row.user_id ? String(row.user_id) : "",
        appointment_id: row.appointment_id ? String(row.appointment_id) : "",
        provider_id: row.provider_id ? String(row.provider_id) : "",
        status: row.status || "REQUESTED",
        visit_address_id: row.visit_address_id ? String(row.visit_address_id) : "",
        visit_line1: row.visit_line1 || "",
        visit_city: row.visit_city || "",
        visit_state: row.visit_state || "",
        scheduled_at: row.scheduled_at || "",
        requested_at: row.requested_at || "",
        grand_total: cleanMoney(row.grand_total),
        currency: row.currency || "INR",
      }));
      sendOk(res, { jobs });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/providers", async (req, res, next) => {
    try {
      requireAdmin(req);
      const limit = Math.min(100, Math.max(1, num(req.query.limit) || 50));
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, first_name, last_name, phone, rating, status, is_active FROM Providers"
          ),
        "Providers"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      const providers = rows.slice(0, limit).map((row) => ({
        id: String(row.ROWID),
        first_name: row.first_name || "",
        last_name: row.last_name || "",
        phone: row.phone || "",
        rating: num(row.rating),
        status: row.status || "AVAILABLE",
        is_active: boolValue(row.is_active, true),
      }));
      sendOk(res, { providers });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/jobs/dispatch", async (req, res, next) => {
    try {
      requireAdmin(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = req.body.provider_id ? asId(req.body.provider_id, "provider_id") : "";
      const zcql = req.catalystApp.zcql();

      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, status, provider_id, visit_city FROM Service_Jobs WHERE ROWID = " + jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }

      let selectedProvider;
      if (providerId) {
        selectedProvider = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, first_name, last_name, status FROM Providers WHERE ROWID = " + providerId
          ),
          "Providers"
        );
      } else {
        const available = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, first_name, last_name, status FROM Providers WHERE is_active = true AND status = 'AVAILABLE'"
          ),
          "Providers"
        );
        if (available.length === 0) {
          const error = new Error("No available provider found for auto-dispatch");
          error.status = 409;
          throw error;
        }
        selectedProvider = available[0];
      }

      if (!selectedProvider) {
        const error = new Error("Provider not found");
        error.status = 404;
        throw error;
      }

      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const dispatch = await req.catalystApp.datastore().table("Job_Dispatch").insertRow({
        job_id: jobId,
        provider_id: selectedProvider.ROWID,
        status: "OFFERED",
        offered_at: now,
        notes: "Dispatched by Admin",
      });

      await req.catalystApp.datastore().table("Service_Jobs").updateRow({
        ROWID: jobId,
        provider_id: selectedProvider.ROWID,
        status: "ASSIGNED",
      });

      await writeAuditLog(req, "DISPATCH", "SERVICE_JOB", jobId, { status: job.status }, {
        status: "ASSIGNED",
        provider_id: selectedProvider.ROWID,
      });

      sendOk(res, {
        job_id: jobId,
        dispatch_id: String(dispatch.ROWID || dispatch.rowid || ""),
        provider_id: String(selectedProvider.ROWID),
        provider_name: [selectedProvider.first_name, selectedProvider.last_name].filter(Boolean).join(" "),
        status: "ASSIGNED",
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = adminRoutes;
