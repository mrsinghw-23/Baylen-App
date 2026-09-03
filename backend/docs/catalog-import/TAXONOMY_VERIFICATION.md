# Taxonomy verification (live Development)

Checked against live APIs after deploy.

| Requirement | Status | Evidence |
|---|---|---|
| Main category (Makeup, Skin, Hair, Natural, Men, Bath & Body, …) | Implemented | Mega-menu hubs present (23 top nodes including Makeup, Skin, Hair, Natural, Men, Bath & Body, Appliances, Mom & Baby, Health & Wellness) |
| Subcategory / nested category | Implemented | Nested Categories exist (e.g. Skin → Serums, Makeup → Lips → Lipstick/Lip Gloss/…) via search suggestions |
| Brand | Implemented | `/v1/catalog/brands` returns 88 brands |
| Concern | Schema + sync ready | `Product_Concerns` + importer `concerns` column; terms auto-created under taxonomy Categories |
| Quick link / shop home tiles | Implemented | Existing `/v1/catalog/shop-home` + navigation |
| Trending search | Implemented | `/v1/catalog/search/trending` returns DB-backed trending queries (Tea Tree Oil, Vitamin C Serum, Nude Lipstick, …) |
| Collection | Partial | Collections admin/taxonomy supported via Categories types / existing nav; dedicated Collections CRUD UI not expanded in this pass |

Product master remains DB-driven (`Products` total currently 34). Flutter catalog listing uses API pagination.
