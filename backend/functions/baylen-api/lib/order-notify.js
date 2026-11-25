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

function resolveOrderTemplateName() {
  return (
    String(process.env.TATA_ORDER_TEMPLATE_NAME || "").trim() || resolveNotifyTemplateName()
  );
}

const SINGLE_PARAM_ORDER_TEMPLATES = new Set([
  "baylen_order_confirmed",
  "baylen_order_confirmation_v2",
]);

function orderTemplateDetails(payload) {
  return (
    "Order " +
    (payload.orderNumber || "") +
    " of INR " +
    (payload.total || "") +
    " (" +
    (payload.paymentMethod || "") +
    "). Delivery: " +
    (payload.city || "") +
    " " +
    (payload.pincode || "") +
    ". " +
    (payload.eta || "")
  ).slice(0, 1024);
}

function orderTemplateParameterCount(templateName) {
  const name = String(templateName || "").trim();
  if (!name) {
    return 0;
  }
  if (SINGLE_PARAM_ORDER_TEMPLATES.has(name)) {
    return 1;
  }
  if (name === resolveNotifyTemplateName()) {
    return 1;
  }
  return 6;
}

function orderUsesSingleParamTemplate() {
  const dedicated = String(process.env.TATA_ORDER_TEMPLATE_NAME || "").trim();
  if (dedicated) {
    return SINGLE_PARAM_ORDER_TEMPLATES.has(dedicated);
  }
  return Boolean(resolveNotifyTemplateName());
}

function orderMessage(payload) {
  return (
    "Hi " +
    (payload.name || "there") +
    ", your Baylen order " +
    payload.orderNumber +
    " of ₹" +
    payload.total +
    " (" +
    payload.paymentMethod +
    ") is confirmed. Delivery: " +
    (payload.city || "") +
    " " +
    (payload.pincode || "") +
    ". " +
    (payload.eta || "")
  );
}

function getOrderWhatsappStatus() {
  const config = getWhatsappOtpConfig();
  const dedicated = String(process.env.TATA_ORDER_TEMPLATE_NAME || "").trim();
  const notify = resolveNotifyTemplateName();
  const missing = [];
  if (!config.apiKey) {
    missing.push("TATA_WHATSAPP_API_KEY");
  }
  if (!config.sender) {
    missing.push("TATA_WHATSAPP_SENDER");
  }
  if (!dedicated && !notify) {
    missing.push("TATA_ORDER_TEMPLATE_NAME");
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
    mode: dedicated ? "order_template" : notify ? "notify_template" : "plain_text",
    sender_configured: Boolean(config.sender),
    body_parameter_count: dedicated
      ? orderTemplateParameterCount(dedicated)
      : orderUsesSingleParamTemplate()
        ? 1
        : 0,
    plain_text_supported: true,
    template_required_for_new_users: true,
    delivery_strategy: dedicated
      ? "utility_template_then_plain_text_best_effort"
      : "plain_text_requires_customer_conversation_window",
  };
}

async function resolveOrderMobile(req, user, orderPhone) {
  const { normalizeIndianMobile } = require("./whatsapp-transactional");
  const fromOrder = normalizeIndianMobile(orderPhone);
  if (fromOrder.length === 10) {
    return fromOrder;
  }
  return resolveCustomerWhatsappMobile(req, user);
}

async function sendOrderWhatsapp(payload) {
  const dedicated = isPlainTextOnlyMode()
    ? ""
    : String(process.env.TATA_ORDER_TEMPLATE_NAME || "").trim();
  const notifyOnly = !dedicated && resolveNotifyTemplateName();
  const templateName = dedicated || notifyOnly || "";
  const message = orderMessage(payload);
  const templateParameters = dedicated
    ? SINGLE_PARAM_ORDER_TEMPLATES.has(dedicated)
      ? [orderTemplateDetails(payload)]
      : [
          String(payload.name || "there"),
          String(payload.orderNumber || ""),
          String(payload.total || ""),
          String(payload.paymentMethod || ""),
          String((payload.city || "") + " " + (payload.pincode || "")).trim(),
          String(payload.eta || ""),
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

async function notifyOrderWhatsapp(req, user, order, extras = {}) {
  const mobile = await resolveOrderMobile(req, user, order.shipping_phone || order.mobile);
  const name =
    order.shipping_name ||
    extras.name ||
    (await resolveCustomerDisplayName(req, user));
  const payload = {
    mobile,
    name,
    orderNumber: order.order_number || extras.orderNumber || "",
    total: order.grand_total != null ? order.grand_total : extras.total,
    paymentMethod: order.payment_method || extras.paymentMethod || "ONLINE",
    city: order.shipping_city || extras.city || "",
    pincode: order.shipping_postal_code || extras.pincode || "",
    eta: extras.eta || "",
  };
  if (!mobile) {
    return { status: "FAILED", reason: "Customer WhatsApp mobile is missing" };
  }
  const result = await sendOrderWhatsapp(payload);
  return {
    ...result,
    mobile,
  };
}

async function recordOrderNotification(req, userId, orderId, result, title, body) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: userId,
      type: "ORDER",
      title,
      body,
      reference_type: "ORDER",
      reference_id: orderId,
      delivery_status: result.status || "PENDING",
    });
  } catch (_) {}
  await recordWhatsappNotification(req, {
    user_id: userId,
    notification_type: "ORDER_CONFIRMED",
    reference_type: "ORDER",
    reference_id: orderId,
    template_name: result.template || "",
    template_variables: result.templateParameters || [],
    delivery_status: result.status || "PENDING",
    provider_message_id: result.messageId || "",
    mobile: result.mobile || "",
  });
}

module.exports = {
  orderMessage,
  orderTemplateDetails,
  orderTemplateParameterCount,
  getOrderWhatsappStatus,
  resolveOrderMobile,
  sendOrderWhatsapp,
  notifyOrderWhatsapp,
  recordOrderNotification,
};
