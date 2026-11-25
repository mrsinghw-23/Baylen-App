# Baylen App — Complete API Specification
**Version:** 1.0 | **Date:** 2026-09-09

Base URL: `https://baylen-api.zohocloud.com/server/baylen-api/api`

All authenticated requests require:
```
Authorization: Bearer <token>
Content-Type: application/json
```

---

## 1. Authentication (`/auth`)

### POST /auth/delivery-partner/otp/request
Start OTP for professional/rider login or registration.
```json
Request:  { "phone": "+919876543210", "purpose": "LOGIN" | "REGISTER" }
Response: { "challenge_id": "...", "expires_in": 300 }
```

### POST /auth/delivery-partner/otp/verify
```json
Request:  { "challenge_id": "...", "otp": "123456", "phone": "..." }
Response: { "token": "<jwt>", "partner": { id, name, status, kyc_status }, "is_new": false }
```

### POST /auth/delivery-partner/refresh
```json
Request:  { "token": "..." }
Response: { "token": "<new_jwt>" }
```

---

## 2. Delivery Partner Registration & KYC (`/delivery-partner`)

### POST /delivery-partner/register
Register a new professional/rider (creates Delivery_Partners row).
```json
Request:  { "phone": "...", "full_name": "...", "email": "...", "outlet_id": "..." }
Response: { "partner_id": "...", "status": "pending" }
```

### GET /delivery-partner/profile
```json
Response: {
  "partner_id": "...", "full_name": "...", "phone": "...",
  "status": "active", "online_status": "OFFLINE",
  "rating": 4.8, "kyc_status": "APPROVED",
  "profile_photo_url": "...", "outlet": { id, name }
}
```

### PUT /delivery-partner/profile
Update name, email, profile photo.
```json
Request:  { "full_name": "...", "email": "..." }
Response: { "updated": true }
```

### POST /delivery-partner/availability
Toggle online/offline status.
```json
Request:  { "online": true | false }
Response: { "online_status": "ONLINE_AVAILABLE" | "OFFLINE" }
Errors:   KYC_REQUIRED (403), SUSPENDED (403)
```

### POST /delivery-partner/kyc/submit
Submit KYC documents.
```json
Request:  {
  "full_name": "...", "date_of_birth": "YYYY-MM-DD",
  "pan_number": "...", "aadhaar_number": "...",
  "bank_account_number": "...", "bank_ifsc": "...", "bank_account_name": "...",
  "address_line1": "...", "city": "...", "state": "...",
  "district": "...", "postal_code": "..."
}
Response: { "kyc_id": "...", "status": "SUBMITTED" }
```

### POST /delivery-partner/kyc/upload
Upload a KYC document file. (multipart/form-data)
```
Field: document_type → "PAN" | "AADHAAR_FRONT" | "AADHAAR_BACK" | "BANK_PROOF" | "PROFILE_PHOTO"
Field: file → binary
Response: { "file_url": "filestore:...", "document_type": "..." }
```

### GET /delivery-partner/kyc/status
```json
Response: {
  "kyc_status": "PENDING" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED",
  "rejection_reason": "...",
  "documents": { pan_submitted: true, aadhaar_submitted: false, ... }
}
```

### GET /delivery-partner/kyc/document/:type
Download a KYC document. Returns signed URL or binary.

---

## 3. Professional Jobs (`/professional-jobs`)

### GET /professional-jobs
List partner's jobs.
```json
Query:    { status?: "ASSIGNED|ACCEPTED|...", limit?: 20, page?: 1 }
Response: {
  "jobs": [{
    "id": "...", "job_number": "PJ2026...",
    "job_type": "HOME_SERVICE" | "PRODUCT_DELIVERY",
    "status": "ASSIGNED",
    "service_name": "...", "customer_address": "...",
    "scheduled_at": "...", "amount": 850.00,
    "outlet": { name, address }
  }],
  "total": 5
}
```

### GET /professional-jobs/:id
Get single job with full context.
```json
Response: {
  "job": { ...job fields... },
  "context": {
    "service_name": "...",
    "drop_address": "...",
    "destination": { latitude, longitude },
    "pickup": { latitude, longitude, name },
    "scheduled_at": "...", "duration_minutes": 60
  },
  "finance": { net_amount, gross_amount, commission_amount },
  "offer_expires_at": "...",
  "offer_ttl_seconds": 720
}
```

### POST /professional-jobs/:id/accept
Accept a job offer.
```json
Request:  {}
Response: { "accepted": true, "job_status": "ACCEPTED" }
Errors:   OFFER_EXPIRED (409), ALREADY_ASSIGNED (409), JOB_NOT_FOUND (404)
```

### POST /professional-jobs/:id/reject
Reject a job offer.
```json
Request:  { "reason": "TOO_FAR" | "SCHEDULE_CONFLICT" | "OTHER" }
Response: { "rejected": true }
```

### POST /professional-jobs/:id/start-travel
Mark EN_ROUTE (home service only). Starts GPS tracking.
```json
Request:  {}
Response: { "new_status": "EN_ROUTE", "tracking_active": true }
Errors:   JOB_NOT_TRACKABLE (409)
```

### POST /professional-jobs/:id/start-pickup
Mark GOING_TO_PICKUP (product delivery). Starts GPS tracking.
```json
Request:  {}
Response: { "new_status": "GOING_TO_PICKUP", "tracking_active": true }
```

### POST /professional-jobs/:id/arrive
Mark ARRIVED at customer location or store.
```json
Request:  { "latitude"?: ..., "longitude"?: ... }
Response: { "new_status": "ARRIVED" }
```

### POST /professional-jobs/:id/verify-arrival-otp
Verify OTP presented by customer.
```json
Request:  { "otp": "123456" }
Response: { "new_status": "OTP_VERIFIED" }
Errors:   INVALID_OTP (409), OTP_EXPIRED (409)
```

### POST /professional-jobs/:id/start-service
Mark service started.
```json
Request:  {}
Response: { "new_status": "STARTED" }
```

### POST /professional-jobs/:id/complete
Mark job completed. Triggers finance settlement.
```json
Request:  { "proof_file_url"?: "filestore:...", "notes"?: "..." }
Response: {
  "completed": true, "new_status": "COMPLETED",
  "finance": {
    "net_amount": 680.00, "gross_amount": 850.00,
    "commission_amount": 170.00, "earning_number": "PE2026..."
  }
}
```

### POST /professional-jobs/:id/location
Publish GPS coordinates.
```json
Request: {
  "latitude": 12.9716, "longitude": 77.5946,
  "accuracy_m": 15.5, "speed_mps": 8.3,
  "heading": 270, "captured_at": "2026-09-09T08:30:00.000Z"
}
Response: { "recorded": true, "location_status": "LIVE" }
Errors:   TRACKING_NOT_ALLOWED (409), LOCATION_INVALID (422)
```

### GET /professional-jobs/:id/customer-tracking
Customer-side tracking endpoint.
```json
Response: {
  "tracking_allowed": true, "location_status": "LIVE",
  "latitude": 12.9716, "longitude": 77.5946,
  "accuracy_m": 15.5, "speed_mps": 8.3, "heading": 270,
  "captured_at": "...", "age_seconds": 4,
  "destination": { "latitude": ..., "longitude": ... },
  "route": { "distance_km": 2.4, "eta_minutes": 7, "eta_label": "7 mins away" },
  "arrived": false, "otp_verified": false,
  "service_started": false, "service_completed": false
}
```

---

## 4. Partner Dashboard (`/professional-jobs` + `/delivery-partner`)

### GET /delivery-partner/dashboard
```json
Response: {
  "partner": { name, photo_url, kyc_status, online_status },
  "today": { jobs_completed: 3, earnings: 2040.00 },
  "week": { jobs_completed: 12, earnings: 8160.00 },
  "total": { jobs_completed: 87, earnings: 59160.00 },
  "pending_earnings": 850.00,
  "available_earnings": 5200.00,
  "unread_notifications": 2,
  "current_job": { ...job or null }
}
```

### GET /delivery-partner/earnings
```json
Query:    { limit?: 50 }
Response: {
  "earnings": [{
    "earning_id": "...", "earning_number": "PE2026...",
    "job_id": "...", "job_type": "HOME_SERVICE",
    "job_title": "Hair Color Treatment",
    "gross_amount": 850.00, "commission_amount": 170.00,
    "net_amount": 680.00, "status": "AVAILABLE",
    "completed_at": "2026-09-08T14:30:00"
  }],
  "summary": { pending: 850.00, available: 5200.00, total: 59160.00 }
}
```

---

## 5. At-Home Beauty Booking (`/at-home-beauty`)

### POST /at-home-beauty/book
Create a home service booking.
```json
Request: {
  "outlet_id": "...", "service_id": "...",
  "scheduled_at": "2026-09-10T10:00:00",
  "address": {
    "line1": "...", "city": "Bengaluru",
    "state": "Karnataka", "postal_code": "560001",
    "latitude": 12.9716, "longitude": 77.5946
  },
  "payment_method": "RAZORPAY" | "COD"
}
Response: {
  "booking_id": "...", "booking_number": "SJ2026...",
  "status": "CONFIRMED",
  "razorpay_order_id"?: "...",
  "amount": 850.00
}
```

### GET /at-home-beauty/bookings
List customer's home service bookings.

### GET /at-home-beauty/bookings/:id
Get single booking with job tracking info.

### POST /at-home-beauty/bookings/:id/cancel
Cancel booking.
```json
Request:  { "reason": "..." }
Response: { "cancelled": true, "refund_initiated": true }
```

### POST /at-home-beauty/bookings/:id/reschedule
Reschedule to new date/time.
```json
Request:  { "scheduled_at": "2026-09-12T14:00:00" }
Response: { "rescheduled": true, "new_scheduled_at": "..." }
```

---

## 6. Catalog & Shop (`/catalog`, `/search`)

### GET /catalog/products
```json
Query:  { category_id?, brand?, page?, limit?, sort? }
Response: { products: [...], total, page, limit }
```

### GET /catalog/products/:id
Full product detail with variants and availability.

### GET /search
```json
Query: { q: "lipstick", type?: "products|services|outlets" }
Response: { products: [...], services: [...], outlets: [...] }
```

---

## 7. Cart & Checkout (`/cart`, `/checkout`)

### GET /cart
### POST /cart/items — add item
### PUT /cart/items/:id — update quantity
### DELETE /cart/items/:id — remove item

### POST /checkout
Create order from cart.
```json
Request: {
  "address_id": "...",
  "payment_method": "RAZORPAY" | "COD",
  "coupon_code"?: "SAVE20"
}
Response: {
  "order_id": "...", "order_number": "ORD2026...",
  "razorpay_order_id"?: "...",
  "amount": 1250.00
}
```

---

## 8. Payments (`/payments`)

### POST /payments/razorpay-webhook
Razorpay webhook handler. Verifies HMAC signature, updates order status.

### GET /payments/order/:order_id/status
```json
Response: { "payment_status": "PAID", "order_status": "CONFIRMED" }
```

---

## 9. Notifications (`/notifications`)

### GET /notifications/partner
### POST /notifications/partner/read
### GET /notifications/partner/count

---

## 10. Admin (`/admin`)

### GET /admin/delivery-partners
List all partners with KYC status.

### POST /admin/kyc/:partner_id/approve
```json
Request:  { "notes"?: "All documents verified" }
Response: { "approved": true }
```

### POST /admin/kyc/:partner_id/reject
```json
Request:  { "reason": "PAN document unclear, please re-upload" }
Response: { "rejected": true }
```

### POST /admin/dispatch-job/:job_id
Manually trigger dispatch for a pending job.

### POST /admin/assign-job
Manually assign a specific partner.
```json
Request:  { "job_id": "...", "partner_row_id": "..." }
Response: { "assigned": true }
```

### GET /admin/outlets
### POST /admin/outlets
### PUT /admin/outlets/:id

### GET /admin/services
### POST /admin/services
### PUT /admin/services/:id

### POST /admin/orders/:id/status
Update order status.

---

## 11. Serviceability (`/serviceability`)

### GET /serviceability/pincodes
List all serviceable pincodes.

### POST /serviceability/pincodes
Add new pincode.
```json
Request:  { "pincode": "560001", "city": "Bengaluru", "state": "Karnataka" }
```

### PUT /serviceability/pincodes/:pincode/toggle
Enable or disable a pincode.

---

## 12. Common Error Responses

```json
// 401 Unauthorized
{ "success": false, "error": "Authentication required", "code": "UNAUTHORIZED" }

// 403 KYC Required
{ "success": false, "error": "KYC approval required", "code": "KYC_REQUIRED" }

// 409 Invalid Transition
{ "success": false, "error": "Invalid job transition from ACCEPTED to COMPLETED", "code": "INVALID_STATUS_TRANSITION" }

// 422 Validation
{ "success": false, "error": "Field 'phone' is required", "code": "VALIDATION_ERROR" }

// 500 Internal
{ "success": false, "error": "An unexpected error occurred", "code": "INTERNAL_ERROR" }
```
