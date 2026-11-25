"use strict";

/**
 * Per Professional_Jobs row lock for concurrency-safe dispatch assignment.
 * Production: Catalyst Cache token lock. Tests/local: in-process mutex.
 */

const LOCK_PREFIX = "professional:job:lock:";
const DEFAULT_TTL_SECONDS = 30;
const DEFAULT_MAX_WAIT_MS = 8000;
const DEFAULT_RETRY_MS = 20;

const localMutexChains = new Map();
const localMutexDepth = new Map();

function useLocalLockOnly() {
  return process.env.PROFESSIONAL_JOB_LOCK_LOCAL === "true" || process.env.NODE_ENV === "test";
}

async function withLocalMutex(key, fn) {
  const depth = localMutexDepth.get(key) || 0;
  if (depth > 0) {
    localMutexDepth.set(key, depth + 1);
    try {
      return await fn();
    } finally {
      localMutexDepth.set(key, depth);
    }
  }

  const prev = localMutexChains.get(key) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const next = prev.then(() => gate);
  localMutexChains.set(key, next);
  localMutexDepth.set(key, 1);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    localMutexDepth.delete(key);
    if (localMutexChains.get(key) === next) {
      localMutexChains.delete(key);
    }
  }
}

async function acquireCacheLock(app, key, ttlSeconds) {
  const segment = app.cache().segment();
  const token = Date.now() + ":" + Math.random().toString(36).slice(2, 12);
  const existing = await segment.getValue(key);
  if (existing) {
    return null;
  }
  await segment.put(key, token, ttlSeconds);
  const verify = await segment.getValue(key);
  return verify === token ? token : null;
}

async function releaseCacheLock(app, key, token) {
  try {
    const segment = app.cache().segment();
    const current = await segment.getValue(key);
    if (current === token) {
      await segment.put(key, "", 1);
    }
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withProfessionalJobLock(app, jobRowId, fn, options = {}) {
  const key = LOCK_PREFIX + String(jobRowId);
  const ttlSeconds = options.ttlSeconds || DEFAULT_TTL_SECONDS;
  const maxWaitMs = options.maxWaitMs || DEFAULT_MAX_WAIT_MS;
  const retryMs = options.retryMs || DEFAULT_RETRY_MS;

  const cacheAvailable = typeof app?.cache === "function";
  if (useLocalLockOnly() || !cacheAvailable) {
    return withLocalMutex(key, fn);
  }

  const started = Date.now();
  let token = null;
  while (Date.now() - started < maxWaitMs) {
    token = await acquireCacheLock(app, key, ttlSeconds);
    if (token) {
      break;
    }
    await sleep(retryMs);
  }
  if (!token) {
    const error = new Error("Could not acquire professional job lock");
    error.status = 409;
    error.code = "JOB_LOCK_TIMEOUT";
    throw error;
  }
  try {
    return await fn();
  } finally {
    await releaseCacheLock(app, key, token);
  }
}

module.exports = {
  LOCK_PREFIX,
  withProfessionalJobLock,
};
