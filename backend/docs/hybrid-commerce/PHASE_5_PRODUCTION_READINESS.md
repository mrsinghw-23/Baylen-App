# Phase 5 Production Readiness Audit

**Date:** 2026-09-03  
**Scope:** Phases 5.1–5.10 (Development verified; Production not deployed)  
**Audit type:** Read-only code/configuration review + test verification  
**No Production deployment performed**

---

------------------------------------------------------------
PHASE 5 PRODUCTION READINESS
------------------------------------------------------------

## 1. Security

**Status:** PARTIAL

**Evidence:**

All Phase 5 admin routes use the shared `requireAdmin()` pattern:
- Header: `x-baylen-admin-key`
- Comparison: `crypto.timingSafeEqual` (constant-time)
- Missing env: **503** `ADMIN_API_KEY is not configured` (fail-closed)
- Invalid key: **403** `Admin authorization required`
- Customer session routes do not accept admin key as auth

| Endpoint | Auth | Audit | Input validation |
|----------|------|-------|------------------|
| `GET /v1/admin/inventory/low-stock` | requireAdmin | optional via list | query filters in-memory after load |
| `GET /v1/admin/inventory/low-stock/summary` | requireAdmin | writeAdminAudit | query filters |
| `GET /v1/admin/serviceability/regions` | requireAdmin | — | pincode/city/state via ZCQL sqlString |
| `GET /v1/admin/serviceability/region?id=` | requireAdmin | — | asId |
| `POST /v1/admin/serviceability/region/upsert` | requireAdmin | writeAdminAudit | normalizePincode, warehouse/outlet existence |
| `POST /v1/admin/serviceability/region/deactivate` | requireAdmin | writeAdminAudit | asId |
| `GET /v1/admin/inventory/import/template` | requireAdmin | — | — |
| `POST /v1/admin/inventory/import/preview` | requireAdmin | — | CSV contract validation |
| `POST /v1/admin/inventory/import` | requireAdmin | auditInventoryImport | CSV contract, confirm flag |
| `GET /v1/admin/inventory/import/job?id=` | requireAdmin | — | asId |
| `POST /v1/admin/inventory/import/job/retry` | requireAdmin | auditInventoryImport | asId |
| `GET/POST /v1/admin/inventory/import/:id/*` | requireAdmin | yes | asId (APIG path params unreliable — see deployment risks) |
| `GET/POST /v1/admin/warehouse*` (5.1) | requireAdmin | writeAdminAudit | warehouse-admin validation |

**SQL/ZCQL safety:**
- Numeric IDs: `asId()` enforces `/^\d+$/` before interpolation
- Strings: `sqlString()` escapes single quotes
- Low-stock filters applied in-memory (no raw SQL from user strings except serviceability list filters)

**Error leakage:**
- `sendError()` masks **500** as generic `"Something went wrong. Please try again."` — no stack traces to clients
- **400/403/409** return client-safe messages + optional `code` / `details`

**Secrets in source:**
- `.env.example` only — no real keys in repo (verified grep)
- **Risk:** `AUTH_SESSION_SECRET` defaults to `"baylen-dev-session-key"` in `session.js` and `auth.js` if unset

**Blockers:**
1. Production **must** set strong `ADMIN_API_KEY` and `AUTH_SESSION_SECRET` — default session secret is not production-safe
2. Admin endpoints are only protected by a single shared API key (no per-admin RBAC) — acceptable for current scope but limits blast radius control

---

## 2. Inventory

**Status:** PARTIAL

**Evidence:**

- **Formula:** `availableOf()` = `on_hand - reserved - committed` (`inventory-ops.js`) — used everywhere including low-stock and fulfillment
- **Identity:** `warehouse_id + product_id + variant_id` (`inventory-identity.js`)
- **Canonical reads:** `dedupeToCanonicalInventoryRows()`, `pickCanonicalInventoryRow()` (oldest ROWID)
- **Writes:** `ensureInventoryRow()` 3-attempt retry; `reserveStock()` warehouse-scoped when `warehouseId` provided
- **Race mitigation:** reservation rollback on concurrent conflict (`STOCK_RACE_CONFLICT` 409)
- **Import:** absolute stock via `setAbsoluteStock`; movements `reference_type=IMPORT`
- **Fulfillment isolation:**
  - Quick: `darkStores` (QC/outlet-linked warehouses) only
  - Standard: `resolveStandardWarehouseList()` → central/default when geo flag OFF
  - QC stock never used for Standard pool aggregation (separate code paths)
- **Variant legacy:** `inventoryRowsForItem()` includes all variant rows when request variant omitted (matches pre-5.4 SQL behavior; tested in `inventoryRowsForItem variant scoping` tests)

**Catalyst composite uniqueness:** **Not available** — documented in `INVENTORY_DB_HARDENING.md`. Application-level dedupe + warnings only; concurrent inserts can still create orphan rows.

**Tests:** 21 hardening tests + import/availability tests (192 total backend)

**Blockers:**
1. No database-enforced unique constraint on inventory identity — duplicate rows possible under concurrent writes (mitigated but not eliminated)

---

## 3. Orders / Payments

**Status:** PARTIAL

**Evidence:**

- **Idempotency:** `idempotency_key` / `x-idempotency-key` → `findIdempotentOrder()` returns existing order (`checkout.js`)
- **Reservation:** `reserveStock()` with warehouse pinning from checkout plan; rollback via `releaseReservation()` on failure
- **Split orders:** Master + child orders with separate fulfillment modes; child `idempotencyKey` suffixed
- **Order numbering:** `nextOrderNumber()` year-scoped sequence; tested for duplicates/malformed (`order-number.test.js`)
- **Payments:** verify endpoint supports `idempotent: true` on replay (`payments.js`)
- **COD/online:** normalized via `normalizePaymentMethod()`

**Gaps (not live-tested in this audit):**
- No distributed lock on order number generation under extreme concurrency (ZCQL read-all + increment pattern)
- Payment verify idempotency depends on payment row state — not fully audited end-to-end without live gateway

**Blockers:** None critical identified in static audit; recommend staged production payment smoke before go-live

---

## 4. Quick Commerce

**Status:** PASS

**Evidence:**

- Location required for Quick availability (`LOCATION_REQUIRED`)
- Haversine + bounding-box pre-filter (`fulfillment-topology.js`)
- Outlet hours: `isStoreOpenNow()` Asia/Kolkata default (`FULFILLMENT_OUTLET_TIMEZONE`)
- `delivery_enabled`, `store_type`, service radius from outlet/warehouse topology
- Nearest eligible QC warehouse with sufficient stock selected in `evaluateFulfillmentLine()`
- **Development regression (live smoke):** 23.3782, 85.3315 → WH-RNC-001, 15–20 minutes

**Blockers:** None

---

## 5. Standard E-commerce

**Status:** PASS

**Evidence:**

- Default: `STANDARD_GEO_ROUTING_ENABLED` unset/false → `resolveStandardWarehouseList()` returns central/default only
- **Development regression (live smoke):** WH-BAN01 (`36851000000293759`), 2–3 days ETA
- Flag ON: excludes warehouses with `outlet_id` (Quick-only) before central fallback (`fulfillment-engine.js` lines 332–368)
- Standard stock pool uses `standardList` warehouse IDs only — not QC dark-store list

**Blockers:** None for default (flag OFF) production configuration

---

## 6. Split Fulfillment

**Status:** PASS

**Evidence:**

- Line-level evaluation in `evaluateFulfillment()` → `qcLines` vs `ecOnlyLines`
- Split option when mixed modes available; groups preserve per-line warehouse/store
- Checkout creates master SPLIT order + child orders per fulfillment group
- Reservations pinned to engine-selected warehouse (`resolveCheckoutPlan` tests)
- **Development regression (live smoke):** split_available=true, QC WH-RNC-001 + Standard group

**Blockers:** None

---

## 7. Catalog Performance

**Status:** PASS

**Evidence:**

- `buildCatalogAvailabilityBatch()` (`catalog-batch-availability.js`):
  1. `loadFulfillmentTopology()` once (when location present)
  2. `loadProductsByIds()` single IN query
  3. `inventoryForProductIds()` single IN query
  4. `evaluateFulfillmentLine()` in memory per item
- **No reservation** during catalog reads
- `attachAvailabilityBatch()` wired in catalog listings/search
- **Unit tests:** 10/50/100/500 products → warehouse=1, outlet=1, product=1, inventory=1, total=4 queries
- Circular dependency resolved via `catalog-availability-shared.js`

**Blockers:** None

---

## 8. Background Import

**Status:** PARTIAL

**Evidence:**

- Job states implemented: QUEUED, PROCESSING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED, CANCELLED
- Row-level partial failure; absolute stock; STOCK_COUNT movements; retry failed rows only
- Tests: 14 worker tests + import scale/validation tests
- **Live smoke:** COMPLETED job, job status API, retry 409 on completed job, no double stock

**Production suitability of `setImmediate`:**

```javascript
// inventory-import-worker.js
const ACTIVE_LOCKS = new Set(); // in-process only
function queueInventoryImportWorker(...) {
  setImmediate(async () => { await runInventoryImportWorker(...); });
}
```

**Problems for Production Catalyst:**
1. **Function lifetime:** Advanced I/O handlers may freeze/terminate after HTTP response; background `setImmediate` work may not complete for large imports
2. **No cross-instance lock:** `ACTIVE_LOCKS` is process-local — concurrent function instances can run the same job
3. **Synchronous import (`async:false`)** works for small batches but not a scalable production pattern

**Blockers:**
1. **PRODUCTION BLOCKER:** Replace `setImmediate` queue with Catalyst-native background execution (Catalyst **Job** / **Cron** / dedicated worker function) for production-scale imports
2. **PRODUCTION BLOCKER:** Replace in-memory `ACTIVE_LOCKS` with Data Store/Cache-based distributed lock for job concurrency

---

## 9. Low Stock

**Status:** PARTIAL

**Evidence:**

- Status rules match spec (OUT_OF_STOCK / CRITICAL / LOW_STOCK / IN_STOCK) — no hardcoded ≤5 rule
- Per warehouse/product/variant via `mapLowStockRow()`
- Read-only — no auto purchase/replenish/transfer
- Alert dedup: Catalyst Cache key `lowstock:last:{identity}` + audit `LOW_STOCK_TRANSITION`
- Admin APIs authenticated; filters in-memory
- **Live smoke:** list/summary/filters 200; dedup t1=0 t2=0 on stable status

**Multi-instance cache dedup:**
- Cache is shared across Catalyst instances (segment TTL 24h) — **generally safe** for dedup
- Race window: two instances could emit duplicate alerts on simultaneous transition — low probability, audit still records

**Blockers:** None critical; alert dedup race is a minor risk

---

## 10. Pincode / Serviceability

**Status:** PASS

**Evidence:**

- Reuses `Serviceable_Pincodes` table (no duplicate schema)
- `normalizePincode()` 6-digit validation
- Duplicate pincode → 409 on upsert
- Warehouse/outlet existence validated
- Precedence documented: geographic Quick authoritative; pincode does not override Quick (`evaluateServiceabilityPrecedence()`)
- Admin auth + audit on mutations
- **Live smoke:** list, upsert, invalid reject, deactivate, checkout pincode regression

**Scale:** ZCQL list with filters — suitable for hundreds/thousands of pincodes; bulk import not implemented (manual upsert only)

**Blockers:** None for initial production; bulk onboarding tooling recommended at scale

---

## 11. Standard Geo Routing

**Status:** PASS (default OFF)

**Evidence:**

- `STANDARD_GEO_ROUTING_ENABLED` default false
- When OFF: identical to pre-5.10 central behavior (verified live)
- When ON: regional non-QC warehouses first, central fallback, QC warehouses excluded
- Not enabled in Development production-readiness path

**Blockers:** None while flag remains false in Production

---

## 12. Customer API Exposure

**Status:** PARTIAL

**Evidence:**

**Catalog (`mapProduct`):** Exposes customer-useful availability only — `quick_available`, `standard_available`, ETAs, quantities. **Does not** expose warehouse_id in catalog listings.

**Fulfillment check (`POST /v1/fulfillment/check`):** Returns operational internals:
- `quick_commerce.store.warehouse_id`, `store_id`
- `standard_ecommerce.warehouse_id`, `warehouse_ids[]`
- Full `nearby_stores` / topology details

**Product IDs:** Catalog uses Catalyst ROWIDs as public `id` — pre-existing pattern, required for cart/checkout.

**Admin/low-stock:** Returns `inventory_id`, `warehouse_id`, `product_id` — admin-only, acceptable.

**Blockers:** None critical; recommend trimming customer fulfillment responses to `warehouse_code` + ETA before production hardening (optional enhancement)

---

## 13. Environment Configuration

**Status:** PARTIAL

**Evidence from `.env.example` and code:**

| Variable | Required (Prod) | Default / notes |
|----------|-----------------|-----------------|
| `ADMIN_API_KEY` | **Yes** | 503 if missing |
| `AUTH_SESSION_SECRET` | **Yes** | Falls back to dev default — **unsafe** |
| `STANDARD_GEO_ROUTING_ENABLED` | No | false/unset |
| `FULFILLMENT_OUTLET_TIMEZONE` | No | `Asia/Kolkata` |
| `FULFILLMENT_QC_RADIUS_KM` | No | topology/outlet radius primary |
| `FULFILLMENT_QC_ETA_MIN/MAX` | No | 15/20 |
| `FULFILLMENT_EC_ETA_DAYS_MIN/MAX` | No | 2/3 |
| `FULFILLMENT_QC_COD_LIMIT` | No | 2000 |
| WhatsApp OTP vars | **Yes** (for auth) | synced via predeploy script |
| Payment gateway vars | Optional | COD works without |
| `PICKER_API_KEY` / `RIDER_API_KEY` | If picker/rider used | separate from admin |

**Blockers:**
1. Production env checklist must enforce `AUTH_SESSION_SECRET` and `ADMIN_API_KEY` before deploy

---

## 14. Error Handling

**Status:** PASS

**Evidence:**

- Consistent `{ ok, data }` / `{ ok, false, error, code?, details? }` envelope
- HTTP status codes: 400 validation, 403 auth, 404 not found, 409 conflicts, 503 misconfig, 500 masked
- Import partial failures: row errors collected; job → COMPLETED_WITH_ERRORS
- Worker failures: job → FAILED; background catch updates PROCESSING → FAILED
- Inventory: INSUFFICIENT_STOCK, STOCK_RACE_CONFLICT with rollback

**Blockers:** None

---

## 15. Observability

**Status:** PARTIAL

**Evidence:**

- `console.error("[api]", error)` for 500s
- `Audit_Logs` table for admin actions (imports, serviceability, low-stock summary, warehouse)
- Low-stock transitions logged when `record_alerts=true`
- Import job status fields: processed_rows, failed_rows, error_count, summary_json
- `[inventory-ops]` / `[inventory-identity]` console warnings on duplicate rows

**Gaps:**
- No structured JSON logging / correlation IDs
- No external monitoring/alerting integration (Datadog, etc.)
- Audit `before_json`/`after_json` truncated to **255 chars**
- No dashboard for import job queue depth

**Blockers:** None critical; operational visibility should be improved post-launch

---

## 16. Data Integrity

**Status:** PASS

**Evidence (read-only, latest smoke artifact `phase5-smoke-results.json`):**

| Warehouse | SKU | on_hand | reserved | committed | available |
|-----------|-----|---------|----------|-----------|-----------|
| WH-RNC-001 | MIN-NIA10-30ML | 10 | 3 | 0 | 7 |
| WH-BAN01 | MIN-NIA10-30ML | 80 | 0 | 0 | 80 |

**Orders:** 3 (unchanged during audit)

**Blockers:** None

---

## 17. Deployment / Rollback

**Status:** PARTIAL

**Evidence:**

- Deploy: `catalyst deploy --only functions:baylen-api` then `catalyst deploy --only apig`
- Predeploy: WhatsApp OTP env sync script
- Postdeploy: live health verification
- APIG routes in `catalyst-user-rules.json` (version controlled)
- Backward compatible: catalog/fulfillment customer contracts preserved

**Gaps:**
- No automated rollback script; rollback = redeploy prior git tag manually
- APIG nested wildcard routes (`/(.*)`) do not deploy reliably — fixed-path workarounds required for import job APIs
- No Production deployment performed in this audit

**Blockers:** None if deployment runbook followed

---

## 18. Backup / Recovery

**Status:** FAIL

**Evidence:**

- No application-level backup/recovery implementation found
- Relies on **Zoho Catalyst platform** Data Store durability (no export/restore automation in repo)
- Import jobs, stock movements, inventory — no documented recovery procedure
- `inventory-remediation.js` is design-only (duplicate merge plan, no auto-execute)

**Blockers:**
1. **Operational gap:** Define Production backup/export strategy (Catalyst bulk read, scheduled exports) before go-live — not a code blocker but a **launch prerequisite**

---

------------------------------------------------------------
FINAL TESTS
------------------------------------------------------------

**Backend:** 192/192 PASS (no circular dependency warnings)

**Flutter:** 39/39 PASS

**Quick:** PASS (Development live smoke — WH-RNC-001, 15–20 min)

**Standard:** PASS (WH-BAN01, 2–3 days, flag OFF)

**Split:** PASS (QC + Standard groups)

**Inventory:** Unchanged (see section 16)

**Orders:** 3 (unchanged)

---

------------------------------------------------------------
PRODUCTION BLOCKERS
------------------------------------------------------------

### Blocker 1 — Background import worker execution model

**Problem:** Import queue uses `setImmediate` inside Advanced I/O function with in-process `ACTIVE_LOCKS`.

**Why it matters:** Large imports may not complete after HTTP response; concurrent Catalyst instances can double-process jobs.

**Required fix:** Migrate to Catalyst Job/Cron or dedicated worker with Data Store/Cache distributed lock.

**Phase:** 5.6

---

### Blocker 2 — Session secret default

**Problem:** `AUTH_SESSION_SECRET` defaults to `"baylen-dev-session-key"` when unset.

**Why it matters:** Predictable session signing in Production enables token forgery.

**Required fix:** Enforce strong Production env var; optionally fail startup if default detected.

**Phase:** Pre-existing (affects all auth)

---

### Blocker 3 — Inventory composite uniqueness

**Problem:** Catalyst Data Store cannot enforce `(warehouse_id, product_id, variant_id)` unique constraint.

**Why it matters:** Concurrent inventory creation can produce duplicate rows; reads converge on canonical row but orphans remain.

**Required fix:** Operational duplicate scan schedule + remediation runbook; consider insert-only-through-`ensureInventoryRow` policy; long-term platform constraint if available.

**Phase:** 5.5

---

------------------------------------------------------------
PRODUCTION RISKS
------------------------------------------------------------

1. **Single shared admin API key** — no per-operator RBAC or key rotation workflow
2. **Fulfillment API exposes internal warehouse ROWIDs** to authenticated customers during checkout flow
3. **Low-stock alert dedup race** under multi-instance simultaneous scans (duplicate audit events possible)
4. **APIG path limitations** — prefer `/v1/admin/inventory/import/job?id=` over `/:id` paths
5. **Order number concurrency** — sequence logic not distributed-locked
6. **Audit JSON 255-char truncation** limits forensic detail
7. **No bulk pincode import** — manual upsert only for serviceability onboarding at scale
8. **STANDARD_GEO_ROUTING_ENABLED** must remain false until regional Standard warehouses are operationally ready

---

------------------------------------------------------------
RECOMMENDED PRODUCTION DEPLOYMENT ORDER
------------------------------------------------------------

1. **Freeze & tag** release git commit (Phase 5.1–5.10 bundle)
2. **Production environment variables** — set at minimum:
   - `ADMIN_API_KEY` (strong random)
   - `AUTH_SESSION_SECRET` (strong random)
   - WhatsApp OTP vars (TATA_*)
   - Confirm `STANDARD_GEO_ROUTING_ENABLED` is **unset or false**
   - Confirm `FULFILLMENT_OUTLET_TIMEZONE=Asia/Kolkata`
3. **Pre-deploy inventory duplicate scan** (ZCQL GROUP BY identity; expect 0 groups)
4. **Deploy function:** `catalyst deploy --only functions:baylen-api` (Production env)
5. **Deploy APIG:** `catalyst deploy --only apig`
6. **Health check:** `GET /health`
7. **Smoke (no inventory mutation):**
   - Fulfillment Quick/Standard/Split at known Ranchi coordinates
   - Catalog listing with location (availability fields)
   - Admin low-stock list (with admin key)
8. **Small isolated import test** (test SKU only, not MIN-NIA10-30ML) — prefer sync mode until Job worker deployed
9. **Monitor** Audit_Logs, import job statuses, inventory reserved counts for 24h
10. **Document rollback:** redeploy previous function build + APIG rules from prior tag

---

------------------------------------------------------------
FINAL VERDICT
------------------------------------------------------------

## READY AFTER BLOCKERS FIXED

Phase 5 business logic, fulfillment behavior, catalog performance, and Development live verification are **sound**. Production launch should wait until:

1. Background import worker uses Catalyst-native job execution + distributed locking
2. Production secrets (`AUTH_SESSION_SECRET`, `ADMIN_API_KEY`) are explicitly configured
3. Inventory duplicate monitoring runbook is in place (platform constraint acknowledged)
4. Backup/export operational procedure is defined (platform-level)

**Production deployment:** NOT PERFORMED (per audit scope)
