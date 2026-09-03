# Baylen Hybrid Commerce — Technical Plan

**Status:** Phase 0 complete. Implementation starts with fulfillment decision engine (backend authority).  
**Constraint:** Catalyst Data Store free-tier fetch is currently exhausted — new tables/data loads deferred; code + schema scripts ship now and activate when quota/billing is available.

---

## 1. Existing architecture

| Layer | Stack |
|---|---|
| App | Flutter (`StatefulWidget` + `ValueNotifier` services; no Bloc/Riverpod) |
| API | Catalyst Advanced I/O `baylen-api` (Express) + API Gateway |
| Data | Catalyst Data Store (Products, Carts, Orders, Inventory, Warehouses, Outlets, Addresses, …) |
| Auth | OTP + `X-Baylen-Token` / guest session |

## 2. Existing Shop (preserve)

- `ShopScreen` → `/v1/catalog/shop-home`
- Catalog / search / brands / product detail
- Add to cart / wishlist
- Design system (`shop_theme`, location header)

**Do not rebuild these screens.** Only extend PDP/cart/checkout.

## 3. Existing Cart

- Backend: `routes/cart.js` — guest/signed-in, aggregate stock, coupons
- Flutter: `CartService` + `CartScreen`
- **No** warehouse pick, **no** fulfillment mode today

## 4. Existing Catalyst integration

- Catalog, cart, checkout, inventory-ops, payments (Razorpay APIs exist; checkout currently pending-payment), salon outlets + dispatch (rider-like pattern for services only)

## 5. Existing database (relevant)

**Reuse:** `Products`, `Product_Variants`, `Carts`, `Cart_Items`, `Orders`, `Order_Items`, `Order_Timeline`, `Addresses` (already has lat/lng), `Warehouses` (+ `outlet_id`), `Inventory`, `Stock_Movements`, `Outlets` (lat/lng, hours), `Payments`, `Refunds`

**Closest dark-store seed:** `Warehouses` linked to `Outlets` via `outlet_id`

## 6. What can be reused

- Shop UI + catalog APIs
- Cart + checkout order create + `reserveStock`
- Multi-warehouse inventory + transfer + available calc
- Address lat/lng (backend already stores; Flutter model needs fields)
- Salon Haversine / nearby outlet pattern
- Payment intent/verify APIs (wire later)
- Admin inventory adjust/transfer

## 7. What needs to be added

1. **Fulfillment decision engine** (backend) — location → stores → stock → eligibility → options / split groups  
2. **APIs:** `POST /v1/fulfillment/check`, product availability, checkout fulfillment selection  
3. **Product flags:** `quick_commerce_enabled`, `ecommerce_enabled` (schema when DS available; safe defaults in code)  
4. **Store config:** `service_radius_km`, `delivery_enabled`, QC open status (prefer Outlets+Warehouses; extend columns via script)  
5. **Order split:** parent + QC/EC child orders  
6. **Flutter:** PDP delivery badges, cart hybrid groups, checkout option picker; Address lat/lng  
7. Later phases: picker/rider apps, live GPS, logistics abstraction, COD rules, cron

## 8. Files to modify

- `backend/functions/baylen-api/index.js`
- `backend/catalyst-user-rules.json`
- `backend/functions/baylen-api/routes/cart.js` / `checkout.js` (extend, not replace)
- `lib/api/catalyst_api.dart`
- `lib/models/account.dart`, `cart.dart`, `catalog.dart`
- `lib/screens/product_detail_screen.dart`, `cart_screen.dart`, `checkout_screen.dart`

## 9. New files

- `backend/functions/baylen-api/lib/fulfillment-engine.js`
- `backend/functions/baylen-api/routes/fulfillment.js`
- `backend/scripts/provision-hybrid-commerce-schema.js` (run when DS quota OK)
- `backend/docs/hybrid-commerce/HYBRID_COMMERCE_PLAN.md` (this file)
- `lib/models/fulfillment.dart`

## 10. Implementation sequence (active now)

1. ✅ Inspect + plan  
2. Fulfillment engine + `/v1/fulfillment/check`  
3. PDP availability UI  
4. Cart hybrid preview  
5. Checkout option + split-order fields (when DS allows writes)  
6. Schema provision script (deferred apply)  
7. Later: picker, rider, tracking, logistics, payments hardening  

---

## Decision defaults (configurable)

| Key | Default |
|---|---|
| QC radius | `FULFILLMENT_QC_RADIUS_KM` or `3` |
| QC ETA copy | 15–20 minutes |
| EC ETA copy | 2–3 days |
| Product QC enabled if column missing | `true` when local stock exists |
| Product EC enabled if column missing | `true` when warehouse stock exists |
| COD QC limit | `FULFILLMENT_QC_COD_LIMIT` or `2000` |
