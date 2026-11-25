# Phase 5.4 — Development Deployment Report

**Date:** 2026-09-03  
**Project:** Baylen-App (`36851000000230006`)  
**Environment:** Development only  

## Deployment status

| Component | Action | Result |
|-----------|--------|--------|
| `baylen-api` function | `catalyst deploy --only functions:baylen-api` | **SUCCESS** (2 deploys — see note below) |
| API Gateway | Not redeployed | **N/A** — no route changes in Phase 5.4 |
| Production | Not deployed | **NOT DEPLOYED** |

### Deploy note

Initial deploy exposed a **batch inventory regression**: `inventoryRowsForItem()` incorrectly excluded rows with a `variant_id` when the request omitted `variant_id`. Development inventory for `MIN-NIA10-30ML` is stored against variant `36851000000331522`.

**Fix applied:** align in-memory filter with legacy SQL behavior (no variant filter when request variant is omitted). Redeployed immediately. No data modified.

## Test results

| Suite | Result |
|-------|--------|
| Backend `npm test` | **132/132** PASS (after variant fix; +2 tests) |
| Flutter `flutter test` | **39/39** PASS |

## Health

```
GET https://baylen-app-60069781151.development.catalystserverless.in/health
→ ok: true, service: baylen-api, status: up
```

## Quick Commerce smoke test

```
POST /v1/fulfillment/check
latitude=23.3782, longitude=85.3315
product_id=36851000000334408 (MIN-NIA10-30ML), quantity=1
```

| Check | Result |
|-------|--------|
| Serviceable stores | 3 (WH-RNC-001, WH-RNC-003, WH-RNC-005) |
| Quick available | **true** |
| Warehouse | **WH-RNC-001** |
| ETA | **15–20 minutes** |
| Available qty (QC) | 7 (10 − 3 reserved) |
| Outlet open / delivery | true / true |

## Standard E-Commerce smoke test

Same request as above:

| Check | Result |
|-------|--------|
| Standard available | **true** |
| Warehouse | **WH-BAN01** (`36851000000293759`) |
| ETA | **2–3 days** |
| Available qty (central) | 80 |

## Split fulfillment regression

```
POST /v1/fulfillment/check
items: MIN-NIA10-30ML (QC+Standard) + LOR-EOHS-100ML (Standard only)
```

| Check | Result |
|-------|--------|
| Split option | **available: true** |
| Quick group | MIN-NIA10-30ML → **WH-RNC-001** |
| Standard group | LOR-EOHS-100ML → **WH-BAN01** |
| Cross-warehouse reservation | **None** (read-only check) |

## Performance optimization (live)

Deployed code includes Phase 5.4 optimizations:

- Request-scoped `loadFulfillmentTopology()` (1 warehouse + 1 outlet batch per request)
- Batched `Products` and `Inventory` queries for multi-item carts
- Spatial bounding-box pre-filter before Haversine
- No global topology cache; inventory never cached

Query-count improvements verified in `test/fulfillment-performance.test.js` (5/10/25/50/100 warehouse mocks).

## Inventory safety

| Metric | Before deploy | After smoke tests |
|--------|---------------|-------------------|
| Inventory row count | 4 | **4** (unchanged) |
| Orders count | 3 | **3** (unchanged) |

### WH-RNC-001 / MIN-NIA10-30ML

| Field | Before | After |
|-------|--------|-------|
| quantity_on_hand | 10 | **10** |
| quantity_reserved | 3 | **3** |
| quantity_committed | 0 | **0** |

### WH-BAN01 / MIN-NIA10-30ML

| Field | Before | After |
|-------|--------|-------|
| quantity_on_hand | 80 | **80** |
| quantity_reserved | 0 | **0** |
| quantity_committed | 0 | **0** |

No orders created. No stock reservations. No inventory imports.

## API Gateway

Existing `/v1/fulfillment/check` route unchanged in `catalyst-user-rules.json`. **APIG redeploy not required.**

## Production

**NOT DEPLOYED**

## Final verdict

**PASS** — Development deployment successful after variant-scoping hotfix. Fulfillment behavior, inventory, and orders verified unchanged.
