# Salon Data Relationship Map

```
Outlets (salon locations — KEEP)
  ├── salon_code  ↔  CSV salon_code / Outlets.code
  ├── Outlet_Packages
  │     └── Salon_Packages  ↔  CSV package_code / package_category
  ├── Outlet_Service_Prices  ↔  CSV male_price / female_price / both_price
  │     ├── outlet_id
  │     ├── package_id
  │     ├── service_id
  │     └── gender (MALE | FEMALE | UNISEX)
  └── Staff  ↔  CSV staff_id (stored as import email key)
        └── Staff_Services  ↔  CSV staff_id + service_code rows

Salon_Services (global catalog)  ↔  CSV service_code / service_name / service_category
```

## CSV → database mapping

| CSV column | Database target |
|------------|-----------------|
| `salon_code` | `Outlets.code` lookup |
| `salon_id` | `Outlets.ROWID` (optional update) |
| `package_code` | `Salon_Packages.slug` |
| `package_category` | Validates tier (GOLD, SILVER, …) |
| `service_code` | `Salon_Services.slug` (upsert key) |
| `service_name` | `Salon_Services.name` |
| `service_category` | `Salon_Services.service_type` |
| `male_price` / `female_price` | `Outlet_Service_Prices.selling_price` |
| `duration_minutes` | `Outlet_Service_Prices.duration_minutes` |
| `staff_id` | `Staff.email` = `import+<staff_id>@staff.baylen.local` |
| `staff_name` | `Staff.first_name` + `Staff.last_name` |
| `search_keywords`, `search_aliases` | Appended to `Salon_Services.description` for search |

## Import order (automatic)

1. Upsert `Salon_Services`
2. Ensure `Outlet_Packages` link
3. Upsert `Outlet_Service_Prices` per gender
4. Upsert `Staff` (if row has staff_id)
5. Upsert `Staff_Services`

## Not modified by salon CSV import

- `Outlets` location/profile rows (unless you add separate outlet import)
- `Appointments`, `Appointment_Slots`, customer accounts
- E-commerce product/catalog tables
