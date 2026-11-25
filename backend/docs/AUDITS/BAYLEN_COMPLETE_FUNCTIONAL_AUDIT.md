# Baylen Complete Functional Audit

## Overall Status

**PARTIAL** — Steps 1–5 audited and remediated. Steps 6–23 not started.

## Feature Matrix (Step 1 scope)

| Feature | Backend | Flutter | Data | Integration | Status |
|---------|---------|---------|------|-------------|--------|
| Phone OTP request | PASS | PASS | PASS | PARTIAL | PASS |
| WhatsApp OTP delivery | PASS | PASS | PARTIAL | PARTIAL | PARTIAL |
| OTP verification | PASS | PASS | PASS | PARTIAL | PASS |
| OTP expiry (5 min) | PASS | N/A | PASS | — | PASS |
| OTP resend cooldown (45s) | PASS | PASS | PASS | — | PASS |
| OTP max attempts (5) | PASS | PASS | PASS | — | PASS |
| Wrong / expired OTP | PASS | PASS | PASS | — | PASS |
| Session token (sign/verify) | PASS | PASS | N/A | PARTIAL | PASS |
| Session refresh / revoke | PASS | PASS | N/A | — | PASS |
| User + profile creation on verify | PASS | PASS | PASS | — | PASS |
| Profile complete | PASS | PASS | PASS | — | PASS |
| Guest cart migration on login | PASS | N/A | PASS | — | PASS |
| Dev OTP fallback guard | PASS | PASS | N/A | PASS | PASS |
| Production OTP safety | PASS | PASS | N/A | PASS | PASS |
| Hosted Catalyst login (`/v1/auth/start`) | PARTIAL | PARTIAL | N/A | — | PARTIAL |
| Logout from app states | PASS | PASS | N/A | — | PASS |
| Unauthorized API handling | PASS | PASS | N/A | — | PASS |

---

## STEP 1 — Authentication + WhatsApp OTP

### Authentication status: **PASS**

Phone OTP login, session signing, profile bootstrap, guest migration, refresh/revoke, and unauthorized handling are implemented end-to-end via `baylen-api` → Catalyst Data Store.

### WhatsApp OTP: **PARTIAL**

Gateway acceptance is now validated before marking OTP sent. Development health confirms WhatsApp vars configured and dev fallback disabled. **Live OTP delivery to a real handset was not exercised in this audit session** (requires user phone + WhatsApp consent).

| Check | Result |
|-------|--------|
| OTP generation | **PASS** — `crypto.randomInt(100000, 1000000)` |
| OTP delivery | **PARTIAL** — provider body validation added; live send not smoke-tested on device |
| OTP verification | **PASS** — HMAC hash compare, challenge consume |
| OTP expiry | **PASS** — 5-minute TTL, consumed on expiry |
| OTP resend | **PASS** — 45-second cooldown |
| Session | **PASS** — HMAC JWT-like token, 7-day expiry |
| User creation | **PASS** — `Users` + `User_Profiles` on first verify |
| Dev OTP fallback | **PASS** — disabled when `BAYLEN_ENV=production`; startup guard added |
| Production OTP safety | **PASS** — `otp_whatsapp_ready=true`, `dev_otp_fallback_disabled=true` on Development |

### Backend tests: **267/267 PASS**

### Flutter tests: **41/41 PASS**

### Development smoke: **PASS**

- `GET https://baylen-app-60069781151.development.catalystserverless.in/health`
  - `otp_whatsapp_ready: true`
  - `dev_otp_fallback_enabled: false`
  - `dev_otp_fallback_disabled: true`
- `POST /v1/auth/otp/request` with invalid mobile → **400** with validation error
- `baylen-api` deployed to **Development** (not Production migration)

### Files changed

| File | Change |
|------|--------|
| `backend/functions/baylen-api/lib/whatsapp-otp.js` | Validate Tata/Meta gateway JSON before success; block dev fallback in production runtime |
| `backend/functions/baylen-api/lib/runtime-config.js` | Fail startup if `AUTH_OTP_DEV_RETURN_CODE=true` in Production |
| `backend/functions/baylen-api/routes/auth.js` | Return `debug_otp` only for explicit DEV fallback |
| `backend/functions/baylen-api/index.js` | Expose `dev_otp_fallback_disabled` on `/health` |
| `backend/functions/baylen-api/test/whatsapp-otp.test.js` | **New** — gateway parsing + prod fallback guard |
| `backend/functions/baylen-api/test/runtime-config.test.js` | Production dev-fallback rejection |
| `lib/api/catalyst_api.dart` | `OtpRequestResult.sentVia`, `deliveredViaWhatsapp` |
| `lib/screens/login_screen.dart` | Only claim WhatsApp when `sent_via=WHATSAPP`; reject unknown channels |
| `test/otp_request_result_test.dart` | **New** — Flutter OTP result parsing |

### Root causes

1. **False-positive WhatsApp success** — `sendWhatsappOtp()` treated any HTTP 200 as delivery success without checking gateway JSON for `messages[].id` or error payloads.
2. **Flutter UI over-claimed delivery** — Login screen always showed “OTP sent to WhatsApp” regardless of `sent_via`.
3. **Production dev-fallback risk** — `AUTH_OTP_DEV_RETURN_CODE` could theoretically be true in Production env; no startup guard existed.
4. **Missing regression tests** — No dedicated WhatsApp OTP or Flutter `sent_via` tests.

### Fixes

1. Added `parseWhatsappGatewayResponse()` — accepts only confirmed message IDs; rejects error bodies on HTTP 200.
2. Flutter reads `sent_via`; shows WhatsApp copy only when `WHATSAPP`; shows dev OTP only when `DEV` + `debug_otp`.
3. `isDevOtpFallbackEnabled()` returns false in production; `assertRuntimeSecrets()` throws if dev fallback env set in Production.
4. Added backend + Flutter regression tests; deployed to Development.

### Remaining issues (Step 1)

| Issue | Severity | Notes |
|-------|----------|-------|
| Live WhatsApp delivery not device-tested | Medium | Requires real phone OTP attempt in Development |
| Provider message ID not persisted in Data Store | Low | Logged server-side; `Auth_Otp_Challenges.sent_via` only stores channel |
| `session.js` `APP_BASE` hardcoded to Development URL | Low | Affects hosted `/v1/auth/start` origin allowlist in Production until env-based |
| Production not yet on this code build | Info | Console migration required; Production health lacks `dev_otp_fallback_disabled` until sync |
| Booking WhatsApp template unset | N/A Step 1 | `TATA_BOOKING_TEMPLATE_NAME` — Step 15 |

### Issue detail — False-positive WhatsApp success

**Problem:** OTP challenge could be created while WhatsApp gateway returned 200 with an error JSON body; user saw “OTP sent” but received nothing.

**Root cause:** `whatsapp-otp.js` line `if (response.ok) return { sentVia: "WHATSAPP" }` without body validation.

**Fix:** Parse gateway response; require message ID or explicit success marker.

**Test:** `backend/functions/baylen-api/test/whatsapp-otp.test.js`

**Smoke:** Development `/health` + invalid mobile rejection.

**Production impact:** Requires Production deployment migration when ready.

---

### Production deployment

**NOT RUN** — Development deploy only (`catalyst deploy --only functions:baylen-api`).

---

## STEP 2 — Mandatory Location / Location Permission / Location Enforcement

### Overall Step 2 status: **PASS** (with noted partials)

| Area | Status |
|------|--------|
| Location architecture | PASS |
| Permission handling | PASS |
| GPS-disabled handling | PASS |
| Mandatory location enforcement | PASS |
| Quick Commerce without location | PASS |
| Quick Commerce with Ranchi test coords | PASS |
| Standard E-commerce without location | PASS |
| Salon nearby (no silent fallback) | PASS |
| Home Service device GPS requirement | PASS |
| Address vs device location distinction | PASS |
| Backend coordinate validation | PASS |
| Catalog browse without location | PASS |
| Authentication impact | PASS (no regression) |

### Location architecture found

**Dual Flutter model (preserved):**
- `LocationService` — discovery (salon/home/manual picker + device GPS)
- `DeliveryLocationService` — commerce delivery coords (saved address → device GPS only → none)

**Backend authority:**
- `fulfillment-engine.js` — QC vs Standard using real lat/lng + topology
- `geo-coords.js` — shared coordinate validation (new)
- `routes/home.js` — strict coords for `/v1/outlets/nearby`

### Problems found & root causes

1. **Silent fake location on Home** — `home_screen.dart` fell back to first `salonLocations()` API row when GPS unavailable, injecting outlet coordinates as user location.
2. **Manual location used for Quick Commerce** — `DeliveryLocationService` accepted any `LocationService` value including manual city picks.
3. **Null coords treated as 0,0** — `evaluateFulfillment()` used `Number(null) === 0`, enabling QC evaluation without real location (`NO_SERVICEABLE_STORE` instead of `LOCATION_REQUIRED`).
4. **Weak backend validation** — `parseLocation()` accepted out-of-range and partial coordinates.
5. **No reusable location gate UI** — permission screen existed but launch gate disabled; features used inconsistent soft prompts.

### Files changed

**Backend:** `lib/geo-coords.js` (new), `lib/catalog-availability-shared.js`, `lib/fulfillment-engine.js`, `routes/home.js`, `routes/fulfillment.js`, `test/geo-coords.test.js` (new)

**Flutter:** `lib/services/location_service.dart`, `lib/services/delivery_location_service.dart`, `lib/utils/location_status.dart` (new), `lib/widgets/location/required_location_panel.dart` (new), `lib/screens/home_screen.dart`, `lib/screens/shop_screen.dart`, `lib/screens/home_service_screen.dart`, `lib/screens/nearby_outlets_screen.dart`, `lib/launch/location_permission_screen.dart`, `test/location_enforcement_test.dart` (new)

### Tests

| Suite | Before Step 2 | After Step 2 |
|-------|---------------|--------------|
| Backend | 272/272 | **273/273** |
| Flutter | 41/41 | **44/44** |

### Development smoke results

| Check | Result |
|-------|--------|
| A. `/v1/outlets/nearby` without coords | **400** blocked |
| B. Invalid coords (lat=999) | **400** `INVALID_COORDINATES` |
| C. Valid Ranchi 23.3782, 85.3315 nearby | **5 outlets** returned |
| D. QC without location (MIN-NIA product) | `available=false`, **`reason=LOCATION_REQUIRED`** |
| E. QC with Ranchi test coords | `available=true`, **`warehouse=WH-RNC-001`**, **`eta=15-20 minutes`** |
| F. Standard without location | `available=true` (existing rules) |
| G. Catalog browse | Still available without location |
| H. Auth/OTP health | No regression |

### Remaining issues (Step 2)

| Issue | Severity | Notes |
|-------|----------|-------|
| Launch-time global location gate still disabled | Low | By design — location enforced per feature entry |
| Popular city chips in manual picker use fixed coords | Low | Explicit user action only; not used for QC delivery |
| Home service allows manual location in picker path elsewhere | Low | Main screen now requires device GPS |
| Production not on this build | Info | Console migration required |

### Production deployment

**NOT RUN** — Development deploy only.

---

## STEP 3 — Home Screen

### Overall Step 3 status: **PASS** (with noted partials)

| Area | Status |
|------|--------|
| Home architecture | PASS |
| Home feature inventory | PASS |
| Data source / no fake fallbacks | PASS |
| Location integration (nearby salons) | PASS |
| Home API (`GET /v1/home`) | PASS |
| Nearby API (`POST /v1/outlets/nearby`) | PASS |
| Catalog/product sections on Home | NOT TESTED (not rendered) |
| Salon sections | PASS |
| Home Service CTAs | PARTIAL |
| Search navigation | PASS |
| Banners / promotions | PASS |
| Navigation / CTAs | PASS |
| Authentication states | PARTIAL |
| Loading / empty / error states | PASS |
| Refresh / app resume | PARTIAL |
| Performance (parallel load) | PASS |
| Security (public home feed) | PASS |

### Home architecture

**Flutter:** `HomeScreen` → section widgets under `lib/widgets/home/*` → `CatalystApi` → Catalyst API Gateway → `baylen-api` → Data Store.

**State:** `LocationService`, `CartService`, `NotificationService` (ValueNotifiers). Home feed held in local `_homeData` map. Nearby salons in separate `_nearbyOutlets` list.

**Independent sections:** Home feed failure shows retry banner; nearby salons load independently with own loading/error.

### Home feature inventory (actual UI)

| Section | Widget | Data source |
|---------|--------|-------------|
| Header | `HomeHeader` | Location, notifications count, cart count |
| GPS disabled banner | inline | `LocationService.isGpsDisabled` |
| Search | `HomeSearchBar` | navigates to `SearchScreen` |
| Hero banners | `HeroBanner` | `GET /v1/home` → `banners` |
| Quick access | `QuickAccess` | static CTAs → tabs |
| Nearby salons | `NearbySalons` | `POST /v1/outlets/nearby` |
| Consultation / Book | `ConsultationBookRow` | static → Salon tab |
| Beauty categories | `BeautyServices` | `beauty_categories` from home feed |
| Trending | `TrendingSection` | `trending` from home feed |
| Cut & Color / Videos | `CutColorVideosRow` | static CTAs → Salon / Shop |
| Brands | `BrandCollection` | `brands` from home feed |

**Backend returns but Home does not render:** `offers`, `featured_products`, `featured_outlets`, `featured_services` (Shop/Salon tabs own these).

### APIs used

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/v1/home` | GET | No | Banners, categories, brands, trending, offers (unused in UI) |
| `/v1/outlets/nearby` | POST | No | Distance-sorted active outlets |
| `/v1/notifications/count` | GET | Session optional | Header badge |
| `/v1/cart` | GET | Session/guest | Header cart count |
| `/v1/catalog/product` | GET | No | Trending product deep-link |

### Data Store tables

`Home_Banners`, `Coupons`, `Products`, `Outlets`, `Salon_Services`, `Brands`, `Service_Categories`, `Trending`, `Notifications` (count only).

### Problems found & root causes

1. **Hardcoded home fallback on API error** — `_fallbackHomeData` injected fake beauty categories when `/v1/home` failed.
2. **Widget-level fake data** — `BeautyServices._defaultCategories`, `BrandCollection._fallback` showed hardcoded categories/brands when API empty.
3. **Wrong nearby endpoint** — `nearbyOutlets()` called `GET /v1/salon/outlets` instead of authoritative `POST /v1/outlets/nearby` (Step 2 hardened).
4. **Dead navigation handlers** — notifications, offers, categories, trending, brands, consultation, cut/color CTAs were no-ops.
5. **Location loading not bound** — `HomeHeader.locationLoading` hardcoded `false`.
6. **Sequential home load** — home feed and nearby fetched serially.
7. **Salon-engine null coord bug** — `filterOutletsByLocation` treated `Number(null)` as valid 0,0 (affects salon routes, not Home after fix #3).
8. **No home regression tests** — missing backend mapper tests and Flutter empty-state tests.

### Fixes

1. Removed `_fallbackHomeData`; home feed errors show retry banner only.
2. Empty states for beauty categories and brands (no hardcoded placeholders).
3. `nearbyOutlets()` now uses `POST /v1/outlets/nearby` with required lat/lng.
4. Wired all Home CTAs (notifications, shop offers, salon consultation, home service categories, trending, brands, cut/color/videos).
5. Bound `HomeHeader.locationLoading` to `LocationService.isLoading`.
6. Parallelized home feed + nearby fetch in `_loadData()`.
7. Auth listener clears notification badge on logout.
8. `salon-engine.filterOutletsByLocation` uses `geo-coords.parseLocation`.
9. Added `test/home-feed.test.js`, `test/home_screen_test.dart`, salon-engine coord regression.

### Files changed

**Backend:** `routes/home.js`, `lib/salon-engine.js`, `test/home-feed.test.js` (new), `test/salon-engine.test.js`

**Flutter:** `lib/screens/home_screen.dart`, `lib/api/catalyst_api.dart`, `lib/widgets/home/beauty_services.dart`, `lib/widgets/home/brand_collection.dart`, `test/home_screen_test.dart` (new)

### Tests

| Suite | Before Step 3 | After Step 3 |
|-------|---------------|--------------|
| Backend | 273/273 | **278/278** |
| Flutter | 44/44 | **48/48** |

### Development smoke

| Check | Result |
|-------|--------|
| `GET /v1/home` | **ok=true**, banners=2, brands=10, offers=8, featured_products=1 |
| `POST /v1/outlets/nearby` Ranchi 23.3782, 85.3315 | **5 outlets**, nearest Baylen Premium Salon Lalpur |
| `POST /v1/outlets/nearby` missing coords | **400** (expected) |
| Flutter + backend unit tests | **All pass** |

### Remaining issues (Step 3)

| Issue | Severity | Notes |
|-------|----------|-------|
| Home does not surface `offers` / `featured_products` from API | Low | By design — Shop tab owns commerce home; not a bug |
| Home Service category flow lacks serviceability pre-check | Low | Opens category outlets screen; may show empty if area not serviceable |
| Consultation CTA opens Salon tab (no dedicated chat flow) | Low | No consultation API exists |
| Cut & Color / Videos are static CTAs (no CMS) | Info | Static by design |
| Backend salon-engine fix not deployed | Info | Home uses `/v1/outlets/nearby` (already deployed); deploy recommended for salon routes |
| Session-expired / offline Home not device-tested | Medium | Logic reviewed; manual QA recommended |

### Production deployment

**NOT RUN** — Development smoke against existing Development deployment only. No Production migration or data changes.

---

## Steps not yet audited

Steps 5–23 are **NOT STARTED**. Awaiting instruction to proceed with Step 5.

---

## STEP 4 — Shop / Catalog

### Overall Step 4 status: **PASS** (with noted partials)

| Area | Status |
|------|--------|
| Shop architecture | PASS |
| Catalog data source (no fake products) | PASS |
| Product identity | PASS |
| Product listing | PARTIAL |
| Product detail | PASS |
| Price authority | PASS |
| Inventory / stock display | PASS |
| Quick Commerce integration | PASS |
| Standard E-commerce | PASS |
| Batch availability | PASS |
| Category / brand | PASS |
| Search | PARTIAL |
| Cart integration | PASS |
| Authentication | PARTIAL |
| Location (Step 2 rules) | PASS |
| Security | PASS |
| Performance | PARTIAL |

### Shop architecture

**Flutter:** `ShopScreen` (landing) → `ShopCatalogScreen` / `ShopBrandPage` / `ProductDetailScreen` → `CatalystApi` → `/v1/catalog/*` + `/v1/fulfillment/*` + `/v1/cart/*`.

**Backend authority:** Catalyst Data Store (`Products`, `Product_Variants`, `Product_Media`, `Brands`, `Categories`, `Inventory`, `Warehouses`, `Outlets`). Batch availability via `catalog-batch-availability.js` on list endpoints when lat/lng supplied.

### Problems found & fixes

1. **`const withAvailability` crash** — `/v1/catalog/products` with `min_discount`, `in_stock`, or `min_rating` filters caused ReferenceError. Fixed: `let withAvailability`.
2. **Product detail variant N+1** — Each variant triggered separate availability batch. Fixed: single `buildCatalogAvailabilityBatch` for all variants.
3. **Missing location on shop-home** — Initial Glow Picks lacked QC availability. Fixed: pass lat/lng to `shopHome()`.
4. **Missing location on catalog search / brand page** — `shopSearch()` and `ShopBrandPage` omitted coords. Fixed.
5. **Hardcoded ETAs in Flutter** — `~20 minutes` / `2–3 business days` shown when backend ETA empty. Fixed: generic labels only when backend silent.
6. **ShopBrandPage ignored fulfillment** — Used raw `availableQuantity` only. Fixed: `catalogProductCanAdd` / `catalogProductSoldOut`.
7. **ShopScreen missing Zoho Commerce guard** — Fixed to match catalog screen.
8. **SearchScreen dead navigation** — Result taps were no-ops. Fixed: product/brand/outlet navigation wired.
9. **Search brand results missing slug** — Added `slug` to `/v1/search` brand mapper.

### Files changed

**Backend:** `routes/catalog.js`, `routes/search.js`, `test/catalog-routes.test.js` (new)

**Flutter:** `lib/api/catalyst_api.dart`, `lib/screens/shop_screen.dart`, `lib/screens/shop_catalog_screen.dart`, `lib/screens/shop_brand_page.dart`, `lib/screens/search_screen.dart`, `lib/utils/fulfillment_helpers.dart`, `test/shop_catalog_test.dart` (new)

### Tests

| Suite | Before Step 4 | After Step 4 |
|-------|---------------|--------------|
| Backend | 278/278 | **280/280** |
| Flutter | 48/48 | **53/53** |

### Development smoke

| Check | Result |
|-------|--------|
| `GET /v1/catalog/shop-home` + Ranchi coords | **ok**, glow products with fulfillment fields |
| `GET /v1/catalog/products` + coords | **3 products**, MIN-NIA `quick=true`, `standard=true` |
| `GET /v1/catalog/product?id=…` | Detail + variants + media |
| `GET /v1/catalog/search?q=lakme` + coords | **3 products** with availability |
| `GET /v1/fulfillment/product-availability` MIN-NIA + Ranchi | **QC available**, `WH-RNC-001`, **15-20 minutes** |
| Standard on same product | **available**, **2-3 days** |
| Products without location | Standard aggregate only; Quick off |

### Remaining issues (Step 4)

| Issue | Severity | Notes |
|-------|----------|-------|
| In-memory product pagination (loads all ACTIVE products) | Medium | Scales poorly; DB pagination deferred |
| `ShopFashionScreen` uses static navigation catalog | Low | UI-only; opens real catalog with search query |
| Dead brand name arrays in `shop_brand_catalog.dart` | Low | Enum/tabs used; name lists unused |
| PDP fulfillment mode not persisted to cart | Low | Checkout re-selects mode (existing) |
| Cart `assertFulfillable` fallback to global stock | Medium | Pre-existing; out of Step 4 scope |
| Session-expired Shop manual QA | Medium | Not device-tested this session |
| Backend catalog fixes not deployed yet | Info | Deploy to Development when ready |

### Production deployment

**NOT RUN** — Development smoke against existing deployment; catalog.js fixes require Development deploy to take effect on server.

---

## STEP 5 — Quick Commerce + Inventory

### Overall Step 5 status: **PARTIAL** (production-critical gaps remediated; COD commit lifecycle and concurrency remain documented limitations)

### Feature matrix (Step 5 scope)

| Area | Status |
|------|--------|
| Inventory formula (backend authoritative) | **PASS** |
| Inventory identity (warehouse+SKU) | **PASS** |
| Quick eligibility chain | **PASS** |
| Single-store cart QC selection | **PASS** (fixed) |
| Multi-store nearest full-qty selection | **PASS** |
| Multi-product cart (one warehouse) | **PASS** (fixed) |
| Location required for QC | **PASS** |
| Service radius | **PASS** |
| Business hours (Asia/Kolkata) | **PASS** |
| Warehouse topology | **PASS** |
| Reservation | **PASS** |
| Reservation failure | **PASS** |
| Idempotency (checkout key) | **PASS** |
| Release idempotency | **PASS** (fixed) |
| Commit idempotency | **PASS** (fixed) |
| Stock movements | **PASS** |
| Checkout revalidation | **PASS** |
| Location change recalc | **PARTIAL** (backend yes; Flutter saved-address GPS gap) |
| ETA from backend | **PASS** |
| Quick vs Standard separation | **PASS** |
| Split fulfillment | **PASS** |
| Inventory import | **PASS** (architecture review) |
| Low stock (available-based) | **PASS** |
| Concurrency | **PARTIAL** (TOCTOU; no atomic Data Store transactions) |
| Admin stock adjustment | **PASS** |
| Security (inventory mutations) | **PASS** (fixed) |
| Data integrity utilities | **PASS** |
| COD QC limit at checkout | **PASS** (fixed) |
| COD inventory commit | **PARTIAL** (reserved until online payment commit path) |
| Development smoke | **PASS** (read-only) |
| Production deployment | **NOT RUN** |

### Architecture found

Authoritative Quick Commerce path:

```
GPS → loadFulfillmentTopology → buildDarkStoreCandidatesFromTopology
→ per-line evaluateFulfillmentLine (nearest serviceable store with full line qty)
→ findNearestQuickStoreForCart (cart QC requires ONE warehouse for ALL lines)
→ evaluateFulfillment options → resolveCheckoutPlan (checkout)
→ reserveStock per line at engine warehouse → order → payment commit / release
```

Key modules: `fulfillment-engine.js`, `fulfillment-topology.js`, `inventory-ops.js`, `inventory-identity.js`, `hybrid-checkout.js`, `routes/fulfillment.js`, `routes/checkout.js`, `routes/inventory.js`, `routes/payments.js`.

Flutter reads availability from `/v1/catalog/*`, `/v1/fulfillment/product-availability`, `/v1/fulfillment/check` — does not compute stock/warehouse/ETA.

### Problems found and fixes

| Priority | Issue | Fix |
|----------|-------|-----|
| P0 | Public unauthenticated `POST /v1/inventory/reserve\|release\|commit` | `requireAdmin` on all three routes |
| P1 | Cart QC shown when lines eligible at different stores | `findNearestQuickStoreForCart` + cart-level QC option |
| P1 | QC COD limit hint-only | Enforced in `handlePlaceOrder` → `QC_COD_LIMIT_EXCEEDED` |
| P2 | `releaseReservation` / `commitReservation` not idempotent | Early return if ORDER_RELEASE / SALE movement exists |
| P2 | `commitReservation` did not increment `quantity_committed` | Fixed transition: on_hand↓, reserved↓, committed↑ |
| P2 | `POST /v1/inventory/check` skipped dedupe | Uses `dedupeToCanonicalInventoryRows` |

### Files changed (Step 5)

| File | Change |
|------|--------|
| `lib/fulfillment-engine.js` | `findNearestQuickStoreForCart`, single-store cart QC, split store selection |
| `lib/inventory-ops.js` | Idempotent release/commit; commit increments `quantity_committed` |
| `routes/inventory.js` | Admin auth on reserve/release/commit; dedupe on check |
| `routes/checkout.js` | QC COD limit enforcement |
| `test/quick-commerce.test.js` | **New** — formula, multi-store, cart, radius, reservation failure |
| `test/inventory-hardening.test.js` | Idempotent release/commit; mock Stock_Movements filtering; commit committed qty |

### Tests

| Suite | Before Step 5 | After Step 5 |
|-------|---------------|--------------|
| Backend | 280/280 | **289/289** |
| Flutter | 53/53 | **53/53** |

### Development smoke (read-only, coords 23.3782, 85.3315)

| Check | Result |
|-------|--------|
| MIN-NIA qty 5 + location | QC **available**, `WH-RNC-001`, **available=7**, ETA **15–20 min** |
| MIN-NIA qty 8 + location | QC **unavailable**, reason **INSUFFICIENT_LOCAL_STOCK** |
| MIN-NIA without location | QC **LOCATION_REQUIRED**; Standard still available |
| Baseline inventory | **available=7** unchanged after read-only smoke |
| `baylen-api` deploy | **Development** deploy completed |

### Remaining issues (Step 5)

| Issue | Severity | Status |
|-------|----------|--------|
| COD orders keep stock in `quantity_reserved` until online-payment `commitReservation` | High | **PARTIAL** — document; commit on COD confirm deferred |
| Concurrent reserve TOCTOU (two buyers, last unit) | High | **PARTIAL** — rollback on race; not atomic |
| Flutter checkout uses saved-address lat/lng only | Medium | **PARTIAL** — Step 2/5 boundary |
| EC warehouse pick vs summed stock display | Low | Pre-existing |
| Production deploy / Production Data Store | — | **NOT RUN** |

### Production readiness (Step 5)

**PARTIAL** — Core QC eligibility, cart warehouse selection, inventory formula, checkout revalidation, and inventory API security are in good shape. Before Production: resolve COD commit lifecycle, load-test concurrent checkout, and complete device QA for location-change during checkout.

**STOP — Step 5 complete. Steps 6–23 not started.**
