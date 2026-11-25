"use strict";

const crypto = require("node:crypto");

function fail(message, status = 400, code = "PAYMENT_ERROR") {
  return Object.assign(new Error(message), { status, code });
}

function credentials() {
  const key = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const secret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(key) || !secret) {
    throw fail("Online payments are currently unavailable.", 503, "PAYMENT_NOT_CONFIGURED");
  }
  return { key, secret, mode: key.startsWith("rzp_live_") ? "live" : "test" };
}

function minorUnits(amount) {
  const value = Number(amount);
  const minor = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(minor) || minor < 100) {
    throw fail("Payment amount must be at least INR 1.");
  }
  return minor;
}

function checkSignature(message, signature, secret) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(String(signature || ""))) return false;
  const expected = crypto.createHmac("sha256", secret).update(message).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function verifyCheckout(orderId, paymentId, signature) {
  const { secret } = credentials();
  if (!/^pay_[A-Za-z0-9]+$/.test(String(paymentId || "")) ||
      !checkSignature(orderId + "|" + paymentId, signature, secret)) {
    throw fail("Payment verification failed.", 400, "INVALID_PAYMENT_SIGNATURE");
  }
}

function verifyWebhook(raw, signature) {
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!secret) throw fail("Webhook is not configured.", 503);
  if (!Buffer.isBuffer(raw) || !checkSignature(raw, signature, secret)) {
    throw fail("Invalid webhook signature.", 400);
  }
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const { key, secret } = credentials();
  let response;
  try {
    response = await fetch("https://api.razorpay.com/v1" + path, {
      method,
      headers: {
        Authorization: "Basic " + Buffer.from(key + ":" + secret).toString("base64"),
        "Content-Type": "application/json",
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
  } catch (_) {
    // A timed-out POST may have succeeded. Callers must reconcile before retrying.
    throw fail("The payment provider did not respond. Check payment status before retrying.", 504, "GATEWAY_UNCERTAIN");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw fail("The payment provider could not complete this request.", 502,
      method === "POST" ? "GATEWAY_UNCERTAIN" : "GATEWAY_ERROR");
  }
  return data;
}

function validatePayment(payment, row) {
  if (payment.order_id !== row.provider_order_id ||
      payment.amount !== minorUnits(row.amount) || payment.currency !== row.currency) {
    throw fail("Gateway payment does not match this purchase.", 409, "PAYMENT_MISMATCH");
  }
}

function ticket(row) {
  const payload = Buffer.from(JSON.stringify({
    payment_id: String(row.ROWID), exp: Date.now() + 15 * 60 * 1000,
    purpose: "baylen-checkout",
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", credentials().secret).update(payload).digest("hex");
  return payload + "." + signature;
}

function readTicket(value) {
  const [payload, signature, extra] = String(value || "").split(".");
  if (extra || !payload || payload.length > 512 ||
      !checkSignature(payload, signature, credentials().secret)) throw fail("Payment link is invalid or expired.", 401);
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch (_) {
    throw fail("Payment link is invalid.", 401);
  }
  if (data.purpose !== "baylen-checkout" || !Number.isFinite(data.exp) || data.exp < Date.now() ||
      !/^\d+$/.test(data.payment_id)) throw fail("Payment link has expired. Return to Baylen and retry.", 401);
  return data.payment_id;
}

module.exports = { credentials, minorUnits, checkSignature, verifyCheckout, verifyWebhook,
  request, validatePayment, ticket, readTicket, fail };
