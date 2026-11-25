# Inventory-Only CSV Import (Phase 5.2)

Development-only admin workflow for bulk inventory updates **without** the 53-column product master CSV.

## Canonical CSV format

```csv
warehouse_code,sku,stock,reorder_level,reorder_quantity,safety_stock
WH-RNC-001,MIN-NIA10-30ML,25,5,20,3
WH-RNC-002,MIN-NIA10-30ML,15,5,20,3
WH-RNC-003,MIN-NIA10-30ML,30,8,25,5
WH-RNC-001,LOR-EOHS-100ML,10,3,10,2
```

### Required columns

| Column | Description |
|--------|-------------|
| `warehouse_code` | Existing active warehouse code. **No HQ fallback.** |
| `sku` | Existing product or variant SKU. Products/variants are **not** auto-created. |
| `stock` | **Absolute** `quantity_on_hand` (not a delta). Non-negative integer. |

### Optional columns

| Column | Behavior when omitted |
|--------|----------------------|
| `reorder_level` | Preserves existing inventory value |
| `reorder_quantity` | Preserves existing inventory value |
| `safety_stock` | Preserves existing inventory value |

## Key rules

- **Inventory identity** = `warehouse_id + product_id + variant_id` (see [`INVENTORY_IDENTITY.md`](INVENTORY_IDENTITY.md)).
- **SKU is global** — one catalog SKU can appear in many warehouses.
- **Import file identity** = `warehouse_code + sku` (resolves to warehouse/product/variant IDs).
- Same SKU in multiple warehouses in one file is **valid**.
- Duplicate `warehouse_code + sku` in the same file → `DUPLICATE_INVENTORY_ROW`.
- Invalid warehouse → `WAREHOUSE_NOT_FOUND` (no silent HQ fallback).
- Unknown SKU → `SKU_NOT_FOUND`.
- Negative or decimal stock → `INVALID_STOCK`.
- Stock is **absolute**: CSV `stock=25` sets `quantity_on_hand=25`, not `current + 25`.
- Stock changes record `STOCK_COUNT` movements via the existing `Stock_Movements` ledger.
- Re-importing identical stock is idempotent (`on_hand` unchanged; zero-delta movement may still be recorded).

## Admin API

Header: `x-baylen-admin-key: <ADMIN_API_KEY>`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/v1/admin/inventory/import/template` | Download template + column dictionary |
| `POST` | `/v1/admin/inventory/import/preview` | Validate CSV without modifying inventory |
| `POST` | `/v1/admin/inventory/import` | Preview + import (set `confirm=true`) |

### Preview example

```json
POST /v1/admin/inventory/import/preview
{
  "csv_text": "warehouse_code,sku,stock\nWH-RNC-001,MIN-NIA10-30ML,25\n"
}
```

### Import example

```json
POST /v1/admin/inventory/import
{
  "csv_text": "warehouse_code,sku,stock\nWH-RNC-001,MIN-NIA10-30ML,25\n",
  "filename": "inventory-rnc.csv",
  "confirm": true
}
```

Job errors: `GET /v1/admin/imports/:id/errors?format=csv`

## Batch size guidance

| Rows | Guidance |
|------|----------|
| ≤ 100 | Safe for synchronous import |
| 100–500 | Recommended operational batch |
| 500–5,000 | Supported parser limit; slower on Advanced I/O |
| > 5,000 | **Not supported** in Phase 5.2 (background worker = Phase 5.6) |

Hard parser cap: **5,000 rows** per job.

## Onboarding flow (with Phase 5.1)

1. Create/update outlet (`POST /v1/admin/outlet/upsert`)
2. Create/update warehouse linked to outlet (`POST /v1/admin/warehouse/upsert`)
3. Add serviceability pincodes where applicable
4. **Import inventory** using this CSV (`warehouse_code` + `sku` + `stock`)
5. Fulfillment auto-discovers the location
6. Verify with `POST /v1/fulfillment/check`

## Template file

[`baylen-inventory-import-template.csv`](baylen-inventory-import-template.csv)
