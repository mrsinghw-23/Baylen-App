"use strict";

const { asId, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const { getCustomerProfessionalTracking } = require("../lib/professional-location-engine");

function professionalJobRoutes(app) {
  app.get("/v1/professional-jobs/tracking", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const professionalJobId = req.query.professional_job_id || req.query.job_id || "";
      const orderId = req.query.order_id || "";
      const serviceJobId = req.query.service_job_id || req.query.booking_id || req.query.id || "";
      if (!professionalJobId && !orderId && !serviceJobId) {
        const error = new Error("professional_job_id, order_id, or service_job_id is required");
        error.status = 422;
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const tracking = await getCustomerProfessionalTracking(req.catalystApp, {
        userId: user.user_id,
        professionalJobId: professionalJobId ? asId(professionalJobId, "professional_job_id") : "",
        orderId: orderId ? asId(orderId, "order_id") : "",
        serviceJobId: serviceJobId ? asId(serviceJobId, "service_job_id") : "",
      });
      sendOk(res, tracking);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { professionalJobRoutes };
