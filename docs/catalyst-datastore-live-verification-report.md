# Baylen Catalyst Data Store Live Verification Report

Generated from Catalyst IaC export for project `Baylen-App` on 2026-08-23.

Export inspected:

`backend/export_36851000000295385_33179830782800.zip`

Live export summary:

- Required Baylen tables: 43
- Required tables fully ready: 43
- Existing tables with missing columns: 0
- Required tables not created yet: 0

Manual/MCP updates after export:

- `Home_Banners` created on 2026-08-23 with all required custom columns.
- `User_Profiles` created on 2026-08-23 with all required custom columns.
- `Devices` created on 2026-08-23 with all required custom columns.
- `Wishlist` created on 2026-08-23 with all required custom columns.
- `Order_Timeline` created on 2026-08-23 with all required custom columns.
- `Returns` created on 2026-08-23 with all required custom columns.
- `Refunds` created on 2026-08-23 with all required custom columns.
- `Media_Assets` created on 2026-08-23 with all required custom columns.
- `Job_Timeline` created on 2026-08-23 with all required custom columns.
- `Live_Locations` created on 2026-08-23 with all required custom columns.
- `Job_Proofs` created on 2026-08-23 with all required custom columns.
- `Reviews` created on 2026-08-23 with all required custom columns.
- `Coupons` created on 2026-08-23 with all required custom columns.
- `Notifications` created on 2026-08-23 with all required custom columns.
- `Notification_Preferences` created on 2026-08-23 with all required custom columns.
- `Audit_Logs` created on 2026-08-23 with all required custom columns.
- Missing columns added to `Brands` on 2026-08-23.
- Missing columns added to `Product_Variants` on 2026-08-23.
- Missing columns added to `Product_Media` on 2026-08-23.
- Missing columns added to `Addresses` on 2026-08-23.
- Missing columns added to `Warehouses` on 2026-08-23.
- Missing columns added to `Carts` on 2026-08-23.
- Missing columns added to `Outlets` on 2026-08-23.
- Missing columns added to `Staff` on 2026-08-23.
- Missing columns added to `Staff_Services` on 2026-08-23.
- Missing columns added to `Providers` on 2026-08-23.
- Missing columns added to `Service_Jobs` on 2026-08-23.
- Missing columns added to `Job_Dispatch` on 2026-08-23.
- Missing columns added to `Payments` on 2026-08-23.

## Ready Tables

These required tables exist and include the required backend columns:

- `Categories`
- `Brands`
- `Products`
- `Product_Variants`
- `Product_Media`
- `Home_Banners`
- `User_Profiles`
- `Addresses`
- `Devices`
- `Warehouses`
- `Inventory`
- `Stock_Movements`
- `Carts`
- `Cart_Items`
- `Wishlist`
- `Orders`
- `Order_Items`
- `Order_Timeline`
- `Returns`
- `Refunds`
- `Outlets`
- `Salon_Services`
- `Staff`
- `Staff_Services`
- `Appointment_Slots`
- `Appointments`
- `Appointment_Items`
- `Media_Assets`
- `Providers`
- `Provider_Services`
- `Service_Areas`
- `Service_Jobs`
- `Job_Items`
- `Job_Dispatch`
- `Job_Timeline`
- `Live_Locations`
- `Job_Proofs`
- `Reviews`
- `Coupons`
- `Notifications`
- `Notification_Preferences`
- `Audit_Logs`

## Create These Missing Tables

No required tables are currently missing.

## Add These Missing Columns

These tables already exist in Catalyst. Open each table's Schema View and add only the listed columns.

No required columns are currently missing.

## Verification Loop

1. Create or update one table in Catalyst Console.
2. Open Baylen Admin -> Operations -> Data Store schema.
3. Click `Run schema check`.
4. Continue with the next failing `MISSING_TABLE` or `MISSING_COLUMNS` row.
5. Stop when the admin screen shows `All required tables and columns passed`.

Catalyst Data Store schema creation is a console/IaC metadata operation. Data Store row import APIs and the `ds:import` CLI command only write records after the table and columns already exist.
