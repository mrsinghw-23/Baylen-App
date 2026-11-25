"use strict";

/** Platform commission rate applied to gross job total (0–1). Professional net = gross − commission. */
const PROFESSIONAL_COMMISSION_RATE = Number(
  process.env.PROFESSIONAL_COMMISSION_RATE || 0.2
);

const EARNING_STATUS = Object.freeze({
  PENDING: "PENDING",
  AVAILABLE: "AVAILABLE",
  PAID: "PAID",
  HELD: "HELD",
  ADJUSTED: "ADJUSTED",
});

const INVOICE_STATUS = Object.freeze({
  GENERATED: "GENERATED",
  FAILED: "FAILED",
});

const PAID_PAYMENT_STATUSES = new Set(["PAID", "SUCCESS", "CAPTURED"]);

module.exports = {
  PROFESSIONAL_COMMISSION_RATE,
  EARNING_STATUS,
  INVOICE_STATUS,
  PAID_PAYMENT_STATUSES,
};
