"use strict";

const { rowOf, rowsOf, num, sqlString } = require("./http");
const { parseDeliveryPartnerId } = require("./delivery-partner");
const { isPartnerOperational, normalizePartnerStatus } = require("./delivery-partner-kyc");
const {
  normalizeAvailabilitySchedule,
  summarizeSchedule,
} = require("./professional-availability-schedule");
const { mapPartnerPhotoUrls, partnerHasStoredPhoto } = require("./delivery-partner-photo");

const ONLINE_STATUS = {
  OFFLINE: "OFFLINE",
  ONLINE_AVAILABLE: "ONLINE_AVAILABLE",
  ONLINE_BUSY: "ONLINE_BUSY",
};

const ONLINE_STATUS_VALUES = new Set(Object.values(ONLINE_STATUS));

const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

const ACTIVE_JOB_SELECT =
  "ROWID, booking_number, status, visit_line1, visit_city, scheduled_at, grand_total, currency, service_name_snapshot";

const PJ_ACTIVE_SELECT =
  "ROWID, job_number, job_type, reference_type, reference_row_id, job_status, metadata_json, assigned_at";

// ASSIGNED = offered, not yet accepted — must not block go-online or can_go_offline.
const PROFESSIONAL_IN_PROGRESS_JOB_STATUSES = [
  "ACCEPTED",
  "GOING_TO_PICKUP",
  "ARRIVED_PICKUP",
  "PICKUP_VERIFIED",
  "PICKED_UP",
  "EN_ROUTE",
  "ARRIVED",
  "DELIVERY_VERIFIED",
  "DELIVERED",
  "OTP_VERIFIED",
  "STARTED",
  "IN_PROGRESS",
];

function professionalInProgressStatusSql() {
  return PROFESSIONAL_IN_PROGRESS_JOB_STATUSES.map((status) => "'" + status + "'").join(",");
}

function normalizeOnlineStatus(value) {
  const status = String(value || ONLINE_STATUS.OFFLINE)
    .trim()
    .toUpperCase();
  return ONLINE_STATUS_VALUES.has(status) ? status : ONLINE_STATUS.OFFLINE;
}

function effectiveOnlineStatus(storedStatus, hasActiveJob) {
  const normalized = normalizeOnlineStatus(storedStatus);
  if (
    hasActiveJob &&
    (normalized === ONLINE_STATUS.ONLINE_AVAILABLE ||
      normalized === ONLINE_STATUS.ONLINE_BUSY)
  ) {
    return ONLINE_STATUS.ONLINE_BUSY;
  }
  return normalized;
}

function startOfTodaySql() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function endOfTodaySql() {
  const date = new Date();
  date.setHours(23, 59, 59, 999);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function partnerJobRefColumn() {
  return "delivery_partner_row_id";
}

function todayDateSql() {
  const date = new Date();
  return date.toISOString().slice(0, 10);
}

function buildJobsTodayQuery(partnerRowId) {
  const refColumn = partnerJobRefColumn();
  const todayDate = sqlString(todayDateSql());
  return (
    "SELECT COUNT(ROWID) AS job_count FROM Service_Jobs WHERE " +
    refColumn +
    " = " +
    partnerRowId +
    " AND scheduled_date = " +
    todayDate
  );
}

function buildActiveJobQuery(partnerRowId) {
  const refColumn = partnerJobRefColumn();
  return (
    "SELECT " +
    ACTIVE_JOB_SELECT +
    " FROM Service_Jobs WHERE " +
    refColumn +
    " = " +
    partnerRowId +
    " AND status NOT IN ('COMPLETED','CANCELLED') ORDER BY scheduled_at ASC LIMIT 1"
  );
}

function mapActiveJob(row) {
  if (!row) {
    return null;
  }
  return {
    id: String(row.ROWID),
    booking_number: row.booking_number || "",
    status: row.status || "",
    visit_line1: row.visit_line1 || "",
    visit_city: row.visit_city || "",
    scheduled_at: row.scheduled_at || "",
    grand_total: num(row.grand_total),
    currency: row.currency || "INR",
    service_name: row.service_name_snapshot || "",
  };
}

function mapPartnerProfile(row) {
  if (!row) {
    return null;
  }
  const rowId = row.ROWID != null ? String(row.ROWID) : "";
  return {
    delivery_partner_id: rowId ? "dp_" + rowId : "",
    row_id: rowId,
    phone: row.phone || "",
    outlet_id: row.outlet_id != null && row.outlet_id !== "" ? String(row.outlet_id) : "",
    status: normalizePartnerStatus(row.status),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    age: row.age != null && row.age !== "" ? Number(row.age) : null,
    qualification: row.qualification || "",
    online_status: normalizeOnlineStatus(row.online_status),
    legacy_provider_id:
      row.legacy_provider_id != null && row.legacy_provider_id !== ""
        ? String(row.legacy_provider_id)
        : "",
    legacy_rider_id:
      row.legacy_rider_id != null && row.legacy_rider_id !== ""
        ? String(row.legacy_rider_id)
        : "",
    profile_photo_url: row.profile_photo_url || "",
    has_profile_photo: partnerHasStoredPhoto(row, null),
    rating: row.rating != null && row.rating !== "" ? num(row.rating) : null,
    service_zone: row.service_zone || "",
    availability_schedule: row.availability_schedule || "",
    state: row.state || "",
    district: row.district || "",
    city: row.city || "",
    postal_code: row.postal_code || "",
    country: row.country || "India",
    kyc_approved_at: row.kyc_approved_at || "",
    availability_updated_at: row.MODIFIEDTIME || row.availability_updated_at || "",
  };
}

async function loadPartnerRow(zcql, deliveryPartnerId) {
  const partnerRowId = parseDeliveryPartnerId(deliveryPartnerId);
  if (!partnerRowId) {
    return null;
  }
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, phone, outlet_id, status, first_name, last_name, age, qualification, service_zone, availability_schedule, online_status, legacy_provider_id, legacy_rider_id, profile_photo_url, rating, state, district, city, postal_code, country, kyc_approved_at, MODIFIEDTIME FROM Delivery_Partners WHERE ROWID = " +
        partnerRowId
    ),
    "Delivery_Partners"
  );
}

async function fetchActiveProfessionalJob(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          PJ_ACTIVE_SELECT +
          " FROM Professional_Jobs WHERE delivery_partner_row_id = " +
          partnerRowId +
          " AND job_status IN (" +
          professionalInProgressStatusSql() +
          ") ORDER BY assigned_at ASC LIMIT 1"
      ),
      "Professional_Jobs"
    );
    if (!row) {
      return null;
    }
    let title = row.job_number || "Professional job";
    try {
      const meta = row.metadata_json ? JSON.parse(row.metadata_json) : {};
      if (row.job_type === "HOME_SERVICE") {
        title = meta.service_name || meta.booking_number || title;
      } else {
        title = meta.order_number ? "Order " + meta.order_number : title;
      }
    } catch (_) {}
    return {
      id: String(row.ROWID),
      booking_number: row.job_number || "",
      status: row.job_status || "",
      visit_line1: "",
      visit_city: "",
      scheduled_at: row.assigned_at || "",
      grand_total: 0,
      currency: "INR",
      service_name: title,
      source: "professional_job",
    };
  } catch (_) {
    return null;
  }
}

async function partnerHasActiveJob(zcql, partnerRowId) {
  try {
    const pj = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Professional_Jobs WHERE delivery_partner_row_id = " +
          partnerRowId +
          " AND job_status IN (" + professionalInProgressStatusSql() + ") LIMIT 1"
      ),
      "Professional_Jobs"
    );
    if (pj) {
      return true;
    }
    const row = rowOf(
      await zcql.executeZCQLQuery(buildActiveJobQuery(partnerRowId)),
      "Service_Jobs"
    );
    return Boolean(row);
  } catch (_) {
    return false;
  }
}

async function countJobsToday(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(buildJobsTodayQuery(partnerRowId)),
      "Service_Jobs"
    );
    return num(row && (row.job_count ?? row.total ?? row["COUNT(ROWID)"]));
  } catch (_) {
    return 0;
  }
}

async function fetchActiveJob(zcql, partnerRowId) {
  const professional = await fetchActiveProfessionalJob(zcql, partnerRowId);
  if (professional) {
    return professional;
  }
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(buildActiveJobQuery(partnerRowId)),
      "Service_Jobs"
    );
    return mapActiveJob(row);
  } catch (_) {
    return null;
  }
}

function startOfWeekSql() {
  const date = new Date();
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setDate(date.getDate() - diff);
  date.setHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function buildPartnerDashboard(req, deliveryPartnerId) {
  const zcql = req.catalystApp.zcql();
  const partnerRow = await loadPartnerRow(zcql, deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }

  const partnerRowId = String(partnerRow.ROWID);
  const activeJob = await fetchActiveJob(zcql, partnerRowId);
  const hasActiveJob = Boolean(activeJob);
  const profile = mapPartnerProfile(partnerRow);
  const storedOnlineStatus = profile.online_status;
  const effectiveStatus = effectiveOnlineStatus(storedOnlineStatus, hasActiveJob);
  const { countPartnerJobsByStatus } = require("./professional-job-list");
  const {
    sumPartnerEarnings,
    sumPartnerPendingEarnings,
    sumPartnerAvailableEarnings,
    countPartnerCompletedJobs,
  } = require("./professional-finance-engine");
  const jobCounts = await countPartnerJobsByStatus(zcql, partnerRowId);
  const earningsToday = await sumPartnerEarnings(zcql, partnerRowId, {
    fromSql: startOfTodaySql(),
    toSql: endOfTodaySql(),
  });
  const earningsWeek = await sumPartnerEarnings(zcql, partnerRowId, {
    fromSql: startOfWeekSql(),
    toSql: endOfTodaySql(),
  });
  const pendingEarnings = await sumPartnerPendingEarnings(zcql, partnerRowId);
  const availableEarnings = await sumPartnerAvailableEarnings(zcql, partnerRowId);
  const completedToday = await countPartnerCompletedJobs(zcql, partnerRowId, {
    fromSql: startOfTodaySql(),
    toSql: endOfTodaySql(),
  });
  const { countUnreadPartnerNotifications } = require("./professional-partner-notify");
  const unreadNotifications = await countUnreadPartnerNotifications(zcql, partnerRowId);
  let serviceLocation = { state: "", district: "", city: "", pincode: "", email: "" };
  let hasStoredPhoto = Boolean(profile.has_profile_photo);
  let photoFields = {
    profile_photo_url: profile.profile_photo_url || "",
    has_profile_photo: hasStoredPhoto,
    profile_photo_fetch_url: "",
  };
  try {
    const { findKycRegRow } = require("./delivery-partner-registration");
    const kyc = await findKycRegRow(zcql, partnerRowId, partnerRow);
    serviceLocation = {
      state: kyc?.state || partnerRow.state || "",
      district: kyc?.district || partnerRow.district || "",
      city: kyc?.city || partnerRow.city || "",
      pincode: kyc?.postal_code || partnerRow.postal_code || "",
      email: kyc?.email || "",
      service_zone: kyc?.service_zone || partnerRow.service_zone || "",
      qualification: kyc?.qualification || partnerRow.qualification || "",
    };
    photoFields = mapPartnerPhotoUrls(partnerRowId, partnerRow, kyc, { scope: "employee" });
    hasStoredPhoto = photoFields.has_profile_photo;
  } catch (_) {}

  const scheduleSummary = summarizeSchedule(profile.availability_schedule);

  return {
    partner: {
      ...profile,
      online_status: storedOnlineStatus,
      effective_online_status: effectiveStatus,
      operational: isPartnerOperational(profile.status),
      has_profile_photo: hasStoredPhoto,
      profile_photo_url: photoFields.profile_photo_url,
      profile_photo_fetch_url: photoFields.profile_photo_fetch_url,
      availability_schedule_configured: scheduleSummary.configured,
      availability_schedule_days: scheduleSummary.days,
      ...serviceLocation,
      account_approved: isPartnerOperational(profile.status),
      pincode: serviceLocation.pincode || profile.postal_code || "",
    },
    stats: {
      jobs_today: await countJobsToday(zcql, partnerRowId),
      completed_today: completedToday,
      earnings_today: earningsToday,
      earnings_week: earningsWeek,
      pending_earnings: pendingEarnings,
      available_earnings: availableEarnings,
      unread_notifications: unreadNotifications,
      professional_jobs: jobCounts,
      delivery_offers_count: jobCounts.delivery_offered || 0,
      delivery_active_count: jobCounts.delivery_active || 0,
      delivery_completed_count: jobCounts.delivery_completed || 0,
      home_service_offers_count: jobCounts.home_service_offered || 0,
      home_service_active_count: jobCounts.home_service_active || 0,
      home_service_completed_count: jobCounts.home_service_completed || 0,
      home_service_cancelled_count: jobCounts.home_service_cancelled || 0,
    },
    active_job: activeJob,
    can_go_offline: !hasActiveJob,
    kyc_required: !isPartnerOperational(profile.status),
  };
}

function assertOnlineStatusTransition(partnerRow, nextStatus, hasActiveJob) {
  const normalized = normalizeOnlineStatus(nextStatus);
  if (!isPartnerOperational(partnerRow.status)) {
    if (normalized !== ONLINE_STATUS.OFFLINE) {
      const error = new Error("Complete KYC approval before going online");
      error.status = 403;
      error.code = "KYC_REQUIRED";
      throw error;
    }
    return normalized;
  }
  if (normalized === ONLINE_STATUS.OFFLINE && hasActiveJob) {
    const error = new Error(
      "Cannot go offline while you have an active job in progress"
    );
    error.status = 409;
    error.code = "ACTIVE_JOB_IN_PROGRESS";
    throw error;
  }
  return normalized;
}

async function updatePartnerAvailabilitySchedule(req, deliveryPartnerId, body) {
  const zcql = req.catalystApp.zcql();
  const partnerRow = await loadPartnerRow(zcql, deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const scheduleJson = normalizeAvailabilitySchedule(body?.availability_schedule ?? body?.schedule);
  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    availability_schedule: scheduleJson || null,
  });
  return buildPartnerDashboard(req, deliveryPartnerId);
}

async function updatePartnerOnlineStatus(req, deliveryPartnerId, nextStatus) {
  const zcql = req.catalystApp.zcql();
  const partnerRow = await loadPartnerRow(zcql, deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }

  const partnerRowId = String(partnerRow.ROWID);
  const hasActiveJob = await partnerHasActiveJob(zcql, partnerRowId);
  const normalized = assertOnlineStatusTransition(partnerRow, nextStatus, hasActiveJob);

  await req.catalystApp.datastore().table("Delivery_Partners").updateRow({
    ROWID: partnerRow.ROWID,
    online_status: normalized,
  });

  return buildPartnerDashboard(req, deliveryPartnerId);
}

async function buildPartnerEarnings(req, deliveryPartnerId, { limit = 50 } = {}) {
  const zcql = req.catalystApp.zcql();
  const partnerRow = await loadPartnerRow(zcql, deliveryPartnerId);
  if (!partnerRow) {
    const error = new Error("Delivery partner account not found");
    error.status = 404;
    throw error;
  }
  const partnerRowId = String(partnerRow.ROWID);
  const {
    sumPartnerEarnings,
    sumPartnerPendingEarnings,
    sumPartnerAvailableEarnings,
    countPartnerCompletedJobs,
    listPartnerEarningsHistory,
    sumPartnerEarningsByJobType,
    sumPartnerCommission,
  } = require("./professional-finance-engine");
  const { JOB_TYPES } = require("./professional-job-engine");
  const earningsToday = await sumPartnerEarnings(zcql, partnerRowId, {
    fromSql: startOfTodaySql(),
    toSql: endOfTodaySql(),
  });
  const earningsWeek = await sumPartnerEarnings(zcql, partnerRowId, {
    fromSql: startOfWeekSql(),
    toSql: endOfTodaySql(),
  });
  const totalEarnings = await sumPartnerEarnings(zcql, partnerRowId);
  const pendingEarnings = await sumPartnerPendingEarnings(zcql, partnerRowId);
  const availableEarnings = await sumPartnerAvailableEarnings(zcql, partnerRowId);
  const completedJobs = await countPartnerCompletedJobs(zcql, partnerRowId);
  const deliveryEarnings = await sumPartnerEarningsByJobType(
    zcql,
    partnerRowId,
    JOB_TYPES.PRODUCT_DELIVERY
  );
  const homeServiceEarnings = await sumPartnerEarningsByJobType(
    zcql,
    partnerRowId,
    JOB_TYPES.HOME_SERVICE
  );
  const history = await listPartnerEarningsHistory(zcql, partnerRowId, { limit });
  const commissionTotal = await sumPartnerCommission(zcql, partnerRowId);
  return {
    summary: {
      total_earnings: totalEarnings,
      earnings_today: earningsToday,
      earnings_week: earningsWeek,
      pending_earnings: pendingEarnings,
      available_earnings: availableEarnings,
      completed_jobs: completedJobs,
      delivery_earnings: deliveryEarnings,
      home_service_earnings: homeServiceEarnings,
      commission_total: commissionTotal,
      deductions_total: commissionTotal,
      net_earnings: availableEarnings,
    },
    history,
  };
}

module.exports = {
  ONLINE_STATUS,
  ONLINE_STATUS_VALUES,
  TERMINAL_JOB_STATUSES,
  partnerJobRefColumn,
  normalizeOnlineStatus,
  effectiveOnlineStatus,
  buildJobsTodayQuery,
  buildActiveJobQuery,
  mapActiveJob,
  mapPartnerProfile,
  buildPartnerDashboard,
  buildPartnerEarnings,
  updatePartnerAvailabilitySchedule,
  updatePartnerOnlineStatus,
  partnerHasActiveJob,
};
