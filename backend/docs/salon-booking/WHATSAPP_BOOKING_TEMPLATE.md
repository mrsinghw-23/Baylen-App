# WhatsApp booking confirmation template

Salon bookings send WhatsApp when status is **CONFIRMED** (`backend/functions/baylen-api/lib/booking-notify.js`).

OTP uses `TATA_TEMPLATE_NAME` (`baylen_app_auth`). Bookings need a **separate** approved template.

## 1. Create template in Tata / Meta Business

Suggested template name: **`baylen_booking_confirmed`**

Category: **Utility** (transactional update)

Language: **English**

### Body text (8 variables — order must match)

```
Hi {{1}},

Your Baylen salon booking is confirmed.

Salon: {{2}}
Service: {{3}}
Expert: {{4}}
Date: {{5}}
Time: {{6}}
Amount: ₹{{7}}
Booking ID: {{8}}

Thank you for choosing Baylen De Louis.
```

### Variable mapping (API sends these in order)

| # | Field | Example |
|---|--------|---------|
| 1 | Customer name | Rohit |
| 2 | Salon name | Baylen Premium Salon Lalpur |
| 3 | Service | Hair Cut |
| 4 | Expert | Rohit Sharma |
| 5 | Date | 2026-09-02 |
| 6 | Time | 10:30 |
| 7 | Amount | 500 |
| 8 | Booking ID | BAY-RNC-123456 |

Submit for Meta approval in Tata Tele Business / WhatsApp manager.

## 2. Set Catalyst env var

After approval, add to **baylen-api** function environment (Development, then Production):

```
TATA_BOOKING_TEMPLATE_NAME=baylen_booking_confirmed
```

Use the exact approved template name if different.

Existing vars (already set for OTP) are reused:

- `TATA_WHATSAPP_API_KEY`
- `TATA_WHATSAPP_SENDER`

Redeploy:

```powershell
cd backend
catalyst deploy --only functions
```

## 3. Verify configuration

```powershell
curl https://baylen-app-60069781151.development.catalystserverless.in/health
```

Look for:

```json
"booking_whatsapp": {
  "ready": true,
  "missing": [],
  "template": "baylen_booking_confirmed",
  "mode": "template"
}
```

If `TATA_BOOKING_TEMPLATE_NAME` is missing, `mode` is `plain_text_fallback` (often blocked outside 24h window).

## 4. Send test message

```powershell
$env:ADMIN_API_KEY="your-admin-key"
node backend/scripts/test-booking-whatsapp.js --mobile=9876543210
```

Preview only (no send):

```powershell
node backend/scripts/test-booking-whatsapp.js --mobile=9876543210 --preview
```

## 5. Live booking test

1. Sign in with WhatsApp OTP on the app.
2. Book any Gold salon service → confirm.
3. Check WhatsApp on the login mobile.
4. Open **My Bookings** — appointment should appear with `CONFIRMED` and `WhatsApp confirmation sent` when delivery succeeds.
