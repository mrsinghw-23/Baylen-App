# Phase 5 Final — Development Deployment Report

**Date:** 2026-09-03  
**Project:** Baylen-App (`36851000000230006`)  
**Environment:** Development only  
**Production:** NOT DEPLOYED  

---

## Deployment status

| Component | Action | Result |
|-----------|--------|--------|
| `baylen-api` function | `catalyst deploy --only functions:baylen-api` | **SUCCESS** (Phases 5.5–5.10 bundle) |
| API Gateway | `catalyst deploy --only apig` | **SUCCESS** — new routes for 5.6–5.9 |
| Production | Not deployed | **NOT DEPLOYED** |

### Deploy hotfixes during smoke testing

1. **Low-stock ZCQL:** `Product_Variants.name` → `variant_name` (500 → 200)
2. **Import job routes:** Static `/import/job` routes registered **before** `/import/:id` (Express route order)
3. **APIG job endpoints:** Fixed paths `/v1/admin/inventory/import/job` and `/job/retry` (wildcards not supported for nested import paths)
4. **Circular dependency:** Extracted `catalog-availability-shared.js` — **resolved**

---

## Test results

| Suite | Before deploy | After deploy |
|-------|---------------|--------------|
| Backend `npm test` | 192/192 PASS | 192/192 PASS |
| Flutter `flutter test` | 39/39 PASS | 39/39 PASS |
| Live smoke (`phase5-final-smoke.js`) | — | **31/31 PASS** |

---

## Health

```
GET https://baylen-app-60069781151.development.catalystserverless.in/health
→ ok: true, service: baylen-api, status: up
```

---

## Phase 5.5 — Inventory DB Hardening

**Deployment:** Included in baylen-api deploy  
**Live verification:**

| Check | Result |
|-------|--------|
| Admin inventory list (`GET /v1/admin/inventory?sku=MIN-NIA10-30ML`) | 200 — 4 rows |
| Duplicate identity scan (ZCQL GROUP BY) | **0 duplicate groups** |
| WH-RNC-001 isolation | on_hand=10, reserved=3, available=7 |
| WH-BAN01 isolation | on_hand=80, reserved=0, available=80 |

---

## Phase 5.6 — Background Import Worker

**Deployment:** Included in baylen-api + APIG  
**Live verification:**

| Check | Result |
|-------|--------|
| Import `LOR-EOHS-100ML` @ WH-BAN01 (isolated test SKU) | **COMPLETED** |
| Job status API (`GET /v1/admin/inventory/import/job?id=`) | **COMPLETED** |
| Retry on completed job | **409** (correct — no failed rows) |
| Stock after retry | Unchanged (no double-add) |
| Protected MIN-NIA10-30ML stock | **Unchanged** |

**APIs deployed via APIG:**
- `POST /v1/admin/inventory/import`
- `GET /v1/admin/inventory/import/job?id=`
- `POST /v1/admin/inventory/import/job/retry`

---

## Phase 5.7 — Low-Stock Intelligence

**Deployment:** Included in baylen-api + APIG  
**Live verification:**

| Check | Result |
|-------|--------|
| `GET /v1/admin/inventory/low-stock` | 200 |
| `GET /v1/admin/inventory/low-stock/summary` | total_rows=4, in_stock=4 |
| Warehouse filter (`warehouse_code=WH-RNC-001`) | 200 |
| Status filter (`status=IN_STOCK`) | 200 |
| Alert deduplication (`record_alerts=true` × 2) | No duplicate transitions |

---

## Phase 5.8 — Catalog Availability Batch

**Deployment:** Included in baylen-api (catalog routes use `attachAvailabilityBatch`)  
**Live verification:**

| Check | Result |
|-------|--------|
| Location-aware catalog (`latitude=23.3782, longitude=85.3315`) | 3 products, quick+standard fields present |
| Catalog read reservation safety | WH-RNC-001 reserved still **3** after catalog |
| Performance (live APIG) | 10 products ~174ms, 50 products ~198ms |
| Batch architecture | Single listing request (verified in unit tests: 4 DB queries at 10/50/100/500) |

---

## Phase 5.9 — Pincode / Region Tooling

**Deployment:** Included in baylen-api + APIG  
**Live verification:**

| Check | Result |
|-------|--------|
| `GET /v1/admin/serviceability/regions` | 200 |
| Upsert test pincode 835215 | CREATE/UPDATE 200 |
| Invalid pincode `123` | **400** rejected |
| Deactivate test region | 200 |
| Checkout pincode regression (`POST /v1/checkout/check-pincode`) | 200 |

---

## Phase 5.10 — Standard Geo Routing (flag OFF)

**Deployment:** Included in baylen-api  
**Default:** `STANDARD_GEO_ROUTING_ENABLED` unset/false  
**Live verification:**

| Check | Result |
|-------|--------|
| Standard warehouse | **36851000000293759** (WH-BAN01) |
| Standard ETA | **2–3 days** |
| Quick regression | WH-RNC-001, **15–20 minutes** |
| Flag ON | **Not tested live** (default preserved) |

---

## Fulfillment regression (live)

**Coordinates:** 23.3782, 85.3315  
**Product:** MIN-NIA10-30ML + LOR-EOHS-100ML (split)

| Mode | Result |
|------|--------|
| Quick | WH-RNC-001, 15–20 minutes |
| Standard | WH-BAN01 (id 36851000000293759), 2–3 days |
| Split | available=true, QC group WH-RNC-001, Standard group 1 item |

---

## Data safety

| Metric | Before | After |
|--------|--------|-------|
| WH-RNC-001 / MIN-NIA10-30ML on_hand | 10 | **10** |
| WH-RNC-001 reserved | 3 | **3** |
| WH-RNC-001 committed | 0 | **0** |
| WH-RNC-001 available | 7 | **7** |
| WH-BAN01 / MIN-NIA10-30ML on_hand | 80 | **80** |
| WH-BAN01 reserved | 0 | **0** |
| WH-BAN01 available | 80 | **80** |
| Orders count | 3 | **3** |

**Test-only modification:** `LOR-EOHS-100ML` @ WH-BAN01 temporarily set to 42 during import smoke, **restored to 120**.

---

## API Gateway changes (5.5–5.10)

New routes deployed:
- `admin-inventory-import-template`, `preview`, `import`
- `admin-inventory-import-job-get`, `admin-inventory-import-job-retry`
- `admin-inventory-low-stock`, `admin-inventory-low-stock-summary`
- `admin-serviceability-regions`, `region`, `region/upsert`, `region/deactivate`
- `admin-warehouses-*` (Phase 5.1, included in APIG bundle)

Catalog/fulfillment routes unchanged (batch logic is server-side).

---

## Circular dependency

| Item | Status |
|------|--------|
| Phase 5.8 `product-availability` ↔ `catalog-batch-availability` | **FIXED** via `catalog-availability-shared.js` |
| Node test warnings | **None** after fix |

---

## Remaining warnings / risks

1. **APIG wildcards:** `(.*)` patterns for import job IDs do not deploy reliably — use fixed `/import/job` query/body endpoints
2. **Direct function URL:** Nested paths like `/import/job` return INVALID_URL on `/server/baylen-api/` — must use APIG
3. **Standard geo routing ON:** Not live-tested; requires explicit env var + regional warehouses
4. **Booking WhatsApp template:** `TATA_BOOKING_TEMPLATE_NAME` still missing (pre-existing, unrelated)

---

## Git diff summary (5.5–5.10 backend focus)

| Area | Key files |
|------|-----------|
| 5.5 | `inventory-identity.js`, `inventory-remediation.js`, `inventory-ops.js`, `inventory-hardening.test.js` |
| 5.6 | `inventory-import-worker.js`, `routes/imports.js`, `inventory-import-worker.test.js` |
| 5.7 | `low-stock-engine.js`, `low-stock-alerts.js`, `low-stock-admin.js`, `routes/low-stock.js` |
| 5.8 | `catalog-batch-availability.js`, `catalog-availability-shared.js`, `routes/catalog.js` |
| 5.9 | `serviceability-admin.js`, `routes/serviceability.js` |
| 5.10 | `fulfillment-engine.js` (`standardGeoRoutingEnabled`, `resolveStandardWarehouseList`) |

Smoke evidence: `backend/docs/hybrid-commerce/phase5-smoke-results.json`

---

## Final verdict

**Phases 5.5–5.10: DEPLOYED TO DEVELOPMENT — ALL LIVE SMOKE TESTS PASS**

Production: **NOT DEPLOYED**
