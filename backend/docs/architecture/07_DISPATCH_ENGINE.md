# Baylen App — Job / Dispatch Engine
**Version:** 1.0 | **Date:** 2026-09-09 | **Source:** `professional-dispatch-engine.js`

---

## 1. Engine Overview

The dispatch engine selects the best available professional partner for a job using a scoring model with 8 weighted factors. It is triggered:
1. **Automatically** — `setImmediate()` after every `createProfessionalJob()` call.
2. **Scheduled sweep** — Cron job every 2 minutes runs `dispatchPendingJobs()` for any `ASSIGNMENT_PENDING` jobs not yet assigned.
3. **Manual** — Admin can trigger `POST /admin/dispatch-job/:id`.

---

## 2. Dispatch Flow

```
1. Load job from Professional_Jobs
   └── Must be status = ASSIGNMENT_PENDING

2. Load dispatch context
   ├── HOME_SERVICE:    loadHomeServiceContext(service_job_id)
   │     → Service_Jobs, Job_Items, Salon_Services
   ├── PRODUCT_DELIVERY: loadProductDeliveryContext(order_id)
   │     → Orders, Outlets (fulfillment store)
   └── Validate: isJobReferenceDispatchable(context)

3. Check for pre-linked partner (delivery_partner_row_id already set)
   └── If pre-linked: evaluatePartnerEligibility() → assign if eligible

4. Load all ONLINE_AVAILABLE partners
   ZCQL: SELECT * FROM Delivery_Partners
         WHERE status = 'active' AND online_status = 'ONLINE_AVAILABLE' LIMIT 200

5. Exclude previously rejected partners
   (from metadata_json.rejected_partner_row_ids[])

6. Evaluate each partner:
   evaluatePartnerEligibility(partner, job, context)
   → returns { eligible: bool, reasons: [], factors: {}, score: number }

7. rankEligibleCandidates(evaluations)
   → sort by score DESC, then distance_km ASC

8. BROADCAST: All eligible partners are notified simultaneously
   → insertPartnerNotification() for each
   → recordWhatsappNotification() for each
   → offer_expires_at = now + 15 minutes

9. First partner to POST /professional-jobs/:id/accept wins the job
   (atomic lock via withProfessionalJobLock)

10. If no eligible partners:
    → Log NO_ELIGIBLE_PARTNER in Job_Status_History
    → Admin alert (future enhancement)
```

---

## 3. Eligibility Filters

All filters are **hard gates** — if any fails, the partner is ineligible regardless of score.

### Filter 1: Partner Operational Status
```javascript
isPartnerOperational(partner.status)
// Passes: status = 'active' AND kyc = APPROVED
// Fails:  status = 'pending', 'suspended', 'kyc_rejected'
```

### Filter 2: Online Availability
```javascript
partner.online_status === 'ONLINE_AVAILABLE'
// Options: OFFLINE, ONLINE_AVAILABLE, ONLINE_BUSY
// ONLINE_BUSY = has active job (auto-set by system)
```

### Filter 3: Exclusion List
```javascript
// Partners who previously rejected this job are excluded
// Stored in job.metadata_json.rejected_partner_row_ids[]
!excluded.has(String(partner.row_id))
```

### Filter 4: Outlet Authorization
```javascript
// If job has an outlet_row_id, partner must belong to same outlet
if (jobOutlet && partnerOutlet && partnerOutlet !== jobOutlet) {
  → OUTLET_UNAUTHORIZED (ineligible)
}
```

### Filter 5: Service Skill (HOME_SERVICE only)
```javascript
// Query Provider_Services table for service_id + provider_id match
await partnerHasServiceSkill(zcql, partner, context.service_id)
// Uses legacy_provider_id bridge to Provider_Services table
```

### Filter 6: Service Zone (HOME_SERVICE)
```javascript
// Query Service_Areas table for city coverage
await partnerCoversCity(zcql, partner, context.visit_city)
// If no Service_Areas rows → defaults to covered (true)
```

### Filter 7: Location Eligibility
```javascript
evaluateLocationEligibility(partnerLocation, context)
// Full hierarchy match: country → state → district → city → postal_code → service_zone
// Must match at state level minimum.
// service_zone (e.g. "Zone A") checked if job has a zone requirement.
// Supports all-India employee base.
```

### Filter 8: Delivery Capability (PRODUCT_DELIVERY)
```javascript
// Partner must have legacy_rider_id OR belong to an outlet
Boolean(partner.legacy_rider_id) || Boolean(partner.outlet_row_id)
```

### Filter 9: Delivery Pincode Serviceability (PRODUCT_DELIVERY)
```javascript
await isPincodeServiceable(zcql, context.pincode)
// Query Serviceable_Pincodes WHERE pincode = X AND is_active = true
```

### Filter 10: Concurrent Workload
```javascript
countPartnerAssignedJobs(zcql, partner.row_id) < MAX_CONCURRENT_ASSIGNED (= 3)
```

### Filter 11: Schedule Conflict
```javascript
// Checks stored availability_schedule (weekly schedule in Delivery_Partners)
// AND checks existing ASSIGNED/ACCEPTED/STARTED jobs' time windows
// availability_schedule format: { mon: [{start:"09:00",end:"18:00"}], tue: [...], ... }
// Job's scheduled_at must fall within partner's availability window.
// Buffer: JOB_OVERLAP_BUFFER_MINUTES = 30 min between overlapping jobs
!intervalsOverlap(jobWindow, existingWindows[])
```

---

## 4. Scoring Model

All eligible partners are ranked by a composite score:

```javascript
DISPATCH_RANK_WEIGHTS = {
  skill_match:         100,   // Has required service skill
  outlet_authorization: 80,   // Belongs to same outlet as job
  service_zone:         70,   // Covers job city/pincode
  working_hours_fit:    60,   // No schedule conflict (1 = no conflict)
  workload:             50,   // Fewer current jobs = higher score
  distance:             40,   // Closer to job = higher score (0-25km range)
  rating:               20,   // Higher partner rating = higher score
  priority:             10,   // Job.job_priority > 0 gives bonus
}

// Score calculation:
score = Σ weight[factor] × factor_value[0-1]

// Distance factor:
distance_factor = max(0, 1 - min(distance_km, 25) / 25)
// 0km → 1.0 (max),  25km → 0.0,  10km → 0.6

// Rating factor:
rating_factor = rating > 0 ? min(rating / 5.0, 1.0) : 0.5
// 5.0 star → 1.0,  4.0 star → 0.8,  no rating → 0.5

// Max possible score: 430 points (all factors = 1.0)
```

### Tie-breaking
1. Score (highest wins)
2. Distance km (nearest wins)
3. partner_row_id (lexicographic, for determinism)

---

## 5. Offer Broadcast Model

**Baylen uses simultaneous broadcast, not sequential offers:**

- ALL eligible partners receive the notification at the same time.
- Job stores `eligible_partner_row_ids[]` in `metadata_json`.
- Any eligible partner can accept, but **atomic locking** ensures only one wins.
- First `POST /accept` that acquires the job lock wins.
- Other partners who try to accept receive `ALREADY_ASSIGNED` (idempotent, not error).

This approach minimizes job assignment latency vs sequential offers.

---

## 6. Offer TTL & Reassignment

```
Job Offer TTL: PROFESSIONAL_OFFER_TTL_MINUTES (default: 15 minutes)
Stored in: Professional_Jobs.offer_expires_at

Expiry flow (Cron every 5 minutes):
  1. Find jobs WHERE job_status = 'ASSIGNED' AND offer_expires_at < NOW()
  2. For each expired job:
     a. Add delivery_partner_row_id to metadata_json.rejected_partner_row_ids[]
     b. Clear delivery_partner_row_id
     c. Transition: ASSIGNED → REASSIGNMENT_REQUIRED → ASSIGNMENT_PENDING
  3. Re-trigger dispatch (excludes expired partner)
```

---

## 7. Daily Limits

| Limit | Value | Purpose |
|---|---|---|
| `MAX_DAILY_JOBS` | 12 | Total jobs per partner per day |
| `MAX_CONCURRENT_ASSIGNED` | 3 | Active (ASSIGNED/ACCEPTED/STARTED) at once |
| `JOB_OVERLAP_BUFFER_MINUTES` | 30 | Buffer between scheduled job windows |

---

## 8. Manual Override (Admin)

Admins can manually assign a specific partner to a job:
```
POST /admin/assign-job
{ job_id: "...", partner_row_id: "..." }
```
This calls `assignJobToPartner()` directly, skipping the eligibility check but still requiring:
- Job must be in `ASSIGNMENT_PENDING`
- Partner must exist

---

## 9. Dispatch Context by Job Type

### HOME_SERVICE Context
Loaded from `Service_Jobs` + `Job_Items` + `Salon_Services`:
```javascript
{
  kind: 'HOME_SERVICE',
  service_id,        // Used for skill match
  service_name,
  is_at_home,        // Must be true (gate)
  visit_city,        // Used for zone match
  visit_state,       // Used for location eligibility
  pincode,           // Used for zone match
  scheduled_at,      // Used for conflict check
  duration_minutes,  // Used for conflict window
  outlet_row_id,     // Used for outlet auth
  destination: { latitude, longitude }  // Used for distance scoring
}
```

### PRODUCT_DELIVERY Context
Loaded from `Orders` + `Outlets` (fulfillment store):
```javascript
{
  kind: 'PRODUCT_DELIVERY',
  order_number,
  pincode,           // Delivery pincode (serviceability check)
  visit_city,
  outlet_row_id,     // Fulfillment store (outlet auth)
  pickup: { latitude, longitude, source: 'outlet' },   // Store location
  destination: { latitude, longitude, source: 'pincode_fallback' },  // Customer
  payment_method,    // COD eligibility check
  payment_status,    // PAID check
}
```

---

## 10. No-Partner Scenarios

If no eligible partner is found after dispatch:

1. `NO_ELIGIBLE_PARTNER` logged in `Job_Status_History`.
2. Job remains in `ASSIGNMENT_PENDING`.
3. Dispatch sweep cron retries every 2 minutes.
4. If still no partner after 3 sweeps (6 minutes), admin should manually intervene.

**Common root causes:**
- All partners offline
- No partner in the job's service zone
- No partner with required service skill
- All nearby partners at max workload (3 jobs)
- Delivery pincode not in `Serviceable_Pincodes`
