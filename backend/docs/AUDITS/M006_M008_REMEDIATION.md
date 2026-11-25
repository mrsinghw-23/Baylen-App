# M006 + M008 Force Remediation Report

**Project:** Baylen-App (Development)  
**Date:** 2026-09-04  
**Branch:** master  

---

## M006 — Inventory Concurrency

### Root cause
`reserveStock` used read → calculate available → write without row-level serialization. Concurrent checkout/reservation requests could pass the availability check on the same last unit and both increment `quantity_reserved`.

### Implementation
| Component | Purpose |
|-----------|---------|
| `lib/inventory-row-lock.js` | Per-inventory-row lock. **Production:** Catalyst Cache token lock (cross-instance). **Tests / no-cache mocks:** in-process async mutex. Falls back to local mutex when `app.cache()` is unavailable. |
| `lib/inventory-invariants.js` | Enforces `quantity_on_hand >= 0`, `quantity_reserved >= 0`, `quantity_committed >= 0`, and `quantity_reserved + quantity_committed <= quantity_on_hand` before/after mutations. |
| `lib/inventory-ops.js` | `atomicReserveOnRow`, `atomicReleaseOnRow`, `atomicCommitOnRow` — all mutations run inside row lock with fresh read, idempotency via `Stock_Movements`, invariant validation, and rollback on partial multi-row failure. |

### Concurrency strategy
1. Serialize all reserve/commit/release for a given `Inventory.ROWID`.
2. Re-read row inside lock before mutating.
3. Idempotency: same `reference_type` + numeric `reference_id` + `inventory_id` → net reserved from movements; duplicate requests return without double-reserving.
4. Commit/release idempotent via existing movement guards + row lock.
5. Public routes `/v1/inventory/reserve|release|commit` remain **`requireAdmin`** only.

### Test methodology
- `test/inventory-concurrency.test.js` — 20 parallel last-unit reservations × 3 runs; concurrent duplicate idempotency; repeat reserve idempotency; commit/release idempotency.
- Existing: `inventory-hardening.test.js`, `quick-commerce.test.js`, `inventory-identity.test.js`.

### Repeated concurrency results (automated)
| Run | Attempts | Successful | Failed | Final on_hand | reserved | committed | available |
|-----|----------|------------|--------|---------------|----------|-----------|-----------|
| 1–3 | 20 each | **1** | **19** | 1 | 1 | 0 | 0 |

Idempotency (10 concurrent, qty 2, on_hand 5): **10 fulfilled**, **1 movement**, **reserved = 2**.

### Final inventory invariants
Automated invariant checks run on every atomic mutation path. Violations throw before persisting corrupt state.

### M006 acceptance
| Criterion | Status |
|-----------|--------|
| 20+ concurrent last-unit test (3 runs) | PASS |
| No overselling / negative availability | PASS |
| Idempotency (concurrent + repeat) | PASS |
| Commit/release concurrency-safe | PASS |
| Public inventory mutation blocked | PASS |
| Invariants enforced | PASS |
| Backend regression tests | **299/299 PASS** |

**M006: CLOSED / PRODUCTION READY (Development verified)**

---

## M008 — Catalog Scalability

### Root cause
`GET /v1/catalog/products` loaded the full `Products` table into memory, filtered/sorted in JavaScript, then used `.slice()` for pages. Search index path loaded all `Search_Documents` / `Products` rows.

### Implementation
| Component | Purpose |
|-----------|---------|
| `lib/catalog-pagination.js` | Keyset/cursor pagination on Catalyst ZCQL with `LIMIT pageSize+1`, stable ordering (`ROWID DESC`, price sorts with ROWID tie-breaker), server-side filters (brand, category, search LIKE, price, gender, age, QC/EC flags). |
| `routes/catalog.js` | `GET /v1/catalog/products` uses `fetchProductListPageWithPostFilters` — sequential bounded ZCQL pages only; response includes `has_more`, `next_cursor`, `queries_executed`, `rows_fetched`. Legacy `page > 1` without cursor → `400 CURSOR_REQUIRED`. |
| `lib/search-index.js` | Search candidates via bounded `LIKE` query on `Search_Documents` (`LIMIT 400`); empty-index fallback uses `fetchProductListPage` (max 100 rows), not full catalog scan. |
| Flutter | `catalyst_api.dart`, `shop_catalog_screen.dart`, `shop_brand_page.dart` consume `next_cursor` / `has_more`. |

### Pagination architecture
- **Cursor:** base64url JSON `{ r: ROWID, s: sort, p: selling_price }`.
- **Invalid cursor:** `400 INVALID_CURSOR`.
- **Post-filters** (in_stock, min_discount, min_rating, popularity): over-fetch next keyset pages (max 30 scans) — never loads entire catalog.

### Search architecture
- Indexed: ZCQL `LIKE` on `document_text` / name / sku / brand with hard `LIMIT 400`.
- Unindexed fallback: catalog-pagination search filter, `LIMIT 100`.

### Availability batching
Preserved — `attachAvailabilityBatch` unchanged; `catalog-batch-availability.test.js` confirms 100 products ≠ 100 inventory API calls.

### 10,000-product test (`test/catalog-pagination.test.js`)
| Metric | Result |
|--------|--------|
| Dataset size | 10,000 |
| Page size | 20 |
| Rows fetched (page 1) | **21** (limit+1 probe) |
| ZCQL queries (page 1) | **1** |
| Full-catalog SELECT | **None** |
| 3-page traversal (50/page) | **150 unique IDs**, no duplicates |

### Performance (mock ZCQL, local Node test runner)
| Products | Page size | rows_fetched | queries_executed |
|----------|-----------|--------------|------------------|
| 10,000 | 20 | 21 | 1 |
| 10,000 | 50 | 51 | 1 per page |
| 10,000 | 100 | 101 | 1 per page |

Memory behavior: only `limit+1` product rows held per query; no `Array.from(allProducts).slice()`.

### API contract changes
- `GET /v1/catalog/products`: `pagination.total` removed (no full-count scan). Added `has_more`, `next_cursor`, `queries_executed`, `rows_fetched`.
- `page=1` without cursor still works (first page).
- `page>1` without cursor → `400 CURSOR_REQUIRED`.

### M008 acceptance
| Criterion | Status |
|-----------|--------|
| No full-catalog in-memory pagination (products list) | PASS |
| Server-side + cursor pagination | PASS |
| Stable ordering | PASS |
| Server-side filtering | PASS |
| Search bounded (no full scan) | PASS |
| No N+1 availability regression | PASS |
| 10k test | PASS |
| Flutter cursor consumption | PASS |
| Backend tests | **299/299 PASS** |
| Flutter tests | **53/53 PASS** |

**Note:** Shop home / mega-menu / brand page metadata still load category/brand graphs via existing bounded `fetchAllTableRows` helpers (small dimension tables + featured slices). Production catalog **listing** path is fully paginated.

**M008: CLOSED / PRODUCTION READY (Development verified)**

---

## Files changed

### Backend
- `lib/inventory-row-lock.js` (new)
- `lib/inventory-invariants.js` (new)
- `lib/catalog-pagination.js` (new)
- `lib/inventory-ops.js`
- `lib/search-index.js`
- `routes/catalog.js`
- `test/inventory-concurrency.test.js` (new)
- `test/catalog-pagination.test.js` (new)
- `test/quick-commerce.test.js`

### Flutter
- `lib/api/catalyst_api.dart`
- `lib/screens/shop_catalog_screen.dart`
- `lib/screens/shop_brand_page.dart`

---

## Tests executed
```text
Backend:  npm test → 299/299 PASS
Flutter:  flutter test → 53/53 PASS
```

---

## Development deployment
- `catalyst deploy --only functions:baylen-api` → **SUCCESS** (Development)
- `catalyst deploy --only apig` → **SUCCESS** (Development)
- Function URL: `https://baylen-app-60069781151.catalystserverless.in/server/baylen-api/`
- Live health: `https://baylen-app-60069781151.catalystserverless.in/health` → WhatsApp OTP ready
