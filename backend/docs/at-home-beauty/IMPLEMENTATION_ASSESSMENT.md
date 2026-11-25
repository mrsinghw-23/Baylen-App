# AT-HOME BEAUTY — Implementation Assessment

Assessment date: 2026-09-03. Scope: Baylen Flutter app + Zoho Catalyst `baylen-api`.

## Salon Reuse Refactor (2026-09-03)

Home Service is a **fulfillment mode** on existing salon catalog — not a separate service catalog.

### Salon logic/APIs reused

| Concern | Salon source | At-home usage |
| --- | --- | --- |
| Nearby outlets | `salon-engine.loadNearbyOutletMatches`, `filterOutletsByLocation`, `haversineKm` | `checkServiceability` eligible outlets |
| Outlet validation | `salon-engine.loadActiveOutlet` | Slots, quote, booking |
| Service listing | `salon-engine.loadOutletServiceOffers`, `groupServiceOffers` with `is_at_home=true` | `listAtHomeServices`; Flutter calls `/v1/salon/services?is_at_home=true` |
| Slot generation | `salon-engine.generateDaySlots`, `parseClock`, `isoDate` | `generateAtHomeSlots` (provider-aware overlay) |
| Customer location | Flutter `LocationService` (same as Salon tab) | `HomeServiceScreen`, booking address step |

### Removed duplicate catalog endpoints

- `GET /v1/at-home-beauty/categories` — removed; UI uses static beauty chips → `service_type` filter
- `GET /v1/at-home-beauty/outlets` — removed; Flutter uses `/v1/salon/outlets`
- `GET /v1/at-home-beauty/services` — removed; Flutter uses `/v1/salon/services?is_at_home=true`

### Kept under `/v1/at-home-beauty/*`

Serviceability, provider slots, quote, bookings, cancel/reschedule, confirm-payment, tracking, addons.

---

Foundation delivered in this branch:

| Layer | Status |
| --- | --- |
| Backend APIs | `/v1/at-home-beauty/*` — serviceability, catalog, slots, quote, bookings, cancel/reschedule, tracking |
| FSM engine | `at-home-beauty-engine.js`, `at-home-beauty-fsm.js`, provider GPS cache |
| Customer UI | `HomeServiceScreen` hub + `AtHomeBeautyBookingScreen` flow; Technician Portal removed |
| Tests | 203 backend tests passing (`at-home-beauty.test.js` included) |
| Schema | `provision-at-home-beauty-schema.js` — creates `Beauty_Service_Zones`, `Beauty_Service_Addons`, extends `Service_Jobs` |

**Still requires ops/data before live bookings:** deploy `baylen-api`, seed zones + mark `Salon_Services.is_at_home`, configure providers, online payment UI (MANUAL works in dev).

---

## Live FSM (2026-09-03)

End-to-end home service lifecycle is server-driven on `Service_Jobs`:

| Stage | Backend | Customer UI | Provider UI |
| --- | --- | --- | --- |
| Book + pay | `createBooking` → `confirmPaidBooking` → `autoDispatchJob` | `AtHomeBeautyBookingScreen` | — |
| Assign / accept | `Job_Dispatch`, status `ASSIGNED` → `ACCEPTED` | Friendly status on `HomeServiceScreen` | `ProviderScreen` accept |
| Start travel | `EN_ROUTE` only after `ACCEPTED`; GPS pings gated | Live map hidden until `EN_ROUTE` | Real `geolocator` stream → `/v1/jobs/location` |
| Live tracking | Cache (`beauty_provider_loc:{jobId}`) + `Live_Locations` | `ServiceTrackingScreen` polls `/v1/at-home-beauty/bookings/tracking` | — |
| Arrival OTP | Issued on `ARRIVED`; verified via `/v1/jobs/verify-otp` | 6-digit code card | Verify before `STARTED` |
| Add-on approval | Cache request + customer `/extra-services/respond` | Approve/decline card | Request add-on |
| Complete + review | `COMPLETED` + `/v1/reviews` (`reference_type: JOB`) | Rate service button | Proof upload |

FSM transitions enforced in `at-home-beauty-fsm.js` + `dispatch.js` (`assertProviderTransition`). ETA/distance uses haversine estimate (`geo-routing.js`) — no simulated marker movement.

---

| Area | Evidence |
| --- | --- |
| Auth & session | `lib/auth/auth_service.dart`, `backend/functions/baylen-api/lib/session.js`, hosted Catalyst login |
| Location (GPS + geocode) | `lib/services/location_service.dart` — high-accuracy GPS, Google/Nominatim reverse geocode, permission gates |
| Delivery coordinate resolution | `lib/services/delivery_location_service.dart` — saved address first, then GPS |
| FSM dispatch & tracking APIs | `backend/functions/baylen-api/routes/dispatch.js` — dispatch, accept, status, location, proof, customer list/tracking |
| Provider portal (internal) | `lib/screens/provider_screen.dart`, `lib/api/provider_api.dart` — job lifecycle + GPS ping |
| Admin FSM ops | `backend/functions/baylen-api/routes/admin.js` — service jobs list, providers, admin dispatch |
| Payments foundation (JOB ref) | `backend/functions/baylen-api/routes/payments.js` — `reference_type: JOB` supported |
| Salon catalog & outlets | `backend/functions/baylen-api/routes/salon.js`, `lib/api/catalyst_api.dart` — outlets, services, slots |
| Data Store tables (FSM) | `Service_Jobs`, `Job_Items`, `Job_Dispatch`, `Job_Timeline`, `Live_Locations`, `Providers`, `Provider_Services`, `Service_Areas` documented in `docs/catalyst-console-configuration.md` |
| Pincode serviceability (e-commerce) | `backend/functions/baylen-api/lib/pincode.js`, `Serviceable_Pincodes` |
| Navigation slot | `lib/shell/main_shell.dart` index 3 → `HomeServiceScreen` |
| Account recovery (home jobs) | `backend/functions/baylen-api/lib/account-recover.js` |

## PARTIALLY IMPLEMENTED

| Area | Gap |
| --- | --- |
| Customer At-Home UI | `lib/screens/home_service_screen.dart` lists jobs but uses placeholder map, hardcoded 4-step cards, exposes "Technician Portal" |
| Live tracking UI | `lib/screens/service_tracking_screen.dart` — fake map painter, raw FSM status codes (`EN_ROUTE`, `FSM status`) |
| Service catalog for at-home | `Salon_Services` + `HOME_SERVICE` category type exist; no dedicated at-home filter/booking API |
| Serviceability | Admin pincode regions exist; no customer-facing at-home beauty serviceability (lat/lng → eligible outlets) |
| Booking creation | Salon `Appointments` flow is in-salon only; **no API creates `Service_Jobs` from customer booking** |
| Payment → dispatch hook | JOB payments update `payment_status` but do not auto-confirm job or trigger dispatch |
| Maps | `lib/services/maps_service.dart` only opens external URLs; no in-app map with real coordinates |
| Provider GPS | Writes to `Live_Locations` Data Store; Cache layer for latest position not used |
| Multi-city | `salon-engine.js` has city aliases; no hardcoded Ranchi in backend, but provider screen has demo Mumbai GPS |

## MISSING

| Area | Required for MVP |
| --- | --- |
| Customer booking flow | category → service → address → slot → quote → pay → confirm |
| At-home beauty serviceability API | location → city/pincode/zone → eligible outlets & services |
| Server-side booking state machine | REQUESTED → CONFIRMED → ASSIGNED → … with customer-friendly labels |
| `provision-at-home-beauty-schema.js` | Extend tables + optional zone seed |
| Beauty-only categories API | Hair, Beauty, Makeup, Nails, Facial/Skin, Hair Care |
| Cancel/reschedule rules | Server-controlled |
| Flutter booking screens | Full flow wired to Catalyst |
| Backend tests for at-home module | Unit tests for engine + FSM |
| Post-payment auto-dispatch | End-to-end assign after MANUAL/verified payment |

## INCORRECT

| Issue | Location | Fix |
| --- | --- | --- |
| "Technician Portal" on customer screen | `home_service_screen.dart` | Remove from customer UI; provider entry stays separate |
| Fake ETA `04:10` and grid map | `home_service_screen.dart`, `service_tracking_screen.dart` | Real location + tracking data only |
| Internal FSM labels shown to customers | `service_tracking_screen.dart` | Customer-friendly status copy |
| Bottom nav "Home Service" | `main_shell.dart` | Rename to "At-Home Beauty" |
| Generic repair icons/copy | `home_service_screen.dart` | Beauty-specific copy |

## NEEDS REFACTOR

| Area | Recommendation |
| --- | --- |
| `HomeServiceScreen` | Split into hub (map, categories, outlets, active bookings) + navigate to booking flow |
| Status mapping | Centralize in `lib/utils/beauty_status_labels.dart` + backend `customerStatusLabel()` |
| Dispatch location writes | Add Cache latest-position alongside `Live_Locations` for fast reads |
| `Service_Jobs` schema | Add visit lat/lng, pincode, outlet_id, booking_number, payment_status columns |

## Architecture Decision (this implementation)

- **Extend** existing `Service_Jobs` / `Salon_Services` / `Providers` rather than parallel booking tables.
- Add `Beauty_Service_Zones` for multi-city at-home serviceability (city + optional pincode prefix + radius).
- New routes under `/v1/at-home-beauty/*` with engine in `lib/at-home-beauty-engine.js`.
- Flutter hub replaces placeholder UI; booking flow in dedicated screen(s).
- Dev seed data only in provision script (`--seed` flag).

## MVP End-to-End Target

```
Location permission → serviceability check → pick category/service/outlet
→ address + slot → server quote → create booking (Service_Jobs)
→ payment (MANUAL intent) → confirm → auto-dispatch → provider accept/en-route
→ customer live tracking (post-assignment only) → complete
```
