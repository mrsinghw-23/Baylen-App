# Baylen Final Master Issues Tracker

| ID | STEP | FEATURE | SEVERITY | PROBLEM | ROOT CAUSE | FIX | FILES | TEST | STATUS | PRODUCTION BLOCKER |
|----|------|---------|----------|---------|------------|-----|-------|------|--------|-------------------|
| M001 | 1 | WhatsApp OTP | P2 | Real handset WhatsApp delivery not verified | Manual QA required | Device smoke on Development | — | — | OPEN | NO |
| M002 | 1 | WhatsApp OTP | P3 | Provider message ID not persisted | Schema gap | Optional column + persist on send | whatsapp-otp.js | whatsapp-otp.test.js | OPEN | NO |
| M003 | 1 | Auth | P2 | Session-expiry device QA not run | Manual test deferred | QA checklist | — | — | NOT TESTED | NO |
| M004 | 2 | Location | P2 | Offline/network recovery QA | Manual test deferred | QA checklist | — | — | NOT TESTED | NO |
| M005 | 5/10 | COD commit | P1 | COD orders never committed inventory | commit only on online payment | commitReservation on COD checkout | checkout.js | inventory-hardening.test.js | **FIXED** | NO |
| M006 | 5 | Inventory | P1 | Reserve TOCTOU race | No atomic Data Store transactions | Row lock + atomic reserve/commit/release + invariants | inventory-ops.js, inventory-row-lock.js | inventory-concurrency.test.js | **CLOSED** | NO |
| M007 | 5/9 | Checkout | P2 | Flutter checkout GPS vs saved address | checkout uses address coords first | Wire DeliveryLocationService | checkout_screen.dart | — | OPEN | NO |
| M008 | 4/23 | Catalog | P1 | In-memory full catalog pagination | Load-all then slice | DB cursor pagination + bounded search | catalog.js, catalog-pagination.js | catalog-pagination.test.js | **CLOSED** | NO |
| M009 | 4/8 | Cart | P2 | Cart fulfillment fallback global stock | assertFulfillable aggregate path | Audit + tighten canFulfillQuantity | cart.js | — | OPEN | NO |
| M010 | 4 | PDP | P3 | PDP fulfillment mode not persisted | Checkout re-evaluates | Optional cart hint | — | — | DEFERRED | NO |
| M011 | PROD | Data Store | P0 | Production Data Store init | Not provisioned | Console bootstrap | scripts | — | OPEN | **YES** |
| M012 | PROD | Backup | P0 | Production first backup | Not run | backup pipeline | backup scripts | backup.test.js | OPEN | **YES** |
| M013 | PROD | Worker | P1 | Production inventory import Cron | Not verified | Provision cron | — | — | OPEN | **YES** |
| M014 | PROD | Build | P1 | Flutter production build | Not verified | CI release build | — | — | OPEN | **YES** |
| M015 | PROD | Secrets | P0 | Production secrets verification | Not run | production-env-bootstrap.js | runtime-config.test.js | OPEN | **YES** |
| M016 | PROD | Smoke | P0 | Production smoke | Blocked | production-smoke.js | — | — | OPEN | **YES** |
| M017 | 5/19 | Security | P0 | Public inventory reserve/release/commit | Missing auth | requireAdmin on mutations | inventory.js | quick-commerce.test.js | **FIXED** | NO |
| M018 | 5 | QC cart | P1 | Cart QC without single-store fulfillment | Per-line store for cart option | findNearestQuickStoreForCart | fulfillment-engine.js | quick-commerce.test.js | **FIXED** | NO |
| M019 | 5/9 | Checkout | P1 | QC COD limit not enforced | Hint-only | Enforce in handlePlaceOrder | checkout.js | — | **FIXED** | NO |
| M020 | 5 | Inventory | P2 | Release/commit not idempotent | No duplicate guard | Early return on existing movement | inventory-ops.js | inventory-hardening.test.js | **FIXED** | NO |
| M021 | 5 | Inventory | P2 | Commit skipped quantity_committed | Bug in updateRow | Increment committed on commit | inventory-ops.js | inventory-hardening.test.js | **FIXED** | NO |
| M022 | 6 | Standard EC | P2 | Pincode ETA vs fulfillment EC ETA mismatch | Two independent sources | Unify or document precedence | pincode.js, fulfillment-engine.js | — | OPEN | NO |
| M023 | 7/10 | Split | P1 | Failed payment did not release child reservations | release only on master order id | releaseOrderReservations | payments.js | — | **FIXED** | NO |
| M024 | 8 | Cart | P2 | Stale unit_price on GET cart | Price stored at add time | Refresh from catalog on GET | cart.js | — | **FIXED** | NO |
| M025 | 9 | Checkout | P2 | Online checkout leaves cart until payment | clearCheckedOutCart COD-only | Clear on finalizePaidOrder (exists) | checkout.js, payments.js | — | OPEN | NO |
| M026 | 10 | Payments | P1 | No payment webhooks | Client-only verify | Add Razorpay webhook route | payments.js | — | OPEN | **YES** |
| M027 | 10 | Payments | P2 | Cashfree verify unsupported | Not implemented | Implement or disable provider | payments.js | — | OPEN | NO |
| M028 | 11 | Orders | P1 | Order number race under concurrency | Non-atomic scan+insert | Unique constraint or lock | checkout-engine.js | order-number.test.js | OPEN | **YES** |
| M029 | 12 | Rider | P1 | Rider not bound to order on transitions | Missing fulfillment_rider_id check | Assert rider on state changes | rider.js | — | OPEN | NO |
| M030 | 12 | Tracking | P2 | No live QC delivery ETA on tracking | ETA only at checkout | Optional geo-routing on track | rider.js | — | OPEN | NO |
| M031 | 13 | Salon | P2 | Slot lock hijack any AVAILABLE slot | No appointment ownership | Require owned appointment_id | slots.js | — | **FIXED** | NO |
| M032 | 14 | Home Service | P1 | confirmPaidBooking IDOR | No user_id check | Pass user + verify ownership | at-home-beauty-engine.js | at-home-beauty.test.js | **FIXED** | NO |
| M033 | 15 | WhatsApp | P2 | Order/booking WhatsApp weaker than OTP proof | HTTP 200 without message_id | Reuse parseWhatsappGatewayResponse | order-notify.js, booking-notify.js | — | OPEN | NO |
| M034 | 17 | Notifications | P3 | Unread count loads all notification rows | No is_read filter in query | Add WHERE is_read = false | notifications.js | — | OPEN | NO |
| M035 | 18 | Loyalty | — | Earn/redeem/referral not implemented | Schema fields only | Future feature | — | — | NOT IMPLEMENTED | NO |
| M036 | 19 | Security | P1 | CORS allows any origin | Access-Control-Allow-Origin: * | Restrict to app origins | index.js | — | OPEN | **YES** |
| M037 | 19 | Security | P2 | No global API rate limiting | Not configured | express-rate-limit or gateway throttling | index.js, catalyst-user-rules.json | — | OPEN | YES |
| M038 | 20 | Data integrity | P2 | Duplicate merge plan not executable | No admin merge route | Wire remediation executor | inventory-remediation.js | — | OPEN | NO |
| M039 | 21 | API Gateway | P1 | 17 handlers missing from gateway incl /v1/launch | Gateway drift | Sync catalyst-user-rules.json | catalyst-user-rules.json | — | OPEN | **YES** |
| M040 | 22 | Flutter | P2 | Checkout receives stale cart snapshot | Navigation passes copy | Read live CartService in checkout | checkout_screen.dart | — | OPEN | NO |
| M041 | 22 | Flutter | P2 | Cart not cleared on signOut | signOut skips CartService | Clear cart on logout | auth_service.dart | — | OPEN | NO |
| M042 | 23 | Performance | P1 | Rider orders N+1 loadOrderItems | Loop per order | Batch load items | rider.js | — | OPEN | NO |

**Fixed this audit session:** M005, M017–M021, M023, M024, M031, M032, payment amount verify (payments.js).

**Reports:** [`BAYLEN_FINAL_AUDIT_REPORT.md`](./BAYLEN_FINAL_AUDIT_REPORT.md) | Steps 1–5 detail in [`BAYLEN_COMPLETE_FUNCTIONAL_AUDIT.md`](./BAYLEN_COMPLETE_FUNCTIONAL_AUDIT.md)
