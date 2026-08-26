# Baylen Feature Completion Status

Last updated: 2026-08-23

This document tracks the original Baylen requirement list against the current
codebase and Catalyst development deployment.

## Overall Status

- Coding started: Yes
- Catalyst backend deployed to development: Yes
- API Gateway deployed: Yes
- Production complete: No
- Current overall completion estimate: 60-65%


## Completed / Mostly Implemented

### Catalyst Project Connection

- Catalyst project `Baylen-App` is configured locally.
- Project ID `36851000000230006` is active.
- Function `baylen-api` is deployed.
- API Gateway is enabled and deployed.
- Git is connected to the Baylen repository.

### App Shell And UI Direction

- Flutter app exists.
- Main navigation exists:
  - Home
  - Shop
  - Salon
  - Service
  - Profile
- Dark black/pink Baylen visual theme has been applied.
- Home/Profile/Service screens were redesigned toward the provided UI reference.
- Splash/logo/home visual reference has been captured as sample direction only.
- Flutter launch splash with logo animation, twinkles, loading progress, auth
  restore, guest fallback, and Home transition exists.
- Database-driven launch promo/onboarding API and Flutter launch overlay exist.
- Launch popup/slides can route users into Home, Shop, Salon, Service, or Profile.
- One-time launch items are remembered locally on the device.

### Guest Vs Logged-In Logic

- Guest can open Home and browse public areas.
- Protected flows use auth checks before customer-specific actions.
- Hosted Catalyst login flow is wired.
- Session token flow exists through `X-Baylen-Token`.

### E-Commerce Foundation

- Product categories API exists.
- Brands API exists.
- Product listing/search/filter/sort API exists.
- Product detail API exists.
- Product variants/media/inventory support exists.
- Cart API exists.
- Coupon apply/remove API exists.
- Wishlist API exists.
- Checkout API exists.
- Order list/detail API exists.
- Order timeline API exists.
- Order cancellation API exists.
- Return request API exists.
- Inventory reservation and stock movement logic exists.
- Product review list and submit UI exists.

### Salon Booking Foundation

- Outlet list API exists.
- Service list API exists.
- Staff/employee list API exists.
- Slot list API exists.
- Appointment booking API exists.
- Appointment history API exists.
- Mobile salon booking screen exists.
- Service booking review list and submit UI exists.

### Notifications Foundation

- Notification inbox API exists.
- Mark notification/read-all API exists.
- Notification preferences API exists.
- Mobile notification inbox screen exists.
- Mobile notification preferences screen exists.
- Device registration API exists for push tokens.

### FSM / At-Home Service & Provider Management

- Job dispatch API exists (`/v1/jobs/dispatch` and `/v1/admin/jobs/dispatch`).
- Provider accept API exists (`/v1/jobs/accept`).
- Customer job list API exists (`/v1/jobs`).
- Customer tracking API exists (`/v1/jobs/tracking`).
- Provider job status update API exists (`/v1/jobs/status`).
- Provider location update API exists (`/v1/jobs/location`).
- Provider job completion proof API exists (`/v1/jobs/proof`).
- Dedicated Provider / Technician Portal screen (`ProviderScreen`) implemented with live duty status, active/history job views, one-tap lifecycle transitions (`ACCEPTED` -> `EN_ROUTE` -> `ARRIVED` -> `STARTED` -> `COMPLETED`), photo proof upload, and simulated real-time GPS broadcasting.
- Admin FSM & Dispatch tab in `AdminScreen` implemented with job filters, auto-dispatch, and provider roster inspection.
- Mobile Service tab lists customer service jobs with direct links to live tracking and quick technician portal access.
- Mobile live tracking screen exists.


### Payments Foundation

- Payment intent API exists.
- Payment verification API exists.
- Payment history API exists.
- Refund request API exists.
- Payment provider status API exists.
- Manual provider is enabled.
- Razorpay/Cashfree are environment-variable gated.

### Admin/Data Management Foundation

- Admin summary API exists.
- Product upsert API exists.
- Inventory list API exists.
- Inventory update API exists.
- Service upsert API exists.
- Outlet upsert API exists.
- Mobile/admin interface exists for product, service, outlet, and inventory management.
- Bulk CSV import exists for up to 500 products and up to 500 services per upload.
- Admin APIs require `ADMIN_API_KEY`.
- Deployed admin APIs are waiting for `ADMIN_API_KEY` to be configured in Catalyst env vars.

### Documentation And Configuration

- Catalyst data model document exists.
- Catalyst console configuration checklist exists.
- Required config JSON exists.
- Environment variable template exists.
- README updated for Baylen project.

## Partially Done / Needs Completion

### Authentication

- Hosted login and session flow are present.
- Profile details form is present.
- Mobile number and email are validated before profile save.
- Still required:
  - Catalyst Auth console verification settings.
  - Mobile number plus email enforcement inside the hosted registration page.
  - Production session secret in Catalyst env vars.

### Push Notifications

- Notification table/inbox/preferences/device-token storage are present.
- Still required:
  - Configure Catalyst Push Notifications.
  - Add Android FCM credentials.
  - Add iOS APNs credentials.
  - Add actual push-send function logic after events.

### Payments

- Payment records and provider status are present.
- Still required:
  - Add real Razorpay/Cashfree credentials in Catalyst env vars.
  - Implement provider order creation/signature verification.
  - Build final payment UI around the selected provider.
  - Add webhook handling.

### FSM / Live Tracking

- Backend and customer tracking screen foundation exist.
- Still required:
  - Real provider mobile interface.
  - Real map SDK integration.
  - Route drawing, ETA, and distance calculation.
  - Background location permissions and updates.
  - Job proof upload flow.

### Admin Management

- Backend admin APIs exist.
- Admin mobile interface exists from Profile -> Business management -> Admin panel.
- Bulk CSV product and service import exists in the Admin panel.
- Still required:
  - Configure `ADMIN_API_KEY` in Catalyst function environment variables.
  - File Store upload UI for product/outlet/service images.
  - Role-based admin permissions beyond API key.

### Data Store

- Data model is defined.
- Admin schema verification now includes `Launch_Promos` and
  `Onboarding_Slides`.
- Still required:
  - Verify/create every table and column in Catalyst console.
  - Create/seed `Launch_Promos` and `Onboarding_Slides` rows for live launch
    popup/onboarding content.
  - Add production indexes/search configuration.
  - Seed complete product/service/outlet/staff data.

### Mobile UI Completion

- Main app direction and core screens exist.
- Splash/logo reference direction exists in `docs/baylen-ui-brand-reference.md`.
- Launch controller and splash animation exist in `lib/launch/`.
- Profile edit form exists.
- Notification preferences UI exists.
- Coupon UI exists in cart and checkout.
- Product and service reviews UI exists.
- Still required:
  - Final visual polish for every screen.
  - Final Baylen logo/image assets.
  - Real empty/loading/error states everywhere.
  - Order-completion review prompts.
  - Membership/loyalty UI.

### Testing And Production Hardening

- Backend syntax and gateway JSON validation pass.
- Still required:
  - Flutter analyze/test once local Flutter toolchain stops hanging.
  - API integration tests.
  - Security rules review.
  - Rate limiting/throttling values.
  - Audit log implementation across admin actions.
  - Production deployment and domain mapping.

## Not Yet Production Complete

The app is not yet a full production app like Nykaa/Amazon/Flipkart plus salon
booking plus FSM. The foundation is now strong, and major architecture pieces
are implemented, but real production completion still requires console setup,
payment gateway completion, push credentials, data seeding, admin UI, provider
app flow, map/location integration, and full testing.
