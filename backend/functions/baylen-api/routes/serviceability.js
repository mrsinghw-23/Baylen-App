"use strict";

const { sendOk, asId, optionalText } = require("../lib/http");
const {
  listServiceableRegions,
  getServiceableRegion,
  upsertServiceableRegion,
  deactivateServiceableRegion,
} = require("../lib/serviceability-admin");
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

function serviceabilityRoutes(app) {
  app.get("/v1/admin/serviceability/regions", async (req, res, next) => {
    try {
      requireAdmin(req);
      const regions = await listServiceableRegions(req.catalystApp.zcql(), {
        pincode: req.query.pincode,
        city: req.query.city,
        state: req.query.state,
        active_only: req.query.active_only,
      });
      sendOk(res, { regions });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/admin/serviceability/region", async (req, res, next) => {
    try {
      requireAdmin(req);
      const id = asId(req.query.id, "id");
      const region = await getServiceableRegion(req.catalystApp.zcql(), id);
      if (!region) {
        const error = new Error("Serviceable region not found");
        error.status = 404;
        throw error;
      }
      sendOk(res, { region });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/serviceability/region/upsert", async (req, res, next) => {
    try {
      requireAdmin(req);
      const result = await upsertServiceableRegion(req.catalystApp, req.body || {});
      await writeAdminAudit(
        req.catalystApp,
        adminActor(req),
        result.action,
        "SERVICEABLE_PINCODE",
        result.region.id,
        null,
        result.region
      );
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/serviceability/region/deactivate", async (req, res, next) => {
    try {
      requireAdmin(req);
      const id = asId(req.body.id, "id");
      const region = await deactivateServiceableRegion(req.catalystApp, id);
      await writeAdminAudit(req.catalystApp, adminActor(req), "DEACTIVATE", "SERVICEABLE_PINCODE", id, null, region);
      sendOk(res, { region });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = serviceabilityRoutes;
