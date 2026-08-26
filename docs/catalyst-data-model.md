# Baylen Catalyst Data Model

This file is the working Catalyst table map for the Baylen production build.
It keeps the mobile app, API routes, and Catalyst Data Store aligned.

## Core Account

### User_Profiles
- `user_id` numeric Catalyst user id
- `full_name`, `mobile`, `email`, `gender`, `date_of_birth`
- `profile_photo_url`
- `default_address_id`
- `loyalty_tier`, `loyalty_points`
- `is_active`, `created_at`, `updated_at`

### Addresses
- `user_id`
- `label`, `full_name`, `phone`
- `line1`, `line2`, `city`, `state`, `postal_code`, `country`
- `latitude`, `longitude`
- `is_default`, `is_active`

### Devices
- `user_id`
- `device_id`, `device_type`, `platform`, `os_version`, `app_version`
- `push_token`
- `last_active_at`, `is_active`

## Commerce

### Categories
- `name`, `slug`, `description`, `category_type`
- `image_url`, `display_order`, `is_active`

### Brands
- `name`, `slug`, `logo_url`, `banner_url`, `description`
- `rating`, `review_count`, `is_active`

### Products
- `name`, `slug`, `sku`, `brand_id`, `category_id`
- `product_type`, `short_description`, `description`
- `mrp`, `selling_price`, `currency`, `tax_percent`
- `thumbnail_url`, `has_variants`, `is_featured`, `status`
- Marketplace filters currently depend on `category_id`, `brand_id`, `status`,
  `is_featured`, `name`, and `short_description`.

### Product_Variants
- `product_id`, `sku`, `variant_name`, `variant_value`
- `mrp`, `selling_price`, `currency`, `is_active`
- Variant stock is calculated from `Inventory.product_id` plus
  `Inventory.variant_id`.

### Product_Media
- `product_id`, `variant_id`, `media_type`, `file_url`
- `display_order`, `is_active`

### Warehouses
- `name`, `code`, `outlet_id`, `address_line1`, `city`, `state`
- `is_active`

### Inventory
- `warehouse_id`, `product_id`, `variant_id`
- `quantity_on_hand`, `quantity_reserved`, `status`, `is_active`
- Available stock is calculated as `quantity_on_hand - quantity_reserved`.
- Checkout reserves stock and writes a `Stock_Movements` row.

### Stock_Movements
- `inventory_id`, `warehouse_id`, `product_id`, `variant_id`
- `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes`

### Carts / Cart_Items
- `Carts`: `user_id`, `status`, `currency`, `coupon_code`,
  `discount_amount`, `is_active`
- `Cart_Items`: `cart_id`, `product_id`, `variant_id`, `quantity`, `unit_mrp`, `unit_price`, `is_active`

### Wishlist
- `user_id`, `product_id`, `variant_id`, `is_active`

### Orders / Order_Items
- `Orders`: `user_id`, `order_number`, `status`, `payment_status`,
  `currency`, `coupon_code`, totals, shipping fields
- `Order_Items`: `order_id`, `product_id`, `variant_id`, product snapshot, quantity, pricing, status
- `Orders.status` currently supports customer lifecycle values such as
  `PLACED`, `CONFIRMED`, `PROCESSING`, `DELIVERED`, `COMPLETED`, `CANCELLED`,
  and `RETURN_REQUESTED`.
- `Orders.payment_status` currently supports `PENDING`, `PAID`, `FAILED`,
  `REFUND_PENDING`, and related provider-driven states.

### Order_Timeline
- `order_id`, `status`, `note`, `actor_type`, `happened_at`
- Used by `/v1/order/timeline` for customer-facing order tracking.

### Returns / Refunds
- `Returns`: `user_id`, `order_id`, `order_item_id`, `reason`, `status`
- `Refunds`: `user_id`, `reference_type`, `reference_id`, `payment_id`,
  `amount`, `currency`, `reason`, `status`
- Customer cancellation of a paid order creates a `Refunds` row in
  `REQUESTED` status.

## Salon And Booking

### Outlets
- `name`, `slug`, `code`, `salon_category`
- `address_line1`, `city`, `state`, `postal_code`, `phone`
- `latitude`, `longitude`, `opening_time`, `closing_time`
- `rating`, `review_count`, `image_url`, `video_url`, `is_active`

### Salon_Services
- `name`, `slug`, `description`, `category_id`
- `image_url`, `duration_minutes`, `gender`, `mrp`, `selling_price`, `currency`, `status`, `is_active`

### Staff
- `first_name`, `last_name`, `designation`, `profile_photo_url`
- `outlet_id`, `experience_years`, `rating`, `completed_services`
- `status`, `is_active`

### Staff_Services
- `staff_id`, `service_id`, `price_override`, `is_active`

### Media_Assets
- `media_type`, `file_id`, `folder_id`, `file_name`, `file_url`
- `content_type`, `file_size`, `mapped_entity_type`, `mapped_entity_id`
- `mapped_field`, `is_active`

### Appointment_Slots
- `outlet_id`, `staff_id`, `service_id`
- `slot_date`, `start_time`, `end_time`
- `status`, `appointment_id`

### Appointments / Appointment_Items
- `Appointments`: `user_id`, `outlet_id`, `staff_id`, `slot_id`, `appointment_number`, date/time, status, payment_status, totals
- `Appointment_Items`: `appointment_id`, `service_id`, `staff_id`, service snapshot, duration, quantity, pricing, status

## FSM And Live Tracking

### Service_Jobs
- `user_id`, `appointment_id`, `provider_id`
- `visit_address_id`, visit address snapshot, status, requested_at, scheduled_at

### Job_Items
- `job_id`, `service_id`, `service_name`, `quantity`, pricing

### Job_Dispatch
- `job_id`, `provider_id`, `status`, `offered_at`, `accepted_at`, `rejected_at`, `notes`

### Live_Locations
- `job_id`, `provider_id`, `latitude`, `longitude`
- `heading`, `speed`, `status`, `recorded_at`

### Job_Timeline
- `job_id`, `provider_id`, `status`, `note`, `happened_at`
- Written by `/v1/jobs/status` for FSM tracking history.

### Job_Proofs
- `job_id`, `provider_id`, `file_url`, `proof_type`, `notes`
- Providers can list assigned work through `GET /v1/provider/jobs`, upload
  completion proof through `POST /v1/jobs/proof`, and update live status/location
  through the existing FSM endpoints.

## Engagement

### Reviews
- `user_id`, `target_type`, `target_id`
- `rating`, `review`, `status`, `is_active`

### Coupons
- `code`, `description`, `discount_type`, `discount_value`
- `min_order_value`, `starts_at`, `ends_at`, `usage_limit`, `is_active`

### Payments
- `user_id`, `reference_type`, `reference_id`, `provider`
- `provider_order_id`, `provider_payment_id`
- `amount`, `currency`, `status`, `metadata`
- Payment provider secrets must stay in Catalyst environment variables and
  server-side functions only. The mobile app only receives public intent data
  and posts verification references back to the API.
- Razorpay order creation runs server-side when `RAZORPAY_KEY_ID` and
  `RAZORPAY_KEY_SECRET` are configured. Successful Razorpay verification
  validates the provider signature in the Catalyst function.
- Cashfree order creation runs server-side when `CASHFREE_CLIENT_ID` and
  `CASHFREE_CLIENT_SECRET` are configured. `CASHFREE_ENV=PRODUCTION` switches
  from sandbox to production endpoints.

### Notifications
- `user_id`, `type`, `title`, `body`, `reference_type`, `reference_id`
- `delivery_status`, `read_at`
- `/v1/notifications` returns the signed-in user's alerts with `unread_count`.
- `/v1/notifications/read` marks one notification or all notifications as read.
- Phase 4 starts with Data Store-backed notification inboxes. Catalyst Push
  Notifications should be connected to the same table once Android/iOS push
  credentials and device tokens are finalized.

### Notification_Preferences
- `user_id`
- `push_enabled`, `email_enabled`
- `order_updates`, `booking_updates`, `service_tracking`, `offers`
- Used by `/v1/notifications/preferences`.

### Audit_Logs
- `actor_user_id`, `actor_type`, `action`, `entity_type`, `entity_id`
- `before_json`, `after_json`, `ip_address`

## File Storage

Use Catalyst File Store for product, outlet, service, employee, review, and proof media.
Store only the resulting file URL or file id in Data Store tables.
The admin panel uploads product, service, and outlet images through
`POST /v1/admin/files/upload` into `FILESTORE_MEDIA_FOLDER_ID` by default.
Use `FILESTORE_PRODUCT_FOLDER_ID`, `FILESTORE_SERVICE_FOLDER_ID`, or
`FILESTORE_OUTLET_FOLDER_ID` when separate folders are preferred.

## Admin And Security Environment Variables

- `AUTH_SESSION_SECRET`: required for signed customer session tokens.
- `ADMIN_API_KEY`: required for `/v1/admin/*` data-management APIs.
- `PROVIDER_API_KEY`: required for provider/FSM write APIs:
  `/v1/jobs/dispatch`, `/v1/jobs/accept`, `/v1/jobs/status`,
  and `/v1/jobs/location`.
- `FILESTORE_MEDIA_FOLDER_ID`: required for admin File Store image uploads.
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`: enables Razorpay in
  `/v1/payments/providers` and `/v1/payments/intent`.
- `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`: enables Cashfree in
  `/v1/payments/providers` and `/v1/payments/intent`.

## Admin Data Management APIs

- `GET /v1/admin/summary`: operational counts for products, services, outlets,
  orders, appointments, jobs, and low-stock inventory.
- `GET /v1/admin/schema/check`: validates required Catalyst Data Store tables
  and columns against the backend's deployed schema checklist.
- `GET /v1/admin/inventory`: low-stock-first inventory rows for the admin panel.
- `GET /v1/admin/inventory/movements`: stock movement history for inventory
  audits, releases, reservations, and admin adjustments.
- `GET /v1/admin/audit-logs`: admin change log for create, update, deactivate,
  bulk import, inventory, and media mapping actions.
- `GET /v1/admin/orders`: searchable order management list.
- `POST /v1/admin/order/status`: update order status, write order timeline,
  notify the customer, and record an audit log.
- `GET /v1/admin/bookings`: searchable booking management list.
- `POST /v1/admin/booking/status`: update booking status, keep slot status in
  sync, notify the customer, and record an audit log.
- `GET /v1/admin/products`: searchable product list for admin edit screens.
- `POST /v1/admin/product/upsert`: add or update a product row.
- `POST /v1/admin/products/bulk`: import up to 500 product CSV rows.
- `POST /v1/admin/product/status`: activate or deactivate a product without
  deleting order, review, inventory, or media history.
- `POST /v1/admin/inventory/update`: update stock and write a stock movement.
- `GET /v1/admin/services`: searchable service list for admin edit screens.
- `POST /v1/admin/service/upsert`: add or update a salon/service row.
- `POST /v1/admin/services/bulk`: import up to 500 service CSV rows.
- `POST /v1/admin/service/status`: activate or deactivate a service without
  deleting booking, review, employee, or pricing history.
- `GET /v1/admin/outlets`: searchable outlet list for admin edit screens.
- `POST /v1/admin/outlet/upsert`: add or update an outlet row.
- `POST /v1/admin/outlet/status`: activate or deactivate an outlet without
  deleting service, booking, media, or location history.
- `POST /v1/admin/files/upload`: upload product, service, and outlet images to
  Catalyst File Store.
- `GET /v1/admin/files`: list uploaded product, service, and outlet media
  tracked in `Media_Assets`.
- `POST /v1/admin/files/map`: map a media asset to a product thumbnail,
  service image, or outlet image field.
- `GET /v1/admin/media-targets`: search products, services, or outlets for
  admin image mapping.
- `GET /v1/files/download`: public image delivery proxy for File Store media.

All admin APIs require `X-Baylen-Admin-Key` matching `ADMIN_API_KEY`.
Provider write APIs require `X-Baylen-Provider-Key` matching
`PROVIDER_API_KEY`.
Signed customer session APIs include `/v1/auth/session/refresh` and
`/v1/auth/session/revoke`; revoke can also deactivate a registered device row.

Product CSV columns:
`id,name,slug,sku,brand_id,category_id,short_description,description,mrp,selling_price,currency,tax_percent,thumbnail_url,has_variants,is_featured,status`.

Service CSV columns:
`id,name,slug,description,category_id,duration_minutes,gender,mrp,selling_price,currency,status,is_active`.

Starter templates:
- `docs/admin-products-bulk-template.csv`
- `docs/admin-services-bulk-template.csv`
