# Baylen Catalyst Data Store Verification Checklist

Use this file inside Zoho Catalyst for project `Baylen-App`.

Console path:

`Cloud Scale -> Data Store`

Rules:

- Keep Catalyst default columns such as `ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME`.
- Do not rename `ROWID`; the backend uses it as the primary id.
- Use `Text` for ids only when the checklist says text. Most relationship ids should be `Number`.
- For long URL or JSON fields, choose the largest Catalyst text length available.
- If a table already exists, only add missing columns. Do not delete production data.

Admin verification:

- Open Baylen Admin -> Operations -> Data Store schema.
- Click `Run schema check`.
- `MISSING_TABLE` means create that table in Catalyst Data Store first.
- `MISSING_COLUMNS` means open that table's Schema View and add only the listed missing columns.
- `READY` means the table exists with every column currently required by the Baylen backend.
- After each table is created or updated, run the schema check again and continue from the next failing row.

## Setup Order

1. Create reference/catalog tables.
2. Create account/profile tables.
3. Create commerce/cart/order tables.
4. Create salon/booking tables.
5. Create FSM/provider/live tracking tables.
6. Create engagement/payment/notification/audit tables.
7. Seed minimum active data.
8. Run the smoke tests at the end of this file.

## 1. Reference And Catalog Tables

### Categories

| Column | Type | Required for |
| --- | --- | --- |
| `name` | Text | category display |
| `slug` | Text | category URLs/search |
| `description` | Text | detail text |
| `category_type` | Text | `PRODUCT`, `SALON_SERVICE`, `HOME_SERVICE` |
| `image_url` | Text | category image |
| `display_order` | Number | sort order |
| `is_active` | Boolean | public visibility |

Seed at least:

- Product categories: Hair Care, Skin Care, Nail Care, Makeup, Fragrance, Body Care, Beauty Tools, Salon Products.
- Service categories: Bronze, Silver, Gold, Luxury, Royal or service categories used by salons.

### Brands

| Column | Type | Required for |
| --- | --- | --- |
| `name` | Text | brand display |
| `slug` | Text | brand lookup |
| `logo_url` | Text | brand logo |
| `banner_url` | Text | brand banner |
| `description` | Text | brand detail |
| `rating` | Decimal | rating display |
| `review_count` | Number | review count |
| `is_active` | Boolean | public visibility |

### Products

| Column | Type | Required for |
| --- | --- | --- |
| `name` | Text | product display |
| `slug` | Text | product lookup |
| `sku` | Text | admin/search |
| `brand_id` | Number | relation to `Brands.ROWID` |
| `category_id` | Number | relation to `Categories.ROWID` |
| `product_type` | Text | product grouping |
| `short_description` | Text | listing/search |
| `description` | Text | detail page |
| `mrp` | Decimal | original price |
| `selling_price` | Decimal | sale price |
| `currency` | Text | usually `INR` |
| `tax_percent` | Decimal | checkout tax basis |
| `thumbnail_url` | Text | product card image |
| `has_variants` | Boolean | variant selector |
| `is_featured` | Boolean | home featured strip |
| `status` | Text | `ACTIVE`, `DRAFT`, `INACTIVE` |

Seed at least 5 active products before testing home/shop.

### Product_Variants

| Column | Type | Required for |
| --- | --- | --- |
| `product_id` | Number | relation to product |
| `sku` | Text | variant SKU |
| `variant_name` | Text | example: Size |
| `variant_value` | Text | example: 50 ml |
| `mrp` | Decimal | variant MRP |
| `selling_price` | Decimal | variant price |
| `currency` | Text | usually `INR` |
| `is_active` | Boolean | public visibility |

### Product_Media

| Column | Type | Required for |
| --- | --- | --- |
| `product_id` | Number | relation to product |
| `variant_id` | Number | optional relation to variant |
| `media_type` | Text | `IMAGE` or `VIDEO` |
| `file_url` | Text | File Store/public URL |
| `display_order` | Number | gallery sort |
| `is_active` | Boolean | public visibility |

### Home_Banners

| Column | Type | Required for |
| --- | --- | --- |
| `title` | Text | home banner headline |
| `subtitle` | Text | home banner copy |
| `image_url` | Text | banner image |
| `video_url` | Text | optional banner video |
| `action_type` | Text | `SHOP`, `SERVICE`, `OUTLET`, etc. |
| `action_value` | Text | route/id/search value |
| `display_order` | Number | banner sort |
| `is_active` | Boolean | home visibility |

Seed at least 1 active banner for the guest home screen.

## 2. Account Tables

### User_Profiles

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `full_name` | Text |
| `mobile` | Text |
| `email` | Text |
| `gender` | Text |
| `date_of_birth` | Text or Date |
| `profile_photo_url` | Text |
| `default_address_id` | Number |
| `loyalty_tier` | Text |
| `loyalty_points` | Number |
| `is_active` | Boolean |

### Addresses

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `label` | Text |
| `full_name` | Text |
| `phone` | Text |
| `line1` | Text |
| `line2` | Text |
| `city` | Text |
| `state` | Text |
| `postal_code` | Text |
| `country` | Text |
| `latitude` | Text |
| `longitude` | Text |
| `is_default` | Boolean |
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
| `last_active_at` | DateTime or Text |
| `is_active` | Boolean |

## 3. Commerce, Cart, And Order Tables

### Warehouses

| Column | Type |
| --- | --- |
| `name` | Text |
| `code` | Text |
| `outlet_id` | Number |
| `address_line1` | Text |
| `city` | Text |
| `state` | Text |
| `is_active` | Boolean |

Seed at least 1 active warehouse.

### Inventory

| Column | Type |
| --- | --- |
| `warehouse_id` | Number |
| `product_id` | Number |
| `variant_id` | Number |
| `quantity_on_hand` | Number |
| `quantity_reserved` | Number |
| `status` | Text |
| `is_active` | Boolean |

Seed inventory for every test product. Use `status = ACTIVE`, `is_active = true`, and positive `quantity_on_hand`.

### Stock_Movements

| Column | Type |
| --- | --- |
| `inventory_id` | Number |
| `warehouse_id` | Number |
| `product_id` | Number |
| `variant_id` | Number |
| `movement_type` | Text |
| `quantity` | Number |
| `reference_type` | Text |
| `reference_id` | Number |
| `notes` | Text |

### Carts

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `status` | Text |
| `currency` | Text |
| `coupon_code` | Text |
| `discount_amount` | Decimal |
| `is_active` | Boolean |

### Cart_Items

| Column | Type |
| --- | --- |
| `cart_id` | Number |
| `product_id` | Number |
| `variant_id` | Number |
| `quantity` | Number |
| `unit_mrp` | Decimal |
| `unit_price` | Decimal |
| `is_active` | Boolean |

### Wishlist

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `product_id` | Number |
| `variant_id` | Number |
| `is_active` | Boolean |

### Orders

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `order_number` | Text |
| `status` | Text |
| `payment_status` | Text |
| `currency` | Text |
| `subtotal` | Decimal |
| `discount_amount` | Decimal |
| `coupon_code` | Text |
| `tax_amount` | Decimal |
| `shipping_amount` | Decimal |
| `grand_total` | Decimal |
| `shipping_name` | Text |
| `shipping_phone` | Text |
| `shipping_line1` | Text |
| `shipping_city` | Text |
| `shipping_state` | Text |
| `shipping_postal_code` | Text |
| `shipping_country` | Text |
| `notes` | Text |

### Order_Items

| Column | Type |
| --- | --- |
| `order_id` | Number |
| `product_id` | Number |
| `variant_id` | Number |
| `product_name` | Text |
| `sku` | Text |
| `quantity` | Number |
| `unit_mrp` | Decimal |
| `unit_price` | Decimal |
| `tax_percent` | Decimal |
| `line_total` | Decimal |
| `status` | Text |

### Order_Timeline

| Column | Type |
| --- | --- |
| `order_id` | Number |
| `status` | Text |
| `note` | Text |
| `actor_type` | Text |
| `happened_at` | DateTime or Text |

### Returns

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `order_id` | Number |
| `order_item_id` | Number |
| `reason` | Text |
| `status` | Text |

### Refunds

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `reference_type` | Text |
| `reference_id` | Number |
| `payment_id` | Number |
| `amount` | Decimal |
| `currency` | Text |
| `reason` | Text |
| `status` | Text |

## 4. Salon And Booking Tables

### Outlets

| Column | Type |
| --- | --- |
| `name` | Text |
| `slug` | Text |
| `code` | Text |
| `salon_category` | Text |
| `address_line1` | Text |
| `city` | Text |
| `state` | Text |
| `postal_code` | Text |
| `phone` | Text |
| `latitude` | Text |
| `longitude` | Text |
| `opening_time` | Text |
| `closing_time` | Text |
| `rating` | Decimal |
| `review_count` | Number |
| `image_url` | Text |
| `video_url` | Text |
| `is_active` | Boolean |

Seed at least 1 active outlet.

### Salon_Services

| Column | Type |
| --- | --- |
| `name` | Text |
| `slug` | Text |
| `description` | Text |
| `category_id` | Number |
| `image_url` | Text |
| `duration_minutes` | Number |
| `gender` | Text |
| `mrp` | Decimal |
| `selling_price` | Decimal |
| `currency` | Text |
| `status` | Text |
| `is_active` | Boolean |

Seed at least 5 active services.

### Staff

| Column | Type |
| --- | --- |
| `first_name` | Text |
| `last_name` | Text |
| `designation` | Text |
| `profile_photo_url` | Text |
| `outlet_id` | Number |
| `experience_years` | Number |
| `rating` | Decimal |
| `completed_services` | Number |
| `status` | Text |
| `is_active` | Boolean |

### Staff_Services

| Column | Type |
| --- | --- |
| `staff_id` | Number |
| `service_id` | Number |
| `price_override` | Decimal |
| `is_active` | Boolean |

### Appointment_Slots

| Column | Type |
| --- | --- |
| `outlet_id` | Number |
| `staff_id` | Number |
| `service_id` | Number |
| `slot_date` | Date or Text |
| `start_time` | Text |
| `end_time` | Text |
| `status` | Text |
| `appointment_id` | Number |

Seed slots with `status = AVAILABLE`.

### Appointments

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `outlet_id` | Number |
| `staff_id` | Number |
| `slot_id` | Number |
| `appointment_number` | Text |
| `appointment_date` | Date or Text |
| `start_time` | Text |
| `end_time` | Text |
| `status` | Text |
| `payment_status` | Text |
| `currency` | Text |
| `subtotal` | Decimal |
| `discount_amount` | Decimal |
| `tax_amount` | Decimal |
| `grand_total` | Decimal |

### Appointment_Items

| Column | Type |
| --- | --- |
| `appointment_id` | Number |
| `service_id` | Number |
| `staff_id` | Number |
| `service_name` | Text |
| `duration_minutes` | Number |
| `quantity` | Number |
| `unit_price` | Decimal |
| `line_total` | Decimal |
| `status` | Text |

### Media_Assets

| Column | Type |
| --- | --- |
| `media_type` | Text |
| `file_id` | Text |
| `folder_id` | Text |
| `file_name` | Text |
| `file_url` | Text |
| `content_type` | Text |
| `file_size` | Number |
| `mapped_entity_type` | Text |
| `mapped_entity_id` | Number |
| `mapped_field` | Text |
| `is_active` | Boolean |

## 5. FSM And Provider Tables

### Providers

| Column | Type |
| --- | --- |
| `first_name` | Text |
| `last_name` | Text |
| `phone` | Text |
| `rating` | Decimal |
| `status` | Text |
| `is_active` | Boolean |

Use `status = AVAILABLE` for providers eligible for dispatch.

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
| `requested_at` | DateTime or Text |
| `scheduled_at` | DateTime or Text |
| `grand_total` | Decimal |
| `currency` | Text |

### Job_Items

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `service_id` | Number |
| `service_name` | Text |
| `quantity` | Number |
| `unit_price` | Decimal |
| `line_total` | Decimal |

### Job_Dispatch

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `status` | Text |
| `offered_at` | DateTime or Text |
| `accepted_at` | DateTime or Text |
| `rejected_at` | DateTime or Text |
| `notes` | Text |

### Job_Timeline

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `status` | Text |
| `note` | Text |
| `happened_at` | DateTime or Text |

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
| `recorded_at` | DateTime or Text |

### Job_Proofs

| Column | Type |
| --- | --- |
| `job_id` | Number |
| `provider_id` | Number |
| `file_url` | Text |
| `proof_type` | Text |
| `notes` | Text |

## 6. Engagement, Payment, Notification, And Audit Tables

### Reviews

| Column | Type |
| --- | --- |
| `user_id` | Number |
| `target_type` | Text |
| `target_id` | Number |
| `rating` | Number |
| `review` | Text |
| `status` | Text |
| `is_active` | Boolean |

### Coupons

| Column | Type |
| --- | --- |
| `code` | Text |
| `title` | Text |
| `description` | Text |
| `discount_type` | Text |
| `discount_value` | Decimal |
| `min_order_value` | Decimal |
| `starts_at` | DateTime or Text |
| `ends_at` | DateTime or Text |
| `usage_limit` | Number |
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
| `read_at` | DateTime or Text |

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

### Audit_Logs

| Column | Type |
| --- | --- |
| `actor_user_id` | Number |
| `actor_type` | Text |
| `action` | Text |
| `entity_type` | Text |
| `entity_id` | Text |
| `before_json` | Text |
| `after_json` | Text |
| `ip_address` | Text |

## Minimum Seed Data For First Test

Create these rows before testing the app:

- 1 `Home_Banners` row with `is_active = true`.
- 5 `Categories` rows where `category_type = PRODUCT`.
- 3 `Categories` rows where `category_type = SALON_SERVICE`.
- 3 `Brands` rows with `is_active = true`.
- 5 `Products` rows with `status = ACTIVE`.
- 1 `Warehouses` row with `is_active = true`.
- 5 `Inventory` rows linked to products with `quantity_on_hand > 0`, `quantity_reserved = 0`, `status = ACTIVE`, `is_active = true`.
- 1 `Outlets` row with `is_active = true`.
- 5 `Salon_Services` rows with `status = ACTIVE`, `is_active = true`.
- 2 `Staff` rows with `status = ACTIVE`, `is_active = true`.
- `Staff_Services` rows linking staff to services.
- `Appointment_Slots` rows with `status = AVAILABLE`.
- 1 `Providers` row with `status = AVAILABLE`, `is_active = true`.
- `Provider_Services` and `Service_Areas` rows for that provider.
- 1 active `Coupons` row if testing the coupon UI.

## Verification Smoke Tests

After creating the tables and seed rows, test in this order:

1. `GET /health`
2. `GET /v1/home`
3. `GET /v1/catalog/categories?type=PRODUCT`
4. `GET /v1/catalog/products`
5. `GET /v1/salon/outlets`
6. Sign in, then `GET /v1/profile`
7. Add product to cart, then `GET /v1/cart`
8. Apply coupon, then checkout
9. Book a salon appointment from an available slot
10. Admin: `GET /v1/admin/summary`
11. Admin: `GET /v1/admin/audit-logs`
12. Admin: `GET /v1/admin/inventory/movements`
13. Provider: `GET /v1/provider/jobs?provider_id=<id>`

## Common Missing-Column Symptoms

| Symptom | Likely missing table/column |
| --- | --- |
| Home page loads empty | `Home_Banners`, active `Products`, active `Outlets`, active `Salon_Services` |
| Shop product detail fails | `Product_Variants`, `Product_Media`, `Inventory` |
| Add to cart fails | `Carts`, `Cart_Items`, `Inventory.quantity_on_hand`, `Inventory.quantity_reserved` |
| Checkout fails | `Orders`, `Order_Items`, `Order_Timeline`, `Stock_Movements` |
| Booking fails | `Appointment_Slots`, `Appointments`, `Appointment_Items`, `Staff_Services` |
| Admin Ops tab fails | `Audit_Logs`, `Stock_Movements`, `Orders`, `Appointments` |
| FSM tracking fails | `Service_Jobs`, `Job_Timeline`, `Live_Locations`, `Providers` |
| Provider proof fails | `Job_Proofs` |
| Notifications fail | `Notifications`, `Notification_Preferences`, `Devices` |
| Payment intent fails | `Payments`, `Refunds`, payment env vars |
