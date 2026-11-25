# Pincode / Region Serviceability Tooling (Phase 5.9)

Admin tooling for scalable serviceability onboarding reusing the existing `Serviceable_Pincodes` table.

## Existing structure (reused)

Table: `Serviceable_Pincodes`

Fields used: `pincode`, `city`, `state`, `country`, `estimated_delivery_days`, `delivery_zone`, `is_active`

No duplicate tables created.

## Precedence

Serviceability is layered — pincode rules do **not** override geographic Quick Commerce:

1. **Geographic Quick serviceability** — Haversine + outlet radius + hours + `delivery_enabled` + `store_type` (authoritative for Quick)
2. **Pincode/region eligibility** — additive for Standard pincode messaging and ETA hints
3. **Outlet active status**
4. **Delivery enabled**
5. **Business hours**

`evaluateServiceabilityPrecedence()` in `lib/serviceability-admin.js` documents that `pincode_overrides_geo: false`.

Ranchi Quick Commerce behavior (23.3782, 85.3315 → WH-RNC-001) is unchanged because geographic rules remain primary for Quick.

## Validation

- Pincode: 6-digit Indian format via `normalizePincode()` (`lib/pincode.js`)
- Duplicate pincode: rejected on upsert (`DUPLICATE_PINCODE`)
- Warehouse existence: validated when `warehouse_id` provided
- Outlet existence: validated when `outlet_id` provided
- Active/inactive: explicit `is_active` flag; deactivate endpoint sets `false`

Never silently assigns invalid warehouse/outlet references.

## Admin API

Header: `x-baylen-admin-key: <ADMIN_API_KEY>`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/admin/serviceability/regions` | List regions (filters: pincode, city, state, active_only) |
| GET | `/v1/admin/serviceability/region?id=` | Get one region |
| POST | `/v1/admin/serviceability/region/upsert` | Create or update |
| POST | `/v1/admin/serviceability/region/deactivate` | Deactivate |

All mutations write `Audit_Logs` via `writeAdminAudit()`.

## Tests

`test/serviceability-admin.test.js` — pincode validation, upsert, duplicate rejection, precedence rules.
