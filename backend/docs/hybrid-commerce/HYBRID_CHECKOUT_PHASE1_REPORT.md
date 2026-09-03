# Hybrid Checkout — Phase 1 Implementation Report

**Date:** 2026-08-31  
**Scope:** Hybrid Checkout + Fulfillment Decision Engine (server authority)  
**Constraint:** Existing Shop / cart browse / PDP / auth / OrderTrackingScreen preserved

---

## Inspection summary (before this implementation)

| Area | Status |
|------|--------|
| Cart CRUD | Ready (`routes/cart.js`, Flutter `CartService`) |
| Fulfillment engine + `/v1/fulfillment/*` | Ready (decision only) |
| PDP / cart delivery preview | Ready (read-only) |
| Checkout | **Was** legacy single order — no mode, no lat/lng, no split |
| Inventory reserve | Global; weak race handling |
| Orders parent/child | Schema script only |
| OrderTrackingScreen | Compatible API; underfed by checkout metadata |
| `lib/hybrid-checkout.js` | Plan helpers existed but **not wired** into checkout |

---

## What was implemented

### Business rules
1. Checkout **re-runs** `evaluateFulfillment` with address/device lat/lng (server authority).
2. Client `fulfillment_mode` is validated against fresh options; invalid/stale QC → **409** with clear message.
3. Default mode: **QC → SPLIT → EC**.
4. **QC:** 15–20 min window when local dark-store stock + radius + open + delivery + product eligibility.
5. **EC:** standard 2–3 day warehouse path when QC not available.
6. **SPLIT:** parent/master order + QC child + EC child; inventory reserved per child; QC reserve is **warehouse-scoped**.
7. Mid-checkout stock loss → rollback created orders + release reservations; customer sees clear error.
8. Optimistic inventory re-read before reserve so two customers cannot both take the last QC unit.
9. Order list hides child rows; detail includes `children`; tracking resolves SPLIT master → QC child.
10. Flutter checkout shows server options and sends selected mode + lat/lng.

### Files changed / added

| File | Change |
|------|--------|
| `backend/functions/baylen-api/lib/inventory-ops.js` | Optimistic re-read + warehouse-scoped race-safe reserve |
| `backend/functions/baylen-api/routes/checkout.js` | Hybrid checkout, split orders, lat/lng address, cancel tree |
| `backend/functions/baylen-api/routes/rider.js` | Tracking redirects SPLIT master → QC child |
| `backend/functions/baylen-api/lib/hybrid-checkout.js` | (existing) plan resolve — now used by checkout |
| `backend/scripts/test-hybrid-checkout-scenarios.js` | Scenarios A–F unit tests |
| `backend/docs/hybrid-commerce/HYBRID_CHECKOUT_PHASE1_REPORT.md` | This report |
| `lib/models/order.dart` | fulfillment fields, children, `trackingOrderId` / `trackId` |
| `lib/api/catalyst_api.dart` | checkout accepts mode + lat/lng |
| `lib/screens/checkout_screen.dart` | Fulfillment option picker + refresh |
| `lib/screens/orders_screen.dart` | Shipments + track via `trackId` |

### APIs

| Method | Path | Behavior |
|--------|------|----------|
| POST | `/v1/checkout` | Validates fulfillment; creates 1 order or master+children; returns `order` + `fulfillment` |
| GET | `/v1/orders` | Hides child orders; detail includes `children` |
| GET | `/v1/orders/:id/tracking` | Master SPLIT → QC child tracking |
| POST | `/v1/fulfillment/check` | Unchanged (used by checkout UI + server) |

### Database (scripted; apply when DS quota OK)

From `provision-hybrid-commerce-schema.js` / picker script:
- Orders: `fulfillment_mode`, `parent_order_id`, `fulfillment_store_id`, `fulfillment_warehouse_id`
- Order_Items: `fulfillment_type`, store/warehouse, `pick_status`
- Products / Outlets QC flags & radius

Checkout **degrades** gracefully if columns missing (strips hybrid fields and retries insert).

---

## Tests performed

```bash
node backend/scripts/test-hybrid-checkout-scenarios.js
```

| Scenario | Result |
|----------|--------|
| A Local stock → QC | PASS |
| B Local unavailable → EC | PASS |
| C Mixed → SPLIT groups | PASS |
| D Unavailable / stale QC → 409 message | PASS |
| E Outside radius → EC only | PASS |
| F Store inactive reason → EC | PASS |

Live Data Store E2E may still fail until billing/quota is restored and schema columns are provisioned.

---

## Deploy

```powershell
cd "E:\Zoho\Zoho Catalyst\baylen_app\backend"
catalyst deploy --only functions:baylen-api
```

Flutter: hot restart / `flutter run` (no Catalyst change required for UI-only).

---

## Not in this phase
- Payment verify → `commitReservation`
- Picker/rider mobile apps
- Applying Data Store schema when free-tier is exhausted

## Next step
1. When Data Store works: `node backend/scripts/provision-hybrid-commerce-schema.js`
2. Seed dark-store Warehouse↔Outlet + inventory for QC E2E
3. Then payment → commit reservation, or picker/rider live smoke with real orders
