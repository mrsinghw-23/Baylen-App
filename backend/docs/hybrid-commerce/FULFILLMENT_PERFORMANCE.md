# Phase 5.4 — Fulfillment Performance + Multi-Location Scalability

Development-only optimization. **Business behavior unchanged.**

## Root causes (N+1)

| Area | Before | After |
|------|--------|-------|
| Dark-store discovery | 1 warehouse query + **N outlet queries** (one per warehouse) | 1 warehouse + **1 batch outlet query** |
| `evaluateFulfillment()` | `buildDarkStoreCandidates()` + **second** `loadWarehouses()` | Single `loadFulfillmentTopology()` per request |
| Cart items (products) | **1 Products query per line** | **1 batched `IN (...)` query** |
| Cart items (inventory) | **1 Inventory query per line** | **1 batched `IN (...)` query** |
| Catalog listing (with location) | Full topology reload **per product** via `evaluateProductAvailability()` | **Unchanged** — deferred to Phase 5.8 |

## Implemented changes

### Request-scoped topology (`lib/fulfillment-topology.js`)

```js
{
  warehouses,
  outletsById,
  centralWarehouses,
  centralWarehouseIds,
  qcWarehouses
}
```

- Loaded once per fulfillment evaluation.
- Not globally mutable (no cross-request leakage).

### Batch outlet loading

All active outlets: `SELECT … FROM Outlets WHERE is_active = true`  
Joined in memory via `outletsById` map.

### Spatial pre-filter

`passesBoundingBox()` uses a lat/lng box sized from the **maximum** configured `service_radius_km` across outlets. Exact Haversine + per-outlet radius remain authoritative. The box cannot false-negative a serviceable store.

### Inventory

- Still live queries (not cached).
- Batched by `product_id IN (...)` for multi-item carts.
- Formula unchanged: `available = on_hand - reserved - committed`.

## Cache decision

**No global/TTL cache** for topology in this phase.

Reason: warehouse activate/deactivate, outlet hours, radius, and `delivery_enabled` changes require reliable invalidation. Catalyst Data Store has no push invalidation hook here. **Request-scoped reuse** is safe and implemented.

Inventory quantities are **never** cached.

## Catalog performance status

`buildCatalogAvailability()` still calls `evaluateProductAvailability()` once per product when location is present. Each call reloads topology + inventory for that SKU.

**Remaining work (Phase 5.8):** batch catalog availability helper / internal endpoint evaluating many product IDs in one request without changing public response shape.

## Performance harness

`test/fulfillment-performance.test.js` — mocked ZCQL, synthetic 5/10/25/50/100 QC warehouse topologies.

### Query counts (3 cart items)

| QC warehouses | Legacy outlet queries | Optimized outlet queries | Legacy warehouse loads | Optimized warehouse loads | Legacy product/inventory | Optimized product/inventory |
|---------------|----------------------|--------------------------|------------------------|---------------------------|--------------------------|----------------------------|
| 5 | 5 | 1 | 2 | 1 | 3 + 3 | 1 + 1 |
| 10 | 10 | 1 | 2 | 1 | 3 + 3 | 1 + 1 |
| 25 | 25 | 1 | 2 | 1 | 3 + 3 | 1 + 1 |
| 50 | 50 | 1 | 2 | 1 | 3 + 3 | 1 + 1 |
| 100 | 100 | 1 | 2 | 1 | 3 + 3 | 1 + 1 |

Outlet query count scales **O(1)** instead of **O(N)**. Warehouse dedup saves one query per fulfillment request. Product/inventory scale with cart size, not duplicate per line.

## Regression baseline

Coordinates `23.3782, 85.3315`, SKU `MIN-NIA10-30ML`:

- **Quick:** nearest serviceable dark store (WH-RNC-001 in Development), ETA 15–20 min
- **Standard:** central warehouse (WH-BAN01), ETA 2–3 days

Split-order logic unchanged.

## Files changed

- `lib/fulfillment-topology.js` (new)
- `lib/fulfillment-engine.js` (topology reuse, batch queries, bounding box)
- `test/fulfillment-performance.test.js` (new)
- `docs/hybrid-commerce/FULFILLMENT_PERFORMANCE.md` (this file)

## Remaining scalability risks

1. Catalog N× topology reload when location is set (Phase 5.8).
2. Very large `IN (...)` lists for huge carts (unlikely; could chunk if needed).
3. No DB-side geo index — all active warehouses still scanned in memory (cheap with bounding-box skip).
4. Concurrent inventory reads unchanged (no reservation in availability checks).

## Production readiness

Safe for Development validation. Recommend deploy to Development and smoke-test `/v1/fulfillment/check` with known Ranchi coordinates before Production. No Production deploy in Phase 5.4 scope.
