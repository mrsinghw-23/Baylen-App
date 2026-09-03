# Salon CSV Import

Import package-tier salon CSVs into Catalyst tables:

- `Salon_Services`
- `Outlet_Service_Prices`
- `Outlet_Packages`
- `Staff`
- `Staff_Services`

## CSV files

Place data in:

```
backend/seeds/salon/
  salon-gold.csv
  salon-silver.csv
  salon-luxury.csv
  salon-bronze.csv
  salon-royal.csv
```

Validate locally:

```powershell
node backend/scripts/validate-salon-csv.js
```

## Deploy API first

Salon import routes live on `baylen-api`. Deploy before importing:

```powershell
cd backend
catalyst deploy --only functions
```

## Cleanup old demo data

```powershell
$env:ADMIN_API_KEY="your-admin-key"
$env:BAYLEN_API_BASE="https://baylen-app-60069781151.development.catalystserverless.in"

node backend/scripts/import-salon-csv.js --cleanup
node backend/scripts/import-salon-csv.js --cleanup --confirm
```

## Import one file

```powershell
node backend/scripts/import-salon-csv.js --file=backend/seeds/salon/salon-gold.csv
node backend/scripts/import-salon-csv.js --file=backend/seeds/salon/salon-gold.csv --confirm
```

## Import all five seed files

```powershell
node backend/scripts/import-salon-csv.js --all-seeds
node backend/scripts/import-salon-csv.js --all-seeds --confirm
```

## Admin API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/admin/salon/imports/template` | Header row |
| POST | `/v1/admin/salon/imports/preview` | Validate CSV |
| POST | `/v1/admin/salon/imports` | Import with `confirm=true` |
| POST | `/v1/admin/salon/imports/all-seeds` | Import all `backend/seeds/salon/*.csv` |
| POST | `/v1/admin/salon/cleanup` | Remove demo salon service data |
| POST | `/v1/admin/salon/booking/test-whatsapp` | Test booking WhatsApp (`mobile`, optional sample fields, `preview_only=true`) |

Header: `x-baylen-admin-key: <ADMIN_API_KEY>`

## Upsert keys

| Entity | Key |
|--------|-----|
| Outlet | `salon_code` → `Outlets.code` |
| Package | `package_code` → `Salon_Packages.slug` |
| Service | `service_code` → `Salon_Services.slug` |
| Price | outlet + package + service + gender |
| Staff | `staff_id` → `Staff.email` as `import+<staff_id>@staff.baylen.local` |
| Staff-service | staff + service |

## Male / female rows (recommended)

Use **one CSV row per gender per service**. Same `service_code` on both rows; importer merges them into one service with two prices.

Example for Hair Cut:

| service_code | service_gender | male_price | female_price | staff_id |
|--------------|----------------|------------|--------------|----------|
| SVC-GOLD-HAIRCUT | MALE | 500 | | STF-GOLD-001 |
| SVC-GOLD-HAIRCUT | FEMALE | | 600 | STF-GOLD-001 |

See `backend/seeds/salon/salon-gold.csv` (10 rows = 5 services × male + female).

## Required CSV columns

See `backend/functions/baylen-api/lib/salon-csv-contract.js` (`PACKAGE_CSV_COLUMNS`).
