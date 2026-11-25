# Baylen App — Real-Time Location Architecture
**Version:** 1.0 | **Date:** 2026-09-09

---

## 1. Overview

Real-time location tracking serves two purposes:
1. **Professional navigation** — partner uses device GPS to navigate to customer.
2. **Customer live tracking** — customer sees the professional moving on a map in real time.

Location data flows from the professional's phone → Catalyst Cache (primary, fast) → Data Store tables (audit/history).

---

## 2. Location Data Flow

```
┌─────────────────────────────────────────────────┐
│          Professional App (Flutter)              │
│                                                  │
│  geolocator package                              │
│    │ Geolocator.getPositionStream(               │
│    │   desiredAccuracy: best,                    │
│    │   distanceFilter: 10m                       │
│    │ )                                            │
│    ▼                                             │
│  ProfessionalLocationStore                       │
│    │ filters: accuracy < 500m, age < 30s         │
│    │ throttles: max 1 update / 5 seconds         │
│    ▼                                             │
│  POST /professional-jobs/{id}/location           │
│  { lat, lng, accuracy_m, speed_mps, heading,     │
│    captured_at (ISO8601) }                       │
└─────────────────────────────────────────────────┘
                       │
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────┐
│          professional-location-engine.js         │
│                                                  │
│  1. Validate captured_at                         │
│     - age < MAX_CAPTURE_AGE_SECONDS (30s)        │
│     - not in future (skew < 5s)                  │
│                                                  │
│  2. Validate accuracy_m < 500m                   │
│                                                  │
│  3. Check job status allows GPS                  │
│     HOME_SERVICE:     EN_ROUTE only              │
│     PRODUCT_DELIVERY: GOING_TO_PICKUP | EN_ROUTE │
│                                                  │
│  4. writeProfessionalLocationCache()             │
│     → Catalyst Cache segment "location_cache"    │
│     → key: "prof_loc:{professional_job_id}"      │
│     → TTL: per LOCATION_STALE_SECONDS (300s)     │
│     → checks STALE: rejects older timestamps     │
│                                                  │
│  5a. HOME_SERVICE:                               │
│       INSERT Live_Locations                      │
│       { job_id, lat, lng, heading, speed,        │
│         status: "EN_ROUTE", recorded_at }        │
│                                                  │
│  5b. PRODUCT_DELIVERY:                           │
│       INSERT Delivery_Tracking                   │
│       UPDATE Orders.rider_latitude, rider_lng    │
│                                                  │
│  6. Return { recorded: true, location_status }   │
└─────────────────────────────────────────────────┘
                       │
                       │ Customer polls or taps refresh
                       ▼
┌─────────────────────────────────────────────────┐
│    GET /professional-jobs/{id}/customer-tracking  │
│                                                  │
│  1. Verify customer owns the reference           │
│     (order.user_id or service_job.user_id)       │
│                                                  │
│  2. Read Catalyst Cache key "prof_loc:{job_id}"  │
│                                                  │
│  3. Compute location_status:                     │
│     age < 300s → LIVE                            │
│     age >= 300s → STALE                          │
│     not found → UNAVAILABLE                      │
│                                                  │
│  4. buildRouteSummary(partner_lat, partner_lng,  │
│       destination_lat, destination_lng)          │
│     → distance_km, eta_minutes, eta_label        │
│                                                  │
│  5. Return:                                      │
│     { tracking_allowed, location_status,         │
│       latitude, longitude, accuracy_m,           │
│       speed_mps, heading, captured_at,           │
│       age_seconds, destination, route,           │
│       arrived, otp_verified, service_started }   │
└─────────────────────────────────────────────────┘
```

---

## 3. Catalyst Cache Configuration

```
Segment name:   "location_cache"
Key pattern:    "prof_loc:{professional_job_id}"
Value:          JSON {
                  professional_row_id,
                  latitude,
                  longitude,
                  accuracy_m,
                  speed_mps,
                  heading,
                  captured_at (ISO8601),
                  received_at (ISO8601)
                }
TTL:            300 seconds (5 minutes)
Eviction:       Auto after TTL
Stale guard:    New write rejected if captured_at < existing cached captured_at
```

---

## 4. Location Status Definitions

| Status | Condition | Customer UX |
|---|---|---|
| `LIVE` | Cache hit, age < 300s | Green dot, real-time marker movement |
| `STALE` | Cache hit, age ≥ 300s | Yellow dot, "Last seen X minutes ago" |
| `UNAVAILABLE` | Cache miss | Grey dot, "Location unavailable" |

---

## 5. Routing & ETA Engine

**Current implementation:** `geo-routing.js` using Haversine formula.

```
buildRouteSummary(lat1, lng1, lat2, lng2):
  distance_km = haversine(lat1, lng1, lat2, lng2)
  
  speed_kmh:
    PRODUCT_DELIVERY → 25 km/h (urban bike)
    HOME_SERVICE     → 20 km/h (urban commute)
  
  eta_minutes = ceil((distance_km / speed_kmh) * 60)
  
  eta_label:
    < 1 min  → "Arriving now"
    < 60 min → "X mins away"
    >= 60 min → "~1h away"
  
  routing_source: "haversine"
```

**Limitations:**
- Straight-line distance (no roads).
- No traffic awareness.
- ETA accuracy ±30% in dense urban areas.

**Future upgrade path:**
- Replace `buildRouteSummary` with OSRM or Google Maps Distance Matrix.
- No other code changes needed (same return shape).

---

## 6. GPS Publishing Rules (Professional App)

| Rule | Value | Purpose |
|---|---|---|
| Min accuracy required | 500m | Reject inaccurate GPS fixes |
| Max capture age | 30 seconds | Reject stale from device cache |
| Min publish interval | 5 seconds | Avoid flooding API |
| Distance filter | 10 meters | Only send on meaningful movement |
| GPS provider | High accuracy (GPS + network) | Best position fix |
| Battery mode | Balanced (< 5% battery per hour) | User experience |

---

## 7. When Tracking Is Active / Hidden

| Job Status | HOME_SERVICE tracking | PRODUCT_DELIVERY tracking |
|---|---|---|
| CREATED..ACCEPTED | Hidden | Hidden |
| EN_ROUTE | **Active (customer can see)** | Hidden |
| GOING_TO_PICKUP | Hidden | **Active (GPS to outlet)** |
| ARRIVED_PICKUP..PICKED_UP | Hidden | Hidden |
| EN_ROUTE (after pickup) | — | **Active (GPS to customer)** |
| ARRIVED | Hidden (privacy) | Hidden |
| OTP_VERIFIED..COMPLETED | Hidden | Hidden |
| DELIVERED | Hidden | Hidden |

---

## 8. Privacy Design

- Customer **never** sees partner's exact coordinates before `EN_ROUTE`.
- After `ARRIVED`, coordinates are hidden even if GPS updates continue.
- Partner's phone number is **never** exposed to the customer directly.
- All phone numbers masked as `••••XXXX` in cross-role API responses.
- GPS data in `Live_Locations` and `Delivery_Tracking` is retained for 30 days then purged.

---

## 9. Customer Map UI (Flutter)

```dart
// lib/screens/service_tracking_screen.dart
// lib/screens/order_tracking_screen.dart

Timer.periodic(Duration(seconds: 10), (_) async {
  final tracking = await api.getCustomerTracking(jobId);
  if (tracking.trackingAllowed && tracking.locationStatus == 'LIVE') {
    mapController.move(LatLng(tracking.latitude, tracking.longitude), 15);
    markerPosition = LatLng(tracking.latitude, tracking.longitude);
    etaLabel = tracking.route?.etaLabel ?? '';
  }
});
```

---

## 10. Professional Map UI (Flutter)

```dart
// lib/screens/pro/pro_map_tab_screen.dart

// Uses flutter_map + OpenStreetMap tiles
// Shows:
//   - Partner's current location (blue dot)
//   - Destination pin (customer address or outlet)
//   - Distance and ETA from backend (no local routing)
//   - "Navigate" button → opens Google Maps / device navigation app
```

---

## 11. Error Cases

| Error Code | HTTP | Meaning |
|---|---|---|
| `LOCATION_INVALID` | 422 | Invalid coordinates or timestamp |
| `LOCATION_UPDATE_TOO_OLD` | 409 | captured_at is too old |
| `TRACKING_NOT_ALLOWED` | 409 | Job not in trackable state |
| `STALE_UPDATE` | — (soft) | Server ignores older-than-cached timestamp |
| `JOB_NOT_FOUND` | 404 | Job ID doesn't exist |
