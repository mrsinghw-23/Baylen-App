"use strict";

const {
  INVENTORY_REQUIRED_HEADERS,
  INVENTORY_ALL_HEADERS,
  INVENTORY_MAX_ROWS,
  INVENTORY_RECOMMENDED_BATCH_SIZE,
  inventoryTemplateHeaderRow,
  inventoryTemplateCsv,
  hasValue,
  parseNonNegativeInteger,
  inventoryRowIdentity,
} = require("./inventory-csv-contract");
const { parseCsv } = require("./import-pipeline");
const { findVariantBySku, findProductBySku } = require("./catalog-products");
const { setAbsoluteStock, resolveWarehouse, loadInventoryRow } = require("./inventory-ops");
const { normalizeWarehouseCode } = require("./warehouse-admin");
const { optionalText, rowOf, rowsOf, num, insertedRowId, asId } = require("./http");

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function resolveFinalStatus(created, updated, failed, cancelled) {
  if (cancelled) return "CANCELLED";
  const success = created + updated;
  if (failed && success) return "COMPLETED_WITH_ERRORS";
  if (failed && !success) return "FAILED";
  return "COMPLETED";
}

async function fetchInventoryJob(app, jobId) {
  return rowOf(
    await app
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, mode, status, total_rows, processed_rows, created_rows, updated_rows, failed_rows, error_count FROM Import_Jobs WHERE ROWID = " +
          asId(jobId, "job_id")
      ),
    "Import_Jobs"
  );
}

async function fetchImportRowBatch(zcql, jobId, batchSize, { includeFailed = false } = {}) {
  const statusFilter = includeFailed
    ? "status IN ('PENDING', 'FAILED')"
    : "status = 'PENDING'";
  return rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, row_number, sku, product_code, payload_json, status FROM Import_Job_Rows WHERE job_id = " +
        asId(jobId, "job_id") +
        " AND " +
        statusFilter +
        " LIMIT " +
        Math.max(1, Math.min(500, Number(batchSize) || 25))
    ),
    "Import_Job_Rows"
  );
}

function inventoryCsvObjects(csvText, { maxRows = INVENTORY_MAX_ROWS } = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    const error = new Error("CSV must include a header row and at least one data row");
    error.status = 400;
    throw error;
  }
  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const missing = INVENTORY_REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) {
    const error = new Error("CSV missing required headers: " + missing.join(", "));
    error.status = 400;
    error.code = "MISSING_HEADERS";
    throw error;
  }
  if (rows.length - 1 > maxRows) {
    const error = new Error("Inventory CSV supports up to " + maxRows + " data rows per job");
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

async function resolveSkuTarget(zcql, sku) {
  const variant = await findVariantBySku(zcql, sku);
  if (variant) {
    return {
      product_id: String(variant.product_id),
      variant_id: String(variant.ROWID),
    };
  }
  const product = await findProductBySku(zcql, sku);
  if (product) {
    return {
      product_id: String(product.ROWID),
      variant_id: null,
    };
  }
  return null;
}

async function validateInventoryRecord(app, record, seenIdentities) {
  const errors = [];
  const normalized = {
    row_number: record.row_number,
    warehouse_code: "",
    sku: String(record.sku || "").trim(),
    stock: undefined,
    reorder_level: undefined,
    reorder_quantity: undefined,
    safety_stock: undefined,
    product_id: "",
    variant_id: null,
    warehouse_id: "",
    _action: "CREATE",
  };

  if (!hasValue(record.warehouse_code)) {
    errors.push({
      field: "warehouse_code",
      code: "REQUIRED",
      message: "warehouse_code is required",
    });
  } else {
    try {
      normalized.warehouse_code = normalizeWarehouseCode(record.warehouse_code);
    } catch (error) {
      errors.push({
        field: "warehouse_code",
        code: error.code || "INVALID_WAREHOUSE_CODE",
        message: error.message,
      });
    }
  }

  if (!hasValue(record.sku)) {
    errors.push({
      field: "sku",
      code: "REQUIRED",
      message: "sku is required",
    });
  }

  const stockResult = parseNonNegativeInteger(record.stock, "stock", { required: true });
  if (stockResult.error) {
    errors.push(stockResult.error);
  } else {
    normalized.stock = stockResult.value;
  }

  for (const field of ["reorder_level", "reorder_quantity", "safety_stock"]) {
    if (hasValue(record[field])) {
      const parsed = parseNonNegativeInteger(record[field], field, { required: false });
      if (parsed.error) {
        errors.push(parsed.error);
      } else {
        normalized[field] = parsed.value;
      }
    }
  }

  if (normalized.warehouse_code && normalized.sku) {
    const identity = inventoryRowIdentity(normalized.warehouse_code, normalized.sku);
    if (seenIdentities.has(identity)) {
      errors.push({
        field: "row",
        code: "DUPLICATE_INVENTORY_ROW",
        message:
          "Duplicate warehouse_code + sku in CSV: " +
          normalized.warehouse_code +
          " / " +
          normalized.sku,
      });
    } else {
      seenIdentities.add(identity);
    }
  }

  if (errors.length) {
    return { ok: false, errors, normalized };
  }

  const zcql = app.zcql();
  try {
    const warehouse = await resolveWarehouse(zcql, null, normalized.warehouse_code);
    normalized.warehouse_id = String(warehouse.ROWID);
  } catch (error) {
    errors.push({
      field: "warehouse_code",
      code: error.code || "WAREHOUSE_NOT_FOUND",
      message: error.message,
    });
    return { ok: false, errors, normalized };
  }

  const skuTarget = await resolveSkuTarget(zcql, normalized.sku);
  if (!skuTarget) {
    errors.push({
      field: "sku",
      code: "SKU_NOT_FOUND",
      message: "SKU not found: " + normalized.sku,
    });
    return { ok: false, errors, normalized };
  }
  normalized.product_id = skuTarget.product_id;
  normalized.variant_id = skuTarget.variant_id;

  const existing = await loadInventoryRow(zcql, {
    warehouseId: normalized.warehouse_id,
    productId: normalized.product_id,
    variantId: normalized.variant_id,
  });
  normalized._action = existing ? "UPDATE" : "CREATE";

  return { ok: true, errors, normalized };
}

async function previewInventoryImport(app, csvText) {
  const records = inventoryCsvObjects(csvText);
  const seenIdentities = new Set();
  const rows = [];
  let valid = 0;
  let invalid = 0;
  let createCount = 0;
  let updateCount = 0;

  for (const record of records) {
    const result = await validateInventoryRecord(app, record, seenIdentities);
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
      warehouse_code: record.warehouse_code || "",
      action: result.normalized?._action || "",
      ok: result.ok,
      errors: result.errors,
    });
  }

  return {
    import_type: "INVENTORY",
    mode: "ABSOLUTE_STOCK",
    total_rows: records.length,
    valid_rows: valid,
    invalid_rows: invalid,
    created_inventory_rows: createCount,
    updated_inventory_rows: updateCount,
    recommended_batch_size: INVENTORY_RECOMMENDED_BATCH_SIZE,
    max_rows: INVENTORY_MAX_ROWS,
    rows: rows.slice(0, 200),
    headers: INVENTORY_ALL_HEADERS,
  };
}

async function createInventoryImportJob(app, { filename, uploadedBy, csvText, preview }) {
  const inserted = await app.datastore().table("Import_Jobs").insertRow({
    filename: filename || "inventory.csv",
    uploaded_by: uploadedBy || "ADMIN",
    mode: "INVENTORY",
    status: "QUEUED",
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
      import_type: "INVENTORY",
      created_inventory_rows: preview.created_inventory_rows,
      updated_inventory_rows: preview.updated_inventory_rows,
      sample_errors: preview.rows.filter((row) => !row.ok).slice(0, 20),
    }).slice(0, 5000),
    summary_json: null,
    started_at: null,
    completed_at: null,
    is_active: true,
  });
  const jobId = insertedRowId(inserted);
  const records = inventoryCsvObjects(csvText);
  for (const record of records) {
    await app.datastore().table("Import_Job_Rows").insertRow({
      job_id: jobId,
      row_number: record.row_number,
      sku: record.sku || null,
      product_code: record.warehouse_code || null,
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

async function processInventoryImportJob(
  app,
  jobId,
  { actor = "ADMIN", batchSize = 25, includeFailed = false } = {}
) {
  const zcql = app.zcql();
  const job = await fetchInventoryJob(app, jobId);
  if (!job) {
    const error = new Error("Import job not found");
    error.status = 404;
    throw error;
  }

  const initialStatus = String(job.status || "").toUpperCase();
  if (initialStatus === "PROCESSING") {
    const error = new Error("Import job is already processing");
    error.status = 409;
    error.code = "JOB_ALREADY_PROCESSING";
    throw error;
  }
  if (initialStatus === "CANCELLED") {
    return {
      import_type: "INVENTORY",
      created_inventory_rows: num(job.created_rows),
      updated_inventory_rows: num(job.updated_rows),
      failed_rows: num(job.failed_rows),
      skipped_rows: 0,
      processed_rows: num(job.processed_rows),
      status: "CANCELLED",
      cancelled: true,
    };
  }
  if (initialStatus === "COMPLETED") {
    const error = new Error("Import job is already completed");
    error.status = 409;
    error.code = "JOB_ALREADY_COMPLETED";
    throw error;
  }

  let created = num(job.created_rows);
  let updated = num(job.updated_rows);
  let failed = 0;
  let skipped = 0;
  let processed = num(job.processed_rows);
  const totalRows = Math.max(1, num(job.total_rows));
  const seenIdentities = new Set();
  let cancelled = false;

  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "PROCESSING",
    started_at: job.started_at || nowSql(),
    completed_at: null,
  });

  while (true) {
    const current = await fetchInventoryJob(app, jobId);
    if (String(current.status || "").toUpperCase() === "CANCELLED") {
      cancelled = true;
      break;
    }

    const batch = await fetchImportRowBatch(zcql, jobId, batchSize, { includeFailed });
    if (!batch.length) {
      break;
    }

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

      const validated = await validateInventoryRecord(app, record, seenIdentities);
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
        const beforeRow = await loadInventoryRow(zcql, {
          warehouseId: validated.normalized.warehouse_id,
          productId: validated.normalized.product_id,
          variantId: validated.normalized.variant_id,
        });
        const stockBody = {
          warehouse_code: validated.normalized.warehouse_code,
          product_id: validated.normalized.product_id,
          variant_id: validated.normalized.variant_id,
          quantity_on_hand: validated.normalized.stock,
          notes: "Inventory import job " + jobId,
          reference_type: "IMPORT",
          reference_id: String(jobId),
        };
        if (validated.normalized.reorder_level !== undefined) {
          stockBody.reorder_level = validated.normalized.reorder_level;
        }
        if (validated.normalized.reorder_quantity !== undefined) {
          stockBody.reorder_quantity = validated.normalized.reorder_quantity;
        }
        if (validated.normalized.safety_stock !== undefined) {
          stockBody.safety_stock = validated.normalized.safety_stock;
        }

        const result = await setAbsoluteStock(app, stockBody, actor);
        if (beforeRow) updated += 1;
        else created += 1;

        await app.datastore().table("Import_Job_Rows").updateRow({
          ROWID: row.ROWID,
          status: "SUCCESS",
          action: beforeRow ? "UPDATE" : "CREATE",
          product_id: validated.normalized.product_id,
          variant_id: validated.normalized.variant_id,
          error_message: null,
        });
        if (result.before_quantity === result.after_quantity) {
          skipped += 0;
        }
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

    const progress = Math.min(100, Math.round((processed / totalRows) * 100));
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

  const failedRowsRemaining = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Import_Job_Rows WHERE job_id = " +
        asId(jobId, "job_id") +
        " AND status = 'FAILED'"
    ),
    "Import_Job_Rows"
  ).length;
  failed = failedRowsRemaining;
  processed = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Import_Job_Rows WHERE job_id = " +
        asId(jobId, "job_id") +
        " AND status IN ('SUCCESS', 'FAILED')"
    ),
    "Import_Job_Rows"
  ).length;

  const finalStatus = resolveFinalStatus(created, updated, failed, cancelled);
  const summary = {
    import_type: "INVENTORY",
    created_inventory_rows: created,
    updated_inventory_rows: updated,
    failed_rows: failed,
    skipped_rows: skipped,
    processed_rows: processed,
    status: finalStatus,
    cancelled,
  };
  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: finalStatus,
    completed_at: cancelled ? nowSql() : nowSql(),
    progress_percent: cancelled ? Math.min(100, Math.round((processed / totalRows) * 100)) : 100,
    summary_json: JSON.stringify(summary).slice(0, 3000),
    created_rows: created,
    updated_rows: updated,
    failed_rows: failed,
    skipped_rows: skipped,
    processed_rows: processed,
    error_count: failed,
  });
  return summary;
}

module.exports = {
  inventoryCsvObjects,
  validateInventoryRecord,
  previewInventoryImport,
  createInventoryImportJob,
  processInventoryImportJob,
  resolveSkuTarget,
  inventoryTemplateHeaderRow,
  inventoryTemplateCsv,
  resolveFinalStatus,
  fetchImportRowBatch,
};
