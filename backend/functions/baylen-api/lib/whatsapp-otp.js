const { isProductionRuntime } = require("./runtime-config");

const WHATSAPP_ENV_KEYS = [
  "TATA_WHATSAPP_API_KEY",
  "TATA_WHATSAPP_SENDER",
  "TATA_TEMPLATE_NAME",
];

function envValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function getWhatsappOtpConfig() {
  return {
    apiKey: envValue("TATA_WHATSAPP_API_KEY", "TATA_API_KEY", "WHATSAPP_API_KEY"),
    sender: envValue("TATA_WHATSAPP_SENDER", "TATA_SENDER", "WHATSAPP_SENDER"),
    template: envValue("TATA_TEMPLATE_NAME", "TATA_WHATSAPP_TEMPLATE") || "baylen_app_auth",
    endpoint:
      envValue("TATA_WHATSAPP_ENDPOINT") ||
      "https://wb.omni.tatatelebusiness.com/whatsapp-cloud/messages",
  };
}

function isDevOtpFallbackEnabled() {
  if (isProductionRuntime()) {
    return false;
  }
  return String(process.env.AUTH_OTP_DEV_RETURN_CODE || "false").toLowerCase() === "true";
}

function parseWhatsappGatewayResponse(parsed) {
  if (parsed == null || parsed === "") {
    return { accepted: false, reason: "Empty gateway response" };
  }
  if (typeof parsed === "string") {
    const text = parsed.trim();
    if (!text) {
      return { accepted: false, reason: "Empty gateway response" };
    }
    return { accepted: false, reason: sanitizeTataError(text) };
  }
  if (parsed.error) {
    const reason =
      typeof parsed.error === "string"
        ? parsed.error
        : parsed.error.message || parsed.error.title || JSON.stringify(parsed.error);
    return { accepted: false, reason: sanitizeTataError(reason) };
  }
  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    const reason =
      typeof first === "string"
        ? first
        : first.message || first.title || JSON.stringify(first);
    return { accepted: false, reason: sanitizeTataError(reason) };
  }
  const messages = parsed.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const messageId = String(messages[0].id || messages[0].message_id || "").trim();
    if (messageId) {
      return { accepted: true, messageId };
    }
  }
  const directId = String(parsed.message_id || parsed.id || "").trim();
  if (directId) {
    return { accepted: true, messageId: directId };
  }
  if (parsed.status === "success" || parsed.success === true) {
    return { accepted: true, messageId: directId || "accepted" };
  }
  return { accepted: false, reason: "Gateway did not confirm WhatsApp message delivery" };
}

function getWhatsappOtpStatus() {
  const config = getWhatsappOtpConfig();
  const missing = [];
  if (!config.apiKey) {
    missing.push("TATA_WHATSAPP_API_KEY");
  }
  if (!config.sender) {
    missing.push("TATA_WHATSAPP_SENDER");
  }
  if (!envValue("TATA_TEMPLATE_NAME", "TATA_WHATSAPP_TEMPLATE")) {
    missing.push("TATA_TEMPLATE_NAME");
  }
  return {
    ready: missing.length === 0,
    missing,
    template: config.template,
    sender_configured: Boolean(config.sender),
    dev_fallback_enabled: isDevOtpFallbackEnabled(),
  };
}

function sanitizeTataError(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  return text.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]").slice(0, 500);
}

async function sendWhatsappAuthTemplate(mobile, code) {
  const config = getWhatsappOtpConfig();
  if (!config.apiKey) {
    return { status: "FAILED", reason: "WhatsApp is not configured" };
  }
  const otp = String(code || "").replace(/\D/g, "").slice(-6).padStart(6, "0");
  const to = `91${digitsOnly(mobile).slice(-10)}`;
  const from = config.sender ? `91${digitsOnly(config.sender).slice(-10)}` : "";
  const attempts = [
    { language: "en", includeButton: true, includeFrom: Boolean(from) },
    { language: "en", includeButton: false, includeFrom: Boolean(from) },
    { language: "en_US", includeButton: true, includeFrom: Boolean(from) },
    { language: "en", includeButton: true, includeFrom: false },
  ];
  let lastError = "WhatsApp gateway rejected the auth template.";

  for (const attempt of attempts) {
    const components = [
      {
        type: "body",
        parameters: [{ type: "text", text: otp }],
      },
    ];
    if (attempt.includeButton) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: otp }],
      });
    }
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: config.template,
        language: { code: attempt.language },
        components,
      },
    };
    if (attempt.includeFrom && from) {
      payload.from = from;
    }
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const raw = await response.text();
      let parsed = raw;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {}
      if (response.ok) {
        const gateway = parseWhatsappGatewayResponse(parsed);
        if (gateway.accepted) {
          return {
            status: "SENT",
            messageId: gateway.messageId || "",
            mode: "auth_template",
            template: config.template,
            auth_code: otp,
          };
        }
        lastError = gateway.reason || "Gateway did not confirm WhatsApp message delivery";
      } else {
        lastError = sanitizeTataError(parsed);
      }
    } catch (err) {
      lastError =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "WhatsApp gateway timed out"
          : err.message;
    }
  }

  return { status: "FAILED", reason: lastError, mode: "auth_template", template: config.template };
}

async function sendWhatsappOtp(mobile, otp) {
  const result = await sendWhatsappAuthTemplate(mobile, otp);
  if (result.status === "SENT") {
    return { sentVia: "WHATSAPP", messageId: result.messageId || "" };
  }
  const error = new Error("Could not send OTP on WhatsApp. Please try again.");
  error.status = 502;
  error.details = {
    gateway: result.reason,
    template: result.template,
    sender_configured: Boolean(getWhatsappOtpConfig().sender),
  };
  throw error;
}

module.exports = {
  WHATSAPP_ENV_KEYS,
  getWhatsappOtpConfig,
  getWhatsappOtpStatus,
  isDevOtpFallbackEnabled,
  parseWhatsappGatewayResponse,
  sendWhatsappAuthTemplate,
  sendWhatsappOtp,
};
