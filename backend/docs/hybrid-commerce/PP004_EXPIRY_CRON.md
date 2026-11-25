# PP-004 Offer Expiry Cron (Development / Production)

PP-004 exposes an admin endpoint that safely processes expired professional job offers:

```
POST /v1/admin/professional-jobs/process-expired-offers
x-baylen-admin-key: <ADMIN_API_KEY>
Content-Type: application/json

{"limit": 20}
```

## Behavior

- Finds `Professional_Jobs` where `job_status = ASSIGNED` and `offer_expires_at <= now` (UTC SQL timestamps)
- Atomically transitions each row through reassignment using the same PP-003 dispatch engine
- Idempotent: repeated runs skip already-expired / already-accepted jobs
- Excludes previously rejected/expired partners via `metadata_json.rejected_partner_row_ids`

## Catalyst Console setup (required)

Automatic Cron provisioning was **not** applied in this session (CLI/MCP cannot verify a live Cron without console confirmation).

Create a Catalyst **Cron** in the Baylen-App project:

| Field | Value |
|-------|--------|
| Name | `pp004-process-expired-offers` |
| Target | API Gateway |
| Method | `POST` |
| URL | `/v1/admin/professional-jobs/process-expired-offers` |
| Headers | `x-baylen-admin-key: <Development ADMIN_API_KEY>` |
| Body | `{"limit": 20}` |
| Schedule | Every **2 minutes** in Development; **1 minute** in Production when offer TTL is 15 minutes |

## Verification

```bash
# Manual invoke (Development)
curl -X POST \
  -H "x-baylen-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}' \
  https://baylen-app-60069781151.development.catalystserverless.in/v1/admin/professional-jobs/process-expired-offers
```

PP-004 smoke scenario **E** validates expiry + idempotent processor without requiring Cron.

## Gateway route

Registered in `backend/catalyst-user-rules.json` as `admin-professional-jobs-process-expired-offers`.
