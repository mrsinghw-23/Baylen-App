"use strict";

const { getWhatsappOtpConfig } = require("./whatsapp-otp");
const {
  sendWhatsappTransactional,
  resolveNotifyTemplateName,
  DEFAULT_NOTIFY_TEMPLATE,
  isPlainTextOnlyMode,
} = require("./whatsapp-transactional");
const {
  resolveCustomerWhatsappMobile,
  resolveCustomerDisplayName,
} = require("./whatsapp-user-mobile");
const { recordWhatsappNotification } = require("./whatsapp-notification-store");

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

const SINGLE_PARAM_BOOKING_TEMPLATES = new Set([
  "baylen_booking_confirmed",
  "baylen_booking_confirmation_v2",
]);

function bookingTemplateDetails(payload) {
  const isHome = String(payload.packageName || "").trim() === "Home Service";
  const head = isHome
    ? "Home service at " + (payload.location || payload.salon || "your address")
    : "Salon: " + (payload.salon || "");
  return (
    head +
    ". Category: " +
    (payload.packageName || "") +
    ". Service: " +
    (payload.service || "") +
    ". Expert: " +
    (payload.expert || "") +
    ". Date: " +
    (payload.date || "") +
    " Time: " +
    (payload.time || "") +
    ". Amount: INR " +
    (payload.amount || "") +
    ". Booking ID: " +
    (payload.bookingId || "")
  ).slice(0, 1024);
}

function bookingTemplateParameterCount(templateName) {
  const name = String(templateName || "").trim();
  if (!name) {
    return 0;
  }
  if (SINGLE_PARAM_BOOKING_TEMPLATES.has(name)) {
    return 1;
  }
  if (name === resolveNotifyTemplateName()) {
    return 1;
  }
  return 8;
}

async function resolveBookingMobile(req, user) {
  return resolveCustomerWhatsappMobile(req, user);
}

function getBookingWhatsappStatus() {
  const config = getWhatsappOtpConfig();
  const dedicated = String(process.env.TATA_BOOKING_TEMPLATE_NAME || "").trim();
  const notify = resolveNotifyTemplateName();
  const missing = [];
  if (!config.apiKey) {
    missing.push("TATA_WHATSAPP_API_KEY");
  }
  if (!config.sender) {
    missing.push("TATA_WHATSAPP_SENDER");
  }
  if (!dedicated && !notify) {
    missing.push("TATA_BOOKING_TEMPLATE_NAME");
  }
  return {
    ready: missing.length === 0,
    missing,
    template: dedicated || notify || null,
    dedicated_template: dedicated || null,
    notify_template: notify || null,
    auth_template: config.template || null,
    default_notify_template: DEFAULT_NOTIFY_TEMPLATE,
    plain_text_only: isPlainTextOnlyMode(),
    mode: dedicated ? "booking_template" : notify ? "notify_template" : "plain_text",
    sender_configured: Boolean(config.sender),
    body_parameter_count: dedicated
      ? bookingTemplateParameterCount(dedicated)
      : notify
        ? 1
        : 0,
    plain_text_supported: true,
    template_required_for_new_users: true,
    delivery_strategy: dedicated
      ? "utility_template_then_plain_text_best_effort"
      : "plain_text_requires_customer_conversation_window",
  };
}

async function sendBookingWhatsapp(payload) {
  const dedicated = isPlainTextOnlyMode()
    ? ""
    : String(process.env.TATA_BOOKING_TEMPLATE_NAME || "").trim();
  const notifyOnly = !dedicated && resolveNotifyTemplateName();
  const templateName = dedicated || notifyOnly || "";
  const message = bookingMessage(payload);
  const templateParameters = dedicated
    ? SINGLE_PARAM_BOOKING_TEMPLATES.has(dedicated)
      ? [bookingTemplateDetails(payload)]
      : [
          String(payload.name || "there").slice(0, 60),
          String(payload.salon || "").slice(0, 80),
          String(payload.service || "").slice(0, 80),
          String(payload.expert || "").slice(0, 60),
          String(payload.date || "").slice(0, 20),
          String(payload.time || "").slice(0, 20),
          String(payload.amount || "").slice(0, 20),
          String(payload.bookingId || "").slice(0, 40),
        ]
    : notifyOnly
      ? [message.slice(0, 1024)]
      : [];
  const result = await sendWhatsappTransactional({
    mobile: payload.mobile,
    plainText: message,
    templateName,
    templateParameters,
  });
  return {
    ...result,
    template: result.template || templateName || null,
    templateParameters,
  };
}

async function notifyBookingWhatsapp(req, user, appointment, details) {
  const status = String(appointment.status || details.status || "CONFIRMED").toUpperCase();
  if (status !== "CONFIRMED") {
    return { status: "SKIPPED", reason: "Booking is not confirmed" };
  }
  const mobile = await resolveBookingMobile(req, user);
  const payload = {
    name: await resolveCustomerDisplayName(req, user),
    mobile,
    salon: details.salonName,
    location: details.location,
    packageName: details.packageName,
    service: details.serviceName,
    gender: details.gender,
    expert: details.employeeName,
    date: details.date,
    time: details.startTime,
    amount: String(details.price),
    bookingId: appointment.appointment_number || String(appointment.ROWID),
  };
  if (!mobile) {
    return { status: "FAILED", reason: "Customer WhatsApp mobile is missing" };
  }
  let result;
  try {
    result = await sendBookingWhatsapp(payload);
  } catch (error) {
    result = { status: "FAILED", reason: error.message || "WhatsApp failed" };
  }
  await recordBookingNotification(
    req,
    user.user_id,
    appointment.ROWID,
    result,
    "Booking confirmed",
    bookingMessage(payload).slice(0, 500),
    {
      mobile: payload.mobile,
      templateParameters: result.templateParameters || [],
    }
  );
  try {
    await req.catalystApp.datastore().table("Appointments").updateRow({
      ROWID: String(appointment.ROWID),
      notification_status: result.status || "FAILED",
    });
    appointment.notification_status = result.status || "FAILED";
  } catch (_) {}
  return result;
}

async function recordBookingNotification(req, userId, appointmentId, result, title, body, meta = {}) {
  const referenceType = String(meta.reference_type || "APPOINTMENT").slice(0, 40);
  const notificationType = String(meta.notification_type || "BOOKING_CONFIRMED").slice(0, 40);
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: userId,
      type: referenceType === "SERVICE_JOB" ? "HOME_SERVICE" : "BOOKING",
      title,
      body,
      reference_type: referenceType,
      reference_id: appointmentId,
      delivery_status: result.status || "PENDING",
    });
  } catch (_) {}
  await recordWhatsappNotification(req, {
    user_id: userId,
    notification_type: notificationType,
    reference_type: referenceType,
    reference_id: appointmentId,
    template_name: result.template || "",
    template_variables: meta.templateParameters || result.templateParameters || [],
    delivery_status: result.status || "PENDING",
    provider_message_id: result.messageId || "",
    mobile: meta.mobile || "",
  });
}

module.exports = {
  sendBookingWhatsapp,
  notifyBookingWhatsapp,
  recordBookingNotification,
  bookingMessage,
  bookingTemplateDetails,
  bookingTemplateParameterCount,
  resolveBookingMobile,
  getBookingWhatsappStatus,
};
