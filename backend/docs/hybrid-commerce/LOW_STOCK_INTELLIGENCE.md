# Low-Stock Intelligence (Phase 5.7)

Per-warehouse low-stock evaluation using existing inventory reorder fields. Read-only intelligence — no automatic purchasing, replenishment, or transfers.

## Status rules

`available = quantity_on_hand - quantity_reserved - quantity_committed`

| Status | Rule |
|--------|------|
| `OUT_OF_STOCK` | `available <= 0` |
| `CRITICAL` | `available <= safety_stock` AND `available > 0` |
| `LOW_STOCK` | `available <= reorder_level` AND `available > safety_stock` |
| `IN_STOCK` | `available > reorder_level` |

There is **no global hardcoded `<= 5` rule**. Thresholds come from each inventory row's `reorder_level` and `safety_stock`.

## Engine

- `lib/low-stock-engine.js` — `computeLowStockStatus()`, `mapLowStockRow()`, `summarizeLowStockRows()`
- `lib/low-stock-admin.js` — `listLowStock()`, `lowStockSummary()` with warehouse/product/SKU/status filters
- `lib/low-stock-alerts.js` — transition-based alert deduplication

## Alert deduplication

Alerts emit **only on status transition**:

```
LOW_STOCK → LOW_STOCK   → no duplicate alert
LOW_STOCK → IN_STOCK    → cache updated
IN_STOCK  → LOW_STOCK   → new alert allowed
```

Implementation:

1. Cache key: `lowstock:last:{warehouse_id|product_id|variant_id}` (24h TTL)
2. Audit trail: `Audit_Logs` via `writeAdminAudit()` with action `LOW_STOCK_TRANSITION`

Future channels (email, push, dashboard) can subscribe to these audit events.

## Admin API

Header: `x-baylen-admin-key: <ADMIN_API_KEY>`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/admin/inventory/low-stock` | Paginated low-stock list |
| GET | `/v1/admin/inventory/low-stock/summary` | Status counts |

Query filters: `status`, `warehouse_id`, `warehouse_code`, `product_id`, `variant_id`, `sku`, `alert_only`, `record_alerts=true` (optional scan + emit transitions).

## Response fields

Each row includes: warehouse, warehouse_code, SKU, product, variant, on_hand, reserved, committed, available, reorder_level, reorder_quantity, safety_stock, status, reorder_recommendation (display only).

## Tests

`test/low-stock.test.js` — status rules, row mapping, alert deduplication, summary aggregation.
