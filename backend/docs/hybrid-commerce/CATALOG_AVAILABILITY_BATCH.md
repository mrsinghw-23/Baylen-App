# Catalog Availability Batch (Phase 5.8)

Batch catalog availability eliminates N× per-product fulfillment queries for listing endpoints.

## Architecture

For one catalog availability request:

```
load topology ONCE
      ↓
load products BATCH (IN query)
      ↓
load inventory BATCH (IN query)
      ↓
evaluate products IN MEMORY (evaluateFulfillmentLine)
      ↓
return catalog availability
```

## Implementation

| Module | Role |
|--------|------|
| `lib/catalog-batch-availability.js` | `buildCatalogAvailabilityBatch()` |
| `lib/product-availability.js` | Single-product wrapper delegates to batch |
| `routes/catalog.js` | `attachAvailabilityBatch()` for listings, search, category pages |

## Preserved response fields

- `quick_available`, `standard_available`
- `quick_available_quantity`, `standard_available_quantity`
- `quick_eta`, `standard_eta`
- `quick_commerce_enabled`, `ecommerce_enabled`
- `quick_commerce_restriction_reason`
- `available_quantity`

Business rules unchanged: Quick uses location/outlet/radius/hours/inventory; Standard uses central/default warehouse inventory. No reservation during catalog reads.

## Performance (deterministic mock tests)

| Products | Warehouse | Outlet | Product | Inventory | Total |
|----------|-----------|--------|---------|-----------|-------|
| 10 | 1 | 1 | 1 | 1 | **4** |
| 50 | 1 | 1 | 1 | 1 | **4** |
| 100 | 1 | 1 | 1 | 1 | **4** |
| 500 | 1 | 1 | 1 | 1 | **4** |

### Before vs after

**Before (N× model):** For N products, each `attachAvailability()` call loaded topology + products + inventory independently → ~4N database round-trips per listing page.

**After (batch model):** One topology load + one product batch + one inventory batch → **4 queries** regardless of N (within parser/page limits).

Example at 100 products: before ≈ 400 queries, after = 4 queries.

## Tests

`test/catalog-batch-availability.test.js` — scale tests at 10/50/100/500 products, field preservation, query model comparison.
