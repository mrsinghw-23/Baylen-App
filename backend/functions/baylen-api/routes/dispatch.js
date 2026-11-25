const crypto = require("crypto");
const { asId, optionalText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const { writeProviderLocationCache, readProviderLocationCache } = require("../lib/provider-location-cache");
const {
  customerStatusLabel,
  assertProviderTransition,
  canAcceptLocationPing,
  canShowLiveTracking,
  requiresArrivalOtp,
  PROVIDER_STATUS_ACTIONS,
} = require("../lib/at-home-beauty-fsm");
const { issueArrivalOtp, verifyArrivalOtp, readArrivalOtpState } = require("../lib/at-home-beauty-otp");
const { emitJobEvent } = require("../lib/at-home-beauty-events");
const { requestExtraService } = require("../lib/at-home-beauty-extra");
const { buildRouteSummary } = require("../lib/geo-routing");

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireProviderKey(req) {
  const expected = process.env.PROVIDER_API_KEY;
  if (!expected) {
    const error = new Error("PROVIDER_API_KEY is not configured");
    error.status = 503;
    throw error;
  }
  const provided = req.headers["x-baylen-provider-key"];
  if (!secureEqual(provided, expected)) {
    const error = new Error("Provider authorization required");
    error.status = 403;
    throw error;
  }
}

function mapJob(row) {
  return {
    id: String(row.ROWID),
    appointment_id: row.appointment_id ? String(row.appointment_id) : "",
    provider_id: row.provider_id ? String(row.provider_id) : "",
    status: row.status || "",
    customer_status: customerStatusLabel(row.status || ""),
    visit_address_id: row.visit_address_id ? String(row.visit_address_id) : "",
    visit_line1: row.visit_line1 || "",
    visit_city: row.visit_city || "",
    visit_state: row.visit_state || "",
    scheduled_at: row.scheduled_at || "",
    requested_at: row.requested_at || "",
    grand_total: num(row.grand_total),
    currency: row.currency || "INR",
  };
}

function mapLocation(row) {
  return {
    id: String(row.ROWID),
    job_id: row.job_id ? String(row.job_id) : "",
    provider_id: row.provider_id ? String(row.provider_id) : "",
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    heading: num(row.heading),
    speed: num(row.speed),
    status: row.status || "",
    recorded_at: row.recorded_at || row.CREATEDTIME || "",
  };
}

function mapTimeline(row) {
  return {
    id: String(row.ROWID),
    job_id: row.job_id ? String(row.job_id) : "",
    provider_id: row.provider_id ? String(row.provider_id) : "",
    status: row.status || "",
    note: row.note || "",
    happened_at: row.happened_at || row.CREATEDTIME || "",
  };
}

const STATUS_EVENT_MAP = {
  ACCEPTED: "PROVIDER_ACCEPTED",
  EN_ROUTE: "PROVIDER_EN_ROUTE",
  ARRIVED: "PROVIDER_ARRIVED",
  STARTED: "SERVICE_STARTED",
  COMPLETED: "SERVICE_COMPLETED",
  CANCELLED: "BOOKING_CANCELLED",
};

async function transitionJobStatus(req, job, providerId, nextStatus, note) {
  const current = String(job.status || "REQUESTED").trim().toUpperCase();
  const next = String(nextStatus || "").trim().toUpperCase();
  assertProviderTransition(current, next);

  if (requiresArrivalOtp(current, next)) {
    const otpState = await readArrivalOtpState(req.catalystApp, job.ROWID);
    if (!otpState || !otpState.verified) {
      const error = new Error("Arrival code must be verified before starting the service");
      error.status = 409;
      error.code = "OTP_REQUIRED";
      throw error;
    }
  }

  await req.catalystApp.datastore().table("Service_Jobs").updateRow({
    ROWID: job.ROWID,
    status: next,
  });

  if (next === "COMPLETED" || next === "CANCELLED") {
    await req.catalystApp.datastore().table("Providers").updateRow({
      ROWID: providerId,
      status: "AVAILABLE",
    });
  } else if (next === "ACCEPTED") {
    await req.catalystApp.datastore().table("Providers").updateRow({
      ROWID: providerId,
      status: "ON_JOB",
    });
  }

  await req.catalystApp.datastore().table("Job_Timeline").insertRow({
    job_id: job.ROWID,
    provider_id: providerId,
    status: next,
    note: optionalText(note, "note", 255) || customerStatusLabel(next),
    happened_at: nowSql(),
  });

  const eventKey = STATUS_EVENT_MAP[next];
  if (eventKey) {
    await emitJobEvent(req.catalystApp, {
      jobId: job.ROWID,
      userId: job.user_id,
      providerId,
      event: eventKey,
      status: next,
      note,
    });
  }

  if (next === "ARRIVED") {
    await issueArrivalOtp(req.catalystApp, job.ROWID);
    await emitJobEvent(req.catalystApp, {
      jobId: job.ROWID,
      userId: job.user_id,
      providerId,
      event: "OTP_ISSUED",
      status: next,
      note: "Arrival code issued to customer",
    });
  }

  return next;
}

function dispatchRoutes(app) {
  app.post("/v1/jobs/dispatch", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const zcql = req.catalystApp.zcql();

      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, status, provider_id, visit_city FROM Service_Jobs WHERE ROWID = " +
            jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (job.status !== "REQUESTED") {
        const error = new Error("Job is not waiting for dispatch");
        error.status = 409;
        throw error;
      }

      const items = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT service_id FROM Job_Items WHERE job_id = " + jobId
        ),
        "Job_Items"
      );
      if (items.length === 0) {
        const error = new Error("Job has no service items");
        error.status = 409;
        throw error;
      }
      const serviceId = items[0].service_id;
      const city = String(job.visit_city || "").replace(/'/g, "");

      const skilled = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT provider_id FROM Provider_Services WHERE service_id = " +
            serviceId +
            " AND is_active = true"
        ),
        "Provider_Services"
      );
      const skilledIds = skilled.map((row) => String(row.provider_id));
      if (skilledIds.length === 0) {
        const error = new Error("No provider is skilled for this service");
        error.status = 409;
        throw error;
      }

      let areaQuery =
        "SELECT provider_id FROM Service_Areas WHERE is_active = true AND provider_id IN (" +
        skilledIds.join(",") +
        ")";
      if (city) {
        areaQuery += " AND city = '" + city + "'";
      }
      const inArea = rowsOf(await zcql.executeZCQLQuery(areaQuery), "Service_Areas");
      const areaIds = inArea.map((row) => String(row.provider_id));
      if (areaIds.length === 0) {
        const error = new Error("No provider covers this service area");
        error.status = 409;
        throw error;
      }

      const providers = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, first_name, last_name, status FROM Providers WHERE is_active = true AND status = 'AVAILABLE' AND ROWID IN (" +
            areaIds.join(",") +
            ")"
        ),
        "Providers"
      );
      if (providers.length === 0) {
        const error = new Error("No available provider found");
        error.status = 409;
        throw error;
      }

      const provider = providers[0];
      const dispatch = await req.catalystApp.datastore().table("Job_Dispatch").insertRow({
        job_id: jobId,
        provider_id: provider.ROWID,
        status: "OFFERED",
        offered_at: nowSql(),
        notes: "Offered by baylen-api",
      });

      await req.catalystApp.datastore().table("Service_Jobs").updateRow({
        ROWID: jobId,
        provider_id: provider.ROWID,
        status: "ASSIGNED",
      });

      sendOk(res, {
        job_id: jobId,
        dispatch_id: dispatch.ROWID,
        provider_id: provider.ROWID,
        provider_name: [provider.first_name, provider.last_name].filter(Boolean).join(" "),
        status: "ASSIGNED",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/accept", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const dispatchId = asId(req.body.dispatch_id, "dispatch_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const zcql = req.catalystApp.zcql();

      const dispatch = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, job_id, provider_id, status FROM Job_Dispatch WHERE ROWID = " +
            dispatchId
        ),
        "Job_Dispatch"
      );
      if (!dispatch) {
        const error = new Error("Dispatch offer not found");
        error.status = 404;
        throw error;
      }
      if (String(dispatch.provider_id) !== providerId) {
        const error = new Error("Provider does not match this dispatch offer");
        error.status = 403;
        throw error;
      }
      if (dispatch.status !== "OFFERED") {
        const error = new Error("Dispatch offer is no longer open");
        error.status = 409;
        throw error;
      }

      const now = nowSql();
      await req.catalystApp.datastore().table("Job_Dispatch").updateRow({
        ROWID: dispatchId,
        status: "ACCEPTED",
        accepted_at: now,
      });
      await req.catalystApp.datastore().table("Service_Jobs").updateRow({
        ROWID: dispatch.job_id,
        status: "ACCEPTED",
        provider_id: providerId,
      });
      await req.catalystApp.datastore().table("Providers").updateRow({
        ROWID: providerId,
        status: "ON_JOB",
      });

      sendOk(res, {
        dispatch_id: dispatchId,
        job_id: dispatch.job_id,
        provider_id: providerId,
        status: "ACCEPTED",
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/jobs", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const jobId = asId(req.query.id, "id");
        const row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE ROWID = " +
              jobId +
              " AND user_id = " +
              user.user_id
          ),
          "Service_Jobs"
        );
        if (!row) {
          const error = new Error("Job not found");
          error.status = 404;
          throw error;
        }
        sendOk(res, { job: mapJob(row) });
        return;
      }
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE user_id = " +
            user.user_id
        ),
        "Service_Jobs"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { jobs: rows.map(mapJob) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/provider/jobs", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const providerId = asId(req.query.provider_id, "provider_id");
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE provider_id = " +
              providerId
          ),
        "Service_Jobs"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, { jobs: rows.map(mapJob) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/jobs/tracking", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const jobId = asId(req.query.id, "id");
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, visit_latitude, visit_longitude, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE ROWID = " +
            jobId +
            " AND user_id = " +
            user.user_id
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }

      let provider = null;
      if (job.provider_id) {
        provider = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, first_name, last_name, phone, rating FROM Providers WHERE ROWID = " +
              asId(job.provider_id, "provider_id")
          ),
          "Providers"
        );
      }

      const status = String(job.status || "").trim().toUpperCase();
      const liveTracking = canShowLiveTracking(status);
      let latestLocation = null;
      let locations = [];

      if (liveTracking) {
        latestLocation = await readProviderLocationCache(req.catalystApp, jobId);
        locations = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, job_id, provider_id, latitude, longitude, heading, speed, status, recorded_at, CREATEDTIME FROM Live_Locations WHERE job_id = " +
              jobId
          ),
          "Live_Locations"
        )
          .map(mapLocation)
          .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))
          .slice(0, 25);
        if (!latestLocation && locations.length > 0) {
          latestLocation = locations[0];
        }
      }

      const visitLat = num(job.visit_latitude);
      const visitLng = num(job.visit_longitude);
      const route =
        latestLocation && visitLat && visitLng
          ? buildRouteSummary(
              num(latestLocation.latitude),
              num(latestLocation.longitude),
              visitLat,
              visitLng,
              num(latestLocation.speed)
            )
          : null;

      const timeline = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, job_id, provider_id, status, note, happened_at, CREATEDTIME FROM Job_Timeline WHERE job_id = " +
            jobId
        ),
        "Job_Timeline"
      )
        .map(mapTimeline)
        .sort((a, b) => String(a.happened_at).localeCompare(String(b.happened_at)));

      sendOk(res, {
        job: mapJob(job),
        customer_status: customerStatusLabel(status),
        live_tracking: liveTracking,
        provider: provider
          ? {
              id: String(provider.ROWID),
              name: [provider.first_name, provider.last_name].filter(Boolean).join(" "),
              phone: provider.phone || "",
              rating: num(provider.rating),
            }
          : null,
        latest_location: latestLocation,
        locations,
        route,
        visit: {
          latitude: visitLat || null,
          longitude: visitLng || null,
          line1: job.visit_line1 || "",
          city: job.visit_city || "",
        },
        timeline,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/status", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const status = String(req.body.status || "").trim().toUpperCase();
      if (!PROVIDER_STATUS_ACTIONS.includes(status)) {
        const error = new Error("status is not valid for a service job");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, user_id, provider_id, status FROM Service_Jobs WHERE ROWID = " + jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (String(job.provider_id || "") !== providerId) {
        const error = new Error("Provider does not match this job");
        error.status = 403;
        throw error;
      }
      const nextStatus = await transitionJobStatus(
        req,
        job,
        providerId,
        status,
        optionalText(req.body.note, "note", 255)
      );
      sendOk(res, { job_id: jobId, status: nextStatus, customer_status: customerStatusLabel(nextStatus) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/verify-otp", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const otp = String(req.body.otp || req.body.code || "").trim();
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, user_id, provider_id, status FROM Service_Jobs WHERE ROWID = " + jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (String(job.provider_id || "") !== providerId) {
        const error = new Error("Provider does not match this job");
        error.status = 403;
        throw error;
      }
      if (String(job.status || "").trim().toUpperCase() !== "ARRIVED") {
        const error = new Error("Arrival code can only be verified after marking arrived");
        error.status = 409;
        throw error;
      }
      const result = await verifyArrivalOtp(req.catalystApp, jobId, otp);
      if (!result.already_verified) {
        await emitJobEvent(req.catalystApp, {
          jobId,
          userId: job.user_id,
          providerId,
          event: "OTP_VERIFIED",
          status: "ARRIVED",
          note: "Arrival code verified",
        });
      }
      sendOk(res, { verified: true, already_verified: result.already_verified === true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/extra-services", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, user_id, provider_id, status FROM Service_Jobs WHERE ROWID = " + jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (String(job.provider_id || "") !== providerId) {
        const error = new Error("Provider does not match this job");
        error.status = 403;
        throw error;
      }
      const active = ["STARTED", "ARRIVED"].includes(String(job.status || "").trim().toUpperCase());
      if (!active) {
        const error = new Error("Additional services can only be requested during an active visit");
        error.status = 409;
        throw error;
      }
      const request = await requestExtraService(req.catalystApp, jobId, providerId, req.body || {});
      await emitJobEvent(req.catalystApp, {
        jobId,
        userId: job.user_id,
        providerId,
        event: "EXTRA_SERVICE_REQUESTED",
        status: job.status,
        note: request.name + " — ₹" + request.price,
      });
      sendOk(res, { request });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/location", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const latitude = Number(req.body.latitude);
      const longitude = Number(req.body.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        const error = new Error("latitude and longitude are required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, provider_id, status FROM Service_Jobs WHERE ROWID = " + jobId
        ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (String(job.provider_id || "") !== providerId) {
        const error = new Error("Provider does not match this job");
        error.status = 403;
        throw error;
      }
      if (!canAcceptLocationPing(job.status)) {
        const error = new Error("Live location is only accepted after the professional starts travel");
        error.status = 409;
        error.code = "TRACKING_NOT_ACTIVE";
        throw error;
      }
      const heading = num(req.body.heading);
      const speed = num(req.body.speed);
      const locationStatus = optionalText(req.body.status, "status", 40) || null;
      const recordedAt = nowSql();
      await req.catalystApp.datastore().table("Live_Locations").insertRow({
        job_id: jobId,
        provider_id: providerId,
        latitude,
        longitude,
        heading,
        speed,
        status: locationStatus,
        recorded_at: recordedAt,
      });
      await writeProviderLocationCache(req.catalystApp, jobId, {
        job_id: String(jobId),
        provider_id: String(providerId),
        latitude,
        longitude,
        heading,
        speed,
        status: locationStatus,
        recorded_at: recordedAt,
      });
      sendOk(res, { recorded: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/jobs/proof", async (req, res, next) => {
    try {
      requireProviderKey(req);
      const jobId = asId(req.body.job_id, "job_id");
      const providerId = asId(req.body.provider_id, "provider_id");
      const fileUrl = optionalText(req.body.file_url, "file_url", 500);
      if (!fileUrl) {
        const error = new Error("file_url is required");
        error.status = 400;
        throw error;
      }
      const job = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, provider_id FROM Service_Jobs WHERE ROWID = " + jobId
          ),
        "Service_Jobs"
      );
      if (!job) {
        const error = new Error("Job not found");
        error.status = 404;
        throw error;
      }
      if (String(job.provider_id || "") !== providerId) {
        const error = new Error("Provider does not match this job");
        error.status = 403;
        throw error;
      }
      const proof = await req.catalystApp.datastore().table("Job_Proofs").insertRow({
        job_id: jobId,
        provider_id: providerId,
        file_url: fileUrl,
        proof_type: optionalText(req.body.proof_type, "proof_type", 40) || "PHOTO",
        notes: optionalText(req.body.notes, "notes", 255) || null,
      });
      sendOk(res, { proof_id: String(proof.ROWID || proof.rowid || "") });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = dispatchRoutes;
