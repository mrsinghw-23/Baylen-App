"use strict";

const { asId, optionalText, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const gateway = require("../lib/razorpay");
const { createPaymentEngine, mapPayment, REFUND_COLUMNS } = require("../lib/payment-engine");
const { checkoutPage } = require("../lib/payment-checkout-page");
const engine = createPaymentEngine();

function providerStatus() {
  let config;
  try { config = gateway.credentials(); } catch (_) {}
  return {
    manual: { enabled: false },
    razorpay: { enabled: Boolean(config), public_key: config?.key || "", mode: config?.mode || "unconfigured",
      webhook_configured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) },
    cashfree: { enabled: false },
  };
}

async function createIntentForOrder(req, user, orderId, provider) {
  return mapPayment(await engine.create(req.catalystApp, user.user_id, "ORDER", orderId, provider));
}

async function handleVerify(req, res, next) {
  try {
    const user = requireUser(req);
    if (req.body.status && req.body.status !== "SUCCESS") {
      throw gateway.fail("Payment status is determined by the gateway. Use status refresh.");
    }
    const payment = await engine.verify(req.catalystApp, req.body.payment_id, user.user_id,
      req.body.provider_payment_id, req.body.provider_signature, req);
    sendOk(res, { payment: mapPayment(payment) });
  } catch (error) { next(error); }
}

function route(handler) {
  return async (req, res, next) => { try { await handler(req, res); } catch (error) { next(error); } };
}

function paymentsRoutes(app) {
  app.get("/v1/payments/providers", route(async (_, res) => sendOk(res, { providers: providerStatus() })));
  app.post("/v1/payments/intent", route(async (req, res) => {
    const user = requireUser(req);
    const payment = await engine.create(req.catalystApp, user.user_id, req.body.reference_type,
      req.body.reference_id, req.body.provider || "RAZORPAY");
    sendOk(res, { payment: mapPayment(payment) });
  }));
  app.post("/v1/payments/verify", handleVerify);
  app.get("/v1/payments", route(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, req.query.id
      ? { payment: mapPayment(await engine.load(req.catalystApp, req.query.id, user.user_id)) }
      : { payments: await engine.list(req.catalystApp, user.user_id) });
  }));
  app.post("/v1/payments/reconcile", route(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, { payment: mapPayment(await engine.reconcile(req.catalystApp, req.body.payment_id, user.user_id, req)) });
  }));
  app.post("/v1/payments/checkout-session", route(async (req, res) => {
    const user = requireUser(req);
    const payment = await engine.reconcile(req.catalystApp, req.body.payment_id, user.user_id, req);
    if (!mapPayment(payment).can_resume) {
      sendOk(res, { payment: mapPayment(payment) });
      return;
    }
    const ref = await engine.reference(req.catalystApp, payment.reference_type, payment.reference_id, user.user_id);
    if (["CANCELLED", "EXPIRED", "REJECTED"].includes(ref.status)) throw gateway.fail("This purchase cannot be paid.", 409);
    sendOk(res, { payment: mapPayment(payment), checkout_path: "/v1/payments/checkout?pay_link=" + gateway.ticket(payment) });
  }));
  app.get("/v1/payments/checkout", route(async (req, res) => {
    // Catalyst's gateway consumes a query parameter named "ticket" as its own auth ticket.
    const id = gateway.readTicket(req.query.pay_link);
    const payment = await engine.load(req.catalystApp, id);
    if (!mapPayment(payment).can_resume) throw gateway.fail("Payment is already received. Return to Baylen.", 409);
    const ref = await engine.reference(req.catalystApp, payment.reference_type, payment.reference_id, payment.user_id);
    if (["CANCELLED", "EXPIRED", "REJECTED"].includes(ref.status)) throw gateway.fail("This purchase is no longer payable.", 409);
    checkoutPage(req, res, payment);
  }));
  app.post("/v1/payments/checkout-complete", route(async (req, res) => {
    const id = gateway.readTicket(req.body.ticket);
    const payment = await engine.verify(req.catalystApp, id, null,
      req.body.provider_payment_id, req.body.provider_signature, req);
    sendOk(res, { payment: mapPayment(payment) });
  }));
  app.post("/v1/payments/webhooks/razorpay", route(async (req, res) => {
    await engine.webhook(req.catalystApp, req.body, req.rawPaymentBody, req.headers["x-razorpay-signature"], req);
    sendOk(res, { received: true });
  }));
  app.post("/v1/payments/refund-request", route(async (req, res) => {
    const user = requireUser(req);
    const refund = await engine.requestRefund(req.catalystApp, req.body.payment_id, user.user_id,
      optionalText(req.body.reason, "reason", 255));
    sendOk(res, { requested: true, refund });
  }));
  app.get("/v1/payments/refunds", route(async (req, res) => {
    const user = requireUser(req);
    sendOk(res, { refunds: await engine.query(req.catalystApp, "Refunds", REFUND_COLUMNS,
      "user_id = " + asId(user.user_id, "user_id") + " ORDER BY ROWID DESC LIMIT 100") });
  }));
  app.get("/v1/admin/payments/refunds", route(async (req, res) => {
    require("./admin").requireAdmin(req);
    sendOk(res, { refunds: await engine.query(req.catalystApp, "Refunds", REFUND_COLUMNS,
      "status IN ('REQUESTED','PROCESSING','FAILED') ORDER BY ROWID LIMIT 100") });
  }));
  app.post("/v1/admin/payments/refund-process", route(async (req, res) => {
    require("./admin").requireAdmin(req);
    sendOk(res, { refund: await engine.processRefund(req.catalystApp, req.body.refund_id) });
  }));
  app.post("/v1/admin/payments/reconcile", route(async (req, res) => {
    require("./admin").requireAdmin(req);
    sendOk(res, { payment: mapPayment(await engine.reconcile(req.catalystApp, req.body.payment_id, null, req)) });
  }));
}

module.exports = paymentsRoutes;
module.exports.handleVerify = handleVerify;
module.exports.createIntentForOrder = createIntentForOrder;
module.exports.providerStatus = providerStatus;
