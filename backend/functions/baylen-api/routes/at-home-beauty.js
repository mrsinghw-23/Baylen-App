"use strict";



const { asId, num, optionalText, rowOf, rowsOf, sendOk } = require("../lib/http");

const { requireUser } = require("../lib/session");

const engine = require("../lib/at-home-beauty-engine");

const salonEngine = require("../lib/salon-engine");

const { readProviderLocationCache } = require("../lib/provider-location-cache");

const { customerStatusLabel, canShowLiveTracking } = require("../lib/at-home-beauty-fsm");

const { readArrivalOtpState, customerOtpView } = require("../lib/at-home-beauty-otp");

const { readExtraRequest, respondExtraService } = require("../lib/at-home-beauty-extra");

const { buildRouteSummary } = require("../lib/geo-routing");
const {
  mapPartnerPhotoUrls,
  streamPartnerProfilePhoto,
  assertCustomerOwnsBooking,
  loadPartnerPhotoBundle,
} = require("../lib/delivery-partner-photo");
const { parseDeliveryPartnerId } = require("../lib/delivery-partner");



function atHomeBeautyRoutes(app) {

  app.post("/v1/at-home-beauty/serviceability", async (req, res, next) => {

    try {

      const result = await engine.checkServiceability(req.catalystApp.zcql(), req.body || {});

      sendOk(res, result);

    } catch (error) {

      next(error);

    }

  });



  app.get("/v1/at-home-beauty/providers", async (req, res, next) => {

    try {

      const providers = await engine.listAvailableProviders(req.catalystApp.zcql(), {

        outlet_id: req.query.outlet_id,

        service_id: req.query.service_id,

        city: optionalText(req.query.city, "city", 80),

        gender: optionalText(req.query.gender, "gender", 20),

        preferred_provider_id: req.query.preferred_provider_id,

      });

      sendOk(res, { providers });

    } catch (error) {

      next(error);

    }

  });



  app.get("/v1/at-home-beauty/addons", async (req, res, next) => {

    try {

      const serviceId = asId(req.query.service_id, "service_id");

      const rows = rowsOf(

        await req.catalystApp

          .zcql()

          .executeZCQLQuery(

            "SELECT ROWID, service_id, name, description, price, duration_minutes, is_active FROM Beauty_Service_Addons WHERE service_id = " +

              serviceId +

              " AND is_active = true"

          ),

        "Beauty_Service_Addons"

      );

      sendOk(res, {

        addons: rows.map((row) => ({

          id: String(row.ROWID),

          service_id: String(row.service_id),

          name: row.name || "",

          description: row.description || "",

          price: num(row.price),

          duration_minutes: num(row.duration_minutes),

        })),

      });

    } catch (error) {

      next(error);

    }

  });



  app.get("/v1/at-home-beauty/slots", async (req, res, next) => {

    try {

      const outletId = asId(req.query.outlet_id, "outlet_id");

      const serviceId = asId(req.query.service_id, "service_id");

      const slotDate = optionalText(req.query.slot_date || req.query.date, "slot_date", 10);

      const preferredProviderId = req.query.preferred_provider_id

        ? asId(req.query.preferred_provider_id, "preferred_provider_id")

        : null;

      await salonEngine.loadActiveOutlet(req.catalystApp.zcql(), outletId);

      const slots = await engine.generateAtHomeSlots(

        req.catalystApp.zcql(),

        outletId,

        serviceId,

        slotDate,

        preferredProviderId,

        optionalText(req.query.gender, "gender", 20)

      );

      sendOk(res, { slots, slot_date: slotDate });

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/quote", async (req, res, next) => {

    try {

      const quote = await engine.quoteBooking(req.catalystApp.zcql(), req.body || {});

      sendOk(res, { quote });

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/bookings", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const body = { ...(req.body || {}) };
      if (!body.idempotency_key && req.headers["x-idempotency-key"]) {
        body.idempotency_key = req.headers["x-idempotency-key"];
      }
      const result = await engine.createBooking(req.catalystApp, user, body);

      sendOk(res, result);

    } catch (error) {

      next(error);

    }

  });



  app.get("/v1/at-home-beauty/bookings", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const zcql = req.catalystApp.zcql();

      if (req.query.id) {

        const jobId = asId(req.query.id, "id");

        const row = rowOf(

          await zcql.executeZCQLQuery(

            "SELECT " + engine.JOB_SELECT + " FROM Service_Jobs WHERE ROWID = " +

              jobId +

              " AND user_id = " +

              user.user_id

          ),

          "Service_Jobs"

        );

        if (!row) {

          const error = new Error("Booking not found");

          error.status = 404;

          throw error;

        }

        sendOk(res, { booking: engine.mapJob(row) });

        return;

      }

      const result = await engine.listBookings(zcql, user.user_id, {
        status: req.query.status,
        limit: req.query.limit,
        offset: req.query.offset,
      });

      sendOk(res, result);

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/bookings/cancel", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const jobId = asId(req.body.booking_id || req.body.job_id, "booking_id");

      const reason = optionalText(req.body.reason, "reason", 255);

      const booking = await require("../lib/payment-lock").withPaymentLock(req.catalystApp, "JOB:" + jobId,
        async () => {
          const payments = require("../lib/payment-engine").createPaymentEngine();
          const existing = await payments.reference(req.catalystApp, "JOB", jobId, user.user_id);
          const result = existing.status === "CANCELLED"
            ? { id: String(jobId), status: "CANCELLED" }
            : await engine.cancelBooking(req.catalystApp, user, jobId, reason);
          await payments.queueCancelledRefunds(req.catalystApp, user.user_id, "JOB", jobId, reason);
          return result;
        });

      sendOk(res, { booking });

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/bookings/reschedule", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const jobId = asId(req.body.booking_id || req.body.job_id, "booking_id");

      const booking = await engine.rescheduleBooking(req.catalystApp, user, jobId, req.body || {});

      sendOk(res, { booking });

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/bookings/confirm-payment", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const jobId = asId(req.body.booking_id || req.body.job_id, "booking_id");

      const booking = await require("../lib/payment-lock").withPaymentLock(req.catalystApp, "JOB:" + jobId,
        () => engine.confirmPaidBooking(req.catalystApp, jobId, user));

      let notification = { status: "SKIPPED", reason: "Booking not confirmed" };

      if (booking && String(booking.status || "").toUpperCase() === "CONFIRMED") {

        notification = await engine.notifyAtHomeBooking(req, user, jobId, booking);

      }

      sendOk(res, { booking, notification });

    } catch (error) {

      next(error);

    }

  });



  app.post("/v1/at-home-beauty/bookings/extra-services/respond", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const jobId = asId(req.body.booking_id || req.body.job_id, "booking_id");

      const decision = String(req.body.decision || "").trim().toUpperCase();

      if (!["APPROVE", "DECLINE"].includes(decision)) {

        const error = new Error("decision must be APPROVE or DECLINE");

        error.status = 400;

        throw error;

      }

      const zcql = req.catalystApp.zcql();

      const row = rowOf(

        await zcql.executeZCQLQuery(

          "SELECT ROWID FROM Service_Jobs WHERE ROWID = " +

            jobId +

            " AND user_id = " +

            user.user_id

        ),

        "Service_Jobs"

      );

      if (!row) {

        const error = new Error("Booking not found");

        error.status = 404;

        throw error;

      }

      const result = await respondExtraService(req.catalystApp, jobId, decision);

      sendOk(res, { request: result });

    } catch (error) {

      next(error);

    }

  });



  app.get("/v1/at-home-beauty/bookings/tracking", async (req, res, next) => {

    try {

      const user = requireUser(req);

      const jobId = asId(req.query.id || req.query.booking_id, "id");

      const zcql = req.catalystApp.zcql();

      const row = rowOf(

        await zcql.executeZCQLQuery(

          "SELECT ROWID, booking_number, provider_id, delivery_partner_row_id, status, visit_latitude, visit_longitude, visit_line1, visit_city, scheduled_at, grand_total, currency FROM Service_Jobs WHERE ROWID = " +

            jobId +

            " AND user_id = " +

            user.user_id

        ),

        "Service_Jobs"

      );

      if (!row) {

        const error = new Error("Booking not found");

        error.status = 404;

        throw error;

      }

      const status = row.status || "REQUESTED";

      const liveTracking = canShowLiveTracking(status);

      let providerLocation = null;

      if (liveTracking) {

        providerLocation = await readProviderLocationCache(req.catalystApp, jobId);

      }



      let provider = null;
      let providerPhoto = {
        profile_photo_url: "",
        has_profile_photo: false,
        profile_photo_fetch_url: "",
      };

      const partnerRowId = row.delivery_partner_row_id
        ? String(row.delivery_partner_row_id)
        : "";

      if (partnerRowId) {
        const bundle = await loadPartnerPhotoBundle(zcql, partnerRowId);
        providerPhoto = mapPartnerPhotoUrls(partnerRowId, bundle.partnerRow, bundle.kycRow, {
          scope: "customer",
          booking_row_id: String(row.ROWID),
        });
        provider = bundle.partnerRow
          ? {
              ROWID: bundle.partnerRow.ROWID,
              first_name: bundle.partnerRow.first_name || "",
              last_name: bundle.partnerRow.last_name || "",
              phone: bundle.partnerRow.phone || "",
              rating: bundle.partnerRow.rating || "",
            }
          : null;
      } else if (row.provider_id) {
        provider = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, first_name, last_name, phone, rating, profile_photo_url, profile_image FROM Providers WHERE ROWID = " +
              asId(row.provider_id, "provider_id")
          ),
          "Providers"
        );
        if (provider) {
          providerPhoto = {
            profile_photo_url: provider.profile_photo_url || provider.profile_image || "",
            has_profile_photo: Boolean(provider.profile_photo_url || provider.profile_image),
            profile_photo_fetch_url: "",
          };
        }
      }



      const visitLat = num(row.visit_latitude);

      const visitLng = num(row.visit_longitude);

      const route =

        providerLocation && visitLat && visitLng

          ? buildRouteSummary(

              num(providerLocation.latitude),

              num(providerLocation.longitude),

              visitLat,

              visitLng,

              num(providerLocation.speed)

            )

          : null;



      const otpState =

        String(status).trim().toUpperCase() === "ARRIVED"

          ? await readArrivalOtpState(req.catalystApp, jobId)

          : null;

      const arrivalOtp = customerOtpView(otpState);

      const extraRequest = await readExtraRequest(req.catalystApp, jobId);



      sendOk(res, {

        booking: engine.mapJob(row),

        customer_status: customerStatusLabel(status),

        live_tracking: liveTracking,

        visit: {

          latitude: visitLat || null,

          longitude: visitLng || null,

          line1: row.visit_line1 || "",

          city: row.visit_city || "",

        },

        provider: provider

          ? {

              id: String(provider.ROWID),

              name: [provider.first_name, provider.last_name].filter(Boolean).join(" "),

              phone: provider.phone || "",

              rating: num(provider.rating),

              profile_photo_url: providerPhoto.profile_photo_url,

              has_profile_photo: providerPhoto.has_profile_photo,

              profile_photo_fetch_url: providerPhoto.profile_photo_fetch_url,

            }

          : null,

        provider_location: providerLocation,

        route,

        arrival_otp: arrivalOtp,

        extra_service_request:

          extraRequest && extraRequest.status === "PENDING" ? extraRequest : null,

      });

    } catch (error) {

      next(error);

    }

  });

  app.get("/v1/at-home-beauty/bookings/:id/professional-photo", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const bookingId = asId(req.params.id, "booking_id");
      const zcql = req.catalystApp.zcql();
      const booking = await assertCustomerOwnsBooking(zcql, bookingId, user.user_id);
      const partnerRowId = booking.delivery_partner_row_id
        ? parseDeliveryPartnerId(String(booking.delivery_partner_row_id))
        : "";
      if (!partnerRowId) {
        const error = new Error("Professional not assigned yet");
        error.status = 404;
        throw error;
      }
      await streamPartnerProfilePhoto(req, res, partnerRowId, { internal: true });
    } catch (error) {
      next(error);
    }
  });

}



module.exports = atHomeBeautyRoutes;
