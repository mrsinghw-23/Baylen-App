# Legacy shared WhatsApp template

Do not use this single-variable template for the current setup. Tata rejected the variable-only form, and dedicated Utility templates produce clearer Meta policy classification:

- `baylen_booking_confirmed`
- `baylen_order_confirmed`

See `salon-booking/WHATSAPP_BOOKING_TEMPLATE.md` and `hybrid-commerce/WHATSAPP_ORDER_TEMPLATE.md`.

You already have OTP working with:

- `TATA_WHATSAPP_API_KEY`
- `TATA_WHATSAPP_SENDER` → `+918877682222`
- `TATA_TEMPLATE_NAME` → `baylen_app_auth`

**OTP templates cannot carry order/booking text.** The shared template below remains documented only for older deployments.

## Step 1 — Create template in Tata Tele Business / Meta

| Field | Value |
|--------|--------|
| Name | `baylen_customer_update` |
| Category | **Utility** |
| Language | English |

**Body (exactly 1 variable):**

```
{{1}}
```

Submit for Meta approval (usually 24–48 hours).

## Step 2 — Add ONE env var on baylen-api

In Catalyst → Functions → **baylen-api** → Configuration → Environment Variables:

```
TATA_NOTIFY_TEMPLATE_NAME=baylen_customer_update
```

Or run from repo:

```powershell
cd backend
node scripts/ensure-whatsapp-otp-env.js --sync --enable-notify-template
catalyst deploy --only functions:baylen-api
```

This uses the same API key and sender you already configured.

## Step 3 — Verify

```powershell
curl https://baylen-app-60069781151.catalystserverless.in/health
```

Expect:

```json
"booking_whatsapp": { "ready": true, "notify_template": "baylen_customer_update" },
"order_whatsapp": { "ready": true, "notify_template": "baylen_customer_update" }
```

## Step 4 — Test

```powershell
$env:ADMIN_API_KEY="your-admin-key"
node backend/scripts/test-booking-whatsapp.js --mobile=YOUR_MOBILE
node backend/scripts/test-order-whatsapp.js --mobile=YOUR_MOBILE
```

## Important

- Until Meta **approves** `baylen_customer_update`, test sends will fail (OTP will still work).
- `baylen_app_auth` stays for login OTP only.
- COD orders and confirmed salon bookings send WhatsApp automatically once the template is approved and env var is set.
