# Baylen App — Security & RBAC
**Version:** 1.0 | **Date:** 2026-09-09

---

## 1. Role Definitions

| Role | Identity Source | Access Scope |
|---|---|---|
| `customer` | Catalyst ZAID (app sign-in) | Own bookings, cart, orders, profile, addresses |
| `professional` | Custom JWT from OTP | Own jobs, KYC, availability, earnings, notifications |
| `rider` | Custom JWT from OTP | Own delivery jobs (subset of professional) |
| `admin` | Catalyst ZAID + admin flag | Full platform management, KYC review, all data |
| `outlet_manager` | Catalyst ZAID + outlet_id claim | Own outlet's appointments, staff, inventory |
| `system` | Internal function calls | Dispatch, finance settlement, cron jobs |

---

## 2. Authentication Architecture

### 2.1 Customer Authentication
- Zoho Catalyst Authentication (ZAID).
- Standard Catalyst JWT token (short-lived, auto-refreshed).
- Verified by Catalyst middleware on every request.
- User ID: `req.user.user_id` (Catalyst ZAID string).

### 2.2 Professional / Rider Authentication
- Custom OTP-based auth (`delivery-partner-auth.js`).
- Steps:
  1. POST `/auth/delivery-partner/otp/request` → stores challenge in `Auth_Otp_Challenges`.
  2. POST `/auth/delivery-partner/otp/verify` → validates OTP, issues custom JWT.
- Custom JWT contains: `{ partner_row_id, delivery_partner_id, role: "professional", exp }`.
- Token validated by session middleware on every professional route.
- Token stored in `Delivery_Partners` session on the server side.

### 2.3 Admin Authentication
- Zoho Catalyst ZAID token + role check.
- Admin role checked via `req.user.email` whitelist or `is_admin` flag in Catalyst user segment.

---

## 3. Authorization Rules by Endpoint Group

### 3.1 Public Endpoints (no auth required)
- `GET /catalog/products` (browseable catalog)
- `GET /catalog/products/:id`
- `GET /search`
- `POST /auth/*/otp/request`
- `POST /payments/razorpay-webhook` (HMAC signature required instead)

### 3.2 Customer-Only Endpoints
```
/account/*         → user_id from JWT
/cart/*            → user_id from JWT
/checkout/*        → user_id from JWT
/at-home-beauty/*  → user_id from JWT
/salon/*           → user_id from JWT
/orders/*          → user_id from JWT
```

**Data isolation rule:** Every query that touches Orders, Service_Jobs, Cart, or Addresses MUST include `WHERE user_id = {current_user_id}`.

### 3.3 Professional-Only Endpoints
```
/delivery-partner/*       → partner_row_id from DP JWT
/professional-jobs/*      → partner_row_id from DP JWT
/notifications/partner/*  → partner_row_id from DP JWT
```

**Data isolation rule:** Every job query must include `WHERE delivery_partner_row_id = {partner_row_id}`. Partner cannot see other partners' jobs.

### 3.4 Customer Tracking Endpoint
```
GET /professional-jobs/:id/customer-tracking
```
Special cross-role endpoint. Auth: Customer JWT.
Security: Verifies `order.user_id` or `service_job.user_id` equals the requesting customer before returning any location data.

### 3.5 Admin-Only Endpoints
```
/admin/*
/serviceability/*
/imports/*
/inventory/*
/low-stock/*
/fulfillment/*
/picker/*
```
Enforced by `role-guard-middleware.js`.

---

## 4. Data Access Rules

### 4.1 Phone Number Privacy
- **Customer cannot see partner phone** (ever, in any API response).
- **Partner can see masked customer phone** (last 4 digits): `••••1234`.
- Full phone only stored internally and used for WhatsApp notifications.

### 4.2 KYC Document Privacy
- KYC documents (PAN, Aadhaar, bank details) are stored in Catalyst File Store in private partner folders.
- Only accessible via `GET /delivery-partner/kyc/document/:type` (partner's own documents only).
- Admin has access to all KYC documents via admin routes.
- Documents never returned in list endpoints; always fetched individually with auth check.

### 4.3 Earnings Privacy
- Partner can only see own earnings.
- Customer has no access to partner earnings data.
- Admin can see all earnings.

### 4.4 Cross-User Data Prevention
All data queries enforce user-scoping at the query level:
```javascript
// Good (enforced):
WHERE user_id = sqlString(req.user.user_id)
WHERE delivery_partner_row_id = asId(partnerSession.partner_row_id, "partner_id")

// Never allowed:
SELECT * FROM Orders  // (missing user_id filter)
```

---

## 5. JWT Security

### 5.1 Customer Catalyst JWT
- Signed by Catalyst with RS256.
- Short-lived (Catalyst default).
- Auto-refreshed by Flutter SDK.

### 5.2 Professional Custom JWT
- Signed with `process.env.DP_JWT_SECRET` (server-side only).
- Expires in 30 days.
- Contains minimal claims: `{ partner_row_id, delivery_partner_id, role }`.
- Invalidated on: suspension, KYC rejection (checked at request time).

---

## 6. Input Validation & SQL Injection Prevention

### 6.1 ZCQL Parameterization
All ZCQL queries use helper functions that prevent injection:
```javascript
asId(value, fieldName)      // Coerces to integer, throws if invalid
sqlString(value)            // Wraps in single quotes, escapes internal quotes
isTruthy(value)             // Safe boolean conversion
```

**Never use raw string interpolation** in ZCQL queries.

### 6.2 Request Validation
- All numeric fields: parsed through `num()` helper (returns 0 for invalid).
- All string fields: trimmed and length-limited before storage.
- All enums: validated against allowlist before processing.
- File uploads: MIME type validated, stored in private File Store (no public CDN).

---

## 7. Payment Security

### 7.1 Razorpay Webhook
- `POST /payments/razorpay-webhook` validates HMAC-SHA256 signature:
  ```javascript
  crypto.createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody).digest('hex') === x-razorpay-signature
  ```
- Webhook is idempotent (re-processing same payment_id is safe).

### 7.2 COD Orders
- COD orders cannot be marked as delivered until professional submits completion.
- Earnings from COD jobs start as `COD_PENDING`, not `AVAILABLE`.

---

## 8. Audit Logging

Every critical admin action writes to `Audit_Logs`:
```json
{ "actor": admin_user_id, "action": "KYC_APPROVED", "target_id": partner_id, "metadata": {...}, "timestamp": "..." }
```

Every job state change is permanently recorded in `Job_Status_History` (immutable — no deletes allowed).

---

## 9. Rate Limiting

| Endpoint Group | Limit | Window |
|---|---|---|
| OTP request | 5 per phone | 10 minutes |
| OTP verify (wrong OTP) | 5 attempts | Per challenge |
| GPS location publish | 1 per 5 seconds | Per job |
| Partner job accept | 1 per second | Per partner |
| Admin bulk import | 1 active job | Per admin |

---

## 10. Environment & Secret Management

- All secrets stored in **Catalyst Environment Variables** (encrypted at rest).
- Never hardcoded in source code.
- `.env.example` file shows required keys without values.
- Secrets rotated: Razorpay keys quarterly, JWT secret yearly.

---

## 11. CORS Configuration

CORS domains configured in Catalyst project settings and stored in `CORS_Domains` table (manageable via `/admin/cors`). Flutter mobile app communicates via HTTPS only — CORS primarily matters for web-based admin panel.
