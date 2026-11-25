"use strict";

const crypto = require("node:crypto");
const { fail } = require("./razorpay");

// lock_key MUST have a database UNIQUE constraint. Cache get/put is not a mutex.
async function withPaymentLock(app, key, work) {
  const table = app.datastore().table("Payment_Locks");
  let lock;
  try {
    lock = await table.insertRow({
      lock_key: key, owner: crypto.randomUUID(), created_at: new Date().toISOString(),
    });
  } catch (error) {
    const code = String(error.code || error.message || "");
    throw fail(/duplicate|unique|DUPLICATE/i.test(code)
      ? "Payment is being processed. Please check again shortly."
      : "Payment processing is temporarily unavailable.", 503, "PAYMENT_LOCK_UNAVAILABLE");
  }
  const id = lock.ROWID || lock.rowid;
  if (!id) throw fail("Payment lock could not be confirmed.", 503);
  try {
    return await work();
  } finally {
    // No automatic lease stealing: a crashed worker's lock requires operator recovery.
    // Removing an active worker's lock could permit two charges/refunds.
    try { await table.deleteRow(id); } catch (_) {
      console.error("[payments] lock release requires recovery", id);
    }
  }
}

module.exports = { withPaymentLock };
