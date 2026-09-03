# Baylen Salon CSV

Use the five package-tier files under `backend/seeds/salon/`:

- `salon-gold.csv`
- `salon-silver.csv`
- `salon-luxury.csv`
- `salon-bronze.csv`
- `salon-royal.csv`

Column contract: `backend/functions/baylen-api/lib/salon-csv-contract.js` (`PACKAGE_CSV_COLUMNS`).

Validate locally: `node backend/scripts/validate-salon-csv.js`

Import instructions: **[salon-import-instructions.md](./salon-import-instructions.md)**

WhatsApp booking template: **[WHATSAPP_BOOKING_TEMPLATE.md](./WHATSAPP_BOOKING_TEMPLATE.md)**

Relationship map: **[salon-data-relationship-map.md](./salon-data-relationship-map.md)**

Templates are header-only until you add real salon data.
