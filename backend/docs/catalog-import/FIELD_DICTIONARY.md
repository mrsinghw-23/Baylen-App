# Baylen Product Import Field Dictionary

Canonical contract: `backend/functions/baylen-api/lib/csv-contract.js`

Many-to-many delimiter: `|`  
Category path delimiter: `>`

## Files in this folder

| File | Purpose |
|---|---|
| `baylen-product-import-template.csv` | Empty master template (headers only) |
| `baylen-product-sample.csv` | Filled CREATE sample (7 rows / multi-variant products) |
| `baylen-product-bulk-update-example.csv` | Example UPDATE of existing SKUs (price/stock/status) |
| `FIELD_DICTIONARY.md` | This document |

## Column dictionary

| Column | Required | Description |
|---|---|---|
| product_code | YES | Stable product master code. Used for upsert matching. |
| product_name | YES | Product display name. |
| slug | no | URL slug. Auto-generated from product_name when blank. |
| brand | YES | Brand name. Must match Brands.name or Brands.slug. |
| product_type | no | SIMPLE or VARIABLE. Default SIMPLE. |
| category_path | YES | Primary category path. Example: Skin > Serums |
| extra_categories | no | Additional categories delimited by \|. Example: Natural > Skin > Serums\|Offers |
| description | no | Long description. |
| short_description | no | Short description. |
| sku | YES | Variant SKU. Unique operational identifier. |
| barcode | no | Barcode / EAN / UPC value. |
| ean | no | EAN code. |
| upc | no | UPC code. |
| gtin | no | GTIN code. |
| variant_name | no | Variant display name. Defaults to size/color/sku. |
| size | no | Size label e.g. 30ml / M. |
| unit | no | Size unit e.g. ml / g. |
| volume | no | Volume label. |
| weight | no | Weight label. |
| color | no | Color name. |
| color_hex | no | Hex color e.g. #FF0000. |
| shade | no | Shade name. |
| finish | no | Finish e.g. Matte. |
| mrp | YES | MRP as number. |
| selling_price | YES | Selling price as number. |
| cost_price | no | Cost price as number. |
| tax_percent | no | GST / tax percent. |
| hsn_code | no | HSN code. |
| gender | no | Women / Men / Unisex / Kids. |
| age_group | no | Adult / Teen / Baby / Kids. |
| skin_types | no | Pipe-delimited. Example: Oily\|Combination |
| hair_types | no | Pipe-delimited. Example: Dry\|Damaged |
| concerns | no | Pipe-delimited. Example: Acne\|Pigmentation |
| ingredients | no | Pipe-delimited. Example: Vitamin C\|Niacinamide |
| tags | no | Pipe-delimited. Example: Brightening\|Glow |
| search_keywords | no | Pipe or comma delimited keywords. |
| status | no | ACTIVE / DRAFT / ARCHIVED / INACTIVE. Default ACTIVE. |
| is_featured | no | true/false. |
| is_returnable | no | true/false. |
| image_1 | no | Primary image URL or File Store reference (not embedded binary). |
| image_2 | no | Gallery image URL / reference. |
| image_3 | no | Gallery image URL / reference. |
| video_url | no | Product video URL. |
| seo_title | no | SEO title. |
| seo_description | no | SEO description. |
| warehouse_code | no | Warehouse code for stock row. Default HQ. |
| stock | no | Quantity on hand for warehouse_code. |
| reorder_level | no | Reorder level. |
| reorder_quantity | no | Suggested reorder quantity. |
| safety_stock | no | Safety stock. |

## A. Empty master CSV template

Use `baylen-product-import-template.csv` or:

`GET /v1/admin/imports/template` with header `X-Baylen-Admin-Key`.

## B. Filled sample CSV (CREATE)

Use `baylen-product-sample.csv`.

It demonstrates:
- multi-variant product (Vitamin C 30ml + 50ml share `product_code`)
- multi-category (`category_path` + `extra_categories`)
- concerns / skin types / ingredients / tags
- lipstick shade/color/finish
- hair shampoo concerns
- fragrance family
- warehouse stock fields
- image URL references (not binary)

## C. Bulk CREATE

1. Ensure brands and category tree exist (or create via admin / seed).
2. Fill new unique `product_code` + unique `sku` rows.
3. `POST /v1/admin/imports/preview` with `{ "csv_text": "...", "mode": "UPSERT" }`
4. Review `valid_rows`, `invalid_rows`, `new` vs `update` counts.
5. `POST /v1/admin/imports` with `{ "csv_text": "...", "mode": "UPSERT", "confirm": true, "filename": "create.csv" }`
6. Poll `GET /v1/admin/imports/:id` and download errors if needed.

Upsert rule: if `sku` exists → UPDATE; else CREATE. Same for `product_code` on Products master.

## D. Bulk UPDATE

1. `GET /v1/admin/exports/products?download=true`
2. Change only columns that need updates (price, stock, status, tags, etc.).
3. Keep `product_code` and `sku` unchanged (match keys).
4. Preview → confirm import as above.

Example file: `baylen-product-bulk-update-example.csv`

## E. Updating 100+ products safely

1. Export filtered set (`category_id`, `brand_id`, or `status` query params).
2. Edit in Excel/Sheets; do not reorder header names.
3. Preview and fix all invalid rows before confirm.
4. Import with `confirm=true` (do not use deprecated `/v1/admin/products/bulk`).
5. Download `/v1/admin/imports/:id/errors?format=csv` for failures.
6. Re-run only failed rows after correction.
7. Optional: `POST /v1/admin/search/rebuild` after large taxonomy changes.

## F. Media workflow

1. Upload images to Catalyst File Store (or CDN).
2. Put returned URL / object key into `image_1` / `image_2` / `image_3`.
3. Do not embed binary image data in the CSV.
4. Importer stores references on product/variant and Product_Media where applicable.

## Auth

All admin import/export endpoints require:

`X-Baylen-Admin-Key: <ADMIN_API_KEY>`
