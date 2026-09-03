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
  return String(process.env.AUTH_OTP_DEV_RETURN_CODE || "false").toLowerCase() === "true";
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

async function sendWhatsappOtp(mobile, otp) {
  const config = getWhatsappOtpConfig();
  if (!config.apiKey) {
    const error = new Error(
      "WhatsApp OTP is not configured on baylen-api. Set TATA_WHATSAPP_API_KEY, TATA_WHATSAPP_SENDER, and TATA_TEMPLATE_NAME."
    );
    error.status = 503;
    throw error;
  }

  const to = `91${digitsOnly(mobile).slice(-10)}`;
  const from = config.sender ? `91${digitsOnly(config.sender).slice(-10)}` : "";
  const attempts = [
    { language: "en", includeButton: true, includeFrom: Boolean(from) },
    { language: "en", includeButton: false, includeFrom: Boolean(from) },
    { language: "en_US", includeButton: true, includeFrom: Boolean(from) },
    { language: "en", includeButton: true, includeFrom: false },
  ];

  let lastError = "WhatsApp gateway rejected the OTP template.";
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
        console.log(`[sendOtp] WhatsApp dispatched to ${to} via ${config.template}`);
        return { sentVia: "WHATSAPP" };
      }
      lastError = sanitizeTataError(parsed);
      console.error("[sendOtp] Tata Omni error", response.status, lastError);
    } catch (err) {
      lastError =
        err.name === "TimeoutError" || err.name === "AbortError"
          ? "WhatsApp gateway timed out"
          : err.message;
      console.error("[sendOtp] Tata Omni network error:", lastError);
    }
  }

  const error = new Error("Could not send OTP on WhatsApp. Please try again.");
  error.status = 502;
  error.details = {
    gateway: lastError,
    template: config.template,
    sender_configured: Boolean(config.sender),
  };
  throw error;
}

module.exports = {
  WHATSAPP_ENV_KEYS,
  getWhatsappOtpConfig,
  getWhatsappOtpStatus,
  isDevOtpFallbackEnabled,
  sendWhatsappOtp,
};
