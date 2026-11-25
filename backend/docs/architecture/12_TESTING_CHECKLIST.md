# Baylen App — Testing & Production Checklist
**Version:** 1.1 | **Updated:** 2026-09-09 | **Environment tracked:** Development

---

## Status legend

| Mark | Meaning |
|------|---------|
| ✅ | **Verified** — unit test pass, Dev Catalyst API smoke, or confirmed on device |
| 🔶 | **Partial** — code deployed on Dev; manual/device step not finished |
| ⏳ | **Pending** — not verified yet |

**Automation references**
- Unit tests: `backend/functions/baylen-api` → **541 passing** (2026-09-09)
- Dev E2E smoke: `backend/scripts/launch-e2e-smoke.js` → **12/12** → `launch-e2e-smoke-results.json`
- Device staging: `backend/scripts/cleanup-partner-dev.js` + `device-check-partner-offer.js --name "Priya Singh"`

---

## Progress snapshot

| Area | ✅ | 🔶 | ⏳ |
|------|----|----|-----|
| Module 1 Auth & KYC | 8 unit | 1 integration, 2 device | 2 integration, 3 device |
| Module 2 Dispatch | 10 unit | 3 integration | 2 integration |
| Module 3 Job FSM | 4 unit | 2 integration | 2 integration, 5 device |
| Module 4 Location | 7 unit | 3 integration | 4 device |
| Module 5 Finance | 6 unit | 2 integration | 2 integration |
| Module 6 Notifications | 3 integration | 1 device | 1 integration, 2 device |
| Module 7 Catalog | 4 unit | 0 | 4 device |
| Production readiness | 2 Dev | 0 | 22+ items |
| E2E launch smoke | 12 API | 0 | 12 device mirror |

---

## Module-by-Module Testing Approach

For each module: **Build → Connect Catalyst → Test with real data → Fix → Verify end-to-end → Mark LIVE → Next module**

---

## Module 1: Authentication & KYC

### Unit Tests (`test/delivery-partner-registration.test.js`, `delivery-partner-kyc.test.js`, `whatsapp-otp.test.js`)
- [x] ✅ OTP request creates challenge in `Auth_Otp_Challenges`
- [x] ✅ OTP verify returns JWT on success
- [x] ✅ Wrong OTP increments `attempt_count`
- [x] ✅ 5 failed attempts locks challenge
- [x] ✅ Expired challenge rejects verify
- [x] ✅ KYC submit creates `Delivery_Partner_KYC` row
- [x] ✅ KYC approval updates `Delivery_Partners.status = active`
- [x] ✅ KYC rejection sends partner notification

### Integration Tests (Development Catalyst)
- [ ] 🔶 Register → JWT → KYC → documents → admin approve → go online *(Priya Singh registered; admin approve not formal)*
- [x] ✅ `isPartnerOperational()` returns false before approval
- [x] ✅ Partner cannot go online with `status = pending_kyc` / `kyc_submitted`

### Device Tests (real Android — partner: **Priya Singh** / `8825391754`)
- [x] ✅ Role picker screen fits on-screen (no overflow)
- [ ] 🔶 OTP received on actual phone *(WhatsApp OTP ready on Dev; Priya uses password login)*
- [ ] 🔶 KYC form validates all required fields *(profile saved; full flow not re-walked)*
- [ ] 🔶 Document photo upload completes successfully
- [ ] 🔶 Profile photo visible on dashboard after KYC *(backend fix deployed; confirm on device)*

---

## Module 2: Dispatch Engine

### Unit Tests (`test/professional-dispatch.test.js`, `dispatch-all-india.test.js`)
- [x] ✅ `evaluatePartnerEligibility`: offline partner → PARTNER_OFFLINE
- [x] ✅ `evaluatePartnerEligibility`: wrong outlet → OUTLET_UNAUTHORIZED
- [x] ✅ `evaluatePartnerEligibility`: workload at max → WORKLOAD_LIMIT
- [x] ✅ `evaluatePartnerEligibility`: schedule conflict → SCHEDULE_CONFLICT
- [x] ✅ `rankEligibleCandidates`: higher score wins
- [x] ✅ `rankEligibleCandidates`: distance tie-break
- [x] ✅ `dispatchProfessionalJob`: no online partners → NO_ELIGIBLE_PARTNER
- [x] ✅ `assignJobToPartner`: idempotent (same partner, same job = no duplicate)
- [x] ✅ Pre-linked partner assignment: eligible → assigned
- [x] ✅ Pre-linked partner assignment: ineligible → PRELINKED_PARTNER_INELIGIBLE

### Integration Tests (Development Catalyst)
- [x] ✅ Create home service booking → `Professional_Job` auto-created *(PP004 fixtures + smoke)*
- [x] ✅ Professional online → `Partner_Notification` created *(smoke step 4)*
- [x] ✅ First accept wins; second accept gets conflict *(offer engine tests)*
- [ ] ⏳ Offer expires → job returns to `ASSIGNMENT_PENDING` *(needs offer-expiry cron)*
- [ ] 🔶 Admin manually assigns → notification sent *(API exists; admin UI not device-tested)*

---

## Module 3: Job Lifecycle (FSM)

### Unit Tests (`test/professional-job-engine.test.js`, `professional-job-lifecycle.test.js`)
- [x] ✅ Valid transitions allowed
- [x] ✅ Invalid transitions throw `INVALID_STATUS_TRANSITION (409)`
- [x] ✅ `createProfessionalJob`: idempotency key prevents duplicate
- [x] ✅ `appendStatusHistory`: every transition logged

### Integration Tests (Development Catalyst)
- [x] ✅ Full HOME_SERVICE flow: → COMPLETED via API *(launch-e2e-smoke steps 5–10)*
- [ ] 🔶 Full PRODUCT_DELIVERY flow: → DELIVERED → COMPLETED *(PP004 scripts; not full device)*
- [ ] 🔶 Cancel at each cancellable state *(unit coverage; not full Catalyst walk)*
- [x] ✅ Reassignment: reject → `ASSIGNMENT_PENDING` → new partner *(pp004-dev-smoke)*

### Device Tests
- [ ] ⏳ Accept job on partner app → customer app updates in real time
- [ ] ⏳ Start travel → customer map shows partner moving
- [ ] ⏳ Arrive → customer sees "Professional has arrived"
- [ ] ⏳ OTP verification → both apps update simultaneously
- [ ] ⏳ Service complete → customer notification + invoice

---

## Module 4: Real-Time Location Tracking

### Unit Tests (`test/professional-location.test.js`)
- [x] ✅ `validateCapturedAt`: rejects > 30s old
- [x] ✅ `validateCapturedAt`: rejects future timestamp
- [x] ✅ `validateAccuracy`: rejects > 500m
- [x] ✅ `canAcceptProfessionalLocationPing`: HOME_SERVICE only EN_ROUTE
- [x] ✅ `canAcceptProfessionalLocationPing`: PRODUCT_DELIVERY: GOING_TO_PICKUP | EN_ROUTE
- [x] ✅ Stale update ignored when cached timestamp is newer
- [x] ✅ `computeLocationStatus`: LIVE | STALE | UNAVAILABLE

### Integration Tests (Development Catalyst)
- [x] ✅ Partner publishes GPS → cache written → customer reads *(smoke step 7 — simulated coords)*
- [x] ✅ ETA calculation returns reasonable value *(geo-coords tests)*
- [x] ✅ Location hidden after ARRIVED *(smoke step 8 — UNAVAILABLE)*

### Device Tests
- [ ] ⏳ Start travel → customer tracking → pin moving *(real GPS)*
- [ ] ⏳ Partner arrives → tracking shows "Arrived"
- [ ] ⏳ Kill partner app mid-route → customer sees STALE within 5 minutes
- [ ] ⏳ GPS accuracy: reject inaccurate reading on device

---

## Module 5: Earnings & Finance

### Unit Tests (`test/professional-finance.test.js`, `professional-execution.test.js`)
- [x] ✅ `calculateEarningAmounts`: commission deducted correctly
- [x] ✅ `calculateEarningAmounts`: incentive/tip/adjustment applied
- [x] ✅ `settleProfessionalJobFinance`: idempotent (run twice = same result)
- [x] ✅ `findEarningByJob`: returns existing earning without creating new
- [x] ✅ `sumPartnerEarnings`: correct total across multiple jobs
- [x] ✅ `listPartnerEarningsHistory`: returns correct list

### Integration Tests (Development Catalyst)
- [x] ✅ Complete job → earning with correct `net_amount` *(smoke step 10)*
- [x] ✅ Complete same job twice → earning not duplicated
- [ ] 🔶 Dashboard today/week/total earnings on partner app *(API OK; Priya dashboard not confirmed)*
- [ ] 🔶 Pending vs Available reflects payment method *(COD vs online — API tested)*

---

## Module 6: Notifications

### Integration Tests (Development Catalyst)
- [x] ✅ Job assigned → `Partner_Notifications` row + readable via API
- [x] ✅ Job cancelled → notification sent to partner *(partner-notify tests)*
- [x] ✅ Unread count increments on new notification
- [ ] 🔶 Mark as read → unread count decrements *(API exists; auto-mark on open in app)*
- [x] ✅ WhatsApp audit row for critical events

### Device Tests
- [ ] 🔶 Partner receives in-app notification on assignment *(works but was flooded by Dev test jobs — cleanup script added)*
- [ ] ⏳ Notification tap navigates to correct job screen
- [ ] ⏳ Badge count on notifications tab
- [x] ✅ Notifications screen Retry crash fixed *(Flutter `scheduleLoad` — rebuild required)*

---

## Module 7: Product Catalog & Cart

### Unit Tests (`catalog-batch-availability.test.js`, `catalog-pagination.test.js`, `catalog-cart-module7.test.js`)
- [x] ✅ Out-of-stock product shows as unavailable
- [x] ✅ Pagination returns correct page/limit/total
- [x] ✅ Cart add → inventory reserved
- [x] ✅ Checkout: OOS item rejects order

### Device Tests
- [ ] ⏳ Browse catalog → add to cart
- [ ] ⏳ Apply coupon → discount in total
- [ ] ⏳ Checkout Razorpay → payment → order confirmed
- [ ] ⏳ Checkout COD → order without payment

---

## Production Readiness Checklist

### Backend — Development vs Production

| Item | Dev | Prod |
|------|-----|------|
| Env vars / WhatsApp OTP | ✅ | ⏳ |
| `baylen-api` deployed | ✅ | ⏳ (Console migrate; CLI 406) |
| Crons: dispatch-sweep, offer-expiry, low-stock | ⏳ | ⏳ |
| Test partner with approved KYC | 🔶 Priya (script-assisted) | ⏳ |
| Outlets with `is_at_home` services | ✅ | ⏳ verify |

### Backend (detail)
- [x] ✅ Dev environment variables + WhatsApp OTP configured
- [ ] ⏳ All environment variables set in **Production**
- [ ] ⏳ `RAZORPAY_WEBHOOK_SECRET` + Razorpay webhook registered
- [ ] ⏳ `DP_JWT_SECRET` set (min 32 chars)
- [ ] ⏳ `WHATSAPP_API_TOKEN` / sender configured for Production
- [ ] ⏳ `PROFESSIONAL_OFFER_TTL_MINUTES` (recommend: 15)
- [ ] ⏳ `PROFESSIONAL_COMMISSION_RATE` (recommend: 0.20)
- [ ] ⏳ Cron jobs scheduled (`dispatch-sweep`, `offer-expiry`, low-stock)
- [ ] 🔶 Test partner with approved KYC *(Dev: Priya Singh)*
- [x] ✅ At least one outlet with `is_at_home` services *(Dev seeded)*

### Database
- [x] ✅ All tables in **Development**
- [ ] ⏳ All tables in **Production**
- [ ] ⏳ `Professional_Jobs.idempotency_key` unique constraint in Production
- [x] ✅ `Auth_Otp_Challenges` accessible (Dev)
- [x] ✅ `Partner_Notifications` accessible (Dev)
- [x] ✅ `WhatsApp_Notifications` accessible (Dev)

### Flutter App
- [ ] 🔶 Debug build on physical device *(Priya login + dashboard partial)*
- [ ] ⏳ Release build tested on physical device
- [x] ✅ Dev API URL in `app_config.dart` → Development Catalyst
- [ ] ⏳ Production API URL for release builds
- [x] ✅ SalesIQ init on-demand only (no launch popup)
- [ ] ⏳ Firebase push / `google-services.json`
- [ ] ⏳ Play Store listing + privacy policy

---

## End-to-End Smoke Test (run before launch)

**Development API smoke** (`launch-e2e-smoke.js`): **12/12 ✅** (2026-09-09)

| # | Step | Dev API | Device (your checklist) |
|---|------|---------|-------------------------|
| 1 | Customer registers → books at-home beauty | ✅ booking exists | ⏳ |
| 2 | Admin approves KYC for test partner | 🔶 script `active` | ⏳ formal admin approve |
| 3 | Partner goes online | ✅ API | 🔶 toggle fixed — confirm on phone |
| 4 | Job dispatched → partner notification | ✅ | 🔶 1 clean notification after cleanup |
| 5 | Partner accepts job | ✅ API | ⏳ **Priya — Service → Upcoming → Accept** |
| 6 | Customer tracking → partner assigned | ✅ | ⏳ |
| 7 | Start travel → map shows location | ✅ cache coords | ⏳ real GPS |
| 8 | Arrive → customer notified | ✅ API | ⏳ |
| 9 | Customer OTP → service starts | ✅ API | ⏳ |
| 10 | Complete → earnings on dashboard | ✅ API | ⏳ |
| 11 | Customer "Service completed" notify | ✅ API | ⏳ |
| 12 | Admin: earning, invoice, status history | ✅ API | ⏳ Catalyst console verify |

### Quick device runbook (Priya Singh)

```powershell
cd backend
node scripts/cleanup-partner-dev.js --name "Priya Singh"
node scripts/device-check-partner-offer.js --name "Priya Singh"
flutter run
```

Then: **Service Professional → login → go online → Service → Upcoming → Accept → Start travel → …**

---

## Monitoring Checklist (post-launch)

- [ ] ⏳ Monitor Catalyst Logs for `[professional-dispatch] auto dispatch failed`
- [ ] ⏳ Daily: `ASSIGNMENT_PENDING` jobs older than 15 minutes
- [ ] ⏳ Weekly: `WhatsApp_Notifications` failure rate < 5%
- [ ] ⏳ Weekly: Partner rating average > 4.0
- [ ] ⏳ Razorpay payment success rate > 95%

---

## Recommended order (what to do next)

1. ⏳ **Device steps 3–5** — go online, accept PP004 home job (Priya)
2. ⏳ **Device steps 6–11** — two-phone tracking + OTP + complete + earnings
3. ⏳ **M7 customer app** — catalog, cart, checkout
4. ⏳ **Schedule Dev crons** — dispatch-sweep, offer-expiry
5. ⏳ **Admin KYC** — approve Priya via console (not script-only)
6. ⏳ **Production deploy** — Console migrate + `production-smoke.js`
