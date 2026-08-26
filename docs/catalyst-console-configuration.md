# Baylen Catalyst Console Configuration

Use this checklist in the Zoho Catalyst console for project:

- Project name: `Baylen-App`
- Project ID: `36851000000230006`
- Environment: `Development`
- API function: `baylen-api`
- Function stack: Node 20 Advanced I/O

## 1. API Gateway

Location:

`Cloud Scale -> API Gateway`

Configuration:

- Keep API Gateway enabled.
- Deploy/import rules from `backend/catalyst-user-rules.json`.
- Confirm these new Phase 4-8 endpoints exist:
  - `GET /v1/notifications/preferences`
  - `POST /v1/notifications/preferences`
  - `GET /v1/jobs`
  - `GET /v1/jobs/tracking`
  - `POST /v1/jobs/status`
  - `POST /v1/jobs/location`
  - `GET /v1/payments/providers`
  - `POST /v1/auth/session/refresh`
  - `POST /v1/auth/session/revoke`
  - `GET /v1/provider/jobs`
  - `POST /v1/jobs/proof`
  - `GET /v1/admin/summary`
  - `GET /v1/admin/schema/check`
  - `GET /v1/admin/inventory`
  - `GET /v1/admin/inventory/movements`
  - `GET /v1/admin/audit-logs`
  - `GET /v1/admin/orders`
  - `POST /v1/admin/order/status`
  - `GET /v1/admin/bookings`
  - `POST /v1/admin/booking/status`
  - `GET /v1/admin/products`
  - `POST /v1/admin/product/upsert`
  - `POST /v1/admin/products/bulk`
  - `POST /v1/admin/product/status`
  - `POST /v1/admin/inventory/update`
  - `GET /v1/admin/services`
  - `POST /v1/admin/service/upsert`
  - `POST /v1/admin/services/bulk`
  - `POST /v1/admin/service/status`
  - `GET /v1/admin/outlets`
  - `POST /v1/admin/outlet/upsert`
  - `POST /v1/admin/outlet/status`
  - `POST /v1/admin/files/upload`
  - `GET /v1/admin/files`
  - `POST /v1/admin/files/map`
  - `GET /v1/admin/media-targets`
  - `GET /v1/files/download`

## 2. Function Environment Variables

Location:

`Serverless -> Functions -> baylen-api -> Configuration / Environment Variables`

Add these variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AUTH_SESSION_SECRET` | Yes | Signs Baylen customer session tokens. |
| `ADMIN_API_KEY` | Yes | Secures `/v1/admin/*` data-management APIs. |
| `PROVIDER_API_KEY` | Yes | Secures provider/FSM write APIs. |
| `FILESTORE_MEDIA_FOLDER_ID` | Yes | Default Catalyst File Store folder used by admin product/service/outlet image uploads. |
| `FILESTORE_PRODUCT_FOLDER_ID` | Optional | Product-specific File Store folder override. |
| `FILESTORE_SERVICE_FOLDER_ID` | Optional | Service-specific File Store folder override. |
| `FILESTORE_OUTLET_FOLDER_ID` | Optional | Outlet-specific File Store folder override. |
| `RAZORPAY_KEY_ID` | Optional | Enables Razorpay public key discovery. |
| `RAZORPAY_KEY_SECRET` | Optional | Enables Razorpay payment intent support. |
| `CASHFREE_CLIENT_ID` | Optional | Enables Cashfree public key discovery. |
| `CASHFREE_CLIENT_SECRET` | Optional | Enables Cashfree payment intent support. |

Rules:

- Use long random values for `AUTH_SESSION_SECRET`, `ADMIN_API_KEY`, and `PROVIDER_API_KEY`.
- Do not place real secrets in Flutter code.
- Do not commit real secrets to Git.
- After updating env vars, redeploy or restart the `baylen-api` function.

## 3. Required Data Store Tables

Location:

`Cloud Scale -> Data Store`

Use the complete step-by-step checklist here:

- `docs/catalyst-datastore-verification-checklist.md`

Create/verify these tables and columns. Keep Catalyst default columns such as
`ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME`.

### User_Profiles

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `full_name` | Text |
| `mobile` | Text |
| `email` | Text |
| `gender` | Text |
| `date_of_birth` | Text / Date |
| `profile_photo_url` | Text |
| `default_address_id` | Number |
| `loyalty_tier` | Text |
| `loyalty_points` | Number |
| `is_active` | Boolean |

### Devices

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `device_id` | Text |
| `device_type` | Text |
| `platform` | Text |
| `os_version` | Text |
| `app_version` | Text |
| `push_token` | Text |
| `last_active_at` | DateTime / Text |
| `is_active` | Boolean |

### Notification_Preferences

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `push_enabled` | Boolean |
| `email_enabled` | Boolean |
| `order_updates` | Boolean |
| `booking_updates` | Boolean |
| `service_tracking` | Boolean |
| `offers` | Boolean |

### Notifications

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `type` | Text |
| `title` | Text |
| `body` | Text |
| `reference_type` | Text |
| `reference_id` | Number |
| `delivery_status` | Text |
| `read_at` | DateTime / Text |

### Service_Jobs

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `appointment_id` | Number |
| `provider_id` | Number |
| `visit_address_id` | Number |
| `visit_line1` | Text |
| `visit_city` | Text |
| `visit_state` | Text |
| `status` | Text |
| `requested_at` | DateTime / Text |
| `scheduled_at` | DateTime / Text |
| `grand_total` | Decimal |
| `currency` | Text |

### Job_Dispatch

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `status` | Text |
| `offered_at` | DateTime / Text |
| `accepted_at` | DateTime / Text |
| `rejected_at` | DateTime / Text |
| `notes` | Text |

### Job_Timeline

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `status` | Text |
| `note` | Text |
| `happened_at` | DateTime / Text |

### Live_Locations

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `latitude` | Decimal |
| `longitude` | Decimal |
| `heading` | Decimal |
| `speed` | Decimal |
| `status` | Text |
| `recorded_at` | DateTime / Text |

### Providers

| Column | Type |
| --- | --- |
| `first_name` | Text |
| `last_name` | Text |
| `phone` | Text |
| `rating` | Decimal |
| `status` | Text |
| `is_active` | Boolean |

### Provider_Services

| Column | Type |
| --- | --- |
| `provider_id` | Number |
| `service_id` | Number |
| `is_active` | Boolean |

### Service_Areas

| Column | Type |
| --- | --- |
| `provider_id` | Number |
| `city` | Text |
| `is_active` | Boolean |

### Payments

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `reference_type` | Text |
| `reference_id` | Number |
| `provider` | Text |
| `provider_order_id` | Text |
| `provider_payment_id` | Text |
| `amount` | Decimal |
| `currency` | Text |
| `status` | Text |
| `metadata` | Text |

### Cart Coupon Columns

Verify these columns exist on `Carts`:

| Column | Type |
| --- | --- |
| `coupon_code` | Text |
| `discount_amount` | Decimal |

Verify this column exists on `Orders`:

| Column | Type |
| --- | --- |
| `coupon_code` | Text |

### Coupons

| Column | Type |
| --- | --- |
| `code` | Text |
| `title` | Text |
| `description` | Text |
| `discount_type` | Text |
| `discount_value` | Decimal |
| `min_order_value` | Decimal |
| `starts_at` | DateTime / Text |
| `ends_at` | DateTime / Text |
| `usage_limit` | Number |
| `is_active` | Boolean |

## 4. Push Notifications

Location:

`Cloud Scale -> Push Notifications`

Configuration:

- Add Android Firebase Cloud Messaging credentials.
- Add iOS APNs credentials when iOS signing is ready.
- The mobile app must register a `push_token` through:
  - `POST /v1/devices/register`
- The notification inbox is already Data Store-backed through:
  - `GET /v1/notifications`
  - `POST /v1/notifications/read`

Current status:

- Notification inbox and device-token storage are implemented.
- Actual remote push delivery still needs Catalyst Push credentials and a send step.

## 5. File Store

Location:

`Cloud Scale -> File Store`

Create folders/buckets for:

- `products`
- `brands`
- `outlets`
- `services`
- `staff`
- `reviews`
- `job-proofs`
- `home-banners`

Store file URLs or file IDs in Data Store rows.

## 6. Search

Location:

`Cloud Scale -> Search`

Configure indexing later for:

- `Products.name`
- `Products.short_description`
- `Brands.name`
- `Categories.name`
- `Salon_Services.name`
- `Outlets.name`
- `Outlets.city`

Current API search uses ZCQL filters and can be upgraded to Catalyst Search once
the index is configured.

## 7. Deployment Order

1. Create/verify Data Store tables.
2. Add function environment variables.
3. Deploy `baylen-api`.
4. Deploy API Gateway rules.
5. Test `/health`.
6. Test guest APIs:
   - `/v1/home`
   - `/v1/catalog/products`
   - `/v1/salon/outlets`
7. Test signed-in APIs:
   - `/v1/profile`
   - `/v1/cart`
   - `/v1/notifications`
   - `/v1/jobs`
8. Test admin APIs with `X-Baylen-Admin-Key`.
9. Test provider APIs with `X-Baylen-Provider-Key`.
