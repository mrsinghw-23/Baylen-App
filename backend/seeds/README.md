# Nearby Salon Seed Data

Use these files to maintain salon outlet locations and package-tier service CSVs.

## Outlet locations

- `nearby_outlets.csv` → Catalyst `Outlets` (via `tool/seed_nearby_salons.mjs`)
- Do **not** re-seed demo services from `salon_services.csv` (removed).

## Service catalog (new)

Five package-tier CSV templates (header-only until you add real data):

```
backend/seeds/salon/
  salon-gold.csv
  salon-silver.csv
  salon-luxury.csv
  salon-bronze.csv
  salon-royal.csv
```

Validate: `node backend/scripts/validate-salon-csv.js`

Column contract: `backend/functions/baylen-api/lib/salon-csv-contract.js`

## Cleanup old demo service data

```powershell
node backend/scripts/cleanup-salon-service-data.js --dry-run
node backend/scripts/cleanup-salon-service-data.js --confirm
```

Backups go to `backend/docs/salon-booking/backup/2026-09-01/`.

