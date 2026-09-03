"use strict";

const fs = require("fs");
const path = require("path");
const { sendOk } = require("../lib/http");
const {
  previewSalonImport,
  importSalonRecords,
  cleanupSalonServiceData,
  combineCsvFiles,
  packageCsvHeaderRow,
  defaultSalonSeedPaths,
} = require("../lib/salon-import-pipeline");
const { sendBookingWhatsapp, getBookingWhatsappStatus, bookingMessage } = require("../lib/booking-notify");

function requireAdmin(req) {
  const crypto = require("crypto");
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) {
    const error = new Error("ADMIN_API_KEY is not configured");
    error.status = 503;
    throw error;
  }
  const provided = req.headers["x-baylen-admin-key"];
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const error = new Error("Admin authorization required");
    error.status = 403;
    throw error;
  }
}

function salonImportRoutes(app) {
  app.get("/v1/admin/salon/imports/template", async (req, res, next) => {
    try {
      requireAdmin(req);
      sendOk(res, {
        filename: "salon-gold.csv",
        content_type: "text/csv",
        csv: packageCsvHeaderRow() + "\n",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/salon/imports/preview", async (req, res, next) => {
    try {
      requireAdmin(req);
      const csvText = String(req.body.csv_text || "");
      const preview = await previewSalonImport(req.catalystApp, csvText);
      sendOk(res, { preview });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/salon/imports", async (req, res, next) => {
    try {
      requireAdmin(req);
      const csvText = String(req.body.csv_text || "");
      const confirm = req.body.confirm === true || req.body.confirm === "true";
      const preview = await previewSalonImport(req.catalystApp, csvText);
      if (!confirm) {
        sendOk(res, {
          requires_confirmation: true,
          preview,
          message: "Set confirm=true to import salon CSV rows",
        });
        return;
      }
      const result = await importSalonRecords(req.catalystApp, csvText, {
        allow_invalid: req.body.allow_invalid === true || req.body.allow_invalid === "true",
        continue_on_error: true,
      });
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/salon/booking/test-whatsapp", async (req, res, next) => {
    try {
      requireAdmin(req);
      const mobile = String(req.body.mobile || "").trim();
      if (!mobile) {
        const error = new Error("mobile is required (10-digit Indian number)");
        error.status = 400;
        throw error;
      }
      const status = getBookingWhatsappStatus();
      const sample = {
        name: String(req.body.name || "Baylen Customer").trim(),
        mobile,
        salon: String(req.body.salon || "Baylen Premium Salon Lalpur").trim(),
        location: String(req.body.location || "Lalpur, Ranchi").trim(),
        packageName: String(req.body.package_name || "Gold").trim(),
        service: String(req.body.service || "Hair Cut").trim(),
        gender: String(req.body.gender || "Male").trim(),
        expert: String(req.body.expert || "Rohit Sharma").trim(),
        date: String(req.body.date || new Date().toISOString().slice(0, 10)).trim(),
        time: String(req.body.time || "10:30").trim(),
        amount: String(req.body.amount || "500").trim(),
        bookingId: String(req.body.booking_id || "BAY-TEST-001").trim(),
      };
      if (req.body.preview_only === true || req.body.preview_only === "true") {
        sendOk(res, {
          config: status,
          preview_message: bookingMessage(sample),
          sample_payload: sample,
        });
        return;
      }
      const result = await sendBookingWhatsapp(sample);
      sendOk(res, { config: status, result, sample_payload: sample });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/salon/cleanup", async (req, res, next) => {
    try {
      requireAdmin(req);
      const confirm = req.body.confirm === true || req.body.confirm === "true";
      if (!confirm) {
        const dry = await cleanupSalonServiceData(req.catalystApp, { dryRun: true });
        sendOk(res, {
          requires_confirmation: true,
          backup: dry.deleted,
          message:
            "Set confirm=true to delete demo Salon_Services, Outlet_Service_Prices, Staff, Staff_Services",
        });
        return;
      }
      const result = await cleanupSalonServiceData(req.catalystApp, { dryRun: false });
      sendOk(res, { ok: true, result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/admin/salon/imports/all-seeds", async (req, res, next) => {
    try {
      requireAdmin(req);
      const confirm = req.body.confirm === true || req.body.confirm === "true";
      const rootDir = path.resolve(__dirname, "../../../..");
      const files = defaultSalonSeedPaths(rootDir).filter((filePath) => fs.existsSync(filePath));
      const csvText = combineCsvFiles(files);
      if (!csvText.trim()) {
        const error = new Error("No salon seed CSV data rows found under backend/seeds/salon/");
        error.status = 400;
        throw error;
      }
      const preview = await previewSalonImport(req.catalystApp, csvText);
      if (!confirm) {
        sendOk(res, {
          requires_confirmation: true,
          files,
          preview,
          message: "Set confirm=true to import all backend/seeds/salon/*.csv files",
        });
        return;
      }
      const result = await importSalonRecords(req.catalystApp, csvText, { continue_on_error: true });
      sendOk(res, { files, ...result });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = salonImportRoutes;
