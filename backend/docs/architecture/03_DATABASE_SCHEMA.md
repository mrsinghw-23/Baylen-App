# Baylen App — Backend Database Schema
**Version:** 1.0 | **Date:** 2026-09-09 | **Source:** Audited from ZCQL queries in codebase

All tables use Catalyst Data Store. Every table has an implicit `ROWID` (primary key, auto-increment integer) and `CREATEDTIME` / `MODIFIEDTIME` (auto-managed by Catalyst).

---

## 1. Auth & Identity Tables

### 1.1 Auth_Otp_Challenges
OTP verification challenges for all login flows.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| phone | String(20) | Phone number |
| otp_hash | String(255) | Hashed OTP |
| purpose | String(30) | `LOGIN`, `REGISTER`, `RESET_PASSWORD` |
| attempt_count | Integer | Failed attempts |
| expires_at | DateTime | Challenge expiry |
| verified_at | DateTime | NULL until verified |
| verified | Boolean | |
| user_type | String(20) | `CUSTOMER`, `DELIVERY_PARTNER` |
| metadata_json | Text | Extra context |
| CREATEDTIME | DateTime | Auto |

### 1.2 Devices
FCM push token registry for users.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| user_id | String(40) | Catalyst ZAID |
| fcm_token | String(255) | |
| device_platform | String(10) | `android`, `ios` |
| app_version | String(20) | |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

---

## 2. User & Profile Tables

### 2.1 User_Profiles
Extended customer profile beyond Catalyst auth.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| user_id | String(40) | FK → Catalyst user ZAID |
| full_name | String(120) | |
| phone | String(20) | |
| date_of_birth | Date | |
| gender | String(10) | |
| profile_photo_url | String(500) | File store ref or URL |
| CREATEDTIME | DateTime | Auto |

### 2.2 Addresses
Saved delivery addresses for customers.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| user_id | String(40) | FK → Catalyst user |
| label | String(50) | `Home`, `Work`, etc. |
| line1 | String(200) | |
| line2 | String(200) | |
| city | String(80) | |
| state | String(80) | |
| postal_code | String(10) | |
| latitude | Float | |
| longitude | Float | |
| is_default | Boolean | |
| CREATEDTIME | DateTime | Auto |

---

## 3. Outlet & Service Tables

### 3.1 Outlets
Salon/fulfillment location master.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| name | String(150) | |
| address_line1 | String(200) | |
| address_line2 | String(200) | |
| city | String(80) | |
| state | String(80) | |
| postal_code | String(10) | |
| latitude | Float | |
| longitude | Float | |
| phone | String(20) | |
| image_url | String(500) | Mapped to `assets/icon/logo.png` |
| is_active | Boolean | |
| outlet_type | String(30) | `SALON`, `WAREHOUSE`, `HYBRID` |
| CREATEDTIME | DateTime | Auto |

### 3.2 Salon_Services
Individual service definitions linked to outlets.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| name | String(150) | |
| description | Text | |
| category | String(80) | |
| duration_minutes | Integer | |
| price | Float | |
| discount_price | Float | |
| is_active | Boolean | |
| is_at_home | Boolean | **Critical: must be true for dispatch** |
| service_type | String(30) | `BEAUTY`, `WELLNESS`, `GROOMING` |
| outlet_id | Integer | FK → Outlets.ROWID |
| gender | String(10) | `M`, `F`, `UNISEX` |
| image_url | String(500) | |
| CREATEDTIME | DateTime | Auto |

### 3.3 Outlet_Packages
Bundled service packages at specific prices.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| outlet_id | Integer | FK → Outlets |
| name | String(150) | |
| description | Text | |
| price | Float | |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

### 3.4 Outlet_Service_Prices
Per-outlet pricing overrides for services.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| outlet_id | Integer | FK → Outlets |
| service_id | Integer | FK → Salon_Services |
| price | Float | |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

### 3.5 Staff
Salon staff/professional linked to outlets.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| outlet_id | Integer | FK → Outlets |
| name | String(120) | |
| phone | String(20) | |
| email | String(150) | |
| role | String(40) | |
| photo_url | String(500) | |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

### 3.6 Staff_Services
Services offered by each staff member.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| staff_id | Integer | FK → Staff |
| service_id | Integer | FK → Salon_Services |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

---

## 4. Appointment & Slot Tables

### 4.1 Appointments
Walk-in / in-salon bookings.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| booking_number | String(30) | Unique |
| user_id | String(40) | FK → Catalyst user |
| outlet_id | Integer | FK → Outlets |
| service_id | Integer | FK → Salon_Services |
| staff_id | Integer | FK → Staff |
| scheduled_at | DateTime | |
| status | String(30) | `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELLED` |
| payment_status | String(20) | |
| grand_total | Float | |
| currency | String(5) | `INR` |
| notes | Text | |
| CREATEDTIME | DateTime | Auto |

### 4.2 Appointment_Slots
Pre-defined time slots per outlet/staff.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| outlet_id | Integer | FK → Outlets |
| staff_id | Integer | FK → Staff |
| slot_date | Date | |
| slot_time | String(10) | `HH:MM` |
| is_booked | Boolean | |
| appointment_id | Integer | FK → Appointments |
| CREATEDTIME | DateTime | Auto |

### 4.3 Appointment_Items
Services within an appointment (supports multi-service bookings).

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| appointment_id | Integer | FK → Appointments |
| service_id | Integer | FK → Salon_Services |
| service_name | String(150) | Snapshot |
| quantity | Integer | |
| unit_price | Float | |
| CREATEDTIME | DateTime | Auto |

---

## 5. At-Home Service Job Tables

### 5.1 Service_Jobs
Home service bookings — the primary booking record.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| booking_number | String(30) | Unique |
| user_id | String(40) | FK → Catalyst user |
| outlet_id | Integer | FK → Outlets (legacy) |
| outlet_row_id | Integer | FK → Outlets.ROWID |
| visit_line1 | String(200) | Customer address |
| visit_city | String(80) | |
| visit_state | String(80) | |
| visit_district | String(80) | |
| pincode | String(10) | |
| visit_latitude | Float | |
| visit_longitude | Float | |
| scheduled_at | DateTime | |
| status | String(30) | `PENDING`, `CONFIRMED`, `ASSIGNED`, `ACCEPTED`, `EN_ROUTE`, `ARRIVED`, `STARTED`, `COMPLETED`, `CANCELLED` |
| payment_status | String(20) | `PENDING`, `PAID`, `REFUNDED` |
| payment_method | String(20) | |
| grand_total | Float | |
| currency | String(5) | |
| service_name_snapshot | String(150) | |
| gender_preference | String(10) | |
| delivery_partner_row_id | Integer | FK → Delivery_Partners (assigned pro) |
| CREATEDTIME | DateTime | Auto |

### 5.2 Job_Items
Services within a home service booking.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_id | Integer | FK → Service_Jobs |
| service_id | Integer | FK → Salon_Services |
| service_name | String(150) | Snapshot |
| quantity | Integer | |
| unit_price | Float | |
| CREATEDTIME | DateTime | Auto |

### 5.3 Job_Timeline
Audit trail for Service_Jobs status changes.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_id | Integer | FK → Service_Jobs |
| status | String(30) | New status |
| provider_id | String(40) | Who triggered |
| note | Text | |
| CREATEDTIME | DateTime | Auto |

### 5.4 Job_Dispatch
Legacy dispatch records (pre-Professional_Jobs system).

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_id | Integer | FK → Service_Jobs |
| provider_id | String(40) | |
| status | String(20) | |
| dispatched_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

### 5.5 Job_Proofs
Service completion evidence (photos uploaded by professional).

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_id | Integer | FK → Service_Jobs or Professional_Jobs |
| professional_job_row_id | Integer | FK → Professional_Jobs |
| proof_type | String(30) | `PHOTO`, `SIGNATURE` |
| file_url | String(500) | File Store reference |
| uploaded_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

---

## 6. Professional Job Tables (FSM Core)

### 6.1 Professional_Jobs
The authoritative FSM job record.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_number | String(30) | Human-readable ID (`PJ2026XXXXXX`) |
| job_type | String(30) | `HOME_SERVICE`, `PRODUCT_DELIVERY` |
| reference_type | String(20) | `SERVICE_JOB`, `ORDER` |
| reference_row_id | Integer | FK → Service_Jobs or Orders |
| delivery_partner_row_id | Integer | FK → Delivery_Partners |
| outlet_row_id | Integer | FK → Outlets |
| job_status | String(30) | FSM state (see FSM doc) |
| job_priority | Integer | Higher = dispatched first |
| idempotency_key | String(60) | Unique, prevents duplicate jobs |
| assigned_at | DateTime | When partner was first assigned |
| accepted_at | DateTime | When partner accepted |
| offer_expires_at | DateTime | Offer TTL deadline |
| started_at | DateTime | When service/travel started |
| completed_at | DateTime | When job completed |
| metadata_json | Text(4000) | Dispatch metadata, rejected partner IDs |
| CREATEDTIME | DateTime | Auto |
| MODIFIEDTIME | DateTime | Auto |

**Indexes needed:** `job_status`, `delivery_partner_row_id`, `reference_row_id`, `idempotency_key`

### 6.2 Job_Status_History
Immutable audit log for every Professional_Job state transition.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| professional_job_row_id | Integer | FK → Professional_Jobs |
| old_status | String(30) | |
| new_status | String(30) | |
| actor_id | String(40) | User/system that triggered |
| actor_role | String(20) | `CUSTOMER`, `PROFESSIONAL`, `SYSTEM`, `ADMIN` |
| reason | String(255) | |
| metadata_json | Text(512) | |
| happened_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

---

## 7. Delivery Partner Tables

### 7.1 Delivery_Partners
Master record for all professional/delivery partners. Supports employees **across all of India**.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| delivery_partner_id | String(40) | External ID / Catalyst user ZAID |
| first_name | String(60) | |
| last_name | String(60) | |
| full_name | String(120) | Computed: first_name + last_name (also stored for fast queries) |
| phone | String(20) | |
| email | String(150) | |
| date_of_birth | Date | |
| gender | String(10) | `M`, `F`, `OTHER` |
| qualification | String(150) | e.g. "Diploma in Beauty Therapy", "12th Pass", "Graduate" |
| status | String(20) | `pending`, `active`, `suspended`, `kyc_rejected` |
| online_status | String(25) | `OFFLINE`, `ONLINE_AVAILABLE`, `ONLINE_BUSY` |
| rating | Float | 0.0 – 5.0 |
| total_completed_jobs | Integer | Cached counter |
| outlet_id | Integer | FK → Outlets (legacy) |
| outlet_row_id | Integer | FK → Outlets.ROWID (assigned outlet/location) |
| legacy_provider_id | Integer | Bridge to legacy Providers table (service skills) |
| legacy_rider_id | Integer | Bridge to legacy Riders table |
| profile_photo_url | String(500) | `filestore:{folder_id}/{file_id}` reference |
| country | String(50) | Default: `India` |
| state | String(80) | e.g. `Jharkhand` |
| district | String(80) | e.g. `Ranchi` |
| city | String(80) | e.g. `Ranchi` |
| postal_code | String(10) | e.g. `834001` |
| service_zone | String(80) | Named zone within a city, e.g. `Zone A`, `North Ranchi` |
| availability_schedule | Text | JSON: `{ mon: [{start:"09:00",end:"18:00"}], ... }` |
| kyc_approved_at | DateTime | Timestamp when KYC was approved |
| CREATEDTIME | DateTime | Auto |
| MODIFIEDTIME | DateTime | Auto |

**Location hierarchy:** `country → state → district → city → postal_code → service_zone`
Example: `India → Jharkhand → Ranchi → Ranchi → 834001 → Zone A`

This location data is used by the FSM dispatch system to match employees to customer bookings.

### 7.2 Delivery_Partner_KYC
KYC document submissions.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| delivery_partner_row_id | Integer | FK → Delivery_Partners |
| kyc_type | String(20) | `REGISTRATION`, `OPERATIONAL`, `UPDATE` |
| status | String(20) | `PENDING`, `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, `REJECTED` |
| full_name | String(120) | |
| date_of_birth | Date | |
| pan_number | String(15) | |
| aadhaar_number | String(20) | |
| bank_account_number | String(20) | |
| bank_ifsc | String(15) | |
| bank_account_name | String(120) | |
| address_line1 | String(200) | |
| city | String(80) | |
| state | String(80) | |
| district | String(80) | |
| postal_code | String(10) | |
| service_zone | String(80) | Employee's declared service zone |
| qualification | String(150) | Copied from registration details |
| profile_photo_url | String(500) | File store ref |
| pan_doc_url | String(500) | |
| aadhaar_front_url | String(500) | |
| aadhaar_back_url | String(500) | |
| bank_proof_url | String(500) | |
| rejection_reason | Text | |
| reviewed_by | String(40) | Admin user ID |
| reviewed_at | DateTime | |
| folder_id | String(40) | File Store folder for this KYC |
| CREATEDTIME | DateTime | Auto |

---

## 8. Order & Commerce Tables

### 8.1 Orders
Product orders.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| order_number | String(30) | Unique |
| user_id | String(40) | FK → Customer |
| status | String(30) | `PLACED`, `CONFIRMED`, `PROCESSING`, `PACKED`, `RIDER_SEARCHING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `REFUNDED` |
| payment_status | String(20) | `PENDING`, `PAID`, `FAILED`, `REFUNDED` |
| payment_method | String(20) | `RAZORPAY`, `COD`, `UPI` |
| grand_total | Float | |
| subtotal | Float | |
| tax_amount | Float | |
| discount_amount | Float | |
| currency | String(5) | |
| shipping_name | String(120) | |
| shipping_phone | String(20) | |
| shipping_line1 | String(200) | |
| shipping_line2 | String(200) | |
| shipping_city | String(80) | |
| shipping_state | String(80) | |
| shipping_postal_code | String(10) | |
| fulfillment_mode | String(20) | `DELIVERY`, `PICKUP` |
| fulfillment_store_id | Integer | FK → Outlets |
| fulfillment_rider_id | Integer | Legacy rider ID |
| professional_job_row_id | Integer | FK → Professional_Jobs |
| rider_latitude | Float | Last known rider lat |
| rider_longitude | Float | Last known rider lng |
| parent_order_id | Integer | FK → Orders (split orders) |
| razorpay_order_id | String(80) | |
| razorpay_payment_id | String(80) | |
| CREATEDTIME | DateTime | Auto |

### 8.2 Order_Timeline
Status change audit for orders.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| order_id | Integer | FK → Orders |
| status | String(30) | |
| actor | String(40) | |
| note | Text | |
| CREATEDTIME | DateTime | Auto |

### 8.3 Order_Items
Line items in an order.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| order_id | Integer | FK → Orders |
| product_id | Integer | FK → Products |
| variant_id | Integer | FK → Product_Variants |
| product_name | String(200) | Snapshot |
| quantity | Integer | |
| unit_price | Float | |
| line_total | Float | |
| CREATEDTIME | DateTime | Auto |

### 8.4 Carts / Cart_Items
Shopping cart.

| Column | Type | Notes |
|---|---|---|
| **Carts.ROWID** | Integer | PK |
| Carts.user_id | String(40) | |
| Carts.status | String(20) | `ACTIVE`, `CHECKED_OUT` |
| **Cart_Items.ROWID** | Integer | PK |
| Cart_Items.cart_id | Integer | FK → Carts |
| Cart_Items.product_id | Integer | FK → Products |
| Cart_Items.variant_id | Integer | FK → Product_Variants |
| Cart_Items.quantity | Integer | |
| Cart_Items.unit_price | Float | |

---

## 9. Catalog Tables

### 9.1 Products
| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| name | String(200) | |
| description | Text | |
| sku | String(60) | Unique |
| brand | String(100) | |
| category_id | Integer | FK → Categories |
| base_price | Float | |
| discount_price | Float | |
| image_url | String(500) | |
| is_active | Boolean | |
| is_featured | Boolean | |
| CREATEDTIME | DateTime | Auto |

### 9.2 Product_Variants
Size/shade/quantity variants.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| product_id | Integer | FK → Products |
| variant_name | String(100) | |
| sku_variant | String(60) | |
| price | Float | |
| is_active | Boolean | |
| CREATEDTIME | DateTime | Auto |

### 9.3 Categories / Product_Categories
Two-level category system.

### 9.4 Inventory
| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| product_id | Integer | FK → Products |
| variant_id | Integer | FK → Product_Variants |
| outlet_id | Integer | FK → Outlets (warehouse) |
| quantity | Integer | |
| reserved_qty | Integer | |
| low_stock_threshold | Integer | |
| CREATEDTIME | DateTime | Auto |

### 9.5 Stock_Movements
Inventory change audit trail.

---

## 10. Finance Tables

### 10.1 Professional_Earnings
| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| earning_number | String(30) | `PE2026XXXXXX` |
| professional_row_id | Integer | FK → Delivery_Partners |
| professional_job_row_id | Integer | FK → Professional_Jobs |
| reference_type | String(20) | |
| reference_row_id | Integer | |
| gross_amount | Float | |
| commission_amount | Float | |
| incentive_amount | Float | |
| tip_amount | Float | |
| adjustment_amount | Float | |
| net_amount | Float | |
| currency | String(5) | |
| status | String(20) | `PENDING`, `AVAILABLE`, `WITHDRAWN` |
| invoice_row_id | Integer | FK → Professional_Invoices |
| idempotency_key | String(60) | |
| metadata_json | Text | |
| created_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

### 10.2 Professional_Invoices
| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| invoice_number | String(30) | `INV2026XXXXXX` |
| professional_job_row_id | Integer | FK → Professional_Jobs |
| reference_type | String(20) | |
| reference_row_id | Integer | |
| customer_user_id | String(40) | |
| gross_amount | Float | |
| tax_amount | Float | |
| discount_amount | Float | |
| net_amount | Float | |
| currency | String(5) | |
| payment_status | String(20) | |
| payment_method | String(20) | |
| invoice_status | String(20) | `GENERATED`, `SENT`, `PAID` |
| idempotency_key | String(60) | |
| metadata_json | Text | |
| created_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

---

## 11. Notification Tables

### 11.1 Partner_Notifications
In-app inbox for professional partners.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| partner_row_id | Integer | FK → Delivery_Partners |
| notification_type | String(40) | `PROFESSIONAL_JOB_ASSIGNED`, etc. |
| title | String(120) | |
| body | String(512) | |
| reference_type | String(20) | |
| reference_id | String(40) | |
| professional_job_row_id | String(40) | |
| delivery_status | String(20) | `DELIVERED`, `FAILED` |
| read_at | DateTime | NULL = unread |
| created_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

### 11.2 Notifications
Customer-facing notifications.

### 11.3 WhatsApp_Notifications
WhatsApp delivery audit log.

---

## 12. Location Tables

### 12.1 Live_Locations
GPS pings for home service professionals (en route).

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| job_id | Integer | FK → Service_Jobs |
| provider_id | String(40) | |
| latitude | Float | |
| longitude | Float | |
| heading | Float | |
| speed | Float | |
| status | String(20) | |
| recorded_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

### 12.2 Delivery_Tracking
GPS pings for product delivery riders (en route).

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| order_id | Integer | FK → Orders |
| latitude | Float | |
| longitude | Float | |
| status | String(20) | |
| recorded_at | DateTime | |
| CREATEDTIME | DateTime | Auto |

---

## 13. Support & Admin Tables

### 13.1 Partner_Support_Tickets
| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| partner_row_id | Integer | FK → Delivery_Partners |
| professional_job_row_id | Integer | |
| subject | String(200) | |
| description | Text | |
| status | String(20) | `OPEN`, `IN_PROGRESS`, `RESOLVED` |
| created_at | DateTime | |

### 13.2 Audit_Logs
Admin action audit trail.

### 13.3 Media_Assets
Uploaded images, banners, promotional assets.

### 13.4 Reviews
Customer reviews for services/orders.

### 13.5 Wishlist
Customer saved products.

### 13.6 Serviceable_Pincodes
Delivery zone configuration.

| Column | Type | Notes |
|---|---|---|
| ROWID | Integer | PK |
| pincode | String(10) | Unique |
| is_active | Boolean | |
| city | String(80) | |
| state | String(80) | |

### 13.7 Search_Documents
Full-text search index (denormalized product/service records).

### 13.8 Import_Jobs / Import_Job_Rows / Import_Errors
Bulk CSV import pipeline tables.
