"use strict";

const { getWhatsappOtpConfig } = require("./whatsapp-otp");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function sanitize(value) {
  return String(value || "").replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]").slice(0, 400);
}

function bookingMessage(payload) {
  return (
    "Hi " +
    (payload.name || "there") +
    ",\n\nYour booking is confirmed.\n\nSalon: " +
    (payload.salon || "") +
    "\nLocation: " +
    (payload.location || "") +
    "\nCategory: " +
    (payload.packageName || "") +
    "\nService: " +
    (payload.service || "") +
    "\nGender: " +
    (payload.gender || "") +
    "\nExpert: " +
    (payload.expert || "") +
    "\nDate: " +
    (payload.date || "") +
    "\nTime: " +
    (payload.time || "") +
    "\nAmount: ₹" +
    (payload.amount || "") +
    "\nBooking ID: " +
    (payload.bookingId || "") +
    "\n\nThank you for choosing Baylen De Louis."
  );
}

async function resolveBookingMobile(req, user) {
  const fromSession = digitsOnly(user && (user.mobile || user.phone)).slice(-10);
  if (fromSession.length === 10) {
    return "91" + fromSession;
  }
  try {
    const { loadCustomerIdentity } = require("./account-recover");
    const identity = await loadCustomerIdentity(req, String(user.user_id || ""));
    const fromProfile = digitsOnly(identity && identity.mobile).slice(-10);
    if (fromProfile.length === 10) {
      return "91" + fromProfile;
    }
  } catch (_) {}
  return "";
}

function bookingTemplateAttempts(templateName, to, from, payload) {
  const parameters = [
    { type: "text", text: String(payload.name || "there").slice(0, 60) },
    { type: "text", text: String(payload.salon || "").slice(0, 80) },
    { type: "text", text: String(payload.service || "").slice(0, 80) },
    { type: "text", text: String(payload.expert || "").slice(0, 60) },
    { type: "text", text: String(payload.date || "").slice(0, 20) },
    { type: "text", text: String(payload.time || "").slice(0, 20) },
    { type: "text", text: String(payload.amount || "").slice(0, 20) },
    { type: "text", text: String(payload.bookingId || "").slice(0, 40) },
  ];
  const languages = ["en", "en_US"];
  const attempts = [];
  for (const language of languages) {
    attempts.push({ language, includeFrom: Boolean(from) });
    attempts.push({ language, includeFrom: false });
  }
  return attempts.map((attempt) => {
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: attempt.language },
        components: [{ type: "body", parameters }],
      },
    };
    if (attempt.includeFrom && from) {
      body.from = from;
    }
    return body;
  });
}

function getBookingWhatsappStatus() {
  const config = getWhatsappOtpConfig();
  const template = String(process.env.TATA_BOOKING_TEMPLATE_NAME || "").trim();
  const missing = [];
  if (!config.apiKey) {
    missing.push("TATA_WHATSAPP_API_KEY");
  }
  if (!config.sender) {
    missing.push("TATA_WHATSAPP_SENDER");
  }
  if (!template) {
    missing.push("TATA_BOOKING_TEMPLATE_NAME");
  }
  return {
    ready: missing.length === 0,
    missing,
    template: template || null,
    mode: template ? "template" : "plain_text_fallback",
    sender_configured: Boolean(config.sender),
    body_parameter_count: 8,
  };
}

async function sendBookingWhatsapp(payload) {
  const config = getWhatsappOtpConfig();
  if (!config.apiKey) {
    return { status: "FAILED", reason: "WhatsApp is not configured" };
  }
  const mobile = digitsOnly(payload.mobile).slice(-10);
  if (mobile.length !== 10) {
    return { status: "FAILED", reason: "Customer mobile is missing" };
  }
  const to = "91" + mobile;
  const from = config.sender ? "91" + digitsOnly(config.sender).slice(-10) : "";
  const templateName = String(process.env.TATA_BOOKING_TEMPLATE_NAME || "").trim();
  const bodies = templateName
    ? bookingTemplateAttempts(templateName, to, from, payload)
    : [
        {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { body: bookingMessage(payload).slice(0, 1000) },
          ...(from ? { from } : {}),
        },
      ];
  let lastReason = "WhatsApp gateway rejected the message";
  for (const body of bodies) {
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
      const raw = await response.text();
      if (response.ok) {
        return {
          status: "SENT",
          mode: templateName ? "template" : "plain_text",
          template: templateName || null,
        };
      }
      lastReason = sanitize(raw);
      console.error("[booking-notify] WhatsApp failed", response.status, lastReason);
    } catch (err) {
      lastReason =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "WhatsApp gateway timed out"
          : err.message;
      console.error("[booking-notify] WhatsApp network error", lastReason);
    }
  }
  return {
    status: "FAILED",
    reason: lastReason,
    mode: templateName ? "template" : "plain_text",
    template: templateName || null,
  };
}

async function recordBookingNotification(req, userId, appointmentId, result, title, body) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: userId,
      type: "BOOKING",
      title,
      body,
      reference_type: "APPOINTMENT",
      reference_id: appointmentId,
      delivery_status: result.status || "PENDING",
    });
  } catch (_) {}
}

module.exports = {
  sendBookingWhatsapp,
  recordBookingNotification,
  bookingMessage,
  resolveBookingMobile,
  getBookingWhatsappStatus,
};
