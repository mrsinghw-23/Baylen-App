# WhatsApp order confirmation template

Shop orders send WhatsApp when:

- **COD:** immediately after checkout (`routes/checkout.js`)
- **Online:** after successful payment verify (`routes/payments.js` → `finalizePaidOrder`)

OTP uses `TATA_TEMPLATE_NAME` (`baylen_app_auth`). Orders need a **separate** approved utility template.

## 1. Create template in Tata / Meta Business

Configured template name: **`baylen_order_confirmed`**

Category: **Utility**

Language: **English**

### Body text (6 variables — order must match)

```
Hi {{1}},

Your Baylen order {{2}} is confirmed.

Amount: ₹{{3}}
Payment: {{4}}
Delivery: {{5}}
ETA: {{6}}

Thank you for shopping with Baylen.
```

### Variable mapping

| # | Field | Example |
|---|--------|---------|
| 1 | Customer name | Rohit |
| 2 | Order number | BAY-RNC-123456 |
| 3 | Total | 1299 |
| 4 | Payment method | COD |
| 5 | City + pincode | Ranchi 834001 |
| 6 | ETA label | 2-4 days |

Submit for Meta approval in Tata Tele Business / WhatsApp manager.

## 2. Set Catalyst env var

The Development function is already configured with:

```
TATA_ORDER_TEMPLATE_NAME=baylen_order_confirmed
```

Also set booking template (salon / home service):

```
TATA_BOOKING_TEMPLATE_NAME=baylen_booking_confirmed
```

See [`../salon-booking/WHATSAPP_BOOKING_TEMPLATE.md`](../salon-booking/WHATSAPP_BOOKING_TEMPLATE.md).

Existing vars reused:

- `TATA_WHATSAPP_API_KEY`
- `TATA_WHATSAPP_SENDER`

Redeploy:

```powershell
cd backend
catalyst deploy --only functions:baylen-api
```

## 3. Verify configuration

```powershell
curl https://baylen-app-60069781151.development.catalystserverless.in/health
```

Look for:

```json
"order_whatsapp": {
  "ready": true,
  "missing": [],
  "template": "baylen_order_confirmation_v2",
  "mode": "order_template"
},
"booking_whatsapp": {
  "ready": true,
  "template": "baylen_booking_confirmation_v2"
}
```

The templates must be Meta-approved. OTP login does not open the WhatsApp 24-hour customer-service window; a plain-text fallback is therefore recorded as `PENDING`, never as delivered.

## 4. Test messages (admin)

Booking:

```powershell
$env:ADMIN_API_KEY="your-admin-key"
node backend/scripts/test-booking-whatsapp.js --mobile=9876543210
```

Order:

```powershell
$env:ADMIN_API_KEY="your-admin-key"
node backend/scripts/test-order-whatsapp.js --mobile=9876543210
```

## 5. Payment + WhatsApp flow

| Flow | When WhatsApp sends |
|------|---------------------|
| COD checkout | Immediately on order place |
| Razorpay / UPI / Card | After `/v1/payments/verify` with `status=SUCCESS` |

**Online payment in the app:** Razorpay checkout must complete in Flutter and call `verifyPayment`. Until that is wired, only COD orders trigger order WhatsApp automatically.

Set Razorpay on baylen-api:

```
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
```

## 6. Live customer test

1. Sign in with WhatsApp OTP (same mobile you expect confirmations on).
2. Place a **COD** shop order OR confirm a salon booking.
3. Check WhatsApp on that mobile within 1–2 minutes.
4. If failed, check Catalyst function logs for `[whatsapp-transactional]` or `[order-notify]`.
