# Optional Geo-Aware Standard E-Commerce (Phase 5.10)

Feature-flagged optional routing for Standard E-Commerce warehouses. **Default is OFF** — existing Standard behavior is unchanged.

## Feature flag

| Variable | Default | Effect |
|----------|---------|--------|
| `STANDARD_GEO_ROUTING_ENABLED` | `false` | When false, Standard uses central/default warehouse only |

Functions: `standardGeoRoutingEnabled()`, `resolveStandardWarehouseList()` in `lib/fulfillment-engine.js`.

## When flag is OFF (default)

Standard fulfillment uses **central/default warehouses only** (Development: WH-BAN01, ETA 2–3 days). Identical to pre-5.10 behavior.

## When flag is ON

`resolveStandardWarehouseList()` evaluates:

1. Active regional Standard-capable warehouses (no `outlet_id` — excludes Quick-only dark stores)
2. Sorted by distance when customer location is provided
3. Central warehouse remains **fallback** at end of list

Does **not**:

- Route to Quick-only warehouses
- Reserve stock during availability evaluation
- Change Quick Commerce or Split logic

## Integration

Used by `evaluateFulfillmentLine()` for Standard warehouse selection and `buildCatalogAvailabilityBatch()` via the shared fulfillment engine.

## Tests

`test/standard-geo-routing.test.js`:

- Flag OFF → central only
- Flag ON → regional before central, QC warehouses excluded
- Quick + Standard regression at Ranchi coordinates

## Enabling in Development

Set environment variable on `baylen-api`:

```
STANDARD_GEO_ROUTING_ENABLED=true
```

Only enable after regional Standard warehouses are configured with stock. Central fallback always applies when regional stock is insufficient.
