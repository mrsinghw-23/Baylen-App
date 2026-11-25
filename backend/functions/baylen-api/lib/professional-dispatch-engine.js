"use strict";

/**
 * PP-003 — Professional dispatch, eligibility filtering, ranking, and assignment.
 *
 * Tables/fields used:
 * - Professional_Jobs (authoritative job + assignment)
 * - Job_Status_History (audit)
 * - Delivery_Partners (identity, outlet_row_id, legacy_provider_id, online_status, status)
 * - Provider_Services + Service_Areas (skill + zone via legacy_provider_id bridge)
 * - Salon_Services.is_at_home (home service gate)
 * - Service_Jobs + Job_Items (home service source)
 * - Orders (product delivery source)
 * - Serviceable_Pincodes (delivery zone for product orders)
 */

const { rowOf, rowsOf, asId, num, sqlString, isTruthy } = require("./http");
const { parseDeliveryPartnerId, mapDeliveryPartner, DP_SELECT } = require("./delivery-partner");
const { isPartnerOperational, normalizePartnerStatus } = require("./delivery-partner-kyc");
const {
  JOB_STATUS,
  JOB_TYPES,
  REFERENCE_TYPES,
  findJobByRowId,
  transitionProfessionalJob,
  appendStatusHistory,
} = require("./professional-job-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const { buildRouteSummary } = require("./geo-routing");
const { parseLocation } = require("./geo-coords");
const { citiesMatch, isAtHomeEnabled } = require("./salon-engine");
const { recordWhatsappNotification } = require("./whatsapp-notification-store");
const { computeOfferExpiresAt, rejectedPartnerIdsFromMetadata, parseJobMetadata } = require("./professional-job-engine");
const { evaluateLocationEligibility } = require("./professional-location-match");
const { insertPartnerNotification } = require("./professional-partner-notify");
const { jobFitsPartnerSchedule } = require("./professional-availability-schedule");
const { isAllIndiaDispatchEnabled, dispatchMaxRadiusKm } = require("./dispatch-all-india-config");
const { resolveDispatchCoordinates } = require("./dispatch-location-coords");
const { isDeliveryPincodeDispatchable } = require("./dispatch-pincode-gate");
const { resolveServiceZoneLabel } = require("./service-zone-resolve");
const { readPartnerAvailabilityLocation } = require("./partner-availability-location");

/** Explicit ranking weights — rating alone must not dominate. */
const DISPATCH_RANK_WEIGHTS = Object.freeze({
  skill_match: 100,
  outlet_authorization: 80,
  service_zone: 70,
  working_hours_fit: 60,
  workload: 50,
  distance: 40,
  rating: 20,
  priority: 10,
});

const MAX_DAILY_JOBS = 12;
const MAX_CONCURRENT_ASSIGNED = 3;
const JOB_OVERLAP_BUFFER_MINUTES = 30;

const ONLINE_STATUS = {
  OFFLINE: "OFFLINE",
  ONLINE_AVAILABLE: "ONLINE_AVAILABLE",
  ONLINE_BUSY: "ONLINE_BUSY",
};

function normalizeOnlineStatus(value) {
  const status = String(value || ONLINE_STATUS.OFFLINE)
    .trim()
    .toUpperCase();
  return Object.values(ONLINE_STATUS).includes(status) ? status : ONLINE_STATUS.OFFLINE;
}

const TERMINAL_ORDER_STATUSES = new Set(["CANCELLED", "DELIVERED", "REFUNDED"]);
const DISPATCHABLE_ORDER_STATUSES = new Set([
  "PLACED",
  "CONFIRMED",
  "PROCESSING",
  "STORE_ASSIGNED",
  "PICKING",
  "PACKED",
  "RIDER_SEARCHING",
]);

const TERMINAL_SERVICE_JOB_STATUSES = new Set(["CANCELLED", "COMPLETED"]);

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function partnerOutletRef(partner) {
  if (partner.outlet_row_id) {
    return String(partner.outlet_row_id);
  }
  if (partner.outlet_id) {
    return String(partner.outlet_id);
  }
  return "";
}

function parseMetadata(json) {
  if (!json) {
    return {};
  }
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) {
    return "";
  }
  return "••••" + digits.slice(-4);
}

function parseScheduledAt(value) {
  if (!value) {
    return null;
  }
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

async function loadPartnerRow(zcql, partnerRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE ROWID = " + asId(partnerRowId, "partner_id")
    ),
    "Delivery_Partners"
  );
  return mapDeliveryPartner(row);
}

async function loadOnlinePartners(zcql, { jobType } = {}) {
  let rows = [];
  try {
    rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          DP_SELECT +
          " FROM Delivery_Partners WHERE status = 'active' AND online_status = 'ONLINE_AVAILABLE' LIMIT 200"
      ),
      "Delivery_Partners"
    );
  } catch (_) {
    return [];
  }
  return rows.map(mapDeliveryPartner).filter(Boolean);
}

async function countPartnerAssignedJobs(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT COUNT(ROWID) AS total FROM Professional_Jobs WHERE delivery_partner_row_id = " +
          asId(partnerRowId, "partner_id") +
          " AND job_status = 'ASSIGNED'"
      ),
      "Professional_Jobs"
    );
    return num(row && (row.total ?? row["COUNT(ROWID)"]));
  } catch (_) {
    return 0;
  }
}

async function loadPartnerAssignedWindows(zcql, partnerRowId) {
  const jobs = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, job_type, reference_type, reference_row_id, metadata_json FROM Professional_Jobs WHERE delivery_partner_row_id = " +
        asId(partnerRowId, "partner_id") +
        " AND job_status IN ('ASSIGNED','ACCEPTED','STARTED') LIMIT 50"
    ),
    "Professional_Jobs"
  );
  const windows = [];
  for (const job of jobs) {
    const meta = parseMetadata(job.metadata_json);
    const scheduled = parseScheduledAt(meta.scheduled_at);
    const duration = num(meta.duration_minutes) || 60;
    if (scheduled) {
      windows.push({
        start: scheduled,
        end: new Date(scheduled.getTime() + (duration + JOB_OVERLAP_BUFFER_MINUTES) * 60000),
      });
    }
  }
  return windows;
}

async function loadProductDeliveryContext(zcql, orderRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, order_number, status, payment_status, payment_method, grand_total, currency, shipping_name, shipping_phone, shipping_line1, shipping_line2, shipping_city, shipping_state, shipping_postal_code, fulfillment_mode, fulfillment_store_id, professional_job_row_id FROM Orders WHERE ROWID = " +
        asId(orderRowId, "order_id")
    ),
    "Orders"
  );
  if (!row) {
    return null;
  }
  let store = null;
  if (row.fulfillment_store_id) {
    try {
      store = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, address_line1, city, latitude, longitude FROM Outlets WHERE ROWID = " +
            asId(row.fulfillment_store_id, "outlet_id")
        ),
        "Outlets"
      );
    } catch (_) {
      store = null;
    }
  }
  const pincode = String(row.shipping_postal_code || "").replace(/\D/g, "").slice(0, 6);
  const pickup =
    store && store.latitude != null && store.longitude != null
      ? {
          latitude: Number(store.latitude),
          longitude: Number(store.longitude),
          source: "outlet",
          name: store.name || "",
        }
      : null;
  const destination =
    resolveDispatchCoordinates({
      pincode,
      state: row.shipping_state || "",
      city: row.shipping_city || "",
    }) || null;
  return {
    kind: JOB_TYPES.PRODUCT_DELIVERY,
    reference_row_id: String(row.ROWID),
    order_number: row.order_number || "",
    status: String(row.status || "").toUpperCase(),
    payment_status: String(row.payment_status || "").toUpperCase(),
    payment_method: String(row.payment_method || "").toUpperCase(),
    amount: num(row.grand_total),
    currency: row.currency || "INR",
    customer_name: row.shipping_name || "Customer",
    customer_phone_masked: maskPhone(row.shipping_phone),
    pickup_title: store?.name ? "Pickup from " + store.name : "Pickup from store",
    pickup_address: [store?.address_line1, store?.city].filter(Boolean).join(", "),
    drop_title: "Deliver to",
    drop_address: [row.shipping_line1, row.shipping_line2, row.shipping_city, row.shipping_state, row.shipping_postal_code]
      .filter(Boolean)
      .join(", "),
    pincode: pincode,
    visit_city: row.shipping_city || "",
    outlet_row_id: row.fulfillment_store_id ? String(row.fulfillment_store_id) : "",
    destination,
    pickup,
    scheduled_at: "",
    duration_minutes: 45,
    service_id: "",
    service_name: "Product delivery",
    is_at_home: false,
  };
}

async function loadHomeServiceContext(zcql, serviceJobRowId) {
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, booking_number, status, payment_status, outlet_id, outlet_row_id, visit_line1, visit_city, visit_state, pincode, visit_latitude, visit_longitude, scheduled_at, grand_total, currency, service_name_snapshot, gender_preference, delivery_partner_row_id FROM Service_Jobs WHERE ROWID = " +
        asId(serviceJobRowId, "service_job_id")
    ),
    "Service_Jobs"
  );
  if (!row) {
    return null;
  }
  const items = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT service_id, service_name, quantity FROM Job_Items WHERE job_id = " +
        asId(serviceJobRowId, "service_job_id")
    ),
    "Job_Items"
  );
  const primary = items[0] || {};
  const serviceId = primary.service_id ? String(primary.service_id) : "";
  let salonService = null;
  if (serviceId) {
    salonService = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, duration_minutes, is_at_home, service_type FROM Salon_Services WHERE ROWID = " +
          asId(serviceId, "service_id")
      ),
      "Salon_Services"
    );
  }
  const outletRef =
    row.outlet_row_id != null && row.outlet_row_id !== ""
      ? String(row.outlet_row_id)
      : row.outlet_id != null
        ? String(row.outlet_id)
        : "";
  const serviceZone = await resolveServiceZoneLabel(zcql, {
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    visit_district: row.visit_district || row.visit_city || "",
    pincode: String(row.pincode || "").replace(/\D/g, "").slice(0, 6),
  });
  return {
    kind: JOB_TYPES.HOME_SERVICE,
    reference_row_id: String(row.ROWID),
    booking_number: row.booking_number || "",
    status: String(row.status || "").toUpperCase(),
    payment_status: String(row.payment_status || "").toUpperCase(),
    amount: num(row.grand_total),
    currency: row.currency || "INR",
    customer_name: "Customer",
    customer_phone_masked: "",
    pickup_title: "Service outlet",
    pickup_address: "",
    drop_title: "Customer location",
    drop_address: [row.visit_line1, row.visit_city, row.visit_state, row.pincode].filter(Boolean).join(", "),
    pincode: String(row.pincode || "").replace(/\D/g, "").slice(0, 6),
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    visit_district: row.visit_district || row.visit_city || "",
    country: "India",
    service_zone: serviceZone,
    outlet_row_id: outletRef,
    destination:
      parseLocation(row.visit_latitude, row.visit_longitude) ||
      resolveDispatchCoordinates({
        pincode: String(row.pincode || "").replace(/\D/g, "").slice(0, 6),
        state: row.visit_state || "",
        city: row.visit_city || "",
      }),
    pickup: null,
    scheduled_at: row.scheduled_at || "",
    duration_minutes: num(salonService?.duration_minutes) || 60,
    service_id: serviceId,
    service_name: primary.service_name || row.service_name_snapshot || salonService?.name || "Home service",
    is_at_home: salonService ? isAtHomeEnabled(salonService.is_at_home) : true,
    items,
  };
}

async function loadJobDispatchContext(zcql, job) {
  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER) {
    return loadProductDeliveryContext(zcql, job.reference_row_id);
  }
  return loadHomeServiceContext(zcql, job.reference_row_id);
}

async function partnerHasServiceSkill(zcql, partner, serviceId) {
  if (!serviceId) {
    return false;
  }
  const providerId = partner.legacy_provider_id;
  if (!providerId) {
    return isAllIndiaDispatchEnabled() && isPartnerOperational(partner.status);
  }
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Provider_Services WHERE service_id = " +
          asId(serviceId, "service_id") +
          " AND provider_id = " +
          asId(providerId, "provider_id") +
          " AND is_active = true LIMIT 1"
      ),
      "Provider_Services"
    );
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

const AVAILABILITY_LOCATION_MAX_AGE_MS = 20 * 60 * 1000;

async function resolvePartnerDispatchCoords(app, zcql, partner, options = {}) {
  if (
    options.partnerLocation &&
    options.partnerLocation.latitude != null &&
    options.partnerLocation.longitude != null
  ) {
    return options.partnerLocation;
  }
  if (app && partner?.row_id) {
    try {
      const live = await readPartnerAvailabilityLocation(app, partner.row_id);
      if (live && live.latitude != null && live.longitude != null) {
        const capturedAt = new Date(live.captured_at || live.received_at || 0);
        const ageMs = Date.now() - capturedAt.getTime();
        if (ageMs >= 0 && ageMs <= AVAILABILITY_LOCATION_MAX_AGE_MS) {
          return {
            latitude: Number(live.latitude),
            longitude: Number(live.longitude),
            source: "live_gps",
            accuracy_m: live.accuracy_m,
          };
        }
      }
    } catch (_) {}
  }
  const partnerLocationRow =
    options.partnerLocationRow || (await loadPartnerServiceLocation(zcql, partner));
  return resolveDispatchCoordinates(partnerLocationRow);
}

async function loadPartnerServiceLocation(zcql, partner) {
  try {
    const { findKycRegRow } = require("./delivery-partner-registration");
    const kyc = await findKycRegRow(zcql, partner.row_id, partner);
    return {
      country: kyc?.country || partner.country || "India",
      state: kyc?.state || partner.state || "",
      district: kyc?.district || partner.district || "",
      city: kyc?.city || partner.city || "",
      postal_code: kyc?.postal_code || partner.postal_code || "",
      pincode: kyc?.postal_code || partner.postal_code || partner.pincode || "",
      service_zone: kyc?.service_zone || partner.service_zone || "",
    };
  } catch (_) {
    return {
      country: partner.country || "India",
      state: partner.state || "",
      district: partner.district || "",
      city: partner.city || "",
      postal_code: partner.postal_code || "",
      pincode: partner.pincode || "",
      service_zone: partner.service_zone || "",
    };
  }
}

async function partnerCoversCity(zcql, partner, city) {
  const providerId = partner.legacy_provider_id;
  if (!providerId) {
    return isAllIndiaDispatchEnabled() || !city;
  }
  if (!city) {
    return true;
  }
  try {
    const areas = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT city FROM Service_Areas WHERE is_active = true AND provider_id = " +
          asId(providerId, "provider_id")
      ),
      "Service_Areas"
    );
    if (!areas.length) {
      return true;
    }
    return areas.some((row) => citiesMatch(city, row.city));
  } catch (_) {
    return false;
  }
}

function isJobReferenceDispatchable(context) {
  if (!context) {
    return { ok: false, reason: "REFERENCE_NOT_FOUND" };
  }
  if (context.kind === JOB_TYPES.PRODUCT_DELIVERY) {
    if (TERMINAL_ORDER_STATUSES.has(context.status)) {
      return { ok: false, reason: "ORDER_TERMINAL" };
    }
    const paid = context.payment_status === "PAID";
    const cod = context.payment_method === "COD" && context.payment_status !== "FAILED";
    if (!paid && !cod) {
      return { ok: false, reason: "ORDER_NOT_PAYMENT_ELIGIBLE" };
    }
    if (!DISPATCHABLE_ORDER_STATUSES.has(context.status) && context.status !== "RIDER_SEARCHING") {
      return { ok: false, reason: "ORDER_STATUS_NOT_DISPATCHABLE" };
    }
    if (!context.outlet_row_id) {
      return { ok: false, reason: "MISSING_FULFILLMENT_STORE" };
    }
    return { ok: true };
  }
  if (TERMINAL_SERVICE_JOB_STATUSES.has(context.status)) {
    return { ok: false, reason: "SERVICE_JOB_TERMINAL" };
  }
  if (!context.is_at_home) {
    return { ok: false, reason: "SERVICE_NOT_AT_HOME" };
  }
  if (!context.service_id) {
    return { ok: false, reason: "MISSING_SERVICE_ID" };
  }
  return { ok: true };
}

async function evaluatePartnerEligibility(zcql, partner, job, context, options = {}) {
  const reasons = [];
  const factors = {
    skill_match: 0,
    outlet_authorization: 0,
    service_zone: 0,
    working_hours_fit: 1,
    workload: 1,
    distance: 0,
    rating: 0,
    priority: num(job.priority) > 0 ? 1 : 0,
  };

  if (!isPartnerOperational(partner.status)) {
    reasons.push("PARTNER_NOT_OPERATIONAL");
  }
  if (normalizePartnerStatus(partner.status) === "suspended") {
    reasons.push("PARTNER_SUSPENDED");
  }
  if (normalizePartnerStatus(partner.status) === "kyc_rejected") {
    reasons.push("PARTNER_KYC_REJECTED");
  }
  const online = normalizeOnlineStatus(partner.online_status);
  if (online !== ONLINE_STATUS.ONLINE_AVAILABLE && !options.ignoreOnline) {
    reasons.push("PARTNER_OFFLINE");
  }

  const refCheck = isJobReferenceDispatchable(context);
  if (!refCheck.ok) {
    reasons.push(refCheck.reason);
  }

  const partnerOutlet = partnerOutletRef(partner);
  const jobOutlet = context?.outlet_row_id || job.outlet_row_id || "";
  if (jobOutlet && partnerOutlet && partnerOutlet !== jobOutlet) {
    reasons.push("OUTLET_UNAUTHORIZED");
  } else if (jobOutlet && partnerOutlet && partnerOutlet === jobOutlet) {
    factors.outlet_authorization = 1;
  } else if (!jobOutlet || partnerOutlet) {
    factors.outlet_authorization = jobOutlet ? 0 : 1;
  }

  if (job.job_type === JOB_TYPES.HOME_SERVICE) {
    if (!context?.is_at_home) {
      reasons.push("NON_AT_HOME_SERVICE");
    }
    const skilled = await partnerHasServiceSkill(zcql, partner, context.service_id);
    if (!skilled) {
      reasons.push("SKILL_MISMATCH");
    } else {
      factors.skill_match = 1;
    }
    const zoned = await partnerCoversCity(zcql, partner, context.visit_city);
    if (!zoned) {
      reasons.push("SERVICE_ZONE_MISMATCH");
    } else {
      factors.service_zone = 1;
    }
    const partnerLocation = options.partnerLocationRow || (await loadPartnerServiceLocation(zcql, partner));
    const locationCheck = evaluateLocationEligibility(partnerLocation, context);
    if (!locationCheck.ok) {
      reasons.push(...locationCheck.reasons);
    } else if (
      locationCheck.pincode_match ||
      locationCheck.service_zone_match ||
      locationCheck.district_match
    ) {
      factors.service_zone = 1;
    }
  } else {
    const deliveryCapable = Boolean(partner.legacy_rider_id) || Boolean(partnerOutlet);
    if (!deliveryCapable) {
      reasons.push("DELIVERY_CAPABILITY_MISSING");
    } else {
      factors.skill_match = 1;
    }
    if (context?.pincode) {
      const serviceable = await isDeliveryPincodeDispatchable(
        zcql,
        context.pincode,
        context.visit_state || context.state || ""
      );
      if (!serviceable) {
        reasons.push("DELIVERY_PINCODE_NOT_SERVICEABLE");
      } else {
        factors.service_zone = 1;
      }
    } else if (context?.visit_city) {
      factors.service_zone = 1;
    } else {
      reasons.push("MISSING_DESTINATION_LOCATION");
    }
  }

  const assignedCount = options.assignedCount != null ? options.assignedCount : await countPartnerAssignedJobs(zcql, partner.row_id);
  if (assignedCount >= MAX_CONCURRENT_ASSIGNED) {
    reasons.push("WORKLOAD_LIMIT");
    factors.workload = 0;
  }

  const scheduled = parseScheduledAt(context?.scheduled_at);
  if (scheduled) {
    const duration = num(context.duration_minutes) || 60;
    const scheduleCheck = jobFitsPartnerSchedule(
      partner.availability_schedule,
      scheduled,
      duration
    );
    if (scheduleCheck.configured && !scheduleCheck.ok) {
      reasons.push(scheduleCheck.reason || "OUTSIDE_AVAILABILITY_WINDOW");
      factors.working_hours_fit = 0;
    }
    const jobWindow = {
      start: scheduled,
      end: new Date(scheduled.getTime() + (duration + JOB_OVERLAP_BUFFER_MINUTES) * 60000),
    };
    const windows = options.assignedWindows || (await loadPartnerAssignedWindows(zcql, partner.row_id));
    const overlap = windows.some((w) => intervalsOverlap(jobWindow.start, jobWindow.end, w.start, w.end));
    if (overlap) {
      reasons.push("SCHEDULE_CONFLICT");
      factors.working_hours_fit = 0;
    }
  }

  let distanceKm = null;
  let partnerCoords = null;
  const destination =
    context?.destination ||
    resolveDispatchCoordinates({
      pincode: context?.pincode,
      state: context?.visit_state || context?.state,
      city: context?.visit_city,
    });
  if (destination) {
    partnerCoords = await resolvePartnerDispatchCoords(options.app, zcql, partner, options);
    const from = context?.pickup || partnerCoords;
    if (from && from.latitude != null && from.longitude != null) {
      const route = buildRouteSummary(
        from.latitude,
        from.longitude,
        destination.latitude,
        destination.longitude
      );
      distanceKm = route.distance_km;
      if (distanceKm != null) {
        const maxRadius = dispatchMaxRadiusKm();
        factors.distance = Math.max(0, 1 - Math.min(distanceKm, maxRadius) / maxRadius);
        if (
          job.job_type === JOB_TYPES.HOME_SERVICE &&
          partnerCoords?.source === "live_gps" &&
          distanceKm > maxRadius
        ) {
          reasons.push("DISTANCE_OUT_OF_SERVICE_AREA");
        }
      }
    }
  }

  const rating = num(partner.rating);
  factors.rating = rating > 0 ? Math.min(rating / 5, 1) : 0.5;

  const eligible = reasons.length === 0;
  let score = 0;
  for (const [key, weight] of Object.entries(DISPATCH_RANK_WEIGHTS)) {
    score += weight * (factors[key] || 0);
  }

  return {
    partner_row_id: partner.row_id,
    eligible,
    reasons,
    factors,
    score,
    distance_km: distanceKm,
  };
}

function rankEligibleCandidates(candidates) {
  return candidates
    .filter((c) => c.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const distA = a.distance_km != null ? a.distance_km : 9999;
      const distB = b.distance_km != null ? b.distance_km : 9999;
      if (distA !== distB) {
        return distA - distB;
      }
      return String(a.partner_row_id).localeCompare(String(b.partner_row_id));
    });
}

async function syncSourceAssignment(app, job, partnerRowId) {
  const zcql = app.zcql();
  const partnerRowRef = asId(partnerRowId, "delivery_partner_row_id");
  if (job.reference_type === REFERENCE_TYPES.SERVICE_JOB || job.job_type === JOB_TYPES.HOME_SERVICE) {
    try {
      await app.datastore().table("Service_Jobs").updateRow({
        ROWID: job.reference_row_id,
        delivery_partner_row_id: partnerRowRef,
      });
    } catch (_) {}
    return;
  }
  if (job.reference_type === REFERENCE_TYPES.ORDER || job.job_type === JOB_TYPES.PRODUCT_DELIVERY) {
    const partner = await loadPartnerRow(zcql, partnerRowRef);
    const riderId = partner?.legacy_rider_id;
    if (riderId && /^\d+$/.test(String(riderId)) && String(riderId).length <= 9) {
      try {
        await app.datastore().table("Orders").updateRow({
          ROWID: job.reference_row_id,
          fulfillment_rider_id: riderId,
        });
      } catch (_) {}
    }
  }
}

function buildJobOfferNotification(partner, job, context) {
  const serviceName = context?.service_name || context?.order_number || "Home service";
  const location = [context?.visit_city, context?.visit_state, context?.pincode].filter(Boolean).join(", ");
  const when = context?.scheduled_at || "As scheduled";
  const jobId = job.job_number || job.id;
  const isDelivery = job.job_type === JOB_TYPES.PRODUCT_DELIVERY;
  return {
    partner_row_id: partner.row_id,
    notification_type: "PROFESSIONAL_JOB_ASSIGNED",
    title: isDelivery ? "New Product Delivery Request" : "New Home Service Request",
    body: [serviceName, location, when, "Action required: Accept Service", jobId]
      .filter(Boolean)
      .join(" · "),
    reference_type: "PROFESSIONAL_JOB",
    reference_id: job.id,
    professional_job_row_id: job.id,
    delivery_status: "DELIVERED",
  };
}

async function notifyPartnerAssigned(req, partner, job, context, app = null) {
  const catalystApp = app || req?.catalystApp;
  let inbox = null;
  if (catalystApp && partner?.row_id) {
    inbox = await insertPartnerNotification(catalystApp, buildJobOfferNotification(partner, job, context));
  }
  if (!req || !partner?.phone) {
    return { recorded: Boolean(inbox), inbox_id: inbox?.ROWID || "" };
  }
  try {
    await recordWhatsappNotification(req, {
      user_id: partner.delivery_partner_id,
      notification_type: "PROFESSIONAL_JOB_ASSIGNED",
      reference_type: "PROFESSIONAL_JOB",
      reference_id: job.id,
      template_name: "professional_job_assigned",
      template_variables: [
        job.job_number || job.id,
        context?.service_name || context?.order_number || "Job",
      ],
      delivery_status: inbox ? "RECORDED" : "PENDING",
      mobile: partner.phone,
    });
    return { recorded: true, inbox_id: inbox?.ROWID || "" };
  } catch (_) {
    return { recorded: Boolean(inbox), inbox_id: inbox?.ROWID || "" };
  }
}

async function assignJobToPartner(app, jobRowId, partnerRowId, dispatchMeta = {}, req = null) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const partnerRowRef = asId(partnerRowId, "delivery_partner_row_id");
    const offerExpiresAt = computeOfferExpiresAt();
    const current = await findJobByRowId(zcql, jobRowId);
    if (!current) {
      return { assigned: false, reason: "JOB_NOT_FOUND" };
    }
    if (current.status !== JOB_STATUS.ASSIGNMENT_PENDING) {
      return { assigned: false, reason: "JOB_NOT_PENDING", status: current.status };
    }
    if (current.delivery_partner_row_id) {
      if (String(current.delivery_partner_row_id) === String(partnerRowRef)) {
        const assignedAt = nowSql();
        if (!current.assigned_at) {
          await app.datastore().table("Professional_Jobs").updateRow({
            ROWID: jobRowId,
            assigned_at: assignedAt,
            offer_expires_at: offerExpiresAt,
          });
        } else if (!current.offer_expires_at) {
          await app.datastore().table("Professional_Jobs").updateRow({
            ROWID: jobRowId,
            offer_expires_at: offerExpiresAt,
          });
        }
        const updated = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.ASSIGNED, {
          actorId: "dispatch",
          actorRole: "SYSTEM",
          reason: dispatchMeta.reason || "Pre-linked partner assignment confirmed",
          metadata: dispatchMeta,
        });
        await syncSourceAssignment(app, updated, partnerRowRef);
        const partner = await loadPartnerRow(zcql, partnerRowRef);
        const context = await loadJobDispatchContext(zcql, updated);
        const notification = dispatchMeta.skipNotify
          ? { recorded: false, skipped: true }
          : await notifyPartnerAssigned(req, partner, updated, context, app);
        return {
          assigned: true,
          job: updated,
          partner_row_id: partnerRowRef,
          prelinked: true,
          notification,
        };
      }
      return {
        assigned: false,
        reason: "ALREADY_ASSIGNED",
        delivery_partner_row_id: current.delivery_partner_row_id,
      };
    }

    const assignedAt = nowSql();
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      delivery_partner_row_id: partnerRowRef,
      assigned_at: assignedAt,
      offer_expires_at: offerExpiresAt,
    });

    const updated = await transitionProfessionalJob(app, jobRowId, JOB_STATUS.ASSIGNED, {
      actorId: "dispatch",
      actorRole: "SYSTEM",
      reason: dispatchMeta.reason || "Dispatch assignment",
      metadata: dispatchMeta,
    });

    await syncSourceAssignment(app, updated, partnerRowRef);

    const partner = await loadPartnerRow(zcql, partnerRowRef);
    const context = await loadJobDispatchContext(zcql, updated);
    const notification = dispatchMeta.skipNotify
      ? { recorded: false, skipped: true }
      : await notifyPartnerAssigned(req, partner, updated, context, app);

    return {
      assigned: true,
      job: updated,
      partner_row_id: partnerRowRef,
      notification,
    };
  });
}

async function dispatchProfessionalJob(app, jobRowId, options = {}) {
  const zcql = app.zcql();
  const job = await findJobByRowId(zcql, jobRowId);
  if (!job) {
    return { dispatched: false, reason: "JOB_NOT_FOUND" };
  }
  if (job.status !== JOB_STATUS.ASSIGNMENT_PENDING) {
    return { dispatched: false, reason: "JOB_NOT_PENDING", status: job.status };
  }

  const context = await loadJobDispatchContext(zcql, job);
  const refCheck = isJobReferenceDispatchable(context);
  if (!refCheck.ok) {
    return { dispatched: false, reason: refCheck.reason };
  }

  if (job.delivery_partner_row_id) {
    const prelinkedPartner = await loadPartnerRow(zcql, job.delivery_partner_row_id);
    if (prelinkedPartner) {
      const preEval = await evaluatePartnerEligibility(zcql, prelinkedPartner, job, context, {
        ...options,
        app: options.app || app,
      });
      if (preEval.eligible) {
        return assignJobToPartner(
          app,
          jobRowId,
          job.delivery_partner_row_id,
          {
            reason: "Pre-linked partner assignment confirmed",
            prelinked: true,
            ...preEval,
          },
          options.req || null
        );
      }
      return {
        dispatched: false,
        reason: "PRELINKED_PARTNER_INELIGIBLE",
        rejected: [{ partner_row_id: job.delivery_partner_row_id, reasons: preEval.reasons }],
      };
    }
    return { dispatched: false, reason: "ALREADY_ASSIGNED" };
  }

  const partners = options.candidatePartners || (await loadOnlinePartners(zcql, { jobType: job.job_type }));
  const excluded = new Set((options.excludePartnerRowIds || rejectedPartnerIdsFromMetadata(job.metadata_json)).map(String));
  const evaluations = [];
  for (const partner of partners) {
    if (excluded.has(String(partner.row_id))) {
      evaluations.push({
        partner_row_id: partner.row_id,
        eligible: false,
        reasons: ["PARTNER_EXCLUDED"],
        factors: {},
        score: 0,
        distance_km: null,
      });
      continue;
    }
    evaluations.push(
      await evaluatePartnerEligibility(zcql, partner, job, context, { ...options, app: options.app || app })
    );
  }
  const ranked = rankEligibleCandidates(evaluations);
  const dispatchMeta = {
    candidate_count: evaluations.length,
    eligible_count: ranked.length,
    rejected: evaluations.filter((e) => !e.eligible).map((e) => ({
      partner_row_id: e.partner_row_id,
      reasons: e.reasons,
    })),
    ranked_preview: ranked.slice(0, 5).map((e) => ({
      partner_row_id: e.partner_row_id,
      score: e.score,
      distance_km: e.distance_km,
    })),
  };

  if (!ranked.length) {
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: job.status,
      newStatus: job.status,
      actorId: "dispatch",
      actorRole: "SYSTEM",
      reason: "No eligible professional found",
      metadata: dispatchMeta,
    });
    return { dispatched: false, reason: "NO_ELIGIBLE_PARTNER", ...dispatchMeta };
  }

  const winner = ranked[0];
  const eligibleIds = ranked.map((row) => String(row.partner_row_id));
  const eligiblePartners = partners.filter((partner) =>
    eligibleIds.includes(String(partner.row_id))
  );
  const offerExpiresAt = computeOfferExpiresAt();
  const broadcastMeta = {
    ...parseJobMetadata(job.metadata_json),
    ...dispatchMeta,
    eligible_partner_row_ids: eligibleIds,
    selected_preview_partner_row_id: winner.partner_row_id,
    offer_broadcast_at: nowSql(),
  };

  await app.datastore().table("Professional_Jobs").updateRow({
    ROWID: jobRowId,
    metadata_json: JSON.stringify(broadcastMeta).slice(0, 4000),
    offer_expires_at: offerExpiresAt,
  });

  const refreshedJob = (await findJobByRowId(zcql, jobRowId)) || job;
  const notifications = [];
  for (const candidate of eligiblePartners) {
    notifications.push(
      await notifyPartnerAssigned(options.req || null, candidate, refreshedJob, context, app)
    );
  }

  await appendStatusHistory(app, {
    professionalJobRowId: jobRowId,
    oldStatus: job.status,
    newStatus: job.status,
    actorId: "dispatch",
    actorRole: "SYSTEM",
    reason: "Offer broadcast to eligible professionals",
    metadata: {
      eligible_count: eligibleIds.length,
      selected_preview_partner_row_id: winner.partner_row_id,
    },
  });

  return {
    dispatched: true,
    reason: "OFFER_BROADCAST",
    job: refreshedJob,
    ...dispatchMeta,
    eligible_count: eligibleIds.length,
    offered_count: eligiblePartners.length,
    notifications,
  };
}

async function tryDispatchAfterCreation(app, jobRowId, req = null) {
  try {
    return await dispatchProfessionalJob(app, jobRowId, { req });
  } catch (error) {
    console.error("[professional-dispatch] auto dispatch failed", jobRowId, error.message);
    return { dispatched: false, reason: "DISPATCH_ERROR", message: error.message };
  }
}

async function dispatchPendingJobs(app, limit = 20, req = null) {
  const zcql = app.zcql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING' ORDER BY CREATEDTIME ASC LIMIT " +
        Math.min(Math.max(limit, 1), 100)
    ),
    "Professional_Jobs"
  );
  const results = [];
  for (const row of rows) {
    results.push({
      job_row_id: String(row.ROWID),
      ...(await dispatchProfessionalJob(app, row.ROWID, { req })),
    });
  }
  return results;
}

/**
 * Go-online hook: offer location-eligible pending jobs to a partner who just came online.
 * Appends the partner to existing broadcast pools or re-dispatches jobs with no offers yet.
 */
async function offerPendingJobsToPartnerOnGoOnline(app, partnerRowId, limit = 30, req = null) {
  const zcql = app.zcql();
  const partner = await loadPartnerRow(zcql, partnerRowId);
  if (!partner) {
    return { offered: 0, reason: "PARTNER_NOT_FOUND", results: [] };
  }
  if (normalizeOnlineStatus(partner.online_status) !== ONLINE_STATUS.ONLINE_AVAILABLE) {
    return { offered: 0, reason: "PARTNER_OFFLINE", results: [] };
  }

  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING' AND (delivery_partner_row_id IS NULL OR delivery_partner_row_id = '') ORDER BY CREATEDTIME ASC LIMIT " +
        Math.min(Math.max(limit, 1), 50)
    ),
    "Professional_Jobs"
  );

  const results = [];
  let offered = 0;
  const partnerRef = String(partner.row_id);

  for (const row of rows) {
    const jobRowId = String(row.ROWID);
    const job = await findJobByRowId(zcql, jobRowId);
    if (!job) {
      continue;
    }

    const meta = parseJobMetadata(job.metadata_json);
    const eligibleIds = (meta.eligible_partner_row_ids || []).map(String);
    if (eligibleIds.includes(partnerRef)) {
      results.push({ job_row_id: jobRowId, action: "ALREADY_OFFERED" });
      continue;
    }

    const excluded = new Set(rejectedPartnerIdsFromMetadata(job.metadata_json).map(String));
    if (excluded.has(partnerRef)) {
      results.push({ job_row_id: jobRowId, action: "PARTNER_REJECTED" });
      continue;
    }

    const context = await loadJobDispatchContext(zcql, job);
    const evalResult = await evaluatePartnerEligibility(zcql, partner, job, context, {
      app,
      req,
    });
    if (!evalResult.eligible) {
      results.push({
        job_row_id: jobRowId,
        action: "INELIGIBLE",
        reasons: evalResult.reasons,
        distance_km: evalResult.distance_km,
      });
      continue;
    }

    if (!eligibleIds.length) {
      const dispatchResult = await dispatchProfessionalJob(app, jobRowId, { req });
      results.push({ job_row_id: jobRowId, action: "REDISPATCH", ...dispatchResult });
      if (dispatchResult.dispatched) {
        offered += 1;
      }
      continue;
    }

    const updatedMeta = {
      ...meta,
      eligible_partner_row_ids: [...eligibleIds, partnerRef],
      go_online_partner_row_id: partnerRef,
      go_online_offered_at: nowSql(),
    };
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      metadata_json: JSON.stringify(updatedMeta).slice(0, 4000),
    });
    const refreshedJob = (await findJobByRowId(zcql, jobRowId)) || job;
    const notification = await notifyPartnerAssigned(req, partner, refreshedJob, context, app);
    results.push({ job_row_id: jobRowId, action: "OFFER_ADDED", notification });
    offered += 1;
  }

  return { offered, results };
}

/** Go-online hook: retry only jobs already linked to this partner (not global Dev queue). */
async function dispatchPrelinkedJobsForPartner(app, partnerRowId, limit = 5, req = null) {
  const { parseDeliveryPartnerId } = require("./delivery-partner");
  const parsed = parseDeliveryPartnerId(partnerRowId) || String(partnerRowId || "").trim();
  const partnerRef = asId(parsed, "partner_row_id");
  const zcql = app.zcql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING' AND delivery_partner_row_id = " +
        partnerRef +
        " ORDER BY CREATEDTIME ASC LIMIT " +
        Math.min(Math.max(limit, 1), 20)
    ),
    "Professional_Jobs"
  );
  const results = [];
  for (const row of rows) {
    results.push({
      job_row_id: String(row.ROWID),
      ...(await dispatchProfessionalJob(app, row.ROWID, { req })),
    });
  }
  return results;
}

module.exports = {
  DISPATCH_RANK_WEIGHTS,
  MAX_CONCURRENT_ASSIGNED,
  evaluatePartnerEligibility,
  rankEligibleCandidates,
  loadJobDispatchContext,
  loadProductDeliveryContext,
  loadHomeServiceContext,
  isJobReferenceDispatchable,
  assignJobToPartner,
  dispatchProfessionalJob,
  tryDispatchAfterCreation,
  dispatchPendingJobs,
  dispatchPrelinkedJobsForPartner,
  offerPendingJobsToPartnerOnGoOnline,
  resolvePartnerDispatchCoords,
  partnerHasServiceSkill,
  partnerCoversCity,
  loadPartnerRow,
  loadPartnerServiceLocation,
  countPartnerAssignedJobs,
  notifyPartnerAssigned,
  buildJobOfferNotification,
};
