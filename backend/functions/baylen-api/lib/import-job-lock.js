"use strict";

/** In-process fallback when Cache is unavailable (unit tests). */
const LOCAL_LOCKS = new Set();

const LOCK_PREFIX = "import:job:lock:";
const DEFAULT_LOCK_TTL_SECONDS = 900;

function lockKey(jobId) {
  return LOCK_PREFIX + String(jobId);
}

function useLocalLocksOnly() {
  return (
    process.env.INVENTORY_IMPORT_LOCK_LOCAL === "true" ||
    process.env.NODE_ENV === "test"
  );
}

async function readCacheLock(app, jobId) {
  if (useLocalLocksOnly()) {
    return LOCAL_LOCKS.has(String(jobId)) ? "local" : null;
  }
  try {
    return await app.cache().segment().getValue(lockKey(jobId));
  } catch (_) {
    return LOCAL_LOCKS.has(String(jobId)) ? "local" : null;
  }
}

/**
 * Distributed import job lock via Catalyst Cache (cross-instance).
 * Falls back to in-process lock in tests or when Cache is unavailable.
 */
async function acquireDistributedImportLock(app, jobId, { ttlSeconds = DEFAULT_LOCK_TTL_SECONDS } = {}) {
  const id = String(jobId);
  if (useLocalLocksOnly()) {
    if (LOCAL_LOCKS.has(id)) {
      return false;
    }
    LOCAL_LOCKS.add(id);
    return true;
  }

  try {
    const segment = app.cache().segment();
    const existing = await segment.getValue(lockKey(id));
    if (existing) {
      return false;
    }
    await segment.put(lockKey(id), String(Date.now()), ttlSeconds);
    const verify = await segment.getValue(lockKey(id));
    return Boolean(verify);
  } catch (_) {
    if (LOCAL_LOCKS.has(id)) {
      return false;
    }
    LOCAL_LOCKS.add(id);
    return true;
  }
}

async function releaseDistributedImportLock(app, jobId) {
  const id = String(jobId);
  LOCAL_LOCKS.delete(id);
  if (useLocalLocksOnly()) {
    return;
  }
  try {
    await app.cache().segment().put(lockKey(id), "", 1);
  } catch (_) {}
}

async function withImportJobLock(app, jobId, fn) {
  const acquired = await acquireDistributedImportLock(app, jobId);
  if (!acquired) {
    const error = new Error("Import job is already processing");
    error.status = 409;
    error.code = "JOB_ALREADY_PROCESSING";
    throw error;
  }
  try {
    return await fn();
  } finally {
    await releaseDistributedImportLock(app, jobId);
  }
}

module.exports = {
  LOCK_PREFIX,
  LOCAL_LOCKS,
  acquireDistributedImportLock,
  releaseDistributedImportLock,
  withImportJobLock,
  readCacheLock,
};
