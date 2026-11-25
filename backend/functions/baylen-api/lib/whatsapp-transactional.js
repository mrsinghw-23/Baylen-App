"use strict";

const { getWhatsappOtpConfig, parseWhatsappGatewayResponse } = require("./whatsapp-otp");

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function sanitize(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .slice(0, 400);
}

function normalizeIndianMobile(value) {
  return digitsOnly(value).slice(-10);
}

const DEFAULT_NOTIFY_TEMPLATE = "baylen_customer_update";

function isPlainTextOnlyMode() {
  return String(process.env.WHATSAPP_PLAIN_TEXT_ONLY || "").trim().toLowerCase() === "true";
}

function sixDigitReference(value) {
  const digits = digitsOnly(value);
  if (!digits) {
    return "";
  }
  return digits.slice(-6).padStart(6, "0");
}

function resolveNotifyTemplateName() {
  if (isPlainTextOnlyMode()) {
    return "";
  }
  return String(process.env.TATA_NOTIFY_TEMPLATE_NAME || "").trim();
}

function buildTemplateBodies(templateName, to, from, parameters, languages) {
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
        components: [
          {
            type: "body",
            parameters: parameters.map((text) => ({
              type: "text",
              text: String(text ?? "").slice(0, 1024),
            })),
          },
        ],
      },
    };
    if (attempt.includeFrom && from) {
      body.from = from;
    }
    return body;
  });
}

function buildPlainTextBodies(to, from, plainText, maxLength) {
  const text = String(plainText || "").slice(0, maxLength);
  const withFrom = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body: text },
    ...(from ? { from } : {}),
  };
  if (!from) {
    return [withFrom];
  }
  return [
    withFrom,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    },
  ];
}

function isBodyAccepted(responseOk, parsed) {
  if (!responseOk) {
    return false;
  }
  return parseWhatsappGatewayResponse(parsed).accepted;
}

async function sendBody(config, body) {
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
  let parsed = raw;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {}
  if (isBodyAccepted(response.ok, parsed)) {
    const gateway = parseWhatsappGatewayResponse(parsed);
    return {
      ok: true,
      messageId: gateway.messageId || "",
    };
  }
  return {
    ok: false,
    reason: response.ok
      ? parseWhatsappGatewayResponse(parsed).reason || "Gateway did not confirm delivery"
      : sanitize(raw),
    status: response.status,
  };
}

async function sendWhatsappTransactional({
  mobile,
  plainText,
  templateName,
  templateParameters = [],
  templateLanguages = ["en", "en_US"],
  maxPlainLength = 1000,
}) {
  const config = getWhatsappOtpConfig();
  if (!config.apiKey) {
    return { status: "FAILED", reason: "WhatsApp is not configured" };
  }
  const localMobile = normalizeIndianMobile(mobile);
  if (localMobile.length !== 10) {
    return { status: "FAILED", reason: "Customer mobile is missing" };
  }
  const to = "91" + localMobile;
  const from = config.sender ? "91" + normalizeIndianMobile(config.sender) : "";
  const otpTemplate = String(config.template || "").trim();
  const template = String(templateName || "").trim();
  let lastReason = "WhatsApp gateway rejected the message";

  async function tryNamedTemplate() {
    if (isPlainTextOnlyMode()) {
      return null;
    }
    if (!template || template === otpTemplate) {
      return null;
    }
    for (const body of buildTemplateBodies(template, to, from, templateParameters, templateLanguages)) {
      try {
        const result = await sendBody(config, body);
        if (result.ok) {
          console.log(
            "[whatsapp-transactional] utility template accepted template=" +
              template +
              " message_id=" +
              result.messageId
          );
          return {
            status: "SENT",
            messageId: result.messageId,
            mode: "template",
            template,
          };
        }
        lastReason = result.reason;
        console.error("[whatsapp-transactional] template send failed", result.status, lastReason);
      } catch (err) {
        lastReason =
          err.name === "TimeoutError" || err.name === "AbortError"
            ? "WhatsApp gateway timed out"
            : err.message;
        console.error("[whatsapp-transactional] template network error", lastReason);
      }
    }
    return null;
  }

  async function tryPlainText() {
    const text = String(plainText || "").trim();
    if (!text) {
      return null;
    }
    for (const body of buildPlainTextBodies(to, from, text, maxPlainLength)) {
      try {
        const result = await sendBody(config, body);
        if (result.ok) {
          console.warn(
            "[whatsapp-transactional] plain text accepted but delivery is unconfirmed message_id=" +
              result.messageId
          );
          return {
            status: "PENDING",
            messageId: result.messageId,
            mode: "plain_text",
            template: template || null,
            reason:
              "WhatsApp accepted the message, but plain text requires an active 24-hour customer conversation window",
          };
        }
        lastReason = result.reason;
        console.error("[whatsapp-transactional] plain text send failed", result.status, lastReason);
      } catch (err) {
        lastReason =
          err.name === "TimeoutError" || err.name === "AbortError"
            ? "WhatsApp gateway timed out"
            : err.message;
        console.error("[whatsapp-transactional] plain text network error", lastReason);
      }
    }
    return null;
  }

  const named = await tryNamedTemplate();
  if (named) {
    return named;
  }

  const plain = await tryPlainText();
  if (plain) {
    return plain;
  }

  return {
    status: "FAILED",
    reason: lastReason,
    mode: template ? "template_then_plain_text" : "plain_text",
    template: template || null,
  };
}

module.exports = {
  DEFAULT_NOTIFY_TEMPLATE,
  digitsOnly,
  normalizeIndianMobile,
  sixDigitReference,
  isPlainTextOnlyMode,
  resolveNotifyTemplateName,
  sendWhatsappTransactional,
};
