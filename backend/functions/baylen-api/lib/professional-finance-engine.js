"use strict";

const { rowOf, rowsOf, asId, num, sqlString } = require("./http");

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}
const { JOB_TYPES, REFERENCE_TYPES } = require("./professional-job-engine");
const {
  PROFESSIONAL_COMMISSION_RATE,
  EARNING_STATUS,
  INVOICE_STATUS,
  PAID_PAYMENT_STATUSES,
} = require("./professional-finance-config");

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function earningIdempotencyKey(professionalJobRowId) {
  return "earning:professional_job:" + String(professionalJobRowId);
}

function invoiceIdempotencyKey(professionalJobRowId) {
  return "invoice:professional_job:" + String(professionalJobRowId);
}

function nextDocumentNumber(prefix, referenceRowId) {
  const suffix = String(referenceRowId || "").slice(-6).padStart(6, "0");
  return (prefix + new Date().getFullYear() + suffix + Date.now().toString().slice(-4)).slice(0, 30);
}

function normalizePaymentStatus(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function resolveEarningStatus(paymentStatus) {
  const normalized = normalizePaymentStatus(paymentStatus);
  if (PAID_PAYMENT_STATUSES.has(normalized)) {
    return EARNING_STATUS.AVAILABLE;
  }
  if (normalized === "COD_PENDING" || normalized === "PENDING") {
    return EARNING_STATUS.PENDING;
  }
  return EARNING_STATUS.PENDING;
}

function calculateEarningAmounts(grossAmount, { incentive = 0, tip = 0, adjustment = 0 } = {}) {
  const gross = money(grossAmount);
  const commissionRate = Math.min(Math.max(PROFESSIONAL_COMMISSION_RATE, 0), 1);
  const commission = money(gross * commissionRate);
  const net = money(gross - commission + money(incentive) + money(tip) + money(adjustment));
  return {
    gross_amount: gross,
    commission_amount: commission,
    commission_rate: commissionRate,
    incentive_amount: money(incentive),
    tip_amount: money(tip),
    adjustment_amount: money(adjustment),
    net_amount: net,
  };
}

async function findEarningByJob(zcql, professionalJobRowId) {
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, earning_number, professional_row_id, professional_job_row_id, reference_type, reference_row_id, gross_amount, commission_amount, incentive_amount, tip_amount, adjustment_amount, net_amount, currency, status, invoice_row_id, created_at FROM Professional_Earnings WHERE professional_job_row_id = " +
          asId(professionalJobRowId, "professional_job_id") +
          " LIMIT 1"
      ),
      "Professional_Earnings"
    );
  } catch (_) {
    return null;
  }
}

async function findInvoiceByJob(zcql, professionalJobRowId) {
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, invoice_number, professional_job_row_id, reference_type, reference_row_id, gross_amount, tax_amount, discount_amount, net_amount, currency, payment_status, invoice_status, created_at FROM Professional_Invoices WHERE professional_job_row_id = " +
          asId(professionalJobRowId, "professional_job_id") +
          " LIMIT 1"
      ),
      "Professional_Invoices"
    );
  } catch (_) {
    return null;
  }
}

function mapFinanceResult(earning, invoice, { idempotent = false } = {}) {
  return {
    finance_settled: Boolean(earning),
    finance_idempotent: idempotent,
    earning_id: earning ? String(earning.ROWID) : "",
    earning_number: earning?.earning_number || "",
    earning_status: earning?.status || "",
    net_amount: num(earning?.net_amount),
    gross_amount: num(earning?.gross_amount),
    commission_amount: num(earning?.commission_amount),
    invoice_id: invoice ? String(invoice.ROWID) : earning?.invoice_row_id ? String(earning.invoice_row_id) : "",
    invoice_number: invoice?.invoice_number || "",
    invoice_status: invoice?.invoice_status || "",
    payment_status: invoice?.payment_status || "",
    currency: earning?.currency || invoice?.currency || "INR",
  };
}

async function ensureProfessionalInvoice(app, payload) {
  const zcql = app.zcql();
  const existing = await findInvoiceByJob(zcql, payload.professional_job_row_id);
  if (existing) {
    return { invoice: existing, idempotent: true };
  }

  const invoiceNumber = nextDocumentNumber("INV", payload.reference_row_id);
  const row = {
    invoice_number: invoiceNumber,
    idempotency_key: invoiceIdempotencyKey(payload.professional_job_row_id),
    professional_job_row_id: String(payload.professional_job_row_id),
    reference_type: payload.reference_type,
    reference_row_id: String(payload.reference_row_id),
    customer_user_id: payload.customer_user_id ? String(payload.customer_user_id) : "",
    gross_amount: money(payload.gross_amount),
    tax_amount: money(payload.tax_amount || 0),
    discount_amount: money(payload.discount_amount || 0),
    net_amount: money(payload.net_amount ?? payload.gross_amount),
    currency: payload.currency || "INR",
    payment_status: normalizePaymentStatus(payload.payment_status),
    payment_method: String(payload.payment_method || "").toUpperCase(),
    invoice_status: INVOICE_STATUS.GENERATED,
    metadata_json: payload.metadata_json || "",
    created_at: nowSql(),
  };

  const inserted = await app.datastore().table("Professional_Invoices").insertRow(row);
  const invoice = {
    ROWID: inserted.ROWID || inserted.rowid,
    ...row,
  };
  return { invoice, idempotent: false };
}

async function ensureProfessionalEarning(app, payload) {
  const zcql = app.zcql();
  const existing = await findEarningByJob(zcql, payload.professional_job_row_id);
  if (existing) {
    return { earning: existing, idempotent: true };
  }

  const amounts = calculateEarningAmounts(payload.gross_amount, {
    incentive: payload.incentive_amount,
    tip: payload.tip_amount,
    adjustment: payload.adjustment_amount,
  });
  const earningNumber = nextDocumentNumber("PE", payload.professional_job_row_id);
  const row = {
    earning_number: earningNumber,
    idempotency_key: earningIdempotencyKey(payload.professional_job_row_id),
    professional_row_id: String(payload.professional_row_id),
    professional_job_row_id: String(payload.professional_job_row_id),
    reference_type: payload.reference_type,
    reference_row_id: String(payload.reference_row_id),
    gross_amount: amounts.gross_amount,
    commission_amount: amounts.commission_amount,
    incentive_amount: amounts.incentive_amount,
    tip_amount: amounts.tip_amount,
    adjustment_amount: amounts.adjustment_amount,
    net_amount: amounts.net_amount,
    currency: payload.currency || "INR",
    status: resolveEarningStatus(payload.payment_status),
    invoice_row_id: payload.invoice_row_id ? String(payload.invoice_row_id) : "",
    metadata_json: payload.metadata_json || "",
    created_at: nowSql(),
  };

  const inserted = await app.datastore().table("Professional_Earnings").insertRow(row);
  return {
    earning: { ROWID: inserted.ROWID || inserted.rowid, ...row },
    idempotent: false,
  };
}

async function loadReferenceFinancials(zcql, job) {
  if (job.job_type === JOB_TYPES.PRODUCT_DELIVERY || job.reference_type === REFERENCE_TYPES.ORDER) {
    const order = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, order_number, user_id, grand_total, currency, payment_status, payment_method, tax_amount, discount_amount, subtotal FROM Orders WHERE ROWID = " +
          asId(job.reference_row_id, "order_id")
      ),
      "Orders"
    );
    if (!order) {
      const error = new Error("Order not found for finance settlement");
      error.status = 404;
      throw error;
    }
    return {
      reference_type: REFERENCE_TYPES.ORDER,
      reference_row_id: String(order.ROWID),
      reference_label: order.order_number || "",
      customer_user_id: order.user_id ? String(order.user_id) : "",
      gross_amount: num(order.grand_total),
      tax_amount: num(order.tax_amount),
      discount_amount: num(order.discount_amount),
      net_amount: num(order.grand_total),
      currency: order.currency || "INR",
      payment_status: order.payment_status || "",
      payment_method: order.payment_method || "",
    };
  }

  const serviceJob = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, booking_number, user_id, grand_total, currency, payment_status FROM Service_Jobs WHERE ROWID = " +
        asId(job.reference_row_id, "service_job_id")
    ),
    "Service_Jobs"
  );
  if (!serviceJob) {
    const error = new Error("Service job not found for finance settlement");
    error.status = 404;
    throw error;
  }
  return {
    reference_type: REFERENCE_TYPES.SERVICE_JOB,
    reference_row_id: String(serviceJob.ROWID),
    reference_label: serviceJob.booking_number || "",
    customer_user_id: serviceJob.user_id ? String(serviceJob.user_id) : "",
    gross_amount: num(serviceJob.grand_total),
    tax_amount: 0,
    discount_amount: 0,
    net_amount: num(serviceJob.grand_total),
    currency: serviceJob.currency || "INR",
    payment_status: serviceJob.payment_status || "",
    payment_method: "",
  };
}

async function settleProfessionalJobFinance(app, { job, partner }) {
  if (!job || !partner) {
    return mapFinanceResult(null, null);
  }

  const zcql = app.zcql();
  const existingEarning = await findEarningByJob(zcql, job.id);
  const existingInvoice = await findInvoiceByJob(zcql, job.id);
  if (existingEarning) {
    return mapFinanceResult(existingEarning, existingInvoice, { idempotent: true });
  }

  const financials = await loadReferenceFinancials(zcql, job);
  const { invoice } = await ensureProfessionalInvoice(app, {
    professional_job_row_id: job.id,
    reference_type: financials.reference_type,
    reference_row_id: financials.reference_row_id,
    customer_user_id: financials.customer_user_id,
    gross_amount: financials.gross_amount,
    tax_amount: financials.tax_amount,
    discount_amount: financials.discount_amount,
    net_amount: financials.net_amount,
    currency: financials.currency,
    payment_status: financials.payment_status,
    payment_method: financials.payment_method,
    metadata_json: JSON.stringify({
      reference_label: financials.reference_label,
      job_type: job.job_type,
      job_number: job.job_number,
    }),
  });

  const { earning } = await ensureProfessionalEarning(app, {
    professional_row_id: partner.row_id,
    professional_job_row_id: job.id,
    reference_type: financials.reference_type,
    reference_row_id: financials.reference_row_id,
    gross_amount: financials.gross_amount,
    currency: financials.currency,
    payment_status: financials.payment_status,
    invoice_row_id: invoice.ROWID,
    metadata_json: JSON.stringify({
      reference_label: financials.reference_label,
      job_type: job.job_type,
    }),
  });

  return mapFinanceResult(earning, invoice, { idempotent: false });
}

async function getProfessionalJobFinanceSummary(app, professionalJobRowId) {
  const zcql = app.zcql();
  const earning = await findEarningByJob(zcql, professionalJobRowId);
  const invoice = await findInvoiceByJob(zcql, professionalJobRowId);
  return mapFinanceResult(earning, invoice, { idempotent: Boolean(earning) });
}

async function sumPartnerEarnings(zcql, partnerRowId, { fromSql, toSql } = {}) {
  let query =
    "SELECT SUM(net_amount) AS total FROM Professional_Earnings WHERE professional_row_id = " +
    asId(partnerRowId, "partner_id");
  if (fromSql) {
    query += " AND created_at >= " + sqlString(fromSql);
  }
  if (toSql) {
    query += " AND created_at <= " + sqlString(toSql);
  }
  try {
    const row = rowOf(await zcql.executeZCQLQuery(query), "Professional_Earnings");
    return num(row && (row.total ?? row["SUM(net_amount)"]));
  } catch (_) {
    return 0;
  }
}

async function countPartnerCompletedJobs(zcql, partnerRowId, { fromSql, toSql } = {}) {
  let query =
    "SELECT COUNT(ROWID) AS total FROM Professional_Jobs WHERE delivery_partner_row_id = " +
    asId(partnerRowId, "partner_id") +
    " AND job_status = 'COMPLETED'";
  if (fromSql) {
    query += " AND completed_at >= " + sqlString(fromSql);
  }
  if (toSql) {
    query += " AND completed_at <= " + sqlString(toSql);
  }
  try {
    const row = rowOf(await zcql.executeZCQLQuery(query), "Professional_Jobs");
    return num(row && (row.total ?? row["COUNT(ROWID)"]));
  } catch (_) {
    return 0;
  }
}

async function sumPartnerPendingEarnings(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT SUM(net_amount) AS total FROM Professional_Earnings WHERE professional_row_id = " +
          asId(partnerRowId, "partner_id") +
          " AND status = 'PENDING'"
      ),
      "Professional_Earnings"
    );
    return num(row && (row.total ?? row["SUM(net_amount)"]));
  } catch (_) {
    return 0;
  }
}

async function sumPartnerAvailableEarnings(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT SUM(net_amount) AS total FROM Professional_Earnings WHERE professional_row_id = " +
          asId(partnerRowId, "partner_id") +
          " AND status = 'AVAILABLE'"
      ),
      "Professional_Earnings"
    );
    return num(row && (row.total ?? row["SUM(net_amount)"]));
  } catch (_) {
    return 0;
  }
}

async function listPartnerEarningsHistory(zcql, partnerRowId, { limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, earning_number, professional_job_row_id, reference_type, gross_amount, commission_amount, incentive_amount, tip_amount, net_amount, currency, status, created_at, metadata_json FROM Professional_Earnings WHERE professional_row_id = " +
          asId(partnerRowId, "partner_id") +
          " ORDER BY ROWID DESC LIMIT " +
          safeLimit
      ),
      "Professional_Earnings"
    );
    return rows.map((row) => {
      let meta = {};
      try {
        meta = JSON.parse(row.metadata_json || "{}");
      } catch (_) {}
      return {
        earning_id: String(row.ROWID),
        earning_number: row.earning_number || "",
        job_id: row.professional_job_row_id ? String(row.professional_job_row_id) : "",
        reference_type: row.reference_type || "",
        job_title: meta.reference_label || row.reference_type || "Professional job",
        job_type: meta.job_type || "",
        gross_amount: num(row.gross_amount),
        commission_amount: num(row.commission_amount),
        tip_amount: num(row.tip_amount),
        net_amount: num(row.net_amount),
        currency: row.currency || "INR",
        status: row.status || "",
        completed_at: row.created_at || "",
      };
    });
  } catch (_) {
    return [];
  }
}

async function sumPartnerEarningsByJobType(zcql, partnerRowId, jobType) {
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT net_amount, metadata_json FROM Professional_Earnings WHERE professional_row_id = " +
          asId(partnerRowId, "partner_id")
      ),
      "Professional_Earnings"
    );
    return rows.reduce((total, row) => {
      let meta = {};
      try {
        meta = JSON.parse(row.metadata_json || "{}");
      } catch (_) {}
      if (String(meta.job_type || "").toUpperCase() !== String(jobType || "").toUpperCase()) {
        return total;
      }
      return total + num(row.net_amount);
    }, 0);
  } catch (_) {
    return 0;
  }
}

async function sumPartnerCommission(zcql, partnerRowId) {
  try {
    const row = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT SUM(commission_amount) AS total FROM Professional_Earnings WHERE professional_row_id = " +
          asId(partnerRowId, "partner_id")
      ),
      "Professional_Earnings"
    );
    return num(row && (row.total ?? row["SUM(commission_amount)"]));
  } catch (_) {
    return 0;
  }
}

module.exports = {
  EARNING_STATUS,
  INVOICE_STATUS,
  calculateEarningAmounts,
  resolveEarningStatus,
  settleProfessionalJobFinance,
  getProfessionalJobFinanceSummary,
  sumPartnerEarnings,
  sumPartnerPendingEarnings,
  sumPartnerAvailableEarnings,
  countPartnerCompletedJobs,
  listPartnerEarningsHistory,
  sumPartnerEarningsByJobType,
  sumPartnerCommission,
  findEarningByJob,
  findInvoiceByJob,
};
