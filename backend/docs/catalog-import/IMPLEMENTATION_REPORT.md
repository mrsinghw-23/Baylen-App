# Baylen Catalog Platform — Implementation Report

**Branch:** `cursor/shop-ui-foundation`  
**Environment:** Catalyst Development (`baylen-app-60069781151`)  
**Deployed:** `baylen-api` Advanced I/O + API Gateway rules

## 1. Files changed (high level)

### Backend libs
- `backend/functions/baylen-api/lib/csv-contract.js` — canonical CSV headers
- `backend/functions/baylen-api/lib/catalog-products.js` — product/variant upsert, multi-category, taxonomy sync, backfill
- `backend/functions/baylen-api/lib/inventory-ops.js` — available calc, adjust, set, reserve/release/commit, transfer
- `backend/functions/baylen-api/lib/search-index.js` — Search_Documents upsert/rebuild/search
- `backend/functions/baylen-api/lib/import-pipeline.js` — preview, jobs, batch process, export
- `backend/functions/baylen-api/lib/search-engine.js` — normalization/synonyms (existing, reused)

### Backend routes
- `routes/imports.js` — template, preview, import job, errors, export, backfill, search rebuild
- `routes/inventory.js` — location stock, adjust, transfer, reserve/release/commit
- `routes/catalog.js` — paginated products + indexed search
- `routes/admin.js` — product upsert uses catalog master + search index; legacy bulk CSV deprecated (410)
- `routes/checkout.js` — reservations via inventory-ops
- `index.js` — registers import routes
- `backend/catalyst-user-rules.json` — APIG routes for imports/exports/inventory/search rebuild

### Scripts / docs
- `backend/scripts/provision-catalog-schema.js`
- `backend/scripts/generate-import-csv.js`
- `backend/docs/catalog-import/*` — template, sample, update example, field dictionary

### Flutter
- `lib/api/catalyst_api.dart` — `productsPage`
- `lib/screens/shop_catalog_screen.dart` — pagination / load more
- `lib/screens/shop_brands_screen.dart` — prefers live Brands API

## 2. Database tables created/modified

### Created
- Product_Categories, Product_Tags, Product_Concerns, Product_Skin_Types, Product_Hair_Types, Product_Fragrance_Families, Product_Ingredients, Product_Attributes
- Import_Jobs, Import_Job_Rows, Import_Errors
- Search_Documents

### Extended
- Products (product_code, cost_price, gender, age_group, SEO, search_keywords, visibility, …)
- Product_Variants (codes, barcode/EAN/UPC/GTIN, size/color/shade/finish, cost/tax, …)
- Inventory (committed/in_transit/damaged, safety_stock, allow_negative, …)
- Stock_Movements (before/after, performed_by, reason)
- Categories / Brands (status, SEO fields)

`Products.category_id` kept for compatibility until backfill is verified.

## 3. APIs created/modified

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/catalog/products` | page/limit pagination |
| GET | `/v1/catalog/search` | Search_Documents + fallback |
| GET | `/v1/catalog/search/suggestions` | autocomplete |
| GET | `/v1/catalog/search/trending` | trending |
| POST | `/v1/admin/product/upsert` | master + optional variant + search index |
| GET | `/v1/admin/imports/template` | CSV template |
| POST | `/v1/admin/imports/preview` | validate + preview |
| POST | `/v1/admin/imports` | confirm job + batch process |
| GET | `/v1/admin/imports/:id` | job status |
| GET | `/v1/admin/imports/:id/errors` | JSON or CSV |
| GET | `/v1/admin/exports/products` | export CSV |
| POST | `/v1/admin/catalog/backfill-categories` | migrate category_id → Product_Categories |
| POST | `/v1/admin/search/rebuild` | rebuild Search_Documents |
| POST | `/v1/admin/inventory/adjust` | ledger adjust |
| POST | `/v1/admin/inventory/transfer` | warehouse transfer |
| GET | `/v1/inventory/:sku` | stock by SKU/location |
| POST | `/v1/admin/products/bulk` | **deprecated 410** → use imports |

Admin routes require `X-Baylen-Admin-Key`.

## 4. Frontend screens/components

- Catalog listing uses API pagination (`productsPage` + Load more)
- Brands screen prefers live Brands API; static catalog is fallback UX only when API empty
- Fashion screen still uses static presentation aids (not product SoT)
- Shop home continues to consume `/v1/catalog/home` / navigation APIs

## 5. Migration performed

Schema provisioning completed via Data Store REST (MCP table tools unavailable beyond auth).

**Still required on live data (admin key):**
1. `POST /v1/admin/catalog/backfill-categories`
2. `POST /v1/admin/search/rebuild`
3. Seed/create brands referenced by CSV before first import
4. Ensure category paths in CSV exist in Categories tree

## 6. Search architecture

- Write path: product upsert/import → `upsertSearchDocument`
- Read path: `searchIndexed` over `Search_Documents` with synonym/normalization from `search-engine`
- Ranking: name/SKU/brand/category/keywords/tags/concerns/description priorities
- Fallback: legacy in-memory graph search if index empty/unavailable
- Rebuild: `POST /v1/admin/search/rebuild`
- Decision: Catalyst Search service not used (MCP/tooling unavailable); Data Store index table is Catalyst-native and scalable with rebuild + pagination

## 7. Inventory architecture

- Source of truth: Warehouses + Inventory + Stock_Movements
- Available = on_hand − reserved − committed
- Movements record before/after; negative stock blocked unless `allow_negative`
- Checkout reserve/release uses inventory-ops (`ORDER_RESERVATION` / release; also releases legacy `RESERVE`)
- Admin adjust + inter-warehouse transfer supported

## 8. Bulk import architecture

Admin → template → fill → preview → confirm → Import_Jobs + rows → batch process → report/errors CSV.

Upsert keys: `product_code` (master), `sku` (variant). Relational fields resolved against DB (`brand`, category paths, taxonomy terms auto-created under Categories typed terms).

## 9. Security

- Customer: published catalog read APIs
- Admin: key header for mutate/import/export/inventory/search rebuild
- Inputs validated in catalog/import/inventory libs
- Legacy unbounded sync CSV bulk disabled

## 10. Testing performed

- Local module require smoke: admin/checkout/imports/inventory/catalog-products/import-pipeline/search-index load OK
- `catalyst deploy --only functions:baylen-api` SUCCESS
- `catalyst deploy --only apig` SUCCESS
- Live API smoke + backfill/import: **pending ADMIN_API_KEY** (no local `.env` in workspace)

## 11. Remaining issues

1. Run backfill + search rebuild with admin key
2. First import needs brands + category paths present
3. Catalyst MCP still only exposes `mcp_auth` after auth — schema changes via REST/CLI path
4. Flutter fashion/brand tab UX still partly static for presentation; products are API-driven
5. Import currently processes inline (Advanced I/O); for 100k+ rows add Job/Cron worker later
6. Media_Assets separate table not required for MVP — File Store URLs + Product_Media used
7. Concurrent inventory is check-then-update (best-effort); true locking needs Job queues / conditional updates at higher scale

## 12. Production deployment requirements

1. Deploy function + APIG to Production env
2. Confirm `ADMIN_API_KEY` set on function
3. Run category backfill + search rebuild
4. Seed Brands / Categories taxonomy from screenshots
5. Upload media to File Store; put URLs in CSV
6. Preview → import sample CSV
7. Verify search suggestions, filters, cart reserve, and admin export
8. Keep `Products.category_id` until Product_Categories counts match

## Decision log

- **Search:** Data Store `Search_Documents` over Catalyst Search (tooling unavailable)
- **Import worker:** inline batch in Advanced I/O (no separate Job function yet)
- **Compatibility:** keep `category_id` during dual-write/backfill window
- **CSV contract:** single source in `csv-contract.js`
