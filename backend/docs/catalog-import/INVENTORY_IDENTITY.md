# Inventory Identity (Phase 5.3)

## Canonical identity

Inventory rows are uniquely identified by:

```
warehouse_id + product_id + variant_id
```

**SKU is not the inventory primary key.**

The same catalog SKU may exist in many warehouses as separate inventory rows:

| warehouse_id | product_id | variant_id | Valid |
|--------------|------------|------------|-------|
| WH-RNC-001 | Product X | Variant Red | ✅ |
| WH-RNC-002 | Product X | Variant Red | ✅ |
| WH-RNC-001 | Product X | Variant Blue | ✅ |

Invalid duplicate:

| warehouse_id | product_id | variant_id | Valid |
|--------------|------------|------------|-------|
| WH-RNC-001 | Product X | Variant Red | row A |
| WH-RNC-001 | Product X | Variant Red | row B ❌ duplicate |

## variant_id = null

Product-level inventory (no variant) uses:

```
warehouse_id + product_id + NULL variant_id
```

This is distinct from variant-specific rows in the same warehouse.

## Current protection

| Layer | Status |
|-------|--------|
| Application lookup | `loadInventoryRowsByIdentity()` + `pickCanonicalInventoryRow()` |
| Create path | `ensureInventoryRow()` re-reads after insert and converges on canonical row |
| Import CSV | Duplicate `warehouse_code + sku` rejected in same file |
| Database composite unique constraint | **Not available** in Catalyst Data Store for `(warehouse_id, product_id, variant_id)` |

Catalyst columns support single-column `is_unique` only. Nullable `variant_id` would also complicate a composite unique index even if Catalyst added support later.

## Development duplicate scan (read-only)

As of Phase 5.3 audit:

```sql
SELECT warehouse_id, product_id, variant_id, COUNT(ROWID)
FROM Inventory
GROUP BY warehouse_id, product_id, variant_id
HAVING COUNT(ROWID) > 1
```

**Result:** 0 duplicate groups in Development.

Existing rows verified (unchanged):

| Warehouse | Product/Variant | on_hand | reserved |
|-----------|-----------------|---------|----------|
| WH-BAN01 | MIN-NIA10-30ML | 80 | 0 |
| WH-RNC-001 | MIN-NIA10-30ML | 10 | 3 |

## Race-condition limitation

Two concurrent `ensureInventoryRow()` calls can still both insert before either re-read completes.

Mitigation in Phase 5.3:

1. Post-insert identity re-read
2. Canonical row selection (lowest `ROWID`, active preferred)
3. Warning log when duplicates detected

Remaining risk: orphan duplicate rows may exist until manually merged. Operations always target the canonical row, so reservations/adjustments remain warehouse-isolated.

## Recommended future hardening

1. Periodic admin duplicate scan job
2. Manual merge tooling for orphan rows (not implemented in 5.3)
3. Re-evaluate Catalyst composite uniqueness if platform support appears
4. Optional sentinel column for product-level inventory if NULL uniqueness becomes problematic

## Operations that respect identity

- `ensureInventoryRow()`
- `setAbsoluteStock()` / `STOCK_COUNT`
- `adjustStock()`
- `reserveStock()` (warehouse-scoped when `warehouseId` provided)
- `commitReservation()` / `releaseReservation()`
- `transferStock()`
- Inventory-only CSV import
