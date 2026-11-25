# Phase 5.5 — Inventory DB Hardening / Duplicate Prevention

Development-only hardening. **No Production deploy in this phase.**

## Inventory identity model

Canonical physical identity:

```
warehouse_id + product_id + variant_id
```

- **SKU** is a catalog/import convenience key, not the inventory primary key.
- **Product-level inventory** uses `variant_id IS NULL` (distinct from variant rows in the same warehouse).
- **Same SKU across warehouses** is valid (separate identity per warehouse).

Implementation: `backend/functions/baylen-api/lib/inventory-identity.js`

## Database composite constraint capability

**Not available on Catalyst Data Store (verified Phase 5.5).**

Inspected `Inventory` table columns via Catalyst MCP (`table_id: 36851000000295021`):

| Column | `is_unique` |
|--------|-------------|
| `warehouse_id` | false |
| `product_id` | false |
| `variant_id` | false (nullable) |

Catalyst supports **single-column `is_unique` only**. There is no composite unique index on `(warehouse_id, product_id, variant_id)`. Nullable `variant_id` would further complicate a future composite constraint.

**Conclusion:** Absolute database-level duplicate prevention is **unavailable**. Application-level hardening is required.

## Canonical row strategy

1. **Reads:** `dedupeToCanonicalInventoryRows()` collapses duplicate identity rows before aggregation (fulfillment, availability).
2. **Lookup:** `loadInventoryRowByIdentity()` returns `pickCanonicalInventoryRow()` — lowest `ROWID`, active `ACTIVE` preferred.
3. **Writes:** All normal stock paths use `ensureInventoryRow()` → canonical row only.

## Race behavior (`ensureInventoryRow`)

Phase 5.5 strengthens the insert path:

```
attempt 0..2:
  read identity rows
  if found → return canonical
  else try insert (attempts 0–1)
re-read identity rows
return canonical (warn if duplicates)
```

Concurrent inserts can still create orphan rows (platform limitation). Normal reads/writes converge on the canonical row; warnings are logged.

## Duplicate detection

`buildInventoryDuplicateReport(zcql)` returns:

- `total_rows`
- `unique_identities`
- `duplicate_group_count`
- `duplicate_groups` (warehouse_code, sku, row_ids)
- `affected_warehouse_ids`, `affected_skus`

**Development scan (Phase 5.5, read-only):**

| Metric | Value |
|--------|-------|
| Total Inventory rows | 4 |
| Unique identities | 4 |
| Duplicate groups | **0** |

No automatic delete or merge performed.

## Duplicate remediation approach

`backend/functions/baylen-api/lib/inventory-remediation.js`

- `planDuplicateRemediation(groupRows)` — **design/plan only**
- `auto_execute: false`, `requires_admin_confirmation: true`
- Proposed merge sums quantities into canonical row
- Orphan rows: `DEACTIVATE_AFTER_MERGE` (never blind delete)
- Protections documented: Stock_Movements re-pointing, reservation checks, Audit_Logs

**Not implemented in 5.5:** automatic merge execution (requires explicit future admin API + confirmation token).

## Import identity (Phase 5.2 unchanged)

CSV file identity: `warehouse_code + sku`

- Duplicate `warehouse_code + sku` in same file → rejected
- Same SKU, different warehouse → valid
- Import resolves catalog SKU → `product_id` + `variant_id`, then `loadInventoryRow()` / `setAbsoluteStock()` via canonical identity

## Warehouse isolation

Verified paths remain warehouse-scoped:

| Operation | Isolation |
|-----------|-----------|
| `setAbsoluteStock` | ✅ via `ensureInventoryRow(warehouseId, …)` |
| `adjustStock` | ✅ |
| `reserveStock` | ✅ uses `loadInventoryRowByIdentity` when `warehouseId` set |
| `releaseReservation` / `commitReservation` | ✅ via movement `inventory_id` |
| `transferStock` | ✅ explicit from/to warehouses |
| Fulfillment availability | ✅ `dedupeToCanonicalInventoryRows` in `stockByWarehouseFromRows` |

Example: `WH-RNC-001 + MIN-NIA10-30ML` never modifies `WH-BAN01 + MIN-NIA10-30ML`.

## Known bypass paths (documented, not rewritten)

| Path | Risk | Mitigation |
|------|------|------------|
| `zoho-books.js` direct `Inventory.insertRow` | Legacy Books sync bypass | Out of 5.5 scope; use `ensureInventoryRow` if Books sync is extended |
| Admin `POST /v1/admin/inventory/update` by `inventory_id` | Targets explicit ROWID | Admin-only; audit logged |

## Remaining risks

1. Concurrent `ensureInventoryRow()` can still create orphan duplicate rows (no DB constraint).
2. Legacy/direct inserts outside `ensureInventoryRow()` can bypass identity logic.
3. Remediation merge is plan-only — manual Console work required if duplicates appear.
4. Catalog fulfillment still loads inventory per product when location set (Phase 5.8).

## Production readiness

Safe for Development validation. Recommend:

1. Deploy to Development when approved (not done in Phase 5.5).
2. Run `buildInventoryDuplicateReport` after deploy.
3. Re-smoke-test fulfillment with Ranchi coordinates.

**Production: NOT DEPLOYED**

## Files changed (Phase 5.5)

- `lib/inventory-identity.js` — `dedupeToCanonicalInventoryRows`, `buildInventoryDuplicateReport`
- `lib/inventory-remediation.js` — **new** remediation plan (no auto-merge)
- `lib/inventory-ops.js` — race-safe `ensureInventoryRow`, canonical `reserveStock`, deduped reads
- `lib/fulfillment-engine.js` — deduped `stockByWarehouseFromRows`
- `test/inventory-hardening.test.js` — **new** Phase 5.5 test suite
- `docs/hybrid-commerce/INVENTORY_DB_HARDENING.md` — this document

## Development inventory verified (unchanged)

| Warehouse | SKU | on_hand | reserved | committed |
|-----------|-----|---------|----------|-----------|
| WH-RNC-001 | MIN-NIA10-30ML | 10 | 3 | 0 |
| WH-BAN01 | MIN-NIA10-30ML | 80 | 0 | 0 |

Orders count: **3** (unchanged)
