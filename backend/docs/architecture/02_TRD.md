# Baylen App — Technical Requirements Document (TRD)
**Version:** 1.0 | **Date:** 2026-09-09 | **Status:** Approved for Implementation

---

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Flutter Mobile App                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌───────────────────┐  │
│  │ Customer │ │   Pro    │ │   Delivery   │ │      Admin        │  │
│  │  Shell   │ │  Shell   │ │  Partner     │ │    (Admin Screen) │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘ └────────┬──────────┘  │
└───────┼────────────┼──────────────┼──────────────────┼─────────────┘
        │            │              │                  │
        └────────────┴──────────────┴──────────────────┘
                             │  HTTPS REST API
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Zoho Catalyst Backend                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              baylen-api  (Advanced I/O Function)            │   │
│  │                                                             │   │
│  │  Express Router → Route Handlers → Lib Engines             │   │
│  │                                                             │   │
│  │  Engines:                                                   │   │
│  │  • professional-dispatch-engine.js  (dispatch)              │   │
│  │  • professional-job-engine.js        (job creation/FSM)     │   │
│  │  • professional-job-fsm.js           (state machine)        │   │
│  │  • professional-location-engine.js   (GPS + tracking)       │   │
│  │  • professional-finance-engine.js    (earnings)             │   │
│  │  • at-home-beauty-engine.js          (booking creation)     │   │
│  │  • checkout-engine.js                (cart → order)         │   │
│  │  • fulfillment-engine.js             (order fulfillment)    │   │
│  │  • delivery-partner-kyc-engine.js    (KYC workflow)         │   │
│  │  • geo-routing.js                    (routing/ETA)          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               Catalyst Data Store (ZCQL)                    │   │
│  │   40+ tables — see Database Schema doc                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Catalyst File Store   │   Catalyst Cache   │  Cron Jobs    │   │
│  │  (KYC docs, proof)     │   (GPS cache, OTP) │  (low stock)  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               External Integrations                         │   │
│  │  • Zoho SalesIQ / WhatsApp API  (notifications)             │   │
│  │  • Razorpay                     (payments)                  │   │
│  │  • Zoho Books                   (invoicing)                 │   │
│  │  • Zoho Workdrive               (backup storage)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 (Catalyst Advanced I/O Function) |
| Framework | Express.js |
| Database | Zoho Catalyst Data Store (relational, ZCQL queries) |
| File Storage | Zoho Catalyst File Store (KYC documents, proof photos) |
| Cache | Zoho Catalyst Cache (GPS, OTP, sessions) |
| Cron Jobs | Catalyst Cron (low-stock alerts, dispatch sweep, offer expiry) |
| Payments | Razorpay (webhook-driven) |
| Notifications | Zoho SalesIQ WhatsApp API + in-app `Partner_Notifications` table |
| Backup | Zoho WorkDrive |
| Logging | `console.log` → Catalyst Logs viewer |

---

## 3. Frontend Technology Stack

| Layer | Technology |
|---|---|
| Framework | Flutter 3.x |
| State Management | ChangeNotifier + ListenableBuilder |
| Navigation | Flutter Navigator 2.0 (material route stack) |
| HTTP Client | `http` package + `catalyst_api.dart` wrapper |
| Maps | `flutter_map` + OpenStreetMap tiles |
| Location | `geolocator` package |
| Image Handling | `image_picker` + File Store API |
| Push Notifications | Firebase FCM (via `Devices` table for token storage) |
| Chat/Support | Zoho SalesIQ Mobilisten (on-demand, not auto-init) |

---

## 4. API Architecture

### 4.1 Base URL
```
https://baylen-api.zohocloud.com/server/baylen-api/api/
```

### 4.2 Authentication
All private routes require `Authorization: Bearer <catalyst_jwt>` header.

- Customer routes: Catalyst ZAID token (sign-in via Catalyst Authentication).
- Professional/Rider routes: Custom JWT issued by `delivery-partner-auth.js` after OTP verification.
- Admin routes: Catalyst ZAID token + admin role check.

### 4.3 Route Groups

| Prefix | Module | Auth |
|---|---|---|
| `/auth` | OTP challenge, verify, refresh | Public / Token |
| `/account` | Profile, addresses, device tokens | Customer JWT |
| `/catalog` | Products, categories, search | Public / Customer JWT |
| `/cart` | Cart CRUD | Customer JWT |
| `/checkout` | Checkout, payment initiation | Customer JWT |
| `/payments` | Payment webhooks, status | Webhook / Customer JWT |
| `/salon` | Outlet browse, appointment booking | Customer JWT |
| `/slots` | Appointment slot availability | Customer JWT |
| `/home` | Home screen data, banners | Customer JWT |
| `/search` | Full-text product/service search | Public / Customer JWT |
| `/at-home-beauty` | Home service booking, rescheduling | Customer JWT |
| `/delivery-partner` | DP registration, KYC, profile | DP JWT |
| `/professional-jobs` | Job list, accept, reject, travel, GPS, complete | DP JWT |
| `/dispatch` | Admin dispatch, assignment | Admin / DP JWT |
| `/rider` | Rider-specific routes (legacy) | DP JWT |
| `/fulfillment` | Order fulfillment, picker | Admin / Outlet JWT |
| `/picker` | Picker routes | Outlet JWT |
| `/inventory` | Inventory ops, adjustments | Admin JWT |
| `/imports` | CSV import pipelines | Admin JWT |
| `/admin` | Admin CRUD (outlets, services, orders) | Admin JWT |
| `/notifications` | Partner/customer notifications | User/DP JWT |
| `/low-stock` | Low stock alerts admin | Admin JWT |
| `/serviceability` | Pincode serviceability admin | Admin JWT |
| `/order-integrations` | Webhook order status integrations | Webhook |

---

## 5. Catalyst Functions Architecture

### 5.1 baylen-api (Advanced I/O)
The primary backend function. It handles all REST API requests. Key characteristics:
- Single Express app, mounted at the Catalyst API gateway.
- Cold-start mitigated by keeping function warm (Catalyst keeps the last execution context for ~10 minutes).
- Each request gets `req.catalystApp` injected by Catalyst middleware.

### 5.2 Cron Jobs (Catalyst Cron)
| Cron Name | Schedule | Purpose |
|---|---|---|
| `dispatch-sweep` | Every 2 minutes | Re-dispatch `ASSIGNMENT_PENDING` jobs that haven't been picked up |
| `offer-expiry` | Every 5 minutes | Expire partner offers after TTL; trigger reassignment |
| `low-stock-check` | Daily 6:00 AM | Scan inventory, create low-stock alerts |
| `backup-pipeline` | Daily 2:00 AM | Export Data Store tables → Workdrive backup |

---

## 6. Data Store Design Principles

- Every table has `ROWID` as the primary key (Catalyst-managed, auto-increment).
- All timestamps use ISO string format `YYYY-MM-DD HH:MM:SS`.
- Boolean fields stored as `true`/`false` strings (Catalyst Data Store limitation).
- Foreign keys are stored as `_row_id` fields (integer references to `ROWID`).
- JSON blobs stored in `_json` fields with max 4000-character limit.
- Idempotency keys prevent duplicate creation on retries.

---

## 7. Routing & Geo Engine

### 7.1 Current Implementation
- `geo-routing.js`: Haversine straight-line distance with speed-based ETA.
- No external map API dependency (fully offline capable).
- `buildRouteSummary(lat1, lng1, lat2, lng2)` returns `{ distance_km, eta_minutes, eta_label }`.
- Routing source tagged as `"haversine"` in responses.

### 7.2 Future Enhancement
- Google Maps Distance Matrix API or OSRM for turn-by-turn routing.
- Required for: accurate ETA in dense urban traffic.

---

## 8. GPS & Location Cache

- Professional publishes GPS coordinates via `POST /professional-jobs/:id/location`.
- Cache key: `"prof_loc:{professional_job_id}"` in Catalyst Cache Segment `"location_cache"`.
- Cache TTL: 5 minutes (after which location is marked `STALE`).
- Coordinates validated: age < 30 seconds, accuracy < 500m, no future timestamps.
- Customer reads location via `GET /professional-jobs/:id/customer-tracking`.

---

## 9. Job Dispatch Engine

### 9.1 Eligibility Filters (all must pass)
1. Partner status = `active` AND `operational = true`.
2. Online status = `ONLINE_AVAILABLE`.
3. Not on the exclusion list (previously rejected).
4. Outlet authorization (if job has an outlet, partner must belong to that outlet).
5. Service skill match (for HOME_SERVICE).
6. Service zone match (city/pincode).
7. Location eligibility (state/district/pincode).
8. Workload ≤ 3 concurrent assigned jobs.
9. No schedule conflict with existing accepted jobs.
10. For PRODUCT_DELIVERY: delivery pincode must be in `Serviceable_Pincodes`.

### 9.2 Ranking Weights
```javascript
skill_match:         100
outlet_authorization: 80
service_zone:         70
working_hours_fit:    60
workload:             50
distance:             40
rating:               20
priority:             10
```

### 9.3 Assignment Strategy
- All eligible partners are notified simultaneously (broadcast model).
- First partner to `ACCEPT` wins the job.
- Job stores the `offer_expires_at` timestamp (default TTL: 15 minutes).
- If offer expires: `REASSIGNMENT_REQUIRED` → re-dispatch.

---

## 10. Payment Architecture

### 10.1 Online Payment
- Razorpay order created at checkout.
- Payment collected on device (Razorpay SDK).
- Webhook `POST /payments/razorpay-webhook` verifies signature and updates order.
- Order status: `PLACED` → `CONFIRMED` (after payment verification).

### 10.2 COD (Cash on Delivery)
- Order placed with `payment_method = COD`.
- Professional collects cash at delivery/service completion.
- Earning status: `COD_PENDING` → `AVAILABLE` after admin confirmation.

---

## 11. WhatsApp Notification Architecture

- Template-based WhatsApp messages via Zoho SalesIQ WhatsApp API.
- All notifications recorded in `WhatsApp_Notifications` table for audit.
- Retry logic: up to 3 attempts in `notifyPartnerWithRetry`.
- Template names: `professional_job_assigned`, `professional_job_cancelled`, `booking_confirmed`, `order_shipped`.

---

## 12. Security Architecture

- All HTTPS (Catalyst enforces TLS).
- JWT tokens validated on every request via session middleware.
- Role guard middleware (`role-guard-middleware.js`) checks token role vs route requirements.
- Admin endpoints check `admin` role claim in token.
- Phone numbers masked (`••••1234`) in any cross-role API response.
- File uploads: only pre-signed URLs issued; files stored in private File Store folders.
- SQL injection prevention: all ZCQL values passed through `asId()` / `sqlString()` helpers.

---

## 13. Error Handling Standards

All API errors return:
```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "MACHINE_READABLE_CODE",
  "status": 4xx | 5xx
}
```

Standard error codes:
- `VALIDATION_ERROR` (422)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `CONFLICT` / `INVALID_STATUS_TRANSITION` (409)
- `INTERNAL_ERROR` (500)
- `KYC_REQUIRED` (403)
- `TRACKING_NOT_ALLOWED` (409)
- `JOB_NOT_FOUND` (404)
- `NO_ELIGIBLE_PARTNER` (422)

---

## 14. Environment Variables

| Variable | Purpose |
|---|---|
| `CATALYST_PROJECT_ID` | Catalyst project identifier |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payment gateway |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification |
| `WHATSAPP_API_TOKEN` | SalesIQ WhatsApp token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business number |
| `PROFESSIONAL_OFFER_TTL_MINUTES` | Job offer timeout (default: 15) |
| `PROFESSIONAL_COMMISSION_RATE` | Default commission (default: 0.20) |
| `PROFESSIONAL_LOCATION_STALE_SECONDS` | GPS staleness threshold (default: 300) |
| `LOCATION_MAX_ACCURACY_METERS` | GPS accuracy gate (default: 500) |
| `SALESIQ_APP_KEY` / `SALESIQ_ACCESS_KEY` | SalesIQ SDK credentials |
