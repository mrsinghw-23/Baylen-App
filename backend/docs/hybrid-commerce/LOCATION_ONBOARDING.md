# Location Onboarding (Phase 5.1)

Development-only backend flow for adding a new Quick Commerce or Standard location **without Flutter changes**.

## Step 1 — Create or update outlet

`POST /v1/admin/outlet/upsert`

Headers:
- `x-baylen-admin-key: <ADMIN_API_KEY>`

Example:
```json
{
  "name": "Example Dark Store",
  "code": "BAYLEN-EX-001",
  "latitude": "12.971600",
  "longitude": "77.594563",
  "opening_time": "10:00 AM",
  "closing_time": "9:00 PM",
  "service_radius_km": 3,
  "delivery_enabled": true,
  "store_type": "RETAIL",
  "is_active": true
}
```

Outlet remains the source of truth for coordinates, radius, hours, and delivery flags.

## Step 2 — Create or update warehouse linked to outlet

`POST /v1/admin/warehouse/upsert`

Quick Commerce example:
```json
{
  "code": "WH-EX-001",
  "name": "Example QC Stock",
  "type": "DARK_STORE",
  "outlet_id": "<outlet ROWID from step 1>",
  "is_active": true
}
```

Central / Standard example:
```json
{
  "code": "WH-EX-HQ",
  "name": "Example Central Stock",
  "type": "CENTRAL",
  "is_default": true,
  "is_active": true
}
```

## Step 3 — Add serviceability pincodes (Standard checkout gate)

Seed `Serviceable_Pincodes` for the delivery region where Standard E-Commerce checkout should be allowed.

## Step 4 — Import inventory by warehouse code + SKU

Use the **inventory-only CSV** (Phase 5.2):

`POST /v1/admin/inventory/import/preview` then `POST /v1/admin/inventory/import` with `confirm=true`.

Canonical columns: `warehouse_code,sku,stock,reorder_level,reorder_quantity,safety_stock`

See [`backend/docs/catalog-import/INVENTORY_IMPORT.md`](../catalog-import/INVENTORY_IMPORT.md).

The full 53-column product CSV still supports embedded stock, but inventory-only import is preferred for stock updates.

An explicitly invalid `warehouse_code` returns `WAREHOUSE_NOT_FOUND` instead of silently falling back to HQ.

## Step 5 — Fulfillment auto-discovery

No code deploy required. The fulfillment engine loads all active warehouses and linked outlets automatically via:

- `loadWarehouses()`
- `buildDarkStoreCandidates()`
- `centralWarehouses()`

## Step 6 — Verify

`POST /v1/fulfillment/check` with customer `latitude` / `longitude` near the new outlet.

## Admin list/get endpoints

- `GET /v1/admin/warehouses`
- `GET /v1/admin/warehouse?id=<warehouse_id>`
- `POST /v1/admin/warehouse/status` — activate/deactivate
