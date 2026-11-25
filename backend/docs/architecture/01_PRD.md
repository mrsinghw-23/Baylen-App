# Baylen App — Product Requirements Document (PRD)
**Version:** 1.0 | **Date:** 2026-09-09 | **Status:** Approved for Implementation

---

## 1. Executive Summary

Baylen is a multi-vertical home services and product-delivery platform serving customers in India. It operates on a **Zoho Catalyst** backend and a **Flutter** mobile app. The platform connects:

- **Customers** — who book home beauty services, salon appointments, or purchase products.
- **Professional Partners (Employees)** — verified beauty/service professionals who travel to the customer's location.
- **Delivery Partners (Riders)** — who pick up products from a fulfillment store and deliver to the customer's address.
- **Outlets (Salons)** — physical locations that serve walk-in customers and act as fulfillment hubs.
- **Admins** — who manage the catalog, workforce, KYC approvals, and operations.

The system is designed as a **real FSM-driven dispatch platform**, not a demo. Every job flows through an enforced state machine with audit trails, real GPS, live tracking, earnings settlement, and WhatsApp notifications.

---

## 2. User Personas

### 2.1 Customer (End User)
- Browsing services and products on the home screen.
- Booking at-home beauty services (haircut, facial, waxing, etc.) for a selected date/time.
- Placing product orders (cosmetics, personal care) for delivery.
- Tracking professional en route in real time.
- Making payments (Razorpay/UPI/COD).
- Receiving WhatsApp notifications on booking confirmation, partner assignment, ETA, and completion.
- Leaving reviews.

### 2.2 Professional Partner (Employee/Pro)
- Registered via phone OTP, undergoes KYC (identity, address, bank, photo).
- Sets availability (online/offline toggle) and receives job offers.
- Accepts/rejects job offers within a TTL window (default: 15 minutes).
- Navigates to the customer location using in-app map.
- Verifies arrival via OTP presented by the customer.
- Executes service, uploads proof (photo), marks completion.
- Views earnings, pending/available balance, commission deductions.
- Receives in-app and WhatsApp notifications for every lifecycle event.

### 2.3 Delivery Partner (Rider)
- Separate onboarding from Professional Partners.
- Picks up packed orders from the fulfillment outlet.
- Delivers to the customer's address.
- Verifies delivery with a delivery OTP.
- Earns per delivery.

### 2.4 Outlet / Salon Manager
- Manages staff, service offerings, appointment slots.
- Views assigned jobs and walk-in appointments.
- Can create/configure at-home service offerings linked to their outlet.

### 2.5 Admin
- Full CRUD on catalog (products, services, categories, outlets).
- KYC review and approval/rejection.
- Order management and refunds.
- Dispatch oversight (manual override, re-assign).
- Inventory management, CSV imports.
- Serviceability pincode configuration.
- Media asset management.

---

## 3. Core Product Verticals

### 3.1 Home Beauty Services (At-Home)
Customers book professional beauty services at their location.

**Booking Flow:**
1. Customer opens Home Services tab → selects a category (Hair, Skin, Nails, etc.).
2. Selects a service → selects date/time slot → enters address → reviews cart.
3. Pays online or selects COD → booking is confirmed.
4. Backend creates a `Service_Job`, then creates a `Professional_Job` and triggers dispatch.
5. Professional receives notification, accepts job.
6. Customer sees professional en route on a live map.
7. Professional arrives → customer shows OTP → service starts.
8. Service completes → professional uploads proof → earnings settled.
9. Customer receives invoice and can leave a review.

**Cancellation:**
- Customer can cancel before professional starts travel. Fee may apply after assignment.
- Professional can reject/withdraw (triggers reassignment).

### 3.2 Product Delivery
Customers order cosmetics/personal care products for home delivery.

**Order Flow:**
1. Customer browses Catalog → adds to cart → proceeds to checkout.
2. Applies coupons/promo codes → pays → order confirmed.
3. Admin confirms and fulfillment store (outlet) packs the order.
4. Backend creates a `Professional_Job` (type: PRODUCT_DELIVERY) and triggers dispatch.
5. Delivery partner picks up from outlet → delivers to customer.
6. Customer verifies delivery via OTP.
7. Earnings settled for the delivery partner.

### 3.3 Salon Booking (Walk-In / In-Salon)
Customers book in-salon appointments at nearby outlets.

**Booking Flow:**
1. Customer browses nearby salons → selects outlet → selects service and staff.
2. Selects time slot → confirms booking.
3. Booking status: PENDING → CONFIRMED → COMPLETED.
4. Customer arrives at salon for service.

### 3.4 Shop / Catalog
Product browsing by category, brand, or search. Supports:
- Product detail with variants (size, shade).
- Inventory-aware availability (out-of-stock gating).
- Wishlist, cart, checkout.
- Coupon application.

---

## 4. Feature Requirements

### 4.1 Authentication & Identity

| Feature | Customer | Professional | Rider | Admin |
|---|---|---|---|---|
| OTP Login (phone) | ✅ | ✅ | ✅ | — |
| Email/Password Login | ✅ (Zoho ZAID) | ✅ (Zoho ZAID) | — | ✅ |
| Forgot Password | ✅ | ✅ | — | — |
| Social Login | ✅ | — | — | — |
| KYC Required Before Work | — | ✅ | ✅ | — |
| Role-based JWT Session | ✅ | ✅ | ✅ | ✅ |

### 4.2 KYC (Know Your Customer) for Professionals
Employees can register from **any location in India**. KYC is mandatory before any job can be received.

**Registration flow:**
`Employee Login → Registration → Personal Details → Address → State → District → PIN Code → Service Zone → Gender → Qualification → Profile Photo → KYC Documents → Submit → Admin Verification → Approved / Rejected`

- **Section 1 — Personal Details:** First name, last name, DOB, gender, phone, email, qualification.
- **Section 2 — Location:** Full address, state, district, city, PIN code, service zone (e.g. "Zone A" or "North Ranchi").
- **Section 3 — Identity Documents:** PAN card (mandatory), Aadhaar (optional).
- **Section 4 — Bank Details:** Account number, IFSC, account holder name.
- **Section 5 — Profile Photo:** Selfie taken in-app during registration.

**KYC Status Flow:**
`PENDING → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED`

Professionals cannot go online or receive jobs until KYC status is `APPROVED` and `operational = true`.

**Employee profile photo** is stored in Catalyst File Store and fetched **dynamically** on every surface where it appears:
- Employee Dashboard (partner app)
- Employee Profile screen
- Job assignment notification / job detail
- Customer-facing "Your professional" info card (limited, privacy-safe view)
- Admin panel KYC review

No hardcoded employee images are ever used.

### 4.3 Job Lifecycle (FSM)
See Section 5 (FSM Workflow) for the complete state machine. High-level:
- **Home Service:** CREATED → ASSIGNMENT_PENDING → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED → OTP_VERIFIED → STARTED → IN_PROGRESS → COMPLETED
- **Product Delivery:** CREATED → ASSIGNMENT_PENDING → ASSIGNED → ACCEPTED → GOING_TO_PICKUP → ARRIVED_PICKUP → PICKUP_VERIFIED → PICKED_UP → EN_ROUTE → ARRIVED → DELIVERY_VERIFIED → DELIVERED → COMPLETED

### 4.4 Real-Time Tracking
- Professional broadcasts GPS location while `EN_ROUTE` (for home service) or `GOING_TO_PICKUP / EN_ROUTE` (for product delivery).
- Customer sees the professional's position on an in-app map.
- Route, distance, and ETA computed using Haversine formula (local routing engine).
- Location cache keyed by `professional_job_id` in Catalyst Cache with 5-minute TTL.
- Location is hidden once professional arrives (privacy after arrival).

### 4.5 Notifications
- **In-app inbox:** `Partner_Notifications` table, read/unread state.
- **WhatsApp:** Via Zoho SalesIQ / WhatsApp Business API, for critical events only.
- **Customer notifications:** `Notifications` table and real-time SSE/polling.
- Events: Booking confirmed, professional assigned, en-route, arrived, service started, completed, cancelled, payment received.

### 4.6 Earnings & Finance
- Professional earns `gross_amount × (1 - commission_rate)` per completed job.
- Default commission: 20% (configurable).
- Earnings status: `PENDING → AVAILABLE → WITHDRAWN`.
- Invoices generated per job in `Professional_Invoices` table.
- Dashboard shows today's earnings, weekly total, pending, available balance.

### 4.7 Dispatch Engine
- Auto-triggered after job creation.
- Evaluates all `ONLINE_AVAILABLE` partners against 8 ranking factors.
- First eligible candidate receives assignment.
- If rejected (by partner or timeout), `REASSIGNMENT_REQUIRED` → re-dispatch.
- Maximum 3 concurrent assigned jobs per partner, 12 daily jobs cap.

### 4.8 Inventory & Catalog
- Products with variants, categories, brands.
- Stock tracked in `Inventory` table (per outlet/warehouse).
- Low-stock alerts via cron job.
- CSV bulk import pipeline for catalog and inventory.
- Availability gates checkout (out-of-stock blocks add-to-cart).

### 4.9 Cancellation & Rescheduling
- Customer can cancel: booking before `STARTED`, order before `PICKED_UP`.
- Cancellation fee: configurable by state in FSM.
- Rescheduling: new date/time selection, re-confirmation, partner re-notification.
- Professional can reject job → triggers `REASSIGNMENT_REQUIRED`.

### 4.10 Reviews
- Customer can review after service/order is `COMPLETED`.
- Rating (1–5 stars) + text review stored in `Reviews` table.
- Reviews shown on outlet, service, and professional profile pages.

---

## 5. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Response time | API p95 < 500ms |
| Availability | 99.5% uptime (Catalyst SLA) |
| Security | JWT auth on all private endpoints; RBAC enforced |
| Data privacy | Phone numbers masked in partner views |
| Scalability | Handle 500 concurrent users (Catalyst auto-scales) |
| Audit trail | Every job state change logged in `Job_Status_History` |
| Idempotency | All job creation endpoints use idempotency keys |

---

## 6. Out of Scope (v1.0)

- In-app calling between professional and customer
- Subscription plans
- Referral program
- Vendor self-onboarding portal

> **Note:** The system supports employees and customers **across all of India** from day one. The location model is `Country → State → District → City → PIN Code → Service Zone`. There is no single-city restriction.

---

## 7. Success Metrics

| Metric | Target |
|---|---|
| Booking-to-assignment time | < 5 minutes |
| Job acceptance rate | > 80% |
| On-time service delivery | > 90% |
| Customer satisfaction score | > 4.2 / 5 |
| Dispatch failure rate (no partner found) | < 5% |
| Payment success rate | > 95% |
