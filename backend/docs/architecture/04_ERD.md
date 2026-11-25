# Baylen App — Entity Relationship Diagram
**Version:** 1.0 | **Date:** 2026-09-09

---

## 1. Core Data Flow

```
Customer ──────────────────────────────────────────────────────┐
   │                                                           │
   │ books                          orders                     │
   ▼                                ▼                          │
Service_Jobs ──────────────────── Orders ─────────────────────┤
   │  │                              │  │                      │
   │  │ contains                     │  │ contains             │
   │  ▼                              │  ▼                      │
   │ Job_Items                       │ Order_Items             │
   │  └── Salon_Services ◄── Outlets │  └── Products          │
   │                          │      │       └── Product_Variants
   │ triggers                 │      │ triggers                │
   ▼                          │      ▼                         │
Professional_Jobs ◄────────────┘  Professional_Jobs            │
   │ (HOME_SERVICE)                (PRODUCT_DELIVERY)          │
   └─────────────────────────────────────────────────────────►─┘
                  │
                  │ assigned to
                  ▼
         Delivery_Partners
                  │  │
                  │  │ verified via
                  │  ▼
                  │ Delivery_Partner_KYC
                  │
                  │ earns
                  ▼
         Professional_Earnings ──► Professional_Invoices
                  │
                  │ tracks
                  ▼
         Job_Status_History
```

---

## 2. Full Entity Relationship Map

### 2.1 Customer → Booking → Service Path

```
Catalyst_User (ZAID)
    │
    ├──< User_Profiles (1:1)
    │       └── profile_photo_url
    │
    ├──< Addresses (1:N)
    │       └── lat/lng, city, state, postal_code
    │
    ├──< Service_Jobs (1:N)  ← at-home bookings
    │       │
    │       ├── outlet_row_id ──► Outlets
    │       ├── visit_latitude, visit_longitude
    │       ├── scheduled_at
    │       ├── status (FSM)
    │       │
    │       ├──< Job_Items (1:N)
    │       │       └── service_id ──► Salon_Services
    │       │
    │       ├──< Job_Timeline (1:N)  [audit]
    │       │
    │       ├──< Live_Locations (1:N)  [GPS pings]
    │       │
    │       └──< Professional_Jobs (1:1)
    │               └── [see section 2.4]
    │
    ├──< Orders (1:N)  ← product orders
    │       │
    │       ├── fulfillment_store_id ──► Outlets
    │       ├── shipping_postal_code, shipping_city
    │       │
    │       ├──< Order_Items (1:N)
    │       │       ├── product_id ──► Products
    │       │       └── variant_id ──► Product_Variants
    │       │
    │       ├──< Order_Timeline (1:N)  [audit]
    │       │
    │       ├──< Delivery_Tracking (1:N)  [GPS pings]
    │       │
    │       └──< Professional_Jobs (1:1)
    │               └── [see section 2.4]
    │
    ├──< Appointments (1:N)  ← salon walk-in
    │       │
    │       ├── outlet_id ──► Outlets
    │       ├── staff_id ──► Staff
    │       └──< Appointment_Items (1:N)
    │               └── service_id ──► Salon_Services
    │
    ├──< Carts (1:1 active)
    │       └──< Cart_Items (1:N)
    │               ├── product_id ──► Products
    │               └── variant_id ──► Product_Variants
    │
    ├──< Wishlist (1:N)
    │       └── product_id ──► Products
    │
    ├──< Reviews (1:N)
    │       ├── outlet_id ──► Outlets
    │       └── service_id ──► Salon_Services
    │
    └──< Notifications (1:N)
```

### 2.2 Outlet / Service Hierarchy

```
Outlets
    │
    ├──< Salon_Services (1:N)
    │       ├── is_at_home: true/false  ← dispatch gate
    │       ├── duration_minutes        ← scheduling
    │       └── category, service_type, gender
    │
    ├──< Staff (1:N)
    │       └──< Staff_Services (1:N)
    │               └── service_id ──► Salon_Services
    │
    ├──< Outlet_Packages (1:N)
    │
    ├──< Outlet_Service_Prices (1:N)  ← price overrides
    │
    ├──< Inventory (1:N)
    │       ├── product_id ──► Products
    │       └── variant_id ──► Product_Variants
    │
    └──< Delivery_Partners (1:N)  ← assigned professionals
            └── outlet_row_id
```

### 2.3 Catalog Hierarchy

```
Categories
    └──< Product_Categories (bridge)
            └──< Products (1:N)
                    │
                    ├──< Product_Variants (1:N)
                    │
                    ├──< Inventory (1:N)
                    │       └── outlet_id ──► Outlets
                    │
                    └──< Stock_Movements (1:N)  [audit]
```

### 2.4 Professional Job (FSM Core)

```
Professional_Jobs
    │
    ├── reference_type = SERVICE_JOB
    │       └── reference_row_id ──► Service_Jobs
    │
    ├── reference_type = ORDER
    │       └── reference_row_id ──► Orders
    │
    ├── delivery_partner_row_id ──► Delivery_Partners
    │
    ├── outlet_row_id ──► Outlets
    │
    ├──< Job_Status_History (1:N)  [immutable FSM audit]
    │       └── professional_job_row_id
    │
    ├──< Job_Proofs (1:N)  [service proof photos]
    │
    ├──< Professional_Earnings (1:1)
    │       └──► Professional_Invoices (1:1)
    │
    └── (location tracked in Catalyst Cache: "prof_loc:{job_id}")
```

### 2.5 Delivery Partner Identity & KYC

```
Delivery_Partners
    │
    │ Location hierarchy:
    │ country → state → district → city → postal_code → service_zone
    │ Example: India → Jharkhand → Ranchi → Ranchi → 834001 → Zone A
    │
    ├── first_name, last_name, full_name
    ├── phone, email, date_of_birth, gender
    ├── qualification
    ├── profile_photo_url  → Catalyst File Store (fetched dynamically)
    │       Shown on: Dashboard, Profile, Job Detail,
    │                 Customer "Your Professional" card, Admin KYC panel
    │
    ├──< Delivery_Partner_KYC (1:N)
    │       └── kyc_type: REGISTRATION | OPERATIONAL
    │       └── status: PENDING | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED
    │       └── kyc_approved_at (on Delivery_Partners)
    │       └── qualification (snapshot)
    │       └── service_zone (snapshot)
    │       └── folder_id ──► Catalyst File Store
    │
    ├──< Professional_Jobs (1:N)  [jobs assigned]
    │
    ├──< Professional_Earnings (1:N)
    │
    ├──< Partner_Notifications (1:N)
    │
    └──< Partner_Support_Tickets (1:N)
```

### 2.6 Dispatch Decision Flow

```
Service_Jobs / Orders
        │
        │ job creation
        ▼
Professional_Jobs [CREATED → ASSIGNMENT_PENDING]
        │
        │ dispatch engine
        ▼
Online Delivery_Partners (status=active, online_status=ONLINE_AVAILABLE)
        │
        │ eligibility filters
        ▼
Filtered + Ranked Candidates
        │
        │ broadcast offer
        ▼
Partner_Notifications (PROFESSIONAL_JOB_ASSIGNED)
+ WhatsApp_Notifications
        │
        │ partner accepts (first wins)
        ▼
Professional_Jobs [ASSIGNED]
        │
        ▼
Job_Status_History [ASSIGNED entry]
```

---

## 3. Key Relationship Rules

| Relationship | Cardinality | Notes |
|---|---|---|
| Customer → Service_Jobs | 1:N | One customer, many bookings |
| Customer → Orders | 1:N | One customer, many orders |
| Service_Jobs → Professional_Jobs | 1:1 | One booking, one FSM job |
| Orders → Professional_Jobs | 1:1 | One order, one FSM delivery job |
| Professional_Jobs → Job_Status_History | 1:N | Immutable audit trail |
| Professional_Jobs → Professional_Earnings | 1:1 | One job, one earning record |
| Professional_Earnings → Professional_Invoices | 1:1 | One earning, one invoice |
| Delivery_Partners → Professional_Jobs | 1:N | One partner, many jobs over time |
| Delivery_Partners → Delivery_Partner_KYC | 1:N | Multiple KYC submissions allowed |
| Outlets → Salon_Services | 1:N | Each outlet has many services |
| Salon_Services → Job_Items | 1:N | Service can be in many bookings |
| Products → Product_Variants | 1:N | One product, many variants |
| Products → Inventory | 1:N | Per-outlet/warehouse stock |

---

## 4. GPS & Location Data Flow

```
Professional App (Flutter)
        │
        │ POST /professional-jobs/:id/location
        │ { lat, lng, accuracy, captured_at }
        ▼
professional-location-engine.js
        │
        ├── Validate age/accuracy
        │
        ├── Write to Catalyst Cache
        │       key: "prof_loc:{job_id}"
        │       TTL: 5 minutes
        │
        ├── If HOME_SERVICE → Insert into Live_Locations
        │
        └── If PRODUCT_DELIVERY → Insert into Delivery_Tracking
                                 + Update Orders.rider_lat/lng
        
Customer App (Flutter)
        │
        │ GET /professional-jobs/:id/customer-tracking
        ▼
professional-location-engine.js
        │
        ├── Read from Catalyst Cache
        │
        ├── Compute age → LIVE | STALE | UNAVAILABLE
        │
        ├── buildRouteSummary(partner_lat, partner_lng, dest_lat, dest_lng)
        │       → distance_km, eta_minutes
        │
        └── Return location + route to customer
```
