# Picker / Rider (Quick Commerce Ops)

## Auth

| Role | Header | Env |
|------|--------|-----|
| Picker | `X-Baylen-Picker-Key` (+ optional `X-Baylen-Picker-Id`) | `PICKER_API_KEY` |
| Rider | `X-Baylen-Rider-Key` (+ optional `X-Baylen-Rider-Id`) | `RIDER_API_KEY` |
| Admin assign | `X-Baylen-Admin-Key` | `ADMIN_API_KEY` |
| Customer tracking | session cookie / auth as existing orders | — |

Set keys in Catalyst Console → Function env for `baylen-api`.

## Picker flow

1. `GET /v1/picker/orders?store_id=` — queue
2. `POST /v1/picker/orders/:id/start` → `PICKING`
3. `POST /v1/picker/orders/:id/item-status` `{ item_id, pick_status: FOUND|MISSING|… }`
4. `POST /v1/picker/orders/:id/pack` → `PACKED` → `RIDER_SEARCHING` or nearest rider

Missing items: `refund_hint.auto_refund = false` (no auto-refund until payment verified).

## Rider flow

1. `GET /v1/rider/orders`
2. `POST /v1/rider/orders/:id/accept`
3. `POST …/arrived-store` → `…/pickup` → `…/start-delivery` → `…/delivered`
4. `POST /v1/rider/location` `{ order_id?, latitude, longitude }`

Admin: `POST /v1/admin/orders/:id/assign-rider` with store lat/lng.

Customer: `GET /v1/orders/:id/tracking` — steps, masked rider phone, live lat/lng, track points.

## Schema (when Data Store quota OK)

```bash
node backend/scripts/provision-picker-rider-schema.js
```

Creates `Riders`, `Delivery_Tracking`; adds order fulfillment / pick_status columns. APIs degrade gracefully if columns/tables are missing.

## Status path

`CONFIRMED` → `PICKING` → `PACKED` → `RIDER_SEARCHING` / `RIDER_ASSIGNED` → `PICKED_UP` → `OUT_FOR_DELIVERY` → `DELIVERED`
