"use strict";

const {
  REQUIRED_HEADERS,
  ALL_HEADERS,
  splitPipe,
  parseBool,
  parseMoney,
  templateHeaderRow,
} = require("./csv-contract");
const { upsertProductMaster, upsertVariant } = require("./catalog-products");
const { setAbsoluteStock, resolveWarehouse } = require("./inventory-ops");
const { upsertSearchDocument } = require("./search-index");
const { optionalText, rowOf, rowsOf, num, insertedRowId, asId } = require("./http");

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

function csvObjects(csvText, { maxRows = 100000 } = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    const error = new Error("CSV must include a header row and at least one data row");
    error.status = 400;
    throw error;
  }
  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    const error = new Error("CSV missing required headers: " + missing.join(", "));
    error.status = 400;
    error.code = "MISSING_HEADERS";
    throw error;
  }
  if (rows.length - 1 > maxRows) {
    const error = new Error("CSV supports up to " + maxRows + " data rows per job");
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

function normalizeRecord(record) {
  const next = { ...record };
  next.concerns = splitPipe(record.concerns);
  next.skin_types = splitPipe(record.skin_types);
  next.hair_types = splitPipe(record.hair_types);
  next.fragrance_families = splitPipe(record.fragrance_families);
  next.ingredients = splitPipe(record.ingredients);
  next.tags = splitPipe(record.tags);
  next.is_featured = parseBool(record.is_featured, false);
  next.is_returnable = parseBool(record.is_returnable, true);
  next.has_variants = true;
  next.status = optionalText(record.status, "status", 20) || "ACTIVE";
  next.product_type = optionalText(record.product_type, "product_type", 20) || "SIMPLE";
  return next;
}

async function validateRecord(app, record, seenSkus) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeRecord(record);
  try {
    normalized.mrp = parseMoney(record.mrp, "mrp");
    if (normalized.mrp == null) errors.push({ field: "mrp", code: "REQUIRED", message: "mrp is required" });
  } catch (error) {
    errors.push({ field: "mrp", code: error.code || "INVALID_NUMBER", message: error.message });
  }
  try {
    normalized.selling_price = parseMoney(record.selling_price, "selling_price");
    if (normalized.selling_price == null) {
      errors.push({ field: "selling_price", code: "REQUIRED", message: "selling_price is required" });
    }
  } catch (error) {
    errors.push({
      field: "selling_price",
      code: error.code || "INVALID_NUMBER",
      message: error.message,
    });
  }
  if (record.cost_price) {
    try {
      normalized.cost_price = parseMoney(record.cost_price, "cost_price");
    } catch (error) {
      errors.push({ field: "cost_price", code: error.code || "INVALID_NUMBER", message: error.message });
    }
  }
  if (!record.product_code) errors.push({ field: "product_code", code: "REQUIRED", message: "product_code is required" });
  if (!record.product_name) errors.push({ field: "product_name", code: "REQUIRED", message: "product_name is required" });
  if (!record.brand) errors.push({ field: "brand", code: "REQUIRED", message: "brand is required" });
  if (!record.category_path) errors.push({ field: "category_path", code: "REQUIRED", message: "category_path is required" });
  if (!record.sku) errors.push({ field: "sku", code: "REQUIRED", message: "sku is required" });

  const skuKey = String(record.sku || "").trim().toUpperCase();
  if (skuKey) {
    if (seenSkus.has(skuKey)) {
      errors.push({ field: "sku", code: "DUPLICATE_ROW", message: "Duplicate SKU in CSV: " + skuKey });
    } else {
      seenSkus.add(skuKey);
    }
  }

  // Resolve references only when base fields valid enough
  if (!errors.length) {
    try {
      const {
        resolveBrandId,
        resolveCategoryPath,
        findVariantBySku,
        findProductByCode,
      } = require("./catalog-products");
      const zcql = app.zcql();
      await resolveBrandId(zcql, record.brand);
      await resolveCategoryPath(zcql, record.category_path);
      for (const path of splitPipe(record.extra_categories)) {
        await resolveCategoryPath(zcql, path);
      }
      const existingVariant = await findVariantBySku(zcql, record.sku);
      const existingProduct = await findProductByCode(zcql, record.product_code);
      normalized._existing_variant_id = existingVariant ? String(existingVariant.ROWID) : "";
      normalized._existing_product_id = existingProduct
        ? String(existingProduct.ROWID)
        : existingVariant
          ? String(existingVariant.product_id)
          : "";
      normalized._action = existingVariant || existingProduct ? "UPDATE" : "CREATE";
    } catch (error) {
      errors.push({
        field: error.code === "INVALID_BRAND" ? "brand" : error.code === "INVALID_CATEGORY" ? "category_path" : "row",
        code: error.code || "VALIDATION",
        message: error.message,
      });
    }
  }

  if (normalized.mrp != null && normalized.selling_price != null && normalized.selling_price > normalized.mrp) {
    warnings.push({ field: "selling_price", code: "PRICE_WARNING", message: "selling_price is greater than mrp" });
  }

  return { ok: errors.length === 0, errors, warnings, normalized };
}

async function previewImport(app, csvText, { mode = "UPSERT" } = {}) {
  const records = csvObjects(csvText);
  const seenSkus = new Set();
  const rows = [];
  let valid = 0;
  let invalid = 0;
  let createCount = 0;
  let updateCount = 0;
  for (const record of records) {
    const result = await validateRecord(app, record, seenSkus);
    if (result.ok) {
      valid += 1;
      if (result.normalized._action === "CREATE") createCount += 1;
      else updateCount += 1;
    } else {
      invalid += 1;
    }
    rows.push({
      row_number: record.row_number,
      sku: record.sku || "",
      product_code: record.product_code || "",
      action: result.normalized?._action || "",
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings,
    });
  }
  return {
    mode,
    total_rows: records.length,
    valid_rows: valid,
    invalid_rows: invalid,
    new_products: createCount,
    existing_products: updateCount,
    rows: rows.slice(0, 200),
    headers: ALL_HEADERS,
  };
}

async function createImportJob(app, { filename, uploadedBy, mode, csvText, preview }) {
  const inserted = await app.datastore().table("Import_Jobs").insertRow({
    filename: filename || "products.csv",
    uploaded_by: uploadedBy || "ADMIN",
    mode: mode || "UPSERT",
    status: "PREVIEWED",
    total_rows: preview.total_rows,
    valid_rows: preview.valid_rows,
    invalid_rows: preview.invalid_rows,
    created_rows: 0,
    updated_rows: 0,
    skipped_rows: 0,
    failed_rows: 0,
    processed_rows: 0,
    error_count: preview.invalid_rows,
    progress_percent: 0,
    preview_json: JSON.stringify({
      new_products: preview.new_products,
      existing_products: preview.existing_products,
      sample_errors: preview.rows.filter((row) => !row.ok).slice(0, 20),
    }).slice(0, 5000),
    summary_json: null,
    started_at: null,
    completed_at: null,
    is_active: true,
  });
  const jobId = insertedRowId(inserted);
  // Persist CSV content into first job row payload batches via Import_Job_Rows for processing.
  const records = csvObjects(csvText);
  for (const record of records) {
    await app.datastore().table("Import_Job_Rows").insertRow({
      job_id: jobId,
      row_number: record.row_number,
      sku: record.sku || null,
      product_code: record.product_code || null,
      action: null,
      status: "PENDING",
      payload_json: JSON.stringify(record).slice(0, 5000),
      error_message: null,
      product_id: null,
      variant_id: null,
    });
  }
  return jobId;
}

async function processImportJob(app, jobId, { actor = "ADMIN", batchSize = 25 } = {}) {
  const zcql = app.zcql();
  const job = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, mode, status, total_rows FROM Import_Jobs WHERE ROWID = " + asId(jobId, "job_id")
    ),
    "Import_Jobs"
  );
  if (!job) {
    const error = new Error("Import job not found");
    error.status = 404;
    throw error;
  }
  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "PROCESSING",
    started_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  });

  const pending = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, row_number, sku, product_code, payload_json, status FROM Import_Job_Rows WHERE job_id = " +
        asId(jobId, "job_id") +
        " AND status = 'PENDING'"
    ),
    "Import_Job_Rows"
  );

  let created = 0;
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;
  const seenSkus = new Set();

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    for (const row of batch) {
      processed += 1;
      let record;
      try {
        record = JSON.parse(row.payload_json || "{}");
      } catch (_) {
        failed += 1;
        await app.datastore().table("Import_Job_Rows").updateRow({
          ROWID: row.ROWID,
          status: "FAILED",
          error_message: "Invalid payload JSON",
        });
        await app.datastore().table("Import_Errors").insertRow({
          job_id: jobId,
          row_number: row.row_number,
          sku: row.sku || null,
          field_name: "payload",
          error_code: "INVALID_PAYLOAD",
          error_message: "Invalid payload JSON",
          severity: "ERROR",
        });
        continue;
      }

      const validated = await validateRecord(app, record, seenSkus);
      if (!validated.ok) {
        failed += 1;
        const message = validated.errors.map((item) => item.message).join("; ");
        await app.datastore().table("Import_Job_Rows").updateRow({
          ROWID: row.ROWID,
          status: "FAILED",
          error_message: message.slice(0, 1000),
        });
        for (const err of validated.errors) {
          await app.datastore().table("Import_Errors").insertRow({
            job_id: jobId,
            row_number: row.row_number,
            sku: record.sku || null,
            field_name: err.field || null,
            error_code: err.code || "VALIDATION",
            error_message: err.message,
            severity: "ERROR",
          });
        }
        continue;
      }

      try {
        const product = await upsertProductMaster(app, {
          ...validated.normalized,
          id: validated.normalized._existing_product_id || undefined,
          concerns: validated.normalized.concerns,
          skin_types: validated.normalized.skin_types,
          hair_types: validated.normalized.hair_types,
          ingredients: validated.normalized.ingredients,
          tags: validated.normalized.tags,
        });
        const variant = await upsertVariant(app, product.id, {
          ...validated.normalized,
          id: validated.normalized._existing_variant_id || undefined,
        });

        if (record.stock !== undefined && String(record.stock).trim() !== "") {
          const explicitWarehouseCode =
            record.warehouse_code !== undefined &&
            String(record.warehouse_code).trim() !== "";
          const warehouse = await resolveWarehouse(
            app.zcql(),
            null,
            explicitWarehouseCode ? String(record.warehouse_code).trim() : undefined
          );
          await setAbsoluteStock(
            app,
            {
              product_id: product.id,
              variant_id: variant.id,
              warehouse_id: warehouse.ROWID,
              quantity_on_hand: Math.max(0, Math.round(num(record.stock))),
              reorder_level: record.reorder_level,
              reorder_quantity: record.reorder_quantity,
              safety_stock: record.safety_stock,
              notes: "Import stock set",
            },
            actor
          );
        }

        // media URLs
        const images = [record.image_1, record.image_2, record.image_3].filter(Boolean);
        for (let mediaIndex = 0; mediaIndex < images.length; mediaIndex += 1) {
          await app.datastore().table("Product_Media").insertRow({
            product_id: product.id,
            variant_id: variant.id,
            media_type: "IMAGE",
            url: images[mediaIndex],
            file_url: images[mediaIndex],
            alt_text: validated.normalized.product_name || record.product_name,
            display_order: mediaIndex + 1,
            is_primary: mediaIndex === 0,
            is_active: true,
          });
        }
        if (record.video_url) {
          await app.datastore().table("Product_Media").insertRow({
            product_id: product.id,
            variant_id: variant.id,
            media_type: "VIDEO",
            url: record.video_url,
            file_url: record.video_url,
            display_order: 100,
            is_primary: false,
            is_active: true,
          });
        }

        await upsertSearchDocument(app, product.id);

        if (product.action === "created" || variant.action === "created") created += 1;
        else updated += 1;

        await app.datastore().table("Import_Job_Rows").updateRow({
          ROWID: row.ROWID,
          status: "SUCCESS",
          action: product.action === "created" ? "CREATE" : "UPDATE",
          product_id: product.id,
          variant_id: variant.id,
          error_message: null,
        });
      } catch (error) {
        failed += 1;
        await app.datastore().table("Import_Job_Rows").updateRow({
          ROWID: row.ROWID,
          status: "FAILED",
          error_message: String(error.message || "Import failed").slice(0, 1000),
        });
        await app.datastore().table("Import_Errors").insertRow({
          job_id: jobId,
          row_number: row.row_number,
          sku: record.sku || null,
          field_name: "row",
          error_code: error.code || "IMPORT_FAILED",
          error_message: String(error.message || "Import failed").slice(0, 1000),
          severity: "ERROR",
        });
      }
    }

    const progress = Math.min(100, Math.round((processed / Math.max(1, pending.length)) * 100));
    await app.datastore().table("Import_Jobs").updateRow({
      ROWID: job.ROWID,
      processed_rows: processed,
      created_rows: created,
      updated_rows: updated,
      failed_rows: failed,
      skipped_rows: skipped,
      error_count: failed,
      progress_percent: progress,
    });
  }

  const summary = {
    created_rows: created,
    updated_rows: updated,
    failed_rows: failed,
    skipped_rows: skipped,
    processed_rows: processed,
  };
  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: failed && !created && !updated ? "FAILED" : "COMPLETED",
    completed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    progress_percent: 100,
    summary_json: JSON.stringify(summary).slice(0, 3000),
    ...summary,
    error_count: failed,
  });
  return summary;
}

async function exportProductsCsv(app, { categoryId, brandId, status, limit = 5000 } = {}) {
  const zcql = app.zcql();
  let query =
    "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, product_type, short_description, description, mrp, selling_price, cost_price, tax_percent, hsn_code, gender, age_group, search_keywords, status, is_featured, is_returnable, thumbnail_url, seo_title, seo_description FROM Products";
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
  const brands = new Map(
    rowsOf(await zcql.executeZCQLQuery("SELECT ROWID, name FROM Brands"), "Brands").map((row) => [
      String(row.ROWID),
      row.name,
    ])
  );
  const categories = new Map(
    rowsOf(await zcql.executeZCQLQuery("SELECT ROWID, name FROM Categories"), "Categories").map((row) => [
      String(row.ROWID),
      row.name,
    ])
  );
  const variants = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, sku, barcode, ean, upc, gtin, variant_name, size_label, size_unit, volume_label, weight_label, color_name, color_hex, shade, finish, mrp, selling_price, cost_price, tax_percent, status FROM Product_Variants WHERE is_active = true"
    ),
    "Product_Variants"
  );
  const variantsByProduct = {};
  variants.forEach((variant) => {
    const key = String(variant.product_id);
    if (!variantsByProduct[key]) variantsByProduct[key] = [];
    variantsByProduct[key].push(variant);
  });

  const escape = (value) => {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  };

  const lines = [templateHeaderRow()];
  let count = 0;
  for (const product of rows) {
    if (brandId && String(product.brand_id) !== String(brandId)) continue;
    if (categoryId && String(product.category_id) !== String(categoryId)) continue;
    if (status && String(product.status) !== String(status)) continue;
    const productVariants = variantsByProduct[String(product.ROWID)] || [
      {
        sku: product.sku,
        variant_name: product.name,
        mrp: product.mrp,
        selling_price: product.selling_price,
        cost_price: product.cost_price,
        tax_percent: product.tax_percent,
      },
    ];
    for (const variant of productVariants) {
      count += 1;
      if (count > limit) break;
      const values = {
        product_code: product.product_code || product.sku || product.ROWID,
        product_name: product.name,
        slug: product.slug,
        brand: brands.get(String(product.brand_id)) || "",
        product_type: product.product_type || "SIMPLE",
        category_path: categories.get(String(product.category_id)) || "",
        extra_categories: "",
        description: product.description || "",
        short_description: product.short_description || "",
        sku: variant.sku || product.sku || "",
        barcode: variant.barcode || "",
        ean: variant.ean || "",
        upc: variant.upc || "",
        gtin: variant.gtin || "",
        variant_name: variant.variant_name || "",
        size: variant.size_label || "",
        unit: variant.size_unit || "",
        volume: variant.volume_label || "",
        weight: variant.weight_label || "",
        color: variant.color_name || "",
        color_hex: variant.color_hex || "",
        shade: variant.shade || "",
        finish: variant.finish || "",
        mrp: variant.mrp ?? product.mrp,
        selling_price: variant.selling_price ?? product.selling_price,
        cost_price: variant.cost_price ?? product.cost_price ?? "",
        tax_percent: variant.tax_percent ?? product.tax_percent ?? "",
        hsn_code: product.hsn_code || "",
        gender: product.gender || "",
        age_group: product.age_group || "",
        skin_types: "",
        hair_types: "",
        concerns: "",
        ingredients: "",
        tags: "",
        search_keywords: product.search_keywords || "",
        status: product.status || "ACTIVE",
        is_featured: product.is_featured,
        is_returnable: product.is_returnable,
        image_1: product.thumbnail_url || "",
        image_2: "",
        image_3: "",
        video_url: "",
        seo_title: product.seo_title || "",
        seo_description: product.seo_description || "",
        warehouse_code: "HQ",
        stock: "",
        reorder_level: "",
        reorder_quantity: "",
        safety_stock: "",
      };
      lines.push(ALL_HEADERS.map((header) => escape(values[header] ?? "")).join(","));
    }
    if (count > limit) break;
  }
  return lines.join("\n");
}

module.exports = {
  parseCsv,
  csvObjects,
  previewImport,
  createImportJob,
  processImportJob,
  exportProductsCsv,
  templateHeaderRow,
};
