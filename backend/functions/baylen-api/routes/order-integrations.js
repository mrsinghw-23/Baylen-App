"use strict";

const { sendOk, sendError } = require("../lib/http");
const {
  isOrderIntegrationEnabled,
  normalizeInboundOrder,
  validateNormalizedOrder,
  ORDER_SOURCES,
} = require("../lib/order-source");

function orderIntegrationRoutes(app) {
  app.get("/v1/integrations/orders/status", (req, res) => {
    sendOk(res, {
      enabled: isOrderIntegrationEnabled(),
      sources: Object.values(ORDER_SOURCES),
      ingest_path: "/v1/integrations/orders/webhook",
      message: isOrderIntegrationEnabled()
        ? "Order integration is active"
        : "Order integration is not connected. Product orders stay empty until a source is enabled.",
    });
  });

  app.post("/v1/integrations/orders/webhook", (req, res) => {
    try {
      const normalized = normalizeInboundOrder(req.body || {});
      const valid = validateNormalizedOrder(normalized);
      if (!valid.ok) {
        const error = new Error("Inbound order is missing required location or identity fields");
        error.status = 422;
        error.code = valid.reason;
        throw error;
      }
      if (!isOrderIntegrationEnabled()) {
        const error = new Error(
          "Third-party order integration is not connected. Enable ORDER_INTEGRATION_ENABLED to ingest orders."
        );
        error.status = 503;
        error.code = "ORDER_INTEGRATION_DISABLED";
        throw error;
      }
      const error = new Error(
        "Order ingest is configured but the provider adapter is not wired yet. No dummy orders were created."
      );
      error.status = 501;
      error.code = "ORDER_ADAPTER_NOT_WIRED";
      throw error;
    } catch (error) {
      sendError(res, error);
    }
  });
}

module.exports = { orderIntegrationRoutes };
