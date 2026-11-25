# Baylen App — Architecture Documentation Index
**Version:** 1.0 | **Date:** 2026-09-09 | **Status:** Complete

---

## Document Registry

| # | Document | File | Status |
|---|---|---|---|
| 1 | Product Requirements Document (PRD) | [01_PRD.md](./01_PRD.md) | ✅ Complete |
| 2 | Technical Requirements Document (TRD) | [02_TRD.md](./02_TRD.md) | ✅ Complete |
| 3 | Backend Database Schema | [03_DATABASE_SCHEMA.md](./03_DATABASE_SCHEMA.md) | ✅ Complete |
| 4 | Entity Relationship Diagram (ERD) | [04_ERD.md](./04_ERD.md) | ✅ Complete |
| 5 | FSM Workflow | [05_FSM_WORKFLOW.md](./05_FSM_WORKFLOW.md) | ✅ Complete |
| 6 | Real-Time Location Architecture | [06_LOCATION_ARCHITECTURE.md](./06_LOCATION_ARCHITECTURE.md) | ✅ Complete |
| 7 | Job / Dispatch Engine | [07_DISPATCH_ENGINE.md](./07_DISPATCH_ENGINE.md) | ✅ Complete |
| 8 | Notification Architecture | [08_NOTIFICATION_ARCHITECTURE.md](./08_NOTIFICATION_ARCHITECTURE.md) | ✅ Complete |
| 9 | Complete API Specification | [09_API_SPECIFICATION.md](./09_API_SPECIFICATION.md) | ✅ Complete |
| 10 | Security & RBAC | [10_SECURITY_RBAC.md](./10_SECURITY_RBAC.md) | ✅ Complete |
| 11 | Edge Cases & Failure Handling | [11_EDGE_CASES.md](./11_EDGE_CASES.md) | ✅ Complete |
| 12 | Testing & Production Checklist | [12_TESTING_CHECKLIST.md](./12_TESTING_CHECKLIST.md) | ✅ Complete |

---

## Implementation Sequence

Follow the PRD → TRD → Schema → ERD → FSM → API design before coding.  
Then implement **one module at a time**:

| Phase | Module | Key Files | Status |
|---|---|---|---|
| 1 | Auth & KYC | `delivery-partner-auth.js`, `delivery-partner-kyc-engine.js` | ✅ Implemented |
| 2 | Professional Job FSM | `professional-job-fsm.js`, `professional-job-engine.js` | ✅ Implemented |
| 3 | Dispatch Engine | `professional-dispatch-engine.js` | ✅ Implemented |
| 4 | Real-Time Location | `professional-location-engine.js`, `professional-location-cache.js` | ✅ Implemented |
| 5 | Job Lifecycle Execution | `professional-execution-engine.js`, `professional-arrival-engine.js` | ✅ Implemented |
| 6 | Earnings & Finance | `professional-finance-engine.js` | ✅ Implemented |
| 7 | Notifications | `professional-partner-notify.js`, `whatsapp-transactional.js` | ✅ Implemented |
| 8 | Product Delivery | `professional-delivery-engine.js` | ✅ Implemented |
| 9 | Catalog & Commerce | `catalog-products.js`, `checkout-engine.js`, `commerce-ops.js` | ✅ Implemented |
| 10 | Inventory | `inventory-ops.js`, `low-stock-engine.js` | ✅ Implemented |
| 11 | At-Home Beauty Booking | `at-home-beauty-engine.js` | ✅ Implemented |
| 12 | KYC Admin Review | `delivery-partner-kyc.js` routes | ✅ Implemented |

---

## Key Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| Backend Platform | Zoho Catalyst | Existing project infrastructure |
| Job Dispatch Model | Broadcast all eligible | Minimize assignment latency |
| Location Storage | Catalyst Cache (primary) + Data Store (audit) | Fast reads + persistence |
| Routing Engine | Haversine (offline) | No external API dependency |
| Auth (Professional) | Custom OTP JWT | Phone-only access flow |
| Finance Settlement | Idempotent at job completion | Prevents duplicate earnings |
| Notification Priority | In-app first, WhatsApp second | WhatsApp failures non-blocking |
| GPS Privacy | Hidden after ARRIVED status | User trust / privacy |
| SalesIQ Init | On-demand only | Avoid GDPR popup on launch |

---

## Tables Created in Catalyst Data Store

**Professional FSM system:**
- `Professional_Jobs` — FSM job record
- `Job_Status_History` — immutable audit trail
- `Partner_Notifications` — in-app notification inbox
- `Partner_Support_Tickets` — support requests
- `Professional_Earnings` — earning records
- `Professional_Invoices` — invoice records

**Location tracking:**
- `Live_Locations` — home service GPS trail
- `Delivery_Tracking` — product delivery GPS trail

**Auth:**
- `Auth_Otp_Challenges` — OTP verification sessions

**Core commerce (pre-existing):**
- `Orders`, `Order_Items`, `Order_Timeline`
- `Service_Jobs`, `Job_Items`, `Job_Timeline`
- `Appointments`, `Appointment_Items`, `Appointment_Slots`
- `Delivery_Partners`, `Delivery_Partner_KYC`
- `Products`, `Product_Variants`, `Categories`
- `Inventory`, `Stock_Movements`
- `Outlets`, `Salon_Services`, `Staff`, `Staff_Services`
- `Carts`, `Cart_Items`
- `Addresses`, `User_Profiles`, `Devices`
- `Notifications`, `WhatsApp_Notifications`
- `Reviews`, `Wishlist`
- `Serviceable_Pincodes`
- `Search_Documents`
- `Import_Jobs`, `Import_Job_Rows`, `Import_Errors`
- `Audit_Logs`, `Media_Assets`
