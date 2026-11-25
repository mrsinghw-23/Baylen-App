"use strict";

const assert = require("node:assert/strict");
const { describe, it, afterEach } = require("node:test");
const {
  resolveNotifyTemplateName,
  isPlainTextOnlyMode,
  sixDigitReference,
} = require("../lib/whatsapp-transactional");
const { formatIndianMobileForStorage } = require("../lib/whatsapp-user-mobile");

describe("whatsapp transactional notify template", () => {
  it("does not invent a missing notify template", () => {
    const prevNotify = process.env.TATA_NOTIFY_TEMPLATE_NAME;
    const prevPlain = process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    delete process.env.TATA_NOTIFY_TEMPLATE_NAME;
    delete process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    assert.equal(resolveNotifyTemplateName(), "");
    process.env.TATA_NOTIFY_TEMPLATE_NAME = "baylen_customer_update";
    assert.equal(resolveNotifyTemplateName(), "baylen_customer_update");
    process.env.WHATSAPP_PLAIN_TEXT_ONLY = "true";
    assert.equal(resolveNotifyTemplateName(), "");
    process.env.WHATSAPP_PLAIN_TEXT_ONLY = prevPlain;
    process.env.TATA_NOTIFY_TEMPLATE_NAME = prevNotify;
  });

  it("respects explicit empty notify template override", () => {
    const prevNotify = process.env.TATA_NOTIFY_TEMPLATE_NAME;
    const prevPlain = process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    process.env.TATA_NOTIFY_TEMPLATE_NAME = "";
    delete process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    assert.equal(resolveNotifyTemplateName(), "");
    process.env.TATA_NOTIFY_TEMPLATE_NAME = prevNotify;
    process.env.WHATSAPP_PLAIN_TEXT_ONLY = prevPlain;
  });

  it("maps order numbers to a 6-digit auth template code", () => {
    assert.equal(sixDigitReference("BLN-2026-000001"), "000001");
    assert.equal(sixDigitReference("BAY-TEST-001"), "000001");
  });
});

describe("whatsapp transactional send", () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it("rejects HTTP 200 plain text without a provider message id", async () => {
    process.env.TATA_WHATSAPP_API_KEY = "test-key";
    process.env.TATA_WHATSAPP_SENDER = "918877662222";
    delete process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    const originalFetch = globalThis.fetch;
    const types = [];
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      types.push(body.type);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messaging_product: "whatsapp" }),
      };
    };
    try {
      const { sendWhatsappTransactional } = require("../lib/whatsapp-transactional");
      const result = await sendWhatsappTransactional({
        mobile: "8825391754",
        plainText: "Your booking is confirmed.\nBooking ID: BAY392112",
      });
      assert.equal(result.status, "FAILED");
      assert.equal(result.mode, "plain_text");
      assert.equal(types[0], "text");
      assert.equal(types.length, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to plain text when a named template is not found", async () => {
    process.env.TATA_WHATSAPP_API_KEY = "test-key";
    process.env.TATA_WHATSAPP_SENDER = "918877662222";
    delete process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    const originalFetch = globalThis.fetch;
    const types = [];
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      types.push(body.type);
      if (body.type === "template") {
        return {
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ error: { message: "Template Not Found" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ messages: [{ id: "wamid.test" }] }),
      };
    };
    try {
      const { sendWhatsappTransactional } = require("../lib/whatsapp-transactional");
      const result = await sendWhatsappTransactional({
        mobile: "8825391754",
        plainText: "Your Baylen order BLN-2026-000001 is confirmed.",
        templateName: "baylen_booking_confirmed",
        templateParameters: ["Salon: Baylen Elite"],
      });
      assert.equal(result.status, "PENDING");
      assert.equal(result.mode, "plain_text");
      assert.match(result.reason, /24-hour customer conversation window/i);
      assert.ok(types.includes("template"));
      assert.ok(types.includes("text"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("includes home visit address in booking template details", () => {
    const { bookingTemplateDetails } = require("../lib/booking-notify");
    const details = bookingTemplateDetails({
      salon: "Baylen Elite Salon",
      packageName: "Home Service",
      location: "12 MG Road, Ranchi",
      service: "Facial",
      expert: "Assigning soon",
      date: "2026-09-04",
      time: "14:30",
      amount: "899",
      bookingId: "HS123456",
    });
    assert.match(details, /Home service at 12 MG Road, Ranchi/);
    assert.match(details, /HS123456/);
  });

  it("builds one template variable for baylen_booking_confirmed", () => {
    const { bookingTemplateDetails, bookingTemplateParameterCount } = require("../lib/booking-notify");
    const details = bookingTemplateDetails({
      salon: "Baylen Elite Salon Doranda",
      packageName: "Royal",
      service: "Hair Cut",
      expert: "Rohit Sharma",
      date: "2026-09-04",
      time: "17:20",
      amount: "648",
      bookingId: "BAY392112",
    });
    assert.match(details, /BAY392112/);
    assert.equal(bookingTemplateParameterCount("baylen_booking_confirmed"), 1);
    assert.equal(bookingTemplateParameterCount("baylen_booking_custom"), 8);
  });

  it("builds one template variable for baylen_order_confirmed", () => {
    const { orderTemplateDetails, orderTemplateParameterCount } = require("../lib/order-notify");
    const details = orderTemplateDetails({
      orderNumber: "BLN-2026-000001",
      total: "999",
      paymentMethod: "COD",
      city: "Ranchi",
      pincode: "834001",
      eta: "2-4 days",
    });
    assert.match(details, /BLN-2026-000001/);
    assert.equal(orderTemplateParameterCount("baylen_order_confirmed"), 1);
    assert.equal(orderTemplateParameterCount("baylen_order_custom"), 6);
  });

  it("reports SENT only when a utility template is accepted with a message id", async () => {
    process.env.TATA_WHATSAPP_API_KEY = "test-key";
    process.env.TATA_WHATSAPP_SENDER = "918877662222";
    delete process.env.WHATSAPP_PLAIN_TEXT_ONLY;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.type, "template");
      assert.equal(body.template.name, "baylen_booking_confirmed");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "provider-message-id" }),
      };
    };
    try {
      const { sendWhatsappTransactional } = require("../lib/whatsapp-transactional");
      const result = await sendWhatsappTransactional({
        mobile: "8825391754",
        plainText: "Your booking is confirmed.",
        templateName: "baylen_booking_confirmed",
        templateParameters: [
          "Salon: Baylen Elite Salon Doranda. Category: Royal. Service: Hair Cut. Expert: Rohit Sharma. Date: 2026-09-04 Time: 17:20. Amount: INR 648. Booking ID: BAY392112.",
        ],
      });
      assert.equal(result.status, "SENT");
      assert.equal(result.mode, "template");
      assert.equal(result.messageId, "provider-message-id");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("whatsapp user mobile formatting", () => {
  it("formats registered Indian mobile for order storage", () => {
    assert.equal(formatIndianMobileForStorage("9876543210"), "+919876543210");
    assert.equal(formatIndianMobileForStorage("+919876543210"), "+919876543210");
    assert.equal(formatIndianMobileForStorage("123"), "");
  });
});
