"use strict";

const { isPartnerOperational } = require("./delivery-partner-kyc-engine");

function jobNotFoundError() {
  const error = new Error("Professional job not found");
  error.status = 404;
  error.code = "JOB_NOT_FOUND";
  return error;
}

function compareRowIds(left, right) {
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function isSafeRowId(value) {
  return /^\d+$/.test(String(value ?? "").trim());
}

function assertPartnerOwnsJob(job, partner) {
  if (!job || !partner) {
    throw jobNotFoundError();
  }
  const partnerRowId = String(partner.row_id || partner.ROWID || "").trim();
  if (!partnerRowId || !compareRowIds(job.delivery_partner_row_id, partnerRowId)) {
    throw jobNotFoundError();
  }
}

function assertPartnerOutletAccess(job, partner) {
  const jobOutlet = String(job?.outlet_row_id || "").trim();
  const partnerOutlet = String(partner?.outlet_row_id || partner?.outlet_id || "").trim();
  if (!jobOutlet || !partnerOutlet) {
    return;
  }
  if (!compareRowIds(jobOutlet, partnerOutlet)) {
    throw jobNotFoundError();
  }
}

function assertPartnerJobMutationAccess(job, partner, { requireOutlet = true } = {}) {
  assertPartnerOwnsJob(job, partner);
  if (requireOutlet) {
    assertPartnerOutletAccess(job, partner);
  }
}

function assertPartnerExecutionAllowed(partner) {
  if (!partner) {
    const error = new Error("Delivery partner not found");
    error.status = 404;
    error.code = "PARTNER_NOT_FOUND";
    throw error;
  }
  const status = String(partner.status || "")
    .trim()
    .toLowerCase();
  if (status === "suspended" || status === "kyc_rejected") {
    const error = new Error("Partner cannot execute jobs");
    error.status = 403;
    error.code = "PARTNER_NOT_APPROVED";
    throw error;
  }
  if (!isPartnerOperational(partner.status)) {
    const error = new Error("Partner is not operational");
    error.status = 403;
    error.code = "PARTNER_NOT_OPERATIONAL";
    throw error;
  }
}

function sessionPartnerRowId(partnerSession) {
  return String(partnerSession?.delivery_partner_id || "")
    .replace(/^dp_/, "")
    .trim();
}

function assertSessionPartnerMatches(partnerSession, partnerRow) {
  const sessionRowId = sessionPartnerRowId(partnerSession);
  const actualRowId = String(partnerRow?.row_id || partnerRow?.ROWID || "").trim();
  if (!sessionRowId || !actualRowId || !compareRowIds(sessionRowId, actualRowId)) {
    const error = new Error("Delivery partner session mismatch");
    error.status = 403;
    error.code = "PARTNER_SESSION_MISMATCH";
    throw error;
  }
}

module.exports = {
  compareRowIds,
  isSafeRowId,
  jobNotFoundError,
  assertPartnerOwnsJob,
  assertPartnerOutletAccess,
  assertPartnerJobMutationAccess,
  assertPartnerExecutionAllowed,
  sessionPartnerRowId,
  assertSessionPartnerMatches,
};
