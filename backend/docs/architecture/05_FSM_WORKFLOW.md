# Baylen App — FSM Workflow
**Version:** 1.0 | **Date:** 2026-09-09

All state transitions are enforced by `professional-job-fsm.js`. Invalid transitions return HTTP 409 with code `INVALID_STATUS_TRANSITION`. Every transition is logged in `Job_Status_History`.

---

## 1. Home Service FSM

### 1.1 State Diagram

```
                    ┌─────────────┐
                    │   CREATED   │
                    └──────┬──────┘
                           │ auto → system
                           ▼
                ┌──────────────────────┐
                │  ASSIGNMENT_PENDING  │◄────────────────────────┐
                └──────────┬───────────┘                         │
                           │ dispatch engine                     │
              ┌────────────▼──────────────┐                      │
              │         ASSIGNED          │────► CANCELLED        │
              └────────────┬──────────────┘                      │
                           │ partner accepts                     │
              ┌────────────▼──────────────┐                      │
              │         ACCEPTED          │────► REASSIGNMENT_REQUIRED
              └────────────┬──────────────┘           │          │
                           │ partner starts travel    │          │
                           │ (POST /start-travel)     └──────────┘
              ┌────────────▼──────────────┐
              │         EN_ROUTE          │────► CANCELLED
              └────────────┬──────────────┘
                           │ partner arrives (POST /arrive)
              ┌────────────▼──────────────┐
              │          ARRIVED          │────► CANCELLED
              └────────────┬──────────────┘
                           │ customer shows OTP → partner verifies
              ┌────────────▼──────────────┐
              │       OTP_VERIFIED        │────► CANCELLED
              └────────────┬──────────────┘
                           │ partner starts service
              ┌────────────▼──────────────┐
              │          STARTED          │────► CANCELLED
              └────────────┬──────────────┘
                           │
              ┌────────────▼──────────────┐
              │        IN_PROGRESS        │
              └────────────┬──────────────┘
                           │ partner marks complete + uploads proof
              ┌────────────▼──────────────┐
              │         COMPLETED         │
              └───────────────────────────┘
                    (terminal — earnings settled)
```

### 1.2 State Definitions

| Status | Actor | Description |
|---|---|---|
| `CREATED` | System | Job created, immediately transitions to ASSIGNMENT_PENDING |
| `ASSIGNMENT_PENDING` | System | Waiting for dispatch engine to find a partner |
| `ASSIGNED` | Dispatch | Partner assigned; offer TTL starts (15 min default) |
| `ACCEPTED` | Professional | Partner accepted the job; commits to arrive |
| `EN_ROUTE` | Professional | Partner has started traveling to customer location |
| `ARRIVED` | Professional | Partner arrived at customer address (GPS or manual) |
| `OTP_VERIFIED` | Professional | Customer presented OTP; identity verified |
| `STARTED` | Professional | Service work has begun |
| `IN_PROGRESS` | Professional | Service is underway |
| `COMPLETED` | Professional | Service completed; earnings settled |
| `REASSIGNMENT_REQUIRED` | System/Professional | Partner rejected/timed out; back to dispatch queue |
| `CANCELLED` | Customer/Admin | Job cancelled; refund/fee logic triggered |

### 1.3 Allowed Transitions

```javascript
CREATED              → ASSIGNMENT_PENDING
ASSIGNMENT_PENDING   → ASSIGNED | CANCELLED
ASSIGNED             → ACCEPTED | REASSIGNMENT_REQUIRED | CANCELLED
REASSIGNMENT_REQUIRED → ASSIGNMENT_PENDING | CANCELLED
ACCEPTED             → EN_ROUTE | REASSIGNMENT_REQUIRED | CANCELLED
EN_ROUTE             → ARRIVED | CANCELLED
ARRIVED              → OTP_VERIFIED | CANCELLED
OTP_VERIFIED         → STARTED | CANCELLED
STARTED              → IN_PROGRESS | CANCELLED
IN_PROGRESS          → COMPLETED | CANCELLED
COMPLETED            → (terminal)
CANCELLED            → (terminal)
```

---

## 2. Product Delivery FSM

### 2.1 State Diagram

```
                    ┌─────────────┐
                    │   CREATED   │
                    └──────┬──────┘
                           │ auto → system
                           ▼
                ┌──────────────────────┐
                │  ASSIGNMENT_PENDING  │◄───────────────────────┐
                └──────────┬───────────┘                        │
                           │ dispatch                           │
              ┌────────────▼──────────────┐                     │
              │         ASSIGNED          │────► CANCELLED       │
              └────────────┬──────────────┘                     │
                           │ partner accepts                    │
              ┌────────────▼──────────────┐                     │
              │         ACCEPTED          │────► REASSIGNMENT_REQUIRED
              └────────────┬──────────────┘           │         │
                           │ partner starts pickup    └─────────┘
              ┌────────────▼──────────────┐
              │      GOING_TO_PICKUP      │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ partner arrives at store
              ┌────────────▼──────────────┐
              │      ARRIVED_PICKUP       │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ store staff verifies / scans
              ┌────────────▼──────────────┐
              │      PICKUP_VERIFIED      │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ partner picks up package
              ┌────────────▼──────────────┐
              │         PICKED_UP         │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ en route to customer
              ┌────────────▼──────────────┐
              │          EN_ROUTE         │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ arrives at customer
              ┌────────────▼──────────────┐
              │          ARRIVED          │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ customer verifies delivery OTP
              ┌────────────▼──────────────┐
              │     DELIVERY_VERIFIED     │────► REASSIGNMENT_REQUIRED | CANCELLED
              └────────────┬──────────────┘
                           │ delivery confirmed
              ┌────────────▼──────────────┐
              │         DELIVERED         │
              └────────────┬──────────────┘
                           │ auto → earnings settled
              ┌────────────▼──────────────┐
              │         COMPLETED         │
              └───────────────────────────┘
                    (terminal)
```

---

## 3. Service_Job FSM (Home Service Source Record)

The `Service_Jobs` table has its own parallel status that mirrors the `Professional_Jobs` FSM:

```
PENDING → CONFIRMED → ASSIGNED → ACCEPTED → EN_ROUTE → ARRIVED → STARTED → COMPLETED
                                                                          → CANCELLED
```

This is synced by the location engine and execution engine:
- When Professional_Job transitions to `EN_ROUTE` → Service_Job updated to `EN_ROUTE`
- When Professional_Job transitions to `OTP_VERIFIED` → Service_Job updated to `ARRIVED`
- When Professional_Job transitions to `STARTED` → Service_Job updated to `STARTED`
- When Professional_Job transitions to `COMPLETED` → Service_Job updated to `COMPLETED`

---

## 4. Order FSM (Product Delivery Source Record)

```
PLACED → CONFIRMED → PROCESSING → STORE_ASSIGNED → PICKING → PACKED → 
RIDER_SEARCHING → RIDER_ASSIGNED → OUT_FOR_DELIVERY → DELIVERED | CANCELLED | REFUNDED
```

Synced by dispatch and delivery:
- When Professional_Job transitions to `EN_ROUTE` → Order updated to `OUT_FOR_DELIVERY`
- When Professional_Job transitions to `DELIVERED` → Order updated to `DELIVERED`

---

## 5. KYC FSM (Delivery Partner Verification)

```
[Not submitted]
       │
       │ partner submits documents
       ▼
    PENDING
       │
       │ partner submits form
       ▼
   SUBMITTED
       │
       │ admin picks for review
       ▼
  UNDER_REVIEW
       │
   ┌───┴────────────┐
   ▼                ▼
APPROVED         REJECTED ──► partner can re-submit with corrections
   │
   │ Delivery_Partners.status = 'active'
   │ isPartnerOperational() = true
   ▼
Partner can go ONLINE_AVAILABLE and receive jobs
```

---

## 6. Availability FSM (Partner Online Status)

```
OFFLINE
   │
   │ partner taps "Go Online" (if KYC approved)
   ▼
ONLINE_AVAILABLE
   │             │
   │ job assigned│ manually goes offline
   ▼             ▼
ONLINE_BUSY    OFFLINE
   │
   │ job completed / cancelled
   ▼
ONLINE_AVAILABLE
```

---

## 7. Reassignment Flow

```
Professional_Job [ASSIGNED]
        │
        │ partner rejects OR offer_expires_at passed
        ▼
[REASSIGNMENT_REQUIRED]
        │
        │ add partner to excluded list in metadata_json
        │ (rejected_partner_row_ids: [...])
        ▼
[ASSIGNMENT_PENDING]
        │
        │ dispatch engine re-evaluates
        │ (excludes previously rejected partners)
        ▼
Next eligible partner receives offer
```

If no eligible partner is found after 3 reassignment attempts, admin is alerted and can manually assign.

---

## 8. Cancellation Rules

| Job Status | Who Can Cancel | Fee? |
|---|---|---|
| ASSIGNMENT_PENDING | Customer, Admin | No fee |
| ASSIGNED | Customer, Admin | No fee |
| ACCEPTED | Customer, Admin | Possible cancellation fee |
| EN_ROUTE | Customer, Admin | Cancellation fee applies |
| ARRIVED+ | Admin only | Dispute process required |
| COMPLETED | Not cancellable | — |

When cancelled:
1. Professional_Job → `CANCELLED`
2. Service_Job / Order → `CANCELLED`
3. Refund initiated if payment was online
4. Partner Notification: `PROFESSIONAL_JOB_CANCELLED`

---

## 9. Completion Settlement Sequence

```
Professional marks job COMPLETED
        │
        │ professional-execution-engine.js
        ▼
1. Professional_Jobs.job_status = 'COMPLETED'
2. Professional_Jobs.completed_at = now()
3. Service_Jobs.status = 'COMPLETED'  (or Orders.status = 'DELIVERED')
4. Job_Timeline entry inserted
5. settleProfessionalJobFinance()
   ├── ensureProfessionalInvoice() → Professional_Invoices
   └── ensureProfessionalEarning() → Professional_Earnings
        └── net_amount = gross - commission + incentive + tip
6. Job_Status_History entry: COMPLETED
7. Customer Notification: "Your service is complete"
8. Partner Notification: "Job complete. Earnings added to your wallet."
```
