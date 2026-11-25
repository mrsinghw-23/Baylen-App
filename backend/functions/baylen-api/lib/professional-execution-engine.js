"use strict";

const { rowOf, rowsOf, asId, num, optionalText } = require("./http");
const {
  JOB_STATUS,
  assertJobTransition,
  normalizeJobStatus,
} = require("./professional-job-fsm");
const {
  findJobByRowId,
  appendStatusHistory,
  JOB_TYPES,
  REFERENCE_TYPES,
} = require("./professional-job-engine");
const {
  loadPartnerBySession,
  assertPartnerCanRespond,
} = require("./professional-job-offer-engine");
const {
  assertPartnerJobMutationAccess,
  assertPartnerExecutionAllowed,
} = require("./professional-partner-guard");
const { loadJobDispatchContext } = require("./professional-dispatch-engine");
const { withProfessionalJobLock } = require("./professional-job-lock");
const { assertProviderTransition } = require("./at-home-beauty-fsm");
const { readArrivalOtpState } = require("./at-home-beauty-otp");
const { emitJobEvent } = require("./at-home-beauty-events");
const { readExtraRequest, requestExtraServiceFromCatalog } = require("./at-home-beauty-extra");
const {
  executionCacheKey,
  resolveChecklistTemplate,
  proofRequiredForService,
  EXECUTION_CACHE_TTL_MINUTES,
} = require("./professional-execution-config");
const { settleProfessionalJobFinance, getProfessionalJobFinanceSummary } = require("./professional-finance-engine");

const EXECUTABLE_STATUSES = new Set([
  JOB_STATUS.OTP_VERIFIED,
  JOB_STATUS.STARTED,
  JOB_STATUS.IN_PROGRESS,
]);
const ACTIVE_EXECUTION_STATUSES = new Set([JOB_STATUS.STARTED, JOB_STATUS.IN_PROGRESS]);
const TERMINAL_STATUSES = new Set(["COMPLETED", "DELIVERED", "CANCELLED", "CLOSED"]);

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function readExecutionState(app, professionalJobRowId) {
  try {
    const raw = await app.cache().segment().getValue(executionCacheKey(professionalJobRowId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function writeExecutionState(app, professionalJobRowId, state) {
  await app.cache().segment().put(
    executionCacheKey(professionalJobRowId),
    JSON.stringify({
      ...state,
      updated_at: new Date().toISOString(),
    }),
    EXECUTION_CACHE_TTL_MINUTES
  );
}

function buildInitialChecklist(serviceName) {
  return resolveChecklistTemplate(serviceName).map((item) => ({
    id: "svc-" + item.id,
    label: item.label,
    mandatory: item.mandatory === true,
    done: false,
    completed_at: "",
    completed_by: "",
  }));
}

async function ensureExecutionState(app, job, context) {
  let state = await readExecutionState(app, job.id);
  if (state && Array.isArray(state.checklist) && state.checklist.length) {
    return state;
  }
  const serviceName = context?.service_name || context?.items?.[0]?.service_name || "Home service";
  state = {
    checklist: buildInitialChecklist(serviceName),
    materials: [],
    proofs: { before: [], after: [] },
    notes: "",
    service_started_at: "",
  };
  await writeExecutionState(app, job.id, state);
  return state;
}

async function assertPartnerOwnsHomeServiceJob(zcql, app, jobRowId, partnerSession, options = {}) {
  const partner = await loadPartnerBySession(zcql, partnerSession);
  assertPartnerExecutionAllowed(partner);
  assertPartnerCanRespond(partner, { requireOnline: false });

  const job = await findJobByRowId(zcql, jobRowId);
  if (!job) {
    const error = new Error("Professional job not found");
    error.status = 404;
    error.code = "JOB_NOT_FOUND";
    throw error;
  }
  assertPartnerJobMutationAccess(job, partner);
  if (job.job_type !== JOB_TYPES.HOME_SERVICE && job.reference_type !== REFERENCE_TYPES.SERVICE_JOB) {
    const error = new Error("Service execution is only supported for home service jobs");
    error.status = 409;
    error.code = "JOB_NOT_SUPPORTED";
    throw error;
  }
  const status = normalizeJobStatus(job.status);
  if (TERMINAL_STATUSES.has(status)) {
    const allowCompleted =
      options.allowCompleted === true && status === JOB_STATUS.COMPLETED;
    if (!allowCompleted) {
      const error = new Error("Job is no longer active");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }
  }

  const context = await loadJobDispatchContext(zcql, job);
  return { partner, job, context };
}

async function syncServiceJobStarted(app, job, partner) {
  const zcql = app.zcql();
  const serviceJob = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status FROM Service_Jobs WHERE ROWID = " +
        asId(job.reference_row_id, "service_job_id")
    ),
    "Service_Jobs"
  );
  if (!serviceJob) {
    return;
  }
  const from = String(serviceJob.status || "").toUpperCase();
  if (from === "STARTED" || from === "COMPLETED") {
    return;
  }
  const otpState = await readArrivalOtpState(app, job.reference_row_id);
  if (!otpState || !otpState.verified) {
    const error = new Error("Customer OTP must be verified before starting service");
    error.status = 409;
    error.code = "OTP_NOT_VERIFIED";
    throw error;
  }
  if (from === "ARRIVED" || from === "EN_ROUTE") {
    if (from === "EN_ROUTE") {
      assertProviderTransition("EN_ROUTE", "ARRIVED");
      await app.datastore().table("Service_Jobs").updateRow({
        ROWID: job.reference_row_id,
        status: "ARRIVED",
      });
    }
    assertProviderTransition("ARRIVED", "STARTED");
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: job.reference_row_id,
      status: "STARTED",
      delivery_partner_row_id: job.delivery_partner_row_id,
    });
    try {
      await app.datastore().table("Job_Timeline").insertRow({
        job_id: job.reference_row_id,
        provider_id: partner.legacy_provider_id || partner.row_id,
        status: "STARTED",
        note: "Service started",
        happened_at: nowSql(),
      });
    } catch (_) {}
    const userId = await contextUserId(zcql, job);
    await emitJobEvent(app, {
      jobId: job.reference_row_id,
      userId,
      providerId: partner.legacy_provider_id || partner.row_id,
      event: "SERVICE_STARTED",
      status: "STARTED",
      note: "Service in progress",
    }).catch(() => {});
  }
}

async function contextUserId(zcql, job) {
  const serviceJob = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT user_id FROM Service_Jobs WHERE ROWID = " + asId(job.reference_row_id, "service_job_id")
    ),
    "Service_Jobs"
  );
  return serviceJob?.user_id || "";
}

async function syncServiceJobCompleted(app, job, partner) {
  const zcql = app.zcql();
  const serviceJob = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, status, user_id, grand_total, payment_status FROM Service_Jobs WHERE ROWID = " +
        asId(job.reference_row_id, "service_job_id")
    ),
    "Service_Jobs"
  );
  if (!serviceJob) {
    return serviceJob;
  }
  const from = String(serviceJob.status || "").toUpperCase();
  if (from === "COMPLETED") {
    return serviceJob;
  }
  if (from === "STARTED") {
    assertProviderTransition("STARTED", "COMPLETED");
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: job.reference_row_id,
      status: "COMPLETED",
    });
    try {
      await app.datastore().table("Job_Timeline").insertRow({
        job_id: job.reference_row_id,
        provider_id: partner.legacy_provider_id || partner.row_id,
        status: "COMPLETED",
        note: "Service completed",
        happened_at: nowSql(),
      });
    } catch (_) {}
    await emitJobEvent(app, {
      jobId: job.reference_row_id,
      userId: serviceJob.user_id,
      providerId: partner.legacy_provider_id || partner.row_id,
      event: "SERVICE_COMPLETED",
      status: "COMPLETED",
      note: "Service completed",
    }).catch(() => {});
  }
  return serviceJob;
}

function computeProgressPercent(checklist) {
  if (!checklist || !checklist.length) {
    return 0;
  }
  const done = checklist.filter((item) => item.done).length;
  return Math.round((done / checklist.length) * 100);
}

function mapExecutionResponse(job, context, state, extraRequest) {
  const status = normalizeJobStatus(job.status);
  const checklist = state?.checklist || [];
  const serviceName = context?.service_name || "Home service";
  return {
    professional_job_id: job.id,
    job_status: job.status,
    service_name: serviceName,
    duration_minutes: context?.duration_minutes || null,
    drop_address: context?.drop_address || "",
    customer_name: context?.customer_name || "",
    amount: context?.amount ?? 0,
    currency: context?.currency || "INR",
    payment_status: context?.payment_status || "",
    service_started_at: job.started_at || state?.service_started_at || "",
    service_completed_at: job.completed_at || "",
    checklist,
    progress_percent: computeProgressPercent(checklist),
    materials: state?.materials || [],
    proofs: state?.proofs || { before: [], after: [] },
    notes: state?.notes || "",
    pending_add_on: extraRequest && extraRequest.status === "PENDING" ? extraRequest : null,
    approved_add_ons: extraRequest && extraRequest.status === "APPROVED" ? [extraRequest] : [],
    before_photo_required: proofRequiredForService(serviceName),
    after_photo_required: proofRequiredForService(serviceName),
    can_start_service: status === JOB_STATUS.OTP_VERIFIED,
    can_complete_service: ACTIVE_EXECUTION_STATUSES.has(status),
    service_ready: status === JOB_STATUS.OTP_VERIFIED,
    service_in_progress: ACTIVE_EXECUTION_STATUSES.has(status),
    service_completed: status === JOB_STATUS.COMPLETED,
    phase:
      status === JOB_STATUS.COMPLETED
        ? "completed"
        : ACTIVE_EXECUTION_STATUSES.has(status)
          ? "in_progress"
          : status === JOB_STATUS.OTP_VERIFIED
            ? "otp_verified"
            : job.status.toLowerCase(),
  };
}

async function getProfessionalJobExecution(app, jobRowId, partnerSession) {
  const zcql = app.zcql();
  const { job, context } = await assertPartnerOwnsHomeServiceJob(zcql, app, jobRowId, partnerSession, {
    allowCompleted: true,
  });
  const state = await ensureExecutionState(app, job, context);
  const extraRequest = await readExtraRequest(app, job.reference_row_id);
  return mapExecutionResponse(job, context, state, extraRequest);
}

async function startProfessionalJobService(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsHomeServiceJob(
      zcql,
      app,
      jobRowId,
      partnerSession
    );
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.STARTED || currentStatus === JOB_STATUS.IN_PROGRESS) {
      const state = await ensureExecutionState(app, job, context);
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        status: job.status,
        service_started_at: job.started_at || state.service_started_at,
        phase: "in_progress",
      };
    }

    if (currentStatus === JOB_STATUS.COMPLETED) {
      const error = new Error("Service is already completed");
      error.status = 409;
      error.code = "SERVICE_ALREADY_COMPLETED";
      throw error;
    }

    if (currentStatus !== JOB_STATUS.OTP_VERIFIED) {
      const error = new Error("Customer OTP must be verified before starting service");
      error.status = 409;
      error.code = "OTP_NOT_VERIFIED";
      throw error;
    }

    const otpState = await readArrivalOtpState(app, job.reference_row_id);
    if (!otpState || !otpState.verified) {
      const error = new Error("Customer OTP must be verified before starting service");
      error.status = 409;
      error.code = "OTP_NOT_VERIFIED";
      throw error;
    }

    const startedAt = nowSql();
    assertJobTransition(currentStatus, JOB_STATUS.STARTED, JOB_TYPES.HOME_SERVICE);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.STARTED,
      started_at: startedAt,
    });
    assertJobTransition(JOB_STATUS.STARTED, JOB_STATUS.IN_PROGRESS, JOB_TYPES.HOME_SERVICE);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.IN_PROGRESS,
    });

    await syncServiceJobStarted(app, job, partner);

    const state = await ensureExecutionState(app, job, context);
    state.service_started_at = startedAt;
    await writeExecutionState(app, job.id, state);

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.STARTED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "SERVICE_STARTED",
      metadata: { event: "service_started" },
    });
    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: JOB_STATUS.STARTED,
      newStatus: JOB_STATUS.IN_PROGRESS,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "SERVICE_IN_PROGRESS",
      metadata: { event: "service_in_progress" },
    });

    return {
      success: true,
      idempotent: false,
      professional_job_id: job.id,
      status: JOB_STATUS.IN_PROGRESS,
      service_started_at: startedAt,
      phase: "in_progress",
    };
  });
}

async function updateProfessionalJobChecklistItem(app, jobRowId, partnerSession, itemId, done) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsHomeServiceJob(
      zcql,
      app,
      jobRowId,
      partnerSession
    );
    const status = normalizeJobStatus(job.status);
    if (!ACTIVE_EXECUTION_STATUSES.has(status)) {
      const error = new Error("Checklist can only be updated while service is in progress");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const state = await ensureExecutionState(app, job, context);
    const checklist = state.checklist || [];
    const index = checklist.findIndex((item) => item.id === String(itemId));
    if (index < 0) {
      const error = new Error("Checklist item not found");
      error.status = 404;
      error.code = "CHECKLIST_ITEM_NOT_FOUND";
      throw error;
    }

    checklist[index] = {
      ...checklist[index],
      done: done === true,
      completed_at: done === true ? new Date().toISOString() : "",
      completed_by: done === true ? String(partner.row_id) : "",
    };
    state.checklist = checklist;
    await writeExecutionState(app, job.id, state);

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: job.status,
      newStatus: job.status,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "CHECKLIST_UPDATED",
      metadata: { item_id: itemId, done: done === true },
    });

    return {
      success: true,
      item_id: itemId,
      done: done === true,
      progress_percent: computeProgressPercent(checklist),
      checklist,
    };
  });
}

async function requestProfessionalJobAddOn(app, jobRowId, partnerSession, body) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsHomeServiceJob(
      zcql,
      app,
      jobRowId,
      partnerSession
    );
    const status = normalizeJobStatus(job.status);
    if (!ACTIVE_EXECUTION_STATUSES.has(status)) {
      const error = new Error("Add-ons can only be requested during an active service");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const serviceId = asId(body.service_id, "service_id");
    const quantity = Math.max(1, Math.min(10, num(body.quantity) || 1));
    const request = await requestExtraServiceFromCatalog(app, {
      jobId: job.reference_row_id,
      serviceId,
      outletRowId: job.outlet_row_id || context?.outlet_row_id,
      providerId: partner.legacy_provider_id || partner.row_id,
      quantity,
    });

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: job.status,
      newStatus: job.status,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "ADDON_REQUESTED",
      metadata: { service_id: serviceId, price: request.price },
    });

    return { success: true, request };
  });
}

async function recordProfessionalJobProof(app, jobRowId, partnerSession, body) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsHomeServiceJob(
      zcql,
      app,
      jobRowId,
      partnerSession
    );
    const status = normalizeJobStatus(job.status);
    if (!EXECUTABLE_STATUSES.has(status) && status !== JOB_STATUS.COMPLETED) {
      const error = new Error("Proof can only be uploaded for an active or completed service");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const fileUrl = optionalText(body.file_url, "file_url", 500);
    if (!fileUrl) {
      const error = new Error("file_url is required");
      error.status = 400;
      error.code = "VALIDATION_ERROR";
      throw error;
    }
    const proofType = String(body.proof_type || body.type || "AFTER")
      .trim()
      .toUpperCase();
    if (proofType !== "BEFORE" && proofType !== "AFTER") {
      const error = new Error("proof_type must be BEFORE or AFTER");
      error.status = 400;
      error.code = "VALIDATION_ERROR";
      throw error;
    }

    const providerId = partner.legacy_provider_id || partner.row_id;
    const inserted = await app.datastore().table("Job_Proofs").insertRow({
      job_id: job.reference_row_id,
      provider_id: providerId,
      file_url: fileUrl,
      proof_type: proofType,
      notes: optionalText(body.notes, "notes", 255) || null,
    });

    const state = await ensureExecutionState(app, job, context);
    const proofRecord = {
      proof_id: String(inserted.ROWID || inserted.rowid || ""),
      file_url: fileUrl,
      proof_type: proofType,
      captured_at: new Date().toISOString(),
      uploaded_by: String(partner.row_id),
    };
    const bucket = proofType === "BEFORE" ? "before" : "after";
    state.proofs = state.proofs || { before: [], after: [] };
    state.proofs[bucket] = [...(state.proofs[bucket] || []), proofRecord];
    await writeExecutionState(app, job.id, state);

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: job.status,
      newStatus: job.status,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: proofType === "BEFORE" ? "BEFORE_PROOF_UPLOADED" : "AFTER_PROOF_UPLOADED",
      metadata: { proof_id: proofRecord.proof_id, proof_type: proofType },
    });

    return { success: true, proof: proofRecord };
  });
}

function validateCompletionRequirements(job, context, state) {
  const serviceName = context?.service_name || "";
  const checklist = state?.checklist || [];
  const missingMandatory = checklist.filter((item) => item.mandatory && !item.done);
  if (missingMandatory.length) {
    const error = new Error("Required checklist items are incomplete");
    error.status = 409;
    error.code = "CHECKLIST_INCOMPLETE";
    error.missing_items = missingMandatory.map((item) => item.id);
    throw error;
  }

  if (proofRequiredForService(serviceName)) {
    const proofs = state?.proofs || {};
    if (!proofs.before || !proofs.before.length) {
      const error = new Error("Before-service proof is required");
      error.status = 409;
      error.code = "PROOF_REQUIRED";
      error.proof_type = "BEFORE";
      throw error;
    }
    if (!proofs.after || !proofs.after.length) {
      const error = new Error("After-service proof is required");
      error.status = 409;
      error.code = "PROOF_REQUIRED";
      error.proof_type = "AFTER";
      throw error;
    }
  }
}

async function completeProfessionalJobService(app, jobRowId, partnerSession) {
  return withProfessionalJobLock(app, jobRowId, async () => {
    const zcql = app.zcql();
    const { partner, job, context } = await assertPartnerOwnsHomeServiceJob(
      zcql,
      app,
      jobRowId,
      partnerSession,
      { allowCompleted: true }
    );
    const currentStatus = normalizeJobStatus(job.status);

    if (currentStatus === JOB_STATUS.COMPLETED) {
      const state = await ensureExecutionState(app, job, context);
      const serviceJob = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT grand_total, payment_status FROM Service_Jobs WHERE ROWID = " +
            asId(job.reference_row_id, "service_job_id")
        ),
        "Service_Jobs"
      );
      const finance = await getProfessionalJobFinanceSummary(app, job.id);
      return {
        success: true,
        idempotent: true,
        professional_job_id: job.id,
        status: JOB_STATUS.COMPLETED,
        service_completed_at: job.completed_at,
        grand_total: num(serviceJob?.grand_total),
        payment_status: serviceJob?.payment_status || "",
        progress_percent: computeProgressPercent(state.checklist),
        ...finance,
      };
    }

    if (!ACTIVE_EXECUTION_STATUSES.has(currentStatus)) {
      const error = new Error("Service must be started before completion");
      error.status = 409;
      error.code = "INVALID_SERVICE_STATE";
      throw error;
    }

    const state = await ensureExecutionState(app, job, context);
    const extraRequest = await readExtraRequest(app, job.reference_row_id);
    if (extraRequest && extraRequest.status === "PENDING") {
      const error = new Error("Customer has not approved the pending add-on");
      error.status = 409;
      error.code = "ADDON_NOT_APPROVED";
      throw error;
    }
    validateCompletionRequirements(job, context, state);

    const completedAt = nowSql();
    assertJobTransition(currentStatus, JOB_STATUS.COMPLETED, JOB_TYPES.HOME_SERVICE);
    await app.datastore().table("Professional_Jobs").updateRow({
      ROWID: jobRowId,
      job_status: JOB_STATUS.COMPLETED,
      completed_at: completedAt,
    });

    const serviceJob = await syncServiceJobCompleted(app, job, partner);

    await appendStatusHistory(app, {
      professionalJobRowId: jobRowId,
      oldStatus: currentStatus,
      newStatus: JOB_STATUS.COMPLETED,
      actorId: partner.delivery_partner_id,
      actorRole: "PROFESSIONAL",
      reason: "SERVICE_COMPLETED",
      metadata: { event: "service_completed" },
    });

    let finance = {};
    try {
      finance = await settleProfessionalJobFinance(app, { job, partner });
    } catch (error) {
      console.error("[professional-finance] home service settlement failed", {
        professional_job_row_id: job.id,
        message: error.message,
      });
      finance = { finance_settled: false, finance_error: error.code || "FINANCE_SETTLEMENT_FAILED" };
    }

    return {
      success: true,
      idempotent: false,
      professional_job_id: job.id,
      status: JOB_STATUS.COMPLETED,
      service_completed_at: completedAt,
      service_started_at: job.started_at || state.service_started_at,
      grand_total: num(serviceJob?.grand_total),
      payment_status: serviceJob?.payment_status || "",
      duration_minutes: context?.duration_minutes || null,
      progress_percent: 100,
      review_pending: true,
      ...finance,
    };
  });
}

module.exports = {
  getProfessionalJobExecution,
  startProfessionalJobService,
  updateProfessionalJobChecklistItem,
  requestProfessionalJobAddOn,
  recordProfessionalJobProof,
  completeProfessionalJobService,
  computeProgressPercent,
  ensureExecutionState,
  readExecutionState,
};
