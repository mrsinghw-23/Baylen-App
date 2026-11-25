# Payment Implementation and Activation

Status: PARTIALLY COMPLETE. Local implementation and automated checks are not proof of live payment acceptance.

## Runtime and Configuration

Payments run in the existing Advanced I/O function `baylen-api`, not the separate `baylen-auth` AppSail service. Existing authentication and CORS settings have been preserved.

In Catalyst's Development environment, open Serverless > Functions > baylen-api > Configuration and configure:

| Key | Value source |
| --- | --- |
| RAZORPAY_KEY_ID | Razorpay Dashboard Test Mode API key ID |
| RAZORPAY_KEY_SECRET | Matching test API key secret |
| RAZORPAY_WEBHOOK_SECRET | A separate strong secret, also configured on the Razorpay webhook |
| ADMIN_API_KEY | Existing private server/admin credential for refund approval; never ship this in Flutter |

Do not paste secrets into chat, Git, Flutter assets, public environment files, or screenshots. `GET /v1/payments/providers` reports configuration presence, not successful gateway connectivity or merchant activation.

Enable automatic capture in Razorpay. An authorized payment alone is not treated as paid. Only a gateway-confirmed captured payment can confirm an order or booking.

## Database

THIS DATA SHOULD BE STORED IN CATALYST.

- `Payments`: customer/reference, gateway order/payment IDs, amount, currency, status and internal verification/finalization metadata.
- `Refunds`: customer/reference/payment ID, amount, currency, reason, request state and `provider_refund_id` (varchar 100).
- `Payment_Locks`: `lock_key` (varchar 100, UNIQUE), `owner` (varchar 50), `created_at` (varchar 30). Internal serialization, never customer editable.
- Existing `Orders`, `Appointments`, `Service_Jobs`: authoritative total and business status.
- Existing `Stock_Movements`: SALE plus COMMIT_PENDING/COMMIT_DONE journal entries for uncertain stock-write recovery.

The additive Development schema script has been applied. A subsequent read-only run reported no missing additions or uniqueness problems:

```powershell
node backend/scripts/provision-payment-schema.js
```

This check does NOT validate all table permissions, status-field lengths, concurrency behavior, or Production schema. Verify those before deployment. Direct App User writes to Payments, Refunds and Payment_Locks must be disabled. Customers use authenticated, ownership-checked backend routes. Financial metadata must not be directly readable across customers.

## Customer Flow

1. Shop checkout creates a saved order with server-calculated totals. The original cart is archived; payment callbacks do not erase a newer cart. Uncertain gateway responses retain the order for reconciliation.
2. Home Service creates the booking, then uses the shared payment screen. Retrying the screen reuses that booking. Direct confirmation without verified payment is rejected.
3. Salon confirmation offers online payment against the appointment.
4. The shared Flutter screen opens Razorpay hosted checkout in a browser tab/window. A short-lived, payment-scoped ticket is used, not the customer's account token.
5. Server verification validates the signature AND fetches the gateway payment to check amount, currency, order ID and captured status. Status refresh on return and signed webhooks use the same reconciliation logic.
6. The UI shows purchase success only after backend fulfillment confirmation. Dismissal, network timeout or a failed attempt never implies success; customers can check/resume from Payments.
7. Customer refund requests are queued for review. Cancelling a verified paid Home Service also queues a request. No refund is issued solely because a customer requests one.

## Refund Administration

Use the existing private `x-baylen-admin-key` header from a secure admin client, never the customer app.

| Method and endpoint | Purpose / body |
| --- | --- |
| GET /v1/admin/payments/refunds | List requested, processing and failed refunds |
| POST /v1/admin/payments/refund-process | Approve/execute or reconcile: `{"refund_id":"ROWID"}` |
| POST /v1/admin/payments/reconcile | Refresh payment and fulfillment: `{"payment_id":"ROWID"}` |
| GET /v1/payments/refunds | Customer's own refund statuses; requires customer session |

Refund execution uses a stable Razorpay idempotency key and receipt. A lost response is recovered before attempting another transfer. REQUESTED, PROCESSING, PROCESSED and FAILED are separate states. PROCESSED means the gateway reported processing complete, not a guarantee that every bank has posted it instantly.

Current customer requests are full-payment requests. Define cancellation fees, partial-item returns, refund eligibility and approval roles before adding automated refund decisions. Partial refunds made externally are reflected on the payment and parent order; child allocations are not guessed. A refunded duplicate does not undo the original paid purchase. Admin approval UI and automated approval policy are not implemented.

## Development Deployment and Webhook

Before deployment, review the dirty worktree. A function deployment includes the entire function, not only payment files. Existing predeploy/postdeploy scripts synchronize/check WhatsApp configuration; they have not been changed or run as part of this payment checkpoint.

After reviewing all included changes and setting test credentials, deploy from `backend`:

```powershell
catalyst deploy --only functions:baylen-api,apig
```

No deployment was performed at this checkpoint. Do not deploy AppSail expecting these function routes to update.

Configure the Development webhook in Razorpay Test Mode:

`https://baylen-app-60069781151.development.catalystserverless.in/v1/payments/webhooks/razorpay`

Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`. The URL must be reachable without an app login; its raw-body signature is mandatory. Set alert notifications for failed deliveries. Verify actual successful deliveries after deploy.

## Recovery and Remaining Release Gates

- A crashed worker can leave a Payment_Locks row. Do not expire/delete locks blindly: first establish that no worker is still running, inspect the gateway and database states, then have an authorized operator recover the affected reference and reconcile.
- A COMMIT_PENDING entry without matching SALE can mean inventory changed but the audit write failed. Stop automatic replay. Reconcile the exact Inventory row and stock ledger, repair the journal under controlled access, then retry payment reconciliation. The gateway payment remains recorded as received; do not charge again.
- Existing inventory locking across non-payment writers and concurrent cart edits still need multi-instance integration testing. Catalyst multi-row writes are not assumed transactional. The journal fails closed on uncertainty; it is not a substitute for an atomic inventory ledger.
- Scheduled gateway reconciliation and lock/journal alerting are not deployed. Configure operations monitoring and a scheduled, authenticated reconciliation worker before unattended live operation.
- Verify table permissions and status lengths, Production schema, request throttling, cross-customer isolation, expired links, cancellation races, concurrent stock writers, browser checkout CSP, Android/iOS return behavior and gateway webhook retries.
- Pending bookings/orders must have a tested expiry/reservation-release policy. Review existing expiry jobs against late captured payments.
- Complete merchant activation/KYC and enable required methods in Razorpay. Configure separate live keys and a live webhook only after all release gates pass. Do not mix test and live keys for existing payment records.

## Verification Matrix

Checkpoint: Flutter web build passed; four Flutter model/widget tests passed, including payment API failure at 320px and 1280px widths. Targeted Dart analysis reported no errors or warnings (18 informational pre-existing lints). Browser automation was unavailable, so browser screenshots and real checkout interactions remain unverified. The local web preview serves at `http://127.0.0.1:52891` and still uses the currently deployed backend, not these undeployed payment routes.

Automated tests cover HMAC rejection, missing secrets, ownership, unique payment locking, repeated intent creation, uncertain order/refund recovery, captured vs authorized/failed status, amount/currency mismatch, duplicate webhooks, failed finalization retries, Home Service payment gating/cancel refunds, refund states, duplicate refund isolation, split-parent charging, inventory partial-write recovery, payment-route auth and Flutter confirmation flags.

Real gateway checks still required: successful test payment for Shop/Home Service/Salon; failure/dismissal/timeout; app killed before callback; signed webhook replay; approved refund through processing/completion; insufficient gateway balance; duplicate-charge refund; device/browser return flow. No real or sandbox charges/refunds have been submitted by this implementation task.

References: [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [Webhooks](https://razorpay.com/docs/webhooks/), [Idempotent Refunds](https://razorpay.com/docs/api/refunds/normal-refunds-idempotent/?preferred-country=IN).
