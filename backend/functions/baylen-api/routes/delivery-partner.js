"use strict";

const { asId, num, optionalText, rowsOf, rowOf, sendOk, sqlString } = require("../lib/http");
const { requireDeliveryPartner } = require("../lib/session");
const { parseDeliveryPartnerId } = require("../lib/delivery-partner");
const {
  getKycBundle,
  saveKycDraft,
  submitKyc,
  uploadDocument,
  deleteDocument,
  downloadDocument,
  refreshPartnerSessionToken,
  isPartnerOperational,
} = require("../lib/delivery-partner-kyc-engine");
const { streamPartnerProfilePhoto } = require("../lib/delivery-partner-photo");
const { KYC_DOCUMENT_TYPES } = require("../lib/delivery-partner-kyc");
const {
  buildPartnerDashboard,
  buildPartnerEarnings,
  updatePartnerAvailabilitySchedule,
  updatePartnerOnlineStatus,
  ONLINE_STATUS,
} = require("../lib/partner-dashboard");
const {
  recordPartnerAvailabilityLocation,
  recordPartnerAvailabilityLocationForSession,
} = require("../lib/partner-availability-location");
const {
  listPartnerJobs,
  getPartnerJobDetail,
  partnerRowIdFromSession,
} = require("../lib/professional-job-list");
const {
  dispatchProfessionalJob,
  dispatchPrelinkedJobsForPartner,
  offerPendingJobsToPartnerOnGoOnline,
} = require("../lib/professional-dispatch-engine");
const {
  acceptProfessionalJobOffer,
  rejectProfessionalJobOffer,
  REJECTION_REASONS,
} = require("../lib/professional-job-offer-engine");
const {
  startProfessionalJobTravel,
  recordProfessionalJobLocation,
} = require("../lib/professional-location-engine");
const {
  getProfessionalJobArrivalPreview,
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
  resendProfessionalJobOtp,
} = require("../lib/professional-arrival-engine");
const {
  getProfessionalJobExecution,
  startProfessionalJobService,
  updateProfessionalJobChecklistItem,
  requestProfessionalJobAddOn,
  recordProfessionalJobProof,
  completeProfessionalJobService,
} = require("../lib/professional-execution-engine");
const {
  startProfessionalJobPickup,
  getProfessionalJobPickupPreview,
  confirmProfessionalJobPickupArrival,
  verifyProfessionalJobPickup,
  confirmProfessionalJobPickedUp,
  startProfessionalJobDelivery,
  getProfessionalJobDeliveryPreview,
  confirmProfessionalJobDeliveryArrival,
  verifyProfessionalJobDeliveryOtp,
  confirmProfessionalJobDelivered,
  completeProfessionalJobDelivery,
  getProfessionalJobDeliveryExecution,
} = require("../lib/professional-delivery-engine");
const {
  listPartnerNotifications,
  markPartnerNotificationsRead,
} = require("../lib/professional-partner-notify");
const {
  cancelProfessionalJobByPartner,
  reportProfessionalJobNoShow,
  getNoShowEligibility,
  createPartnerSupportTicket,
  listPartnerSupportTickets,
} = require("../lib/professional-job-lifecycle");

const LEAD_SELECT =
  "ROWID, booking_number, outlet_id, outlet_row_id, status, visit_line1, visit_city, visit_state, pincode, scheduled_at, grand_total, currency, payment_status, service_name_snapshot, gender_preference, delivery_partner_id, delivery_partner_row_id, provider_id";

function resolvePartnerOutletRef(partner) {
  if (partner.outlet_row_id != null && partner.outlet_row_id !== "") {
    return asId(partner.outlet_row_id, "outlet_row_id");
  }
  if (partner.outlet_id != null && partner.outlet_id !== "") {
    return asId(partner.outlet_id, "outlet_id");
  }
  return "";
}

function mapLead(row) {
  return {
    id: String(row.ROWID),
    booking_number: row.booking_number || "",
    outlet_id: row.outlet_id != null ? String(row.outlet_id) : "",
    outlet_row_id:
      row.outlet_row_id != null && row.outlet_row_id !== ""
        ? String(row.outlet_row_id)
        : row.outlet_id != null
          ? String(row.outlet_id)
          : "",
    status: row.status || "",
    visit_line1: row.visit_line1 || "",
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    pincode: row.pincode || "",
    scheduled_at: row.scheduled_at || "",
    grand_total: num(row.grand_total),
    currency: row.currency || "INR",
    payment_status: row.payment_status || "",
    service_name: row.service_name_snapshot || "",
    gender_preference: row.gender_preference || "",
    delivery_partner_id: row.delivery_partner_id
      ? "dp_" + String(row.delivery_partner_id)
      : null,
    delivery_partner_row_id:
      row.delivery_partner_row_id != null && row.delivery_partner_row_id !== ""
        ? String(row.delivery_partner_row_id)
        : row.delivery_partner_id != null && row.delivery_partner_id !== ""
          ? String(row.delivery_partner_id)
          : null,
    provider_id: row.provider_id != null ? String(row.provider_id) : "",
  };
}

function buildLeadsQuery(partner, statusFilter) {
  const partnerRowId = parseDeliveryPartnerId(partner.delivery_partner_id);
  const outletRef = resolvePartnerOutletRef(partner);
  const filter = String(statusFilter || "available").trim().toLowerCase();

  let query =
    "SELECT " +
    LEAD_SELECT +
    " FROM Service_Jobs WHERE (outlet_row_id = " +
    outletRef +
    " OR outlet_id = " +
    outletRef +
    ")";

  if (filter === "accepted") {
    query +=
      " AND (delivery_partner_row_id = " +
      partnerRowId +
      " OR (delivery_partner_row_id IS NULL AND delivery_partner_id = " +
      partnerRowId +
      "))";
  } else if (filter === "available") {
    query +=
      " AND delivery_partner_row_id IS NULL AND delivery_partner_id IS NULL AND status NOT IN ('CANCELLED','COMPLETED')";
  } else {
    query +=
      " AND ((delivery_partner_row_id IS NULL OR delivery_partner_row_id = " +
      partnerRowId +
      ") AND (delivery_partner_id IS NULL OR delivery_partner_id = " +
      partnerRowId +
      "))";
  }

  query += " ORDER BY scheduled_at DESC LIMIT 100";
  return query;
}

async function listLeads(zcql, partner, statusFilter) {
  if (!resolvePartnerOutletRef(partner)) {
    return [];
  }
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(buildLeadsQuery(partner, statusFilter)),
      "Service_Jobs"
    );
    return rows.map(mapLead);
  } catch (_) {
    return [];
  }
}

function assertOperationalPartner(partner) {
  if (!isPartnerOperational(partner.status)) {
    const error = new Error("Complete KYC approval is required before accessing leads and jobs");
    error.status = 403;
    error.code = "KYC_REQUIRED";
    throw error;
  }
}

function deliveryPartnerRoutes(app) {
  app.get("/v1/delivery-partner/kyc", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const bundle = await getKycBundle(req, partner);
      sendOk(res, {
        kyc: bundle.view,
        partner_status: bundle.partner_status,
        kyc_required: !isPartnerOperational(bundle.partner_status),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/kyc", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const kyc = await saveKycDraft(req, partner, req.body || {}, { createOnly: true });
      sendOk(res, { kyc, created: true });
    } catch (error) {
      next(error);
    }
  });

  app.put("/v1/delivery-partner/kyc", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const kyc = await saveKycDraft(req, partner, req.body || {}, { createOnly: false });
      sendOk(res, { kyc, updated: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/kyc/submit", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const kyc = await submitKyc(req, partner, req.body || {});
      const token = await refreshPartnerSessionToken(req, partner);
      sendOk(res, { kyc, submitted: true, token });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/kyc/documents", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const result = await uploadDocument(req, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/v1/delivery-partner/kyc/documents/:documentType", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const documentType = String(req.params.documentType || "").trim().toLowerCase();
      const result = await deleteDocument(req, partner, documentType);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/kyc/documents/:documentType", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const documentType = String(req.params.documentType || "").trim().toLowerCase();
      if (!KYC_DOCUMENT_TYPES.has(documentType)) {
        const error = new Error("Invalid document type");
        error.status = 400;
        throw error;
      }
      if (documentType === "profile_photo") {
        await streamPartnerProfilePhoto(
          req,
          res,
          parseDeliveryPartnerId(partner.delivery_partner_id),
          { partnerAuth: partner }
        );
        return;
      }
      const file = await downloadDocument(req, partner, documentType);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "private, no-store");
      res.status(200).send(file.buffer);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/leads", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const status = optionalText(req.query.status, "status", 20) || "available";
      const leads = await listLeads(req.catalystApp.zcql(), partner, status);
      sendOk(res, { leads, total: leads.length, status });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/profile-photo", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      await streamPartnerProfilePhoto(
        req,
        res,
        parseDeliveryPartnerId(partner.delivery_partner_id),
        { partnerAuth: partner }
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/dashboard", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const dashboard = await buildPartnerDashboard(req, partner.delivery_partner_id);
      sendOk(res, dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/earnings", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const earnings = await buildPartnerEarnings(req, partner.delivery_partner_id, { limit });
      sendOk(res, earnings);
    } catch (error) {
      next(error);
    }
  });

  app.put("/v1/delivery-partner/availability-schedule", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const dashboard = await updatePartnerAvailabilitySchedule(
        req,
        partner.delivery_partner_id,
        req.body || {}
      );
      sendOk(res, dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/availability-location", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const result = await recordPartnerAvailabilityLocationForSession(
        req.catalystApp,
        partner.delivery_partner_id,
        req.body || {}
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/status", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const onlineStatus = String(req.body?.online_status || req.body?.status || "")
        .trim()
        .toUpperCase();
      if (!onlineStatus) {
        const error = new Error("online_status is required");
        error.status = 400;
        throw error;
      }
      const dashboard = await updatePartnerOnlineStatus(
        req,
        partner.delivery_partner_id,
        onlineStatus
      );
      if (onlineStatus === ONLINE_STATUS.ONLINE_AVAILABLE) {
        const body = req.body || {};
        if (body.latitude != null && body.longitude != null) {
          const zcql = req.catalystApp.zcql();
          const partnerRow = rowOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID, online_status FROM Delivery_Partners WHERE ROWID = " +
                asId(parseDeliveryPartnerId(partner.delivery_partner_id), "partner_id")
            ),
            "Delivery_Partners"
          );
          recordPartnerAvailabilityLocation(req.catalystApp, partnerRow, body).catch(() => {});
        }
        dispatchPrelinkedJobsForPartner(
          req.catalystApp,
          partner.delivery_partner_id,
          5,
          req
        ).catch(() => {});
        offerPendingJobsToPartnerOnGoOnline(
          req.catalystApp,
          partner.delivery_partner_id,
          30,
          req
        ).catch(() => {});
      }
      sendOk(res, dashboard);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/jobs", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const partnerRowId = partnerRowIdFromSession(partner);
      const view = optionalText(req.query.view, "view", 20) || "offered";
      const jobType = optionalText(req.query.job_type, "job_type", 30) || "";
      const result = await listPartnerJobs(req.catalystApp.zcql(), partnerRowId, {
        view,
        jobType: jobType || undefined,
      });
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-detail", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const partnerRowId = partnerRowIdFromSession(partner);
      const jobId = asId(
        req.query.professional_job_id || req.query.job_id,
        "professional_job_id"
      );
      const detail = await getPartnerJobDetail(req.catalystApp.zcql(), partnerRowId, jobId, req.catalystApp);
      sendOk(res, { job: detail });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/jobs/detail", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const partnerRowId = partnerRowIdFromSession(partner);
      const jobId = asId(
        req.query.professional_job_id || req.query.job_id,
        "professional_job_id"
      );
      const detail = await getPartnerJobDetail(req.catalystApp.zcql(), partnerRowId, jobId, req.catalystApp);
      sendOk(res, { job: detail });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/jobs/:jobId", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const partnerRowId = partnerRowIdFromSession(partner);
      const jobId = asId(req.params.jobId, "professional_job_id");
      const detail = await getPartnerJobDetail(req.catalystApp.zcql(), partnerRowId, jobId, req.catalystApp);
      sendOk(res, { job: detail });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/jobs/accept", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await acceptProfessionalJobOffer(
        req.catalystApp,
        jobId,
        partner,
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-accept", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await acceptProfessionalJobOffer(
        req.catalystApp,
        jobId,
        partner,
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/jobs/reject", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const reason = String(req.body?.reason || "").trim();
      if (!reason) {
        const error = new Error("reason is required");
        error.status = 422;
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const result = await rejectProfessionalJobOffer(
        req.catalystApp,
        jobId,
        partner,
        reason,
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-reject", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const reason = String(req.body?.reason || "").trim();
      if (!reason) {
        const error = new Error("reason is required");
        error.status = 422;
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const result = await rejectProfessionalJobOffer(
        req.catalystApp,
        jobId,
        partner,
        reason,
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-start-travel", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await startProfessionalJobTravel(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-location", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await recordProfessionalJobLocation(req.catalystApp, jobId, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/jobs/start-travel", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await startProfessionalJobTravel(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/jobs/location", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await recordProfessionalJobLocation(req.catalystApp, jobId, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-arrival-preview", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(
        req.query.professional_job_id || req.query.job_id,
        "professional_job_id"
      );
      const result = await getProfessionalJobArrivalPreview(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-arrive", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await confirmProfessionalJobArrival(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-verify-otp", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const otp = String(req.body?.otp || "").trim();
      if (!otp) {
        const error = new Error("otp is required");
        error.status = 422;
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const result = await verifyProfessionalJobOtp(req.catalystApp, jobId, partner, otp);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-resend-otp", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await resendProfessionalJobOtp(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-execution", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(
        req.query?.professional_job_id || req.query?.job_id,
        "professional_job_id"
      );
      const result = await getProfessionalJobExecution(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-start-service", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await startProfessionalJobService(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-checklist-item", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const itemId = String(req.body?.item_id || "").trim();
      if (!itemId) {
        const error = new Error("item_id is required");
        error.status = 422;
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const done = req.body?.done === true || req.body?.done === "true";
      const result = await updateProfessionalJobChecklistItem(
        req.catalystApp,
        jobId,
        partner,
        itemId,
        done
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-add-on-request", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await requestProfessionalJobAddOn(req.catalystApp, jobId, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-proof", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await recordProfessionalJobProof(req.catalystApp, jobId, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-complete-service", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await completeProfessionalJobService(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-delivery-execution", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.query?.professional_job_id || req.query?.job_id, "professional_job_id");
      const result = await getProfessionalJobDeliveryExecution(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-start-pickup", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await startProfessionalJobPickup(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-pickup-preview", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.query?.professional_job_id || req.query?.job_id, "professional_job_id");
      const result = await getProfessionalJobPickupPreview(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-pickup-arrive", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await confirmProfessionalJobPickupArrival(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-verify-pickup", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const otp = optionalText(req.body?.otp || req.body?.verification_code, "otp");
      const result = await verifyProfessionalJobPickup(req.catalystApp, jobId, partner, otp);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-pickup", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await confirmProfessionalJobPickedUp(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-start-delivery", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await startProfessionalJobDelivery(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-delivery-preview", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.query?.professional_job_id || req.query?.job_id, "professional_job_id");
      const result = await getProfessionalJobDeliveryPreview(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-delivery-arrive", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await confirmProfessionalJobDeliveryArrival(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-verify-delivery-otp", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const otp = optionalText(req.body?.otp || req.body?.verification_code, "otp");
      const result = await verifyProfessionalJobDeliveryOtp(req.catalystApp, jobId, partner, otp);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-delivered", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await confirmProfessionalJobDelivered(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-complete-delivery", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await completeProfessionalJobDelivery(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/notifications", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const partnerRowId = partnerRowIdFromSession(partner);
      const notifications = await listPartnerNotifications(req.catalystApp.zcql(), partnerRowId, {
        limit: num(req.query?.limit) || 20,
      });
      sendOk(res, { notifications });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/notifications/read", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const partnerRowId = partnerRowIdFromSession(partner);
      const ids = Array.isArray(req.body?.notification_ids)
        ? req.body.notification_ids
        : req.body?.notification_id
          ? [req.body.notification_id]
          : [];
      const result = await markPartnerNotificationsRead(req.catalystApp, partnerRowId, ids);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-cancel", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await cancelProfessionalJobByPartner(
        req.catalystApp,
        jobId,
        partner,
        req.body || {},
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/professional-job-no-show-eligibility", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.query?.professional_job_id || req.query?.job_id, "professional_job_id");
      const result = await getNoShowEligibility(req.catalystApp, jobId, partner);
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/professional-job-no-show", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      assertOperationalPartner(partner);
      const jobId = asId(req.body?.professional_job_id || req.body?.job_id, "professional_job_id");
      const result = await reportProfessionalJobNoShow(
        req.catalystApp,
        jobId,
        partner,
        req.body || {},
        req
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/delivery-partner/support/tickets", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const result = await createPartnerSupportTicket(req.catalystApp, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/delivery-partner/support/tickets", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const partnerRowId = partnerRowIdFromSession(partner);
      const tickets = await listPartnerSupportTickets(req.catalystApp.zcql(), partnerRowId, {
        limit: num(req.query?.limit) || 20,
      });
      sendOk(res, { tickets });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  deliveryPartnerRoutes,
  listLeads,
  mapLead,
  buildLeadsQuery,
  assertOperationalPartner,
  ONLINE_STATUS,
};
