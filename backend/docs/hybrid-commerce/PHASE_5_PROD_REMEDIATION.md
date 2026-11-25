# Phase 5-PROD — Production Blocker Remediation

**Date:** 2026-09-03  
**Scope:** Fix Production readiness blockers from `PHASE_5_PRODUCTION_READINESS.md`  
**Production deploy:** Not performed (Development-only per project policy)

---

## Blockers addressed

### 1. Background import worker (Phase 5.6)

| Before | After |
|--------|-------|
| `setImmediate` fire-and-forget in HTTP handler | Explicit worker modes via `INVENTORY_IMPORT_WORKER_MODE` |
| In-process `ACTIVE_LOCKS` Map | Catalyst Cache distributed lock (`lib/import-job-lock.js`) + in-process fallback for tests |
| No Cron entrypoint | `POST /v1/admin/inventory/import/worker/process` processes queued jobs |

**Production behavior:**
- `BAYLEN_ENV=production` → default worker mode **`deferred`**
- Jobs stay `QUEUED` until Cron/admin calls worker endpoint
- Development default remains **`inline`** (same-request processing, no `setImmediate`)

**Files:** `lib/inventory-import-worker.js`, `lib/import-job-lock.js`, `routes/imports.js`, APIG route `admin-inventory-import-worker-process`

### 2. Session / admin secrets

| Before | After |
|--------|-------|
| `AUTH_SESSION_SECRET` defaulted to `baylen-dev-session-key` | `lib/runtime-config.js` — Production **throws at startup** if secret missing or under 32 chars |
| Same fallback in `auth.js` OTP HMAC | Uses `getAuthSessionSecret()` |
| No Production admin key guard | `assertRuntimeSecrets()` validates `ADMIN_API_KEY` in Production |

**Files:** `lib/runtime-config.js`, `lib/session.js`, `routes/auth.js`, `index.js`

### 3. Inventory duplicate detection (Phase 5.5)

| Before | After |
|--------|-------|
| `buildInventoryDuplicateReport()` only in tests/lib | Admin API `GET /v1/admin/inventory/duplicate-scan` |

**Files:** `routes/inventory.js`, APIG route `admin-inventory-duplicate-scan`

### 4. Backup / recovery (operational)

| Before | After |
|--------|-------|
| No documented export path | `backend/scripts/export-datastore-snapshot.js` + `BACKUP_RECOVERY.md` |

---

## Production env vars (required)

```env
BAYLEN_ENV=production
AUTH_SESSION_SECRET=<random-32+-chars>
ADMIN_API_KEY=<random-32+-chars>
INVENTORY_IMPORT_WORKER_MODE=deferred
```

Optional override: `INVENTORY_IMPORT_WORKER_MODE=inline` only for emergency single-instance debugging (not recommended).

## Cron setup (Production)

Create a Catalyst Cron job targeting:

```
POST /v1/admin/inventory/import/worker/process
x-baylen-admin-key: <ADMIN_API_KEY>
Content-Type: application/json

{"limit": 1, "batch_size": 25}
```

Schedule: every 1–5 minutes (adjust for import volume).

## Verification

```bash
cd backend/functions/baylen-api
npm test
```

Expected: all tests pass including `test/runtime-config.test.js` and updated `test/inventory-import-worker.test.js`.

## Updated readiness verdict

| Area | Pre-remediation | Post-remediation |
|------|-----------------|------------------|
| Import worker | FAIL (in-process lock) | **PASS** (deferred + Cache lock + Cron endpoint) |
| Secrets | PARTIAL (dev default) | **PASS** (fail-fast in Production) |
| Duplicate scan | PARTIAL (lib only) | **PASS** (admin API + runbook) |
| Backup | FAIL (none) | **PARTIAL** (export script + ops doc; platform backup still manual) |

**Overall:** Ready for Production deploy after env vars + Cron + APIG routes are applied to Production project.

---

## APIG routes added (Development config)

- `/v1/admin/inventory/import/worker/process`
- `/v1/admin/inventory/duplicate-scan`

Deploy `catalyst-user-rules.json` to Production APIG when promoting.

---

## Regression baseline (unchanged)

- Quick @ 23.3782, 85.3315 → WH-RNC-001
- Standard → WH-BAN01
- MIN-NIA10-30ML: WH-RNC-001 10/3/0/7; WH-BAN01 80/0/0/80
