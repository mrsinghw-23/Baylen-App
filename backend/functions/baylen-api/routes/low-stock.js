"use strict";

const { sendOk, optionalText, num } = require("../lib/http");
const { listLowStock, lowStockSummary } = require("../lib/low-stock-admin");
const { writeAdminAudit } = require("../lib/audit");

function secureEqual(left, right) {
  const crypto = require("crypto");
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    const error = new Error("ADMIN_API_KEY is not configured");
    error.status = 503;
    throw error;
  }
  if (!secureEqual(req.headers["x-baylen-admin-key"], expected)) {
    const error = new Error("Admin authorization required");
    error.status = 403;
    throw error;
  }
}

function adminActor(req) {
  return optionalText(req.headers["x-baylen-admin-user"], "x-baylen-admin-user", 120) || "ADMIN";
}

function lowStockRoutes(app) {
  app.get("/v1/admin/inventory/low-stock", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await listLowStock(
        req.catalystApp,
        {
          status: req.query.status,
          warehouse_id: req.query.warehouse_id,
          warehouse_code: req.query.warehouse_code,
          product_id: req.query.product_id,
          variant_id: req.query.variant_id,
          sku: req.query.sku,
          alert_only: req.query.alert_only,
        },
        {
          limit: num(req.query.limit) || 200,
          offset: num(req.query.offset) || 0,
          record_alerts: req.query.record_alerts === "true",
          actor: adminActor(req),
        }
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/inventory/low-stock/summary", async (req, res, next) => {
    try {
      requireAdmin(req);
      const summary = await lowStockSummary(req.catalystApp, {
        warehouse_id: req.query.warehouse_id,
        warehouse_code: req.query.warehouse_code,
        sku: req.query.sku,
        alert_only: req.query.alert_only,
      });
      await writeAdminAudit(req.catalystApp, adminActor(req), "LOW_STOCK_SUMMARY", "INVENTORY", null, null, summary);
      sendOk(res, { summary });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = lowStockRoutes;
