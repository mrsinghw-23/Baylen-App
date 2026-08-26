# Nearby Salon Seed Data

Use these CSV files to load real outlet GPS and salon service data into Zoho Catalyst.

## Files

- `nearby_outlets.csv` -> Catalyst Data Store table `Outlets`
- `salon_services.csv` -> Catalyst Data Store table `Salon_Services`

## Required outlet fields

`name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, video_url, is_active`

Important:

- `code` should be unique for each outlet. Re-running the seed updates the same outlet by `code`.
- `latitude` and `longitude` must be real GPS coordinates.
- `image_url` and `video_url` should normally be Catalyst File Store URLs after upload/mapping.
- `salon_category` should be one of `Bronze`, `Silver`, `Gold`, `Luxury`, `Royal`.
- Use `HH:mm` format for `opening_time` and `closing_time`.

## Required service fields

`name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency, status, is_active`

Important:

- `slug` should be unique for each service. Re-running the seed updates the same service by `slug`.
- `status` should be `ACTIVE` for services visible in the app.
- Use `INR` for `currency` unless a different currency is required.

## Seed command

From the project root:

```powershell
$env:ADMIN_API_KEY="your-catalyst-admin-key"
node tool/seed_nearby_salons.mjs
```

Optional:

```powershell
$env:BAYLEN_API_BASE="https://baylen-app-60069781151.development.catalystserverless.in"
$env:OUTLETS_CSV="backend/seeds/nearby_outlets.csv"
$env:SERVICES_CSV="backend/seeds/salon_services.csv"
node tool/seed_nearby_salons.mjs
```
