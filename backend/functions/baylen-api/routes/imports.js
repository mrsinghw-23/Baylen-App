"use strict";

const { asId, optionalText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const {
  previewImport,
  createImportJob,
  processImportJob,
  exportProductsCsv,
  templateHeaderRow,
} = require("../lib/import-pipeline");
const { CSV_COLUMNS } = require("../lib/csv-contract");
const { backfillProductCategories } = require("../lib/catalog-products");
const { rebuildSearchIndex } = require("../lib/search-index");

function secureEqual(left, right) {
  const crypto = require("crypto");
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

function importRoutes(app) {
  app.get("/v1/admin/imports/template", async (req, res, next) => {
    try {
      requireAdmin(req);
      sendOk(res, {
        filename: "baylen-product-import-template.csv",
        content_type: "text/csv",
        csv: templateHeaderRow() + "\n",
        columns: CSV_COLUMNS,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/imports/preview", async (req, res, next) => {
    try {
      requireAdmin(req);
      const csvText = String(req.body.csv_text || "");
      const mode = optionalText(req.body.mode, "mode", 20) || "UPSERT";
      const preview = await previewImport(req.catalystApp, csvText, { mode });
      sendOk(res, { preview });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/imports", async (req, res, next) => {
    try {
      requireAdmin(req);
      const csvText = String(req.body.csv_text || "");
      const mode = optionalText(req.body.mode, "mode", 20) || "UPSERT";
      const filename = optionalText(req.body.filename, "filename", 180) || "products.csv";
      const confirm = req.body.confirm === true || req.body.confirm === "true";
      const preview = await previewImport(req.catalystApp, csvText, { mode });
      if (!confirm) {
        sendOk(res, {
          requires_confirmation: true,
          preview,
          message: "Set confirm=true to create and process the import job",
        });
        return;
      }
      if (preview.invalid_rows > 0 && req.body.allow_invalid !== true && req.body.allow_invalid !== "true") {
        const error = new Error(
          "Import has " + preview.invalid_rows + " invalid rows. Fix errors or pass allow_invalid=true"
        );
        error.status = 400;
        error.details = preview.rows.filter((row) => !row.ok).slice(0, 50);
        throw error;
      }
      const jobId = await createImportJob(req.catalystApp, {
        filename,
        uploadedBy: adminActor(req),
        mode,
        csvText,
        preview,
      });
      // Process inline in batches for reliability on Advanced I/O (no separate worker yet).
      const summary = await processImportJob(req.catalystApp, jobId, { actor: adminActor(req) });
      sendOk(res, { job_id: jobId, summary, preview_totals: {
        total_rows: preview.total_rows,
        valid_rows: preview.valid_rows,
        invalid_rows: preview.invalid_rows,
      } });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/imports/:id", async (req, res, next) => {
    try {
      requireAdmin(req);
      const jobId = asId(req.params.id, "id");
      const job = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, filename, uploaded_by, mode, status, total_rows, valid_rows, invalid_rows, created_rows, updated_rows, skipped_rows, failed_rows, processed_rows, error_count, progress_percent, preview_json, summary_json, started_at, completed_at FROM Import_Jobs WHERE ROWID = " +
              jobId
          ),
        "Import_Jobs"
      );
      if (!job) {
        const error = new Error("Import job not found");
        error.status = 404;
        throw error;
      }
      sendOk(res, {
        job: {
          id: String(job.ROWID),
          filename: job.filename,
          uploaded_by: job.uploaded_by,
          mode: job.mode,
          status: job.status,
          total_rows: num(job.total_rows),
          valid_rows: num(job.valid_rows),
          invalid_rows: num(job.invalid_rows),
          created_rows: num(job.created_rows),
          updated_rows: num(job.updated_rows),
          skipped_rows: num(job.skipped_rows),
          failed_rows: num(job.failed_rows),
          processed_rows: num(job.processed_rows),
          error_count: num(job.error_count),
          progress_percent: num(job.progress_percent),
          started_at: job.started_at || "",
          completed_at: job.completed_at || "",
          preview: job.preview_json ? safeJson(job.preview_json) : null,
          summary: job.summary_json ? safeJson(job.summary_json) : null,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/imports/:id/errors", async (req, res, next) => {
    try {
      requireAdmin(req);
      const jobId = asId(req.params.id, "id");
      const limit = Math.min(1000, Math.max(1, num(req.query.limit) || 200));
      const format = optionalText(req.query.format, "format", 10) || "json";
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, row_number, sku, field_name, error_code, error_message, severity FROM Import_Errors WHERE job_id = " +
              jobId
          ),
        "Import_Errors"
      ).slice(0, limit);
      if (format === "csv") {
        const lines = ["row_number,sku,field_name,error_code,error_message,severity"];
        rows.forEach((row) => {
          lines.push(
            [
              row.row_number,
              csvEscape(row.sku),
              csvEscape(row.field_name),
              csvEscape(row.error_code),
              csvEscape(row.error_message),
              csvEscape(row.severity),
            ].join(",")
          );
        });
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="import-errors-' + jobId + '.csv"');
        res.status(200).send(lines.join("\n"));
        return;
      }
      sendOk(res, {
        errors: rows.map((row) => ({
          id: String(row.ROWID),
          row_number: num(row.row_number),
          sku: row.sku || "",
          field_name: row.field_name || "",
          error_code: row.error_code || "",
          error_message: row.error_message || "",
          severity: row.severity || "ERROR",
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/exports/products", async (req, res, next) => {
    try {
      requireAdmin(req);
      const csv = await exportProductsCsv(req.catalystApp, {
        categoryId: req.query.category_id || "",
        brandId: req.query.brand_id || "",
        status: req.query.status || "",
        limit: Math.min(20000, Math.max(1, num(req.query.limit) || 5000)),
      });
      if (req.query.download === "1" || req.query.download === "true") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="baylen-products-export.csv"');
        res.status(200).send(csv);
        return;
      }
      sendOk(res, { csv, filename: "baylen-products-export.csv" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/catalog/backfill-categories", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await backfillProductCategories(req.catalystApp);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/search/rebuild", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await rebuildSearchIndex(req.catalystApp, {
        limit: Math.min(20000, Math.max(1, num(req.body.limit) || 5000)),
      });
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

module.exports = importRoutes;
