# Baylen App — Edge Cases & Failure Handling
**Version:** 1.0 | **Date:** 2026-09-09

---

## 1. GPS / Location Failures

### 1.1 Professional GPS Unavailable
**Scenario:** Professional's phone GPS is off or accuracy is poor.
**Detection:** `accuracy_m > 500` OR no location ping for > 5 minutes.
**Handling:**
- API returns `LOCATION_INVALID (422)` for bad accuracy pings.
- Customer sees `location_status: "UNAVAILABLE"` → "Location unavailable".
- Professional can still complete the job manually (no GPS required for OTP/completion steps).
- Job is NOT cancelled due to GPS failure alone.

### 1.2 Location Timestamp Too Old
**Scenario:** Phone is sending cached GPS from hours ago.
**Detection:** `captured_at` is > 30 seconds old.
**Handling:** Returns `LOCATION_UPDATE_TOO_OLD (409)`. App must fetch fresh GPS before retrying.

### 1.3 Future Timestamp
**Scenario:** Phone clock is ahead (> 5 seconds).
**Detection:** `captured_at > now + 5s`.
**Handling:** Returns `LOCATION_INVALID (409)`.

### 1.4 Stale Location Cache
**Scenario:** Professional stopped sending GPS pings mid-route.
**Handling:**
- Cache entry expires after 5 minutes (`LOCATION_STALE_SECONDS = 300`).
- Customer UI shows `STALE` status with last known position and timestamp.
- No action needed — tracking resumes when pings resume.

---

## 2. Dispatch / Assignment Failures

### 2.1 No Eligible Partner Found
**Scenario:** `dispatchProfessionalJob()` finds zero eligible partners.
**Handling:**
- Job remains `ASSIGNMENT_PENDING`.
- `NO_ELIGIBLE_PARTNER` logged in `Job_Status_History`.
- Cron sweep retries every 2 minutes.
- After 3+ sweeps (~6 minutes): admin should manually assign.
- Customer status: "Finding a professional near you..." (no alert yet).

**Root causes to investigate:**
- All partners offline → encourage partners to go online.
- No skilled partner in zone → expand skill/zone coverage.
- Pincode not in `Serviceable_Pincodes` → add to serviceability config.

### 2.2 Offer Expiry (Partner Doesn't Respond)
**Scenario:** Assigned partner ignores offer for > TTL minutes.
**Detection:** Cron job checks `offer_expires_at < NOW() AND job_status = ASSIGNED`.
**Handling:**
1. Partner added to `rejected_partner_row_ids[]` in metadata.
2. `delivery_partner_row_id` cleared.
3. Job: `ASSIGNED → REASSIGNMENT_REQUIRED → ASSIGNMENT_PENDING`.
4. Dispatch re-run excluding expired partner.

### 2.3 Partner Rejects Job
**Scenario:** Partner explicitly rejects the offer.
**Handling:**
- Partner calls `POST /professional-jobs/:id/reject`.
- Partner added to exclusion list.
- Job transitions to `REASSIGNMENT_REQUIRED → ASSIGNMENT_PENDING`.
- Re-dispatch triggered.

### 2.4 Partner Goes Offline During Assignment
**Scenario:** Partner sets `online_status = OFFLINE` after receiving a job offer.
**Handling:**
- `ONLINE_AVAILABLE` check is at dispatch time only.
- Going offline does NOT auto-cancel assigned jobs.
- Partner must explicitly reject or the offer expires.
- Admin can force reassignment if partner is offline with assigned job.

### 2.5 Concurrent Accept Race Condition
**Scenario:** Two partners both accept the same job simultaneously.
**Handling:** `withProfessionalJobLock(jobRowId)` acquires a Catalyst Cache lock before any state mutation. Only one accept can hold the lock; the second gets `ALREADY_ASSIGNED (409)` — not an error for the app (idempotent).

---

## 3. Partner/Professional Failures

### 3.1 Professional Offline (No Internet) Mid-Job
**Scenario:** Professional loses connectivity while `EN_ROUTE`.
**Handling:**
- GPS cache expires → customer sees `STALE`.
- Job FSM state persists — no automatic cancellation.
- Professional's app queues location updates locally and sends when reconnected.
- All job actions (arrive, OTP verify, complete) can be performed offline and synced.

### 3.2 Professional No-Show
**Scenario:** Professional accepted but never arrived.
**Detection:** Customer reports issue / admin review.
**Handling:**
1. Admin cancels job from admin panel.
2. Job: `ACCEPTED/EN_ROUTE → CANCELLED`.
3. `PROFESSIONAL_JOB_NO_SHOW` notification sent to partner.
4. Refund initiated for customer.
5. Partner's acceptance rate tracked (future: automatic suspension for high no-show rate).

### 3.3 Professional KYC Rejected Mid-Activity
**Scenario:** Admin rejects KYC after partner has active jobs.
**Handling:**
- `Delivery_Partners.status` → `kyc_rejected`.
- `isPartnerOperational()` returns false.
- Active jobs continue to completion (already ACCEPTED/STARTED).
- No new jobs can be assigned.
- Partner cannot go online after current session ends.
- Notification sent to partner.

---

## 4. Network / API Failures

### 4.1 Catalyst Function Cold Start
**Scenario:** Function hasn't received a request in > 10 minutes, cold start causes delay.
**Handling:** First request may take 2–5 seconds. App shows loading indicator. No data loss.

### 4.2 ZCQL Query Timeout
**Scenario:** Data Store query times out under high load.
**Handling:**
- All critical queries wrapped in try/catch.
- Fallback to empty arrays (`rowsOf` returns `[]` on error).
- Idempotency keys prevent duplicate creation on retry.
- App can safely retry failed GET requests.

### 4.3 WhatsApp Notification Failure
**Scenario:** SalesIQ WhatsApp API is down or rate-limited.
**Handling:**
- `notifyPartnerWithRetry` retries up to 3 times.
- On final failure: `delivery_status = 'FAILED'` in `WhatsApp_Notifications`.
- Job proceeds normally — notification failure does NOT block job flow.
- In-app notification always sent as backup.

### 4.4 Payment Webhook Delay / Retry
**Scenario:** Razorpay sends webhook with delay or sends it multiple times.
**Handling:**
- Webhook handler is idempotent: checks `razorpay_payment_id` before processing.
- `payment_status = 'PAID'` + `status = 'CONFIRMED'` only set once.
- Duplicate webhooks are silently ignored after first processing.

---

## 5. Booking / Order Failures

### 5.1 Duplicate Booking
**Scenario:** Customer submits booking twice (double tap, network retry).
**Handling:**
- `idempotency_key` on Professional_Jobs prevents duplicate job creation.
- Booking creation: check for existing booking for same service+time+user before inserting.
- Response: `{ job: existing_job, created: false, idempotent: true }`.

### 5.2 Invalid OTP at Arrival
**Scenario:** Professional enters wrong OTP at customer location.
**Handling:**
- `INVALID_OTP (409)` returned.
- 3 attempts allowed before lockout.
- After lockout: customer can request a new OTP.
- Professional can call customer for manual OTP delivery.

### 5.3 OTP Expired
**Scenario:** Arrival OTP window has passed (e.g., professional took too long).
**Handling:**
- `OTP_EXPIRED (409)` returned.
- Customer requests a fresh OTP (valid for 10 minutes).

### 5.4 Booking for Past Date/Time
**Scenario:** Customer tries to book for a time in the past.
**Handling:**
- Validation: `scheduled_at` must be > now + 30 minutes.
- Returns `VALIDATION_ERROR (422)` with message.

### 5.5 Slot Already Booked (Race Condition)
**Scenario:** Two customers book the same professional at the same time.
**Handling:**
- `Appointment_Slots.is_booked` checked atomically before creating booking.
- First to commit wins; second gets `SLOT_UNAVAILABLE (409)`.

---

## 6. Payment Failures

### 6.1 Payment Failed
**Scenario:** Customer's payment is declined.
**Handling:**
- Razorpay webhook: `payment.failed` event.
- `Orders.payment_status → FAILED`.
- No Professional_Job created (checked: `!paid && !codEligible → INVALID_REFERENCE_STATE`).
- Customer sees payment failure screen → retry or choose COD.

### 6.2 Refund Processing Failure
**Scenario:** Zoho Books / Razorpay refund call fails.
**Handling:**
- Refund is queued; admin manually triggers from admin panel.
- Order status set to `REFUND_PENDING` until confirmed.
- Customer notified via WhatsApp once refund is processed.

---

## 7. Inventory Failures

### 7.1 Out-of-Stock During Checkout
**Scenario:** Item was in-stock when added to cart but sold out by checkout.
**Handling:**
- `checkout-engine.js` re-checks inventory at checkout time.
- `ITEM_OUT_OF_STOCK (409)` returned with out-of-stock product IDs.
- Cart remains intact; customer must remove OOS items before re-attempting.

### 7.2 Negative Inventory
**Scenario:** Race condition causes inventory to go below zero.
**Handling:**
- `inventory-invariants.js` checks for negative quantities.
- `inventory-remediation.js` auto-corrects to zero if detected.
- `Stock_Movements` table tracks all changes for forensic analysis.

---

## 8. KYC Failures

### 8.1 File Upload Fails
**Scenario:** Document file upload to Catalyst File Store times out.
**Handling:**
- Upload endpoint returns `FILE_UPLOAD_FAILED (500)`.
- Client retries the upload independently.
- KYC row is NOT created until upload succeeds (upload is a prerequisite).

### 8.2 KYC Re-Submission After Rejection
**Scenario:** Partner's KYC was rejected; they want to re-submit.
**Handling:**
- Rejected partner can submit a new KYC row (`kyc_type = 'UPDATE'`).
- Old rejected row is not deleted (audit trail).
- New submission enters `PENDING → SUBMITTED → UNDER_REVIEW`.
- `Delivery_Partners.status` remains `kyc_rejected` until new submission is `APPROVED`.

---

## 9. Admin / System Failures

### 9.1 Dispatch Cron Fails
**Scenario:** Cron job errors mid-run.
**Handling:**
- Remaining `ASSIGNMENT_PENDING` jobs are retried on the next cron cycle (2 minutes).
- Individual job dispatch errors are caught and logged; other jobs in the batch continue.

### 9.2 Finance Settlement Fails at Completion
**Scenario:** `settleProfessionalJobFinance()` throws during job completion.
**Handling:**
- Finance settlement is idempotent: checked by `findEarningByJob()` before creating.
- Job is marked `COMPLETED` regardless of finance failure.
- Admin can manually trigger settlement via admin API.
- Alerts logged for investigation.
