"use strict";

const gatewayDefault = require("./razorpay");
const { withPaymentLock } = require("./payment-lock");
const { asId, rowOf, rowsOf, sqlString } = require("./http");
const { fail, minorUnits } = gatewayDefault;

const TABLES = { ORDER: "Orders", APPOINTMENT: "Appointments", JOB: "Service_Jobs" };
const PAYMENT_COLUMNS = "ROWID, user_id, reference_type, reference_id, provider, provider_order_id, provider_payment_id, amount, currency, status, metadata";
const REFUND_COLUMNS = "ROWID, user_id, reference_type, reference_id, payment_id, amount, currency, reason, status, provider_refund_id";
const RECEIVED = new Set(["SUCCESS", "REFUND_REQUESTED", "REFUND_PROCESSING", "PARTIALLY_REFUNDED", "REFUNDED"]);
const CLOSED = new Set(["CANCELLED", "REJECTED", "EXPIRED", "REFUNDED"]);

function referenceType(value) {
  const type = String(value || "").toUpperCase();
  if (!TABLES[type]) throw fail("Invalid payment reference.");
  return type;
}
function metadata(row) {
  try { return JSON.parse(row.metadata || "{}"); } catch (_) { return {}; }
}
function mapPayment(row) {
  const meta = metadata(row);
  return {
    id: String(row.ROWID), reference_type: row.reference_type, reference_id: String(row.reference_id),
    provider: row.provider, provider_order_id: row.provider_order_id || "",
    provider_payment_id: row.provider_payment_id || "", amount: Number(row.amount),
    currency: row.currency, status: row.status,
    fulfillment_ready: meta.finalized === true,
    can_resume: !RECEIVED.has(row.status) && row.provider === "RAZORPAY",
    can_request_refund: row.status === "SUCCESS" && meta.verified === true,
  };
}

function createPaymentEngine({ gateway = gatewayDefault, lock = withPaymentLock,
  finalize = (...args) => require("./payment-fulfillment").finalize(...args) } = {}) {
  async function query(app, table, columns, where) {
    return rowsOf(await app.zcql().executeZCQLQuery(
      `SELECT ${columns} FROM ${table} WHERE ${where}`), table);
  }
  async function update(app, table, row, changes) {
    await app.datastore().table(table).updateRow({ ROWID: row.ROWID, ...changes });
    Object.assign(row, changes);
    return row;
  }
  async function load(app, id, userId) {
    const where = "ROWID = " + asId(id, "payment_id") +
      (userId ? " AND user_id = " + asId(userId, "user_id") : "");
    const row = (await query(app, "Payments", PAYMENT_COLUMNS, where))[0];
    if (!row) throw fail("Payment not found.", 404);
    referenceType(row.reference_type);
    return row;
  }
  async function reference(app, type, id, userId) {
    const row = (await query(app, TABLES[referenceType(type)],
      "ROWID, user_id, grand_total, currency, payment_status, status" + (type === "ORDER" ? ", parent_order_id" : ""),
      "ROWID = " + asId(id, "reference_id") + " AND user_id = " + asId(userId, "user_id")))[0];
    if (!row) throw fail("Purchase not found.", 404);
    return row;
  }
  function refKey(row) { return row.reference_type + ":" + row.reference_id; }
  async function siblings(app, row) {
    return query(app, "Payments", PAYMENT_COLUMNS,
      "reference_type = " + sqlString(row.reference_type) + " AND reference_id = " + asId(row.reference_id, "reference_id") +
      " AND user_id = " + asId(row.user_id, "user_id") + " ORDER BY ROWID DESC LIMIT 100");
  }
  function checkKey(row) {
    if (row.provider !== "RAZORPAY") throw fail("This payment provider requires support reconciliation.", 409);
    const configured = gateway.credentials();
    if (metadata(row).key && metadata(row).key !== configured.key) {
      throw fail("This payment belongs to a different gateway configuration. Contact support.", 409);
    }
    return configured;
  }

  async function ensureGatewayOrder(app, row, fresh) {
    checkKey(row);
    if (row.provider_order_id) return row;
    const receipt = "baylen_pay_" + row.ROWID;
    if (!fresh) {
      const orders = await gateway.request("/orders?receipt=" + encodeURIComponent(receipt) + "&count=100");
      const found = (orders.items || []).filter(o => o.receipt === receipt &&
        o.amount === minorUnits(row.amount) && o.currency === row.currency);
      if (found.length !== 1) throw fail("Payment creation is awaiting reconciliation. Please contact support before retrying.", 409, "PAYMENT_CREATION_UNCERTAIN");
      return update(app, "Payments", row, { provider_order_id: found[0].id, status: "PENDING" });
    }
    const order = await gateway.request("/orders", { method: "POST", body: {
      amount: minorUnits(row.amount), currency: row.currency, receipt,
      notes: { payment_id: String(row.ROWID), reference_type: row.reference_type, reference_id: String(row.reference_id) },
    } });
    if (!/^order_[A-Za-z0-9]+$/.test(order.id || "") || order.amount !== minorUnits(row.amount) || order.currency !== row.currency) {
      throw fail("Payment order could not be verified.", 502);
    }
    return update(app, "Payments", row, { provider_order_id: order.id, status: "PENDING" });
  }

  async function create(app, userId, type, id, provider = "RAZORPAY") {
    type = referenceType(type);
    id = asId(id, "reference_id");
    if (provider !== "RAZORPAY") throw fail("This online payment provider is unavailable.", 503);
    const config = gateway.credentials();
    return lock(app, type + ":" + id, async () => {
      const ref = await reference(app, type, id, userId);
      if (ref.parent_order_id) throw fail("Pay for this delivery through its main order.", 409);
      if (CLOSED.has(ref.status)) throw fail("This purchase is no longer payable.", 409);
      const amount = Number(ref.grand_total);
      minorUnits(amount);
      const currency = ref.currency || "INR";
      if (currency !== "INR") throw fail("Only INR payments are supported.");
      const existing = await siblings(app, { reference_type: type, reference_id: id, user_id: userId });
      const received = existing.find(p => RECEIVED.has(p.status) && metadata(p).verified === true);
      if (received) return received;
      if (ref.payment_status === "PAID") throw fail("This purchase is already marked paid. Contact support to reconcile it.", 409);
      const pending = existing.find(p => p.provider === "RAZORPAY" && !RECEIVED.has(p.status));
      if (pending) {
        if (minorUnits(pending.amount) !== minorUnits(amount) || pending.currency !== currency) {
          throw fail("Purchase total changed. Contact support before making another payment.", 409);
        }
        return ensureGatewayOrder(app, pending, false);
      }
      const values = { user_id: userId, reference_type: type, reference_id: id,
        source_type: type, source_id: id, provider: "RAZORPAY",
        amount, currency, status: "CREATING", metadata: JSON.stringify({ key: config.key, created: Date.now() }) };
      const inserted = await app.datastore().table("Payments").insertRow(values);
      const row = { ...values, ...inserted, ROWID: asId(inserted.ROWID || inserted.rowid, "payment_id") };
      return ensureGatewayOrder(app, row, true);
    });
  }

  async function refundRequest(app, row, reason) {
    if (!RECEIVED.has(row.status) || !metadata(row).verified || !row.provider_payment_id) {
      throw fail("Only verified payments can be refunded.", 409);
    }
    const requests = await query(app, "Refunds", REFUND_COLUMNS,
      "reference_type = " + sqlString(row.reference_type) + " AND reference_id = " + asId(row.reference_id, "reference_id") +
      " AND user_id = " + asId(row.user_id, "user_id") + " ORDER BY ROWID DESC LIMIT 100");
    let refund = requests.find(r => (!r.payment_id || String(r.payment_id) === String(row.ROWID)) && r.status !== "REJECTED");
    if (!refund) {
      const values = { user_id: row.user_id, reference_type: row.reference_type, reference_id: row.reference_id,
        payment_id: row.ROWID, amount: Number(row.amount), currency: row.currency, reason, status: "REQUESTED" };
      const inserted = await app.datastore().table("Refunds").insertRow(values);
      refund = { ...values, ...inserted };
    } else if (!refund.payment_id) {
      await update(app, "Refunds", refund, { payment_id: row.ROWID });
    }
    if (row.status === "SUCCESS") await update(app, "Payments", row, { status: "REFUND_REQUESTED" });
    return refund;
  }

  async function synchronize(app, row, req = {}) {
    checkKey(row);
    await ensureGatewayOrder(app, row, false);
    const result = await gateway.request("/orders/" + encodeURIComponent(row.provider_order_id) + "/payments");
    const attempts = result.items || [];
    const paid = attempts.find(p => p.status === "captured" || p.status === "refunded");
    if (!paid) {
      if (RECEIVED.has(row.status)) throw fail("Gateway payment state requires reconciliation.", 503);
      const next = attempts.some(p => p.status === "authorized") ? "PENDING"
        : attempts.length && attempts.every(p => p.status === "failed") ? "FAILED" : "PENDING";
      await update(app, "Payments", row, { status: next });
      return row;
    }
    gateway.validatePayment(paid, row);
    const meta = metadata(row);
    if (row.provider_payment_id && RECEIVED.has(row.status) && row.provider_payment_id !== paid.id) {
      throw fail("Multiple received payments require support review.", 409);
    }
    await update(app, "Payments", row, { provider_payment_id: paid.id,
      status: RECEIVED.has(row.status) ? row.status : "SUCCESS",
      metadata: JSON.stringify({ ...meta, verified: true }) });
    const refunded = Number(paid.amount_refunded || 0);
    if (refunded > 0) {
      const status = refunded >= minorUnits(row.amount) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await update(app, "Payments", row, { status });
      const others = await siblings(app, row);
      // A refunded duplicate charge must not undo the original purchase's paid state.
      if (metadata(row).finalized === true || !others.some(p =>
        String(p.ROWID) !== String(row.ROWID) && metadata(p).finalized === true)) {
        await app.datastore().table(TABLES[row.reference_type]).updateRow({ ROWID: row.reference_id, payment_status: status });
        if (row.reference_type === "ORDER" && status === "REFUNDED") {
          const children = await query(app, "Orders", "ROWID", "parent_order_id = " + asId(row.reference_id, "order_id"));
          for (const child of children) await update(app, "Orders", child, { payment_status: status });
        }
      }
      return row;
    }
    const ref = await reference(app, row.reference_type, row.reference_id, row.user_id);
    const received = (await siblings(app, row)).filter(p => RECEIVED.has(p.status) && metadata(p).verified === true)
      .sort((a, b) => BigInt(a.ROWID) < BigInt(b.ROWID) ? -1 : 1);
    const keeper = received.find(p => metadata(p).finalized === true) || received[0];
    const otherPaid = keeper && String(keeper.ROWID) !== String(row.ROWID);
    if (CLOSED.has(ref.status) || otherPaid || Math.round(Number(ref.grand_total) * 100) !== minorUnits(row.amount) || ref.currency !== row.currency) {
      await refundRequest(app, row, "Payment received for a cancelled, changed, or already paid purchase");
      return row;
    }
    // Repeat core finalization after a crash. Never acknowledge a webhook until it succeeds.
    if (metadata(row).finalized !== true) {
      await finalize(app, row, req);
      await update(app, "Payments", row, { metadata: JSON.stringify({ ...metadata(row), finalized: true }) });
    }
    return row;
  }

  async function reconcile(app, id, userId, req) {
    const row = await load(app, id, userId);
    return lock(app, refKey(row), async () => synchronize(app, await load(app, id, userId), req));
  }
  async function verify(app, id, userId, paymentId, signature, req) {
    const row = await load(app, id, userId);
    checkKey(row);
    gateway.verifyCheckout(row.provider_order_id, paymentId, signature);
    return reconcile(app, id, userId, req);
  }
  async function requestRefund(app, id, userId, reason) {
    if (!String(reason || "").trim() || reason.length > 255) throw fail("Enter a refund reason (up to 255 characters).");
    const row = await load(app, id, userId);
    return lock(app, refKey(row), async () => {
      const current = await synchronize(app, await load(app, id, userId));
      return refundRequest(app, current, reason.trim());
    });
  }

  // Caller holds the reference lock. Queue only; issuing money requires admin approval.
  async function queueCancelledRefunds(app, userId, type, id, reason) {
    const ref = await reference(app, type, id, userId);
    if (!CLOSED.has(ref.status)) throw fail("Purchase is not cancelled.", 409);
    const payments = await siblings(app, { reference_type: type, reference_id: id, user_id: userId });
    for (const payment of payments) {
      if (["SUCCESS", "REFUND_REQUESTED"].includes(payment.status) && metadata(payment).verified === true) {
        await refundRequest(app, payment, reason || "Cancelled by customer");
      }
    }
  }

  async function processRefund(app, id) {
    const refund = (await query(app, "Refunds", REFUND_COLUMNS, "ROWID = " + asId(id, "refund_id")))[0];
    if (!refund) throw fail("Refund not found.", 404);
    return lock(app, refund.reference_type + ":" + refund.reference_id, async () => {
      const candidates = await query(app, "Payments", PAYMENT_COLUMNS,
        "reference_type = " + sqlString(referenceType(refund.reference_type)) + " AND reference_id = " + asId(refund.reference_id, "reference_id") +
        " AND user_id = " + asId(refund.user_id, "user_id"));
      const payment = candidates.find(p => refund.payment_id ? String(p.ROWID) === String(refund.payment_id) : RECEIVED.has(p.status) && metadata(p).verified);
      if (!payment || !metadata(payment).verified) throw fail("Verified payment not found for this refund.", 409);
      if (!refund.payment_id) await update(app, "Refunds", refund, { payment_id: payment.ROWID });
      if (refund.status === "PROCESSED") {
        await synchronize(app, payment);
        return refund;
      }
      if (refund.status === "REJECTED") return refund;
      if (!["REQUESTED", "PROCESSING", "FAILED"].includes(refund.status)) throw fail("Refund requires manual review.", 409);
      checkKey(payment);
      let remote;
      if (refund.provider_refund_id) {
        remote = await gateway.request("/refunds/" + encodeURIComponent(refund.provider_refund_id));
      } else {
        const known = await gateway.request("/payments/" + encodeURIComponent(payment.provider_payment_id) + "/refunds");
        remote = (known.items || []).find(r => r.receipt === "refund_" + refund.ROWID);
      }
      if (!remote) {
        const received = await gateway.request("/payments/" + encodeURIComponent(payment.provider_payment_id));
        gateway.validatePayment(received, payment);
        if (received.status !== "captured" || minorUnits(refund.amount) > received.amount - Number(received.amount_refunded || 0)) {
          throw fail("Refund amount is unavailable or has already been refunded. Reconcile with the gateway.", 409);
        }
        await update(app, "Refunds", refund, { status: "PROCESSING" });
        remote = await gateway.request("/payments/" + encodeURIComponent(payment.provider_payment_id) + "/refund", {
          method: "POST", headers: { "X-Refund-Idempotency": "baylen-refund-" + refund.ROWID },
          body: { amount: minorUnits(refund.amount), speed: "normal", receipt: "refund_" + refund.ROWID,
            notes: { refund_id: String(refund.ROWID) } },
        });
      }
      if (remote.payment_id !== payment.provider_payment_id || remote.amount !== minorUnits(refund.amount) ||
          !/^rfnd_[A-Za-z0-9]+$/.test(remote.id || "")) throw fail("Refund response could not be verified.", 502);
      await update(app, "Refunds", refund, { provider_refund_id: remote.id,
        status: remote.status === "processed" ? "PROCESSED" : remote.status === "failed" ? "FAILED" : "PROCESSING" });
      if (remote.status !== "failed") await update(app, "Payments", payment, { status: "REFUND_PROCESSING" });
      await synchronize(app, payment);
      return refund;
    });
  }

  async function webhook(app, body, raw, signature, req) {
    gateway.verifyWebhook(raw, signature);
    const entity = body.payload?.payment?.entity;
    const orderId = entity?.order_id || body.payload?.order?.entity?.id;
    const refund = body.payload?.refund?.entity;
    if (refund?.id) {
      const rows = await query(app, "Refunds", REFUND_COLUMNS, "provider_refund_id = " + sqlString(refund.id));
      // Recover the API-response-lost window using our receipt in the gateway refund.
      if (!rows.length && /^refund_\d+$/.test(refund.receipt || "")) {
        rows.push(...await query(app, "Refunds", REFUND_COLUMNS, "ROWID = " + asId(refund.receipt.slice(7), "refund_id")));
      }
      for (const row of rows) await processRefund(app, row.ROWID);
      return;
    }
    if (!orderId) return;
    const rows = await query(app, "Payments", PAYMENT_COLUMNS, "provider = 'RAZORPAY' AND provider_order_id = " + sqlString(orderId));
    if (!rows.length) throw fail("Payment is not yet linked. Retry webhook delivery.", 503);
    for (const row of rows) await reconcile(app, row.ROWID, null, req);
  }

  async function list(app, userId) {
    const rows = await query(app, "Payments", PAYMENT_COLUMNS, "user_id = " + asId(userId, "user_id") + " ORDER BY ROWID DESC LIMIT 100");
    return rows.map(mapPayment);
  }
  return { create, load, reference, reconcile, verify, requestRefund, queueCancelledRefunds, processRefund, webhook, list, query };
}

module.exports = { createPaymentEngine, mapPayment, metadata, referenceType, TABLES, PAYMENT_COLUMNS, REFUND_COLUMNS };
