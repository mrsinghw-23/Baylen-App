"use strict";

const CACHE_TTL_MINUTES = 15;

function cacheKey(jobId) {
  return "beauty_provider_loc:" + String(jobId);
}

async function writeProviderLocationCache(app, jobId, payload) {
  try {
    await app.cache().segment().put(
      cacheKey(jobId),
      JSON.stringify({
        ...payload,
        cached_at: new Date().toISOString(),
      }),
      CACHE_TTL_MINUTES
    );
  } catch (_) {}
}

async function readProviderLocationCache(app, jobId) {
  try {
    const raw = await app.cache().segment().getValue(cacheKey(jobId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  writeProviderLocationCache,
  readProviderLocationCache,
};
