"use strict";

const { processInventoryImportJob } = require("./inventory-import-pipeline");
const { rowOf, rowsOf, asId, num } = require("./http");
const { inventoryImportWorkerMode } = require("./runtime-config");
const {
  acquireDistributedImportLock,
  releaseDistributedImportLock,
  withImportJobLock,
} = require("./import-job-lock");

const TERMINAL_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]);
const CANCELLABLE_STATUSES = new Set(["QUEUED", "PROCESSING"]);
const RETRYABLE_STATUSES = new Set(["COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED"]);

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function successfulRows(job) {
  return num(job.created_rows) + num(job.updated_rows);
}

function mapInventoryJob(job) {
  return {
    id: String(job.ROWID),
    job_id: String(job.ROWID),
    filename: job.filename || "",
    created_by: job.uploaded_by || "",
    uploaded_by: job.uploaded_by || "",
    mode: job.mode || "INVENTORY",
    status: job.status || "",
    total_rows: num(job.total_rows),
    processed_rows: num(job.processed_rows),
    successful_rows: successfulRows(job),
    created_rows: num(job.created_rows),
    updated_rows: num(job.updated_rows),
    failed_rows: num(job.failed_rows),
    skipped_rows: num(job.skipped_rows),
    valid_rows: num(job.valid_rows),
    invalid_rows: num(job.invalid_rows),
    error_count: num(job.error_count),
    progress_percent: num(job.progress_percent),
    started_at: job.started_at || "",
    completed_at: job.completed_at || "",
    preview: job.preview_json ? safeJson(job.preview_json) : null,
    summary: job.summary_json ? safeJson(job.summary_json) : null,
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

async function loadInventoryJob(app, jobId) {
  const job = rowOf(
    await app
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, filename, uploaded_by, mode, status, total_rows, valid_rows, invalid_rows, created_rows, updated_rows, skipped_rows, failed_rows, processed_rows, error_count, progress_percent, preview_json, summary_json, started_at, completed_at FROM Import_Jobs WHERE ROWID = " +
          asId(jobId, "job_id")
      ),
    "Import_Jobs"
  );
  if (!job) {
    const error = new Error("Import job not found");
    error.status = 404;
    throw error;
  }
  if (String(job.mode || "").toUpperCase() !== "INVENTORY") {
    const error = new Error("Job is not an inventory import");
    error.status = 400;
    throw error;
  }
  return job;
}

/** @deprecated Use acquireDistributedImportLock — kept for unit tests. */
function acquireJobLock(jobId) {
  const { LOCAL_LOCKS } = require("./import-job-lock");
  const key = String(jobId);
  if (LOCAL_LOCKS.has(key)) {
    return false;
  }
  LOCAL_LOCKS.add(key);
  return true;
}

/** @deprecated Use releaseDistributedImportLock — kept for unit tests. */
function releaseJobLock(jobId) {
  const { LOCAL_LOCKS } = require("./import-job-lock");
  LOCAL_LOCKS.delete(String(jobId));
}

async function getInventoryImportJob(app, jobId) {
  const job = await loadInventoryJob(app, jobId);
  return mapInventoryJob(job);
}

async function cancelInventoryImportJob(app, jobId, { actor = "ADMIN" } = {}) {
  const job = await loadInventoryJob(app, jobId);
  if (!CANCELLABLE_STATUSES.has(String(job.status || "").toUpperCase())) {
    const error = new Error("Import job cannot be cancelled in status " + job.status);
    error.status = 409;
    error.code = "JOB_NOT_CANCELLABLE";
    throw error;
  }
  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "CANCELLED",
    completed_at: nowSql(),
    progress_percent: num(job.progress_percent),
  });
  await releaseDistributedImportLock(app, jobId);
  const updated = await loadInventoryJob(app, jobId);
  return { job: mapInventoryJob(updated), actor };
}

async function retryInventoryImportJob(app, jobId, { actor = "ADMIN", batchSize = 25, queue = true } = {}) {
  const job = await loadInventoryJob(app, jobId);
  const status = String(job.status || "").toUpperCase();
  if (status === "PROCESSING") {
    const error = new Error("Import job is already processing");
    error.status = 409;
    error.code = "JOB_ALREADY_PROCESSING";
    throw error;
  }
  if (!RETRYABLE_STATUSES.has(status)) {
    const error = new Error("Import job cannot be retried in status " + job.status);
    error.status = 409;
    error.code = "JOB_NOT_RETRYABLE";
    throw error;
  }
  await app.datastore().table("Import_Jobs").updateRow({
    ROWID: job.ROWID,
    status: "QUEUED",
    completed_at: null,
    summary_json: null,
  });
  const failedRows = rowsOf(
    await app
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID FROM Import_Job_Rows WHERE job_id = " +
          asId(jobId, "job_id") +
          " AND status = 'FAILED'"
      ),
    "Import_Job_Rows"
  );
  for (const row of failedRows) {
    await app.datastore().table("Import_Job_Rows").updateRow({
      ROWID: row.ROWID,
      status: "PENDING",
      error_message: null,
    });
  }
  if (queue) {
    const queued = await queueInventoryImportWorker(app, jobId, { actor, batchSize });
    const updated = await loadInventoryJob(app, jobId);
    return { job: mapInventoryJob(updated), queued: true, worker_mode: queued.worker_mode, actor };
  }
  const summary = await runInventoryImportWorker(app, jobId, { actor, batchSize, includeFailed: true });
  const updated = await loadInventoryJob(app, jobId);
  return { job: mapInventoryJob(updated), summary, queued: false, actor };
}

async function runInventoryImportWorker(app, jobId, { actor = "ADMIN", batchSize = 25, includeFailed = false } = {}) {
  return withImportJobLock(app, jobId, () =>
    processInventoryImportJob(app, jobId, { actor, batchSize, includeFailed })
  );
}

/**
 * Queue job for processing. Production uses deferred mode (Cron/worker endpoint).
 * Development defaults to inline processing in the same request (no setImmediate).
 */
async function queueInventoryImportWorker(app, jobId, { actor = "ADMIN", batchSize = 25 } = {}) {
  const mode = inventoryImportWorkerMode();
  const result = {
    queued: mode === "deferred",
    processed_inline: false,
    worker_mode: mode,
    job_id: String(jobId),
  };

  if (mode === "inline") {
    await runInventoryImportWorker(app, jobId, { actor, batchSize });
    result.processed_inline = true;
    result.queued = false;
  }

  return result;
}

/**
 * Process one or more QUEUED inventory import jobs (Catalyst Cron / admin worker endpoint).
 */
async function processNextQueuedInventoryJobs(app, { limit = 1, actor = "WORKER", batchSize = 25 } = {}) {
  const capped = Math.max(1, Math.min(10, Math.round(num(limit) || 1)));
  const queued = rowsOf(
    await app
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID FROM Import_Jobs WHERE mode = 'INVENTORY' AND status = 'QUEUED' ORDER BY ROWID ASC LIMIT " +
          capped
      ),
    "Import_Jobs"
  );

  const results = [];
  for (const row of queued) {
    const jobId = String(row.ROWID);
    try {
      const summary = await runInventoryImportWorker(app, jobId, { actor, batchSize });
      results.push({ job_id: jobId, status: "processed", summary });
    } catch (error) {
      results.push({
        job_id: jobId,
        status: "error",
        code: error.code || null,
        error: error.message || String(error),
      });
    }
  }

  return {
    worker_mode: inventoryImportWorkerMode(),
    requested_limit: capped,
    found: queued.length,
    results,
  };
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(String(status || "").toUpperCase());
}

module.exports = {
  TERMINAL_STATUSES,
  CANCELLABLE_STATUSES,
  RETRYABLE_STATUSES,
  acquireJobLock,
  releaseJobLock,
  getInventoryImportJob,
  cancelInventoryImportJob,
  retryInventoryImportJob,
  runInventoryImportWorker,
  queueInventoryImportWorker,
  processNextQueuedInventoryJobs,
  mapInventoryJob,
  isTerminalStatus,
};
