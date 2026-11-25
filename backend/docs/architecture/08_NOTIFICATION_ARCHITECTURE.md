# Baylen App — Notification Architecture
**Version:** 1.0 | **Date:** 2026-09-09

---

## 1. Notification Channels

| Channel | Recipient | Trigger | Storage |
|---|---|---|---|
| In-app inbox (Partner) | Professional/Rider | All job lifecycle events | `Partner_Notifications` table |
| In-app inbox (Customer) | Customer | Booking/order status changes | `Notifications` table |
| WhatsApp | Both | Critical events only | `WhatsApp_Notifications` table (audit) |
| Push (FCM) | Customer | Order shipped, arrived | Via `Devices` table (future) |

---

## 2. Partner Notification (In-App)

### 2.1 Table: Partner_Notifications
```
partner_row_id     → who to notify
notification_type  → event type (PROFESSIONAL_JOB_ASSIGNED, etc.)
title              → short heading (e.g. "New Home Service Request")
body               → full message with job details
reference_type     → PROFESSIONAL_JOB
reference_id       → job ID (for deep link)
professional_job_row_id
delivery_status    → DELIVERED | FAILED
read_at            → NULL = unread
created_at
```

### 2.2 Event Types
| `notification_type` | Trigger | Message Pattern |
|---|---|---|
| `PROFESSIONAL_JOB_ASSIGNED` | Dispatch assigns job | "New Home Service Request · {service} · {location} · {time}" |
| `PROFESSIONAL_JOB_CANCELLED` | Job cancelled | "Job #{number} has been cancelled" |
| `PROFESSIONAL_JOB_RESCHEDULED` | Customer reschedules | "Job #{number} rescheduled to {new_time}" |
| `PROFESSIONAL_JOB_NO_SHOW` | No-show recorded | "Customer no-show recorded for job #{number}" |
| `PROFESSIONAL_SUPPORT_TICKET` | Support ticket created | "Support request received" |
| `PROFESSIONAL_JOB_DELAYED` | Job running late | "Job #{number} is running late" |

### 2.3 API Endpoints
```
GET  /notifications/partner         → list (paginated, newest first)
POST /notifications/partner/read    → mark notifications read
     { notification_ids: ["..."] }
GET  /notifications/partner/count   → { unread_count }
```

### 2.4 Flutter Integration
```dart
// Professional dashboard polls every 30 seconds
// Badge shows unread_count
// Tapping a notification opens the relevant job screen
```

---

## 3. WhatsApp Notifications

### 3.1 Flow
```
Event occurs (job assigned, cancelled, etc.)
        │
        │ recordWhatsappNotification(req, {...})
        ▼
WhatsApp_Notifications table (audit record)
        │
        │ Zoho SalesIQ WhatsApp API
        │ POST https://salesiq.zoho.com/api/v2/{portal}/...
        │ { template_name, parameters: [...], to: phone }
        ▼
WhatsApp delivery to user's phone
```

### 3.2 WhatsApp Templates Required

| Template Name | Recipient | Variables |
|---|---|---|
| `professional_job_assigned` | Partner | `[job_number, service_name]` |
| `professional_job_cancelled` | Partner | `[job_number]` |
| `booking_confirmed` | Customer | `[booking_number, service_name, scheduled_time]` |
| `professional_assigned_customer` | Customer | `[professional_name, eta_minutes]` |
| `service_completed` | Customer | `[service_name]` |
| `order_confirmed` | Customer | `[order_number]` |
| `order_out_for_delivery` | Customer | `[order_number, eta_minutes]` |
| `order_delivered` | Customer | `[order_number]` |

### 3.3 Retry Logic
```javascript
// In notifyPartnerWithRetry():
const NOTIFICATION_MAX_ATTEMPTS = 3;  // from professional-lifecycle-config.js

for attempt = 1 to NOTIFICATION_MAX_ATTEMPTS:
  try:
    insertPartnerNotification()  // in-app inbox
    recordPartnerWhatsappAudit() // WhatsApp audit
    return { ok: true, attempts }
  catch:
    continue to next attempt

// After all attempts fail:
recordPartnerWhatsappAudit(deliveryStatus: 'FAILED')
return { ok: false, error: lastError.message }
```

### 3.4 WhatsApp Audit Table: WhatsApp_Notifications
```
user_id               → customer ZAID or "dp_{partner_row_id}"
notification_type     → event type
reference_type        → ORDER | SERVICE_JOB | PROFESSIONAL_JOB
reference_id          → entity ID
template_name         → WhatsApp template name
template_variables    → JSON array of variables
delivery_status       → PENDING | RECORDED | FAILED
provider_message_id   → SalesIQ message ID (for tracking)
mobile                → recipient phone number
CREATEDTIME
```

---

## 4. Customer Notifications (In-App)

### 4.1 Events
| Event | When |
|---|---|
| `BOOKING_CONFIRMED` | After service booking confirmed |
| `PROFESSIONAL_ASSIGNED` | Partner assigned to booking |
| `PROFESSIONAL_EN_ROUTE` | Partner started travel |
| `PROFESSIONAL_ARRIVED` | Partner arrived |
| `SERVICE_STARTED` | Service begins |
| `SERVICE_COMPLETED` | Service finished |
| `ORDER_CONFIRMED` | Product order placed |
| `ORDER_SHIPPED` | Order out for delivery |
| `ORDER_DELIVERED` | Order delivered |
| `BOOKING_CANCELLED` | Booking cancelled |
| `REFUND_INITIATED` | Refund started |

### 4.2 Implementation
- `Notifications` table (customer-facing).
- `order-notify.js` handles order lifecycle.
- `booking-notify.js` handles booking lifecycle.

---

## 5. Push Notifications (FCM) — Future

Current state: FCM tokens stored in `Devices` table. Push delivery not yet wired.

**Required:** A Catalyst Event Listener function that:
1. Triggers on `Professional_Jobs` and `Orders` table updates.
2. Reads `Devices` table for user's FCM token.
3. Sends push via Firebase Admin SDK.

---

## 6. Notification Decision Matrix

| Event | Partner In-App | Partner WhatsApp | Customer In-App | Customer Push |
|---|---|---|---|---|
| Job assigned | ✅ | ✅ | — | — |
| Job cancelled | ✅ | ✅ | ✅ | Future |
| Job rescheduled | ✅ | ✅ | ✅ | Future |
| Partner en route | — | — | ✅ | Future |
| Partner arrived | — | — | ✅ | Future |
| Service completed | ✅ | — | ✅ | Future |
| Booking confirmed | — | — | ✅ | ✅ Future |
| Order confirmed | — | — | ✅ | ✅ Future |
| Order out for delivery | — | — | ✅ | ✅ Future |
| Order delivered | — | — | ✅ | ✅ Future |
| Payment received | — | — | ✅ | Future |
| KYC approved/rejected | ✅ | ✅ | — | — |

---

## 7. SalesIQ Chat Integration

- Zoho SalesIQ Mobilisten SDK is embedded in the Flutter app.
- **Auto-initialization is disabled** (`SalesIqConfig.autoInitializeOnLaunch = false`).
- Chat only opens when user explicitly taps the "Chat / Support" button.
- `SalesIqService.initialize()` is called on demand.
- This prevents the GDPR consent popup on every app launch.
