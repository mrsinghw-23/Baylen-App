const crypto = require("crypto");
const { asId, optionalText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");

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

async function notifyJobStatus(req, job, status) {
  try {
    await req.catalystApp.datastore().table("Notifications").insertRow({
      user_id: job.user_id,
      type: "SERVICE",
      title: "Service update",
      body: "Your Baylen service status is now " + status + ".",
      reference_type: "JOB",
      reference_id: job.ROWID,
      delivery_status: "PENDING",
      read_at: null,
    });
  } catch (_) {}
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
          "SELECT ROWID, appointment_id, provider_id, status, visit_address_id, visit_line1, visit_city, visit_state, scheduled_at, requested_at, grand_total, currency FROM Service_Jobs WHERE ROWID = " +
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

      const locations = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, job_id, provider_id, latitude, longitude, heading, speed, status, recorded_at, CREATEDTIME FROM Live_Locations WHERE job_id = " +
            jobId
        ),
        "Live_Locations"
      )
        .map(mapLocation)
        .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))
        .slice(0, 25);

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
        provider: provider
          ? {
              id: String(provider.ROWID),
              name: [provider.first_name, provider.last_name].filter(Boolean).join(" "),
              phone: provider.phone || "",
              rating: num(provider.rating),
            }
          : null,
        latest_location: locations.length > 0 ? locations[0] : null,
        locations,
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
      const allowed = ["EN_ROUTE", "ARRIVED", "STARTED", "COMPLETED", "CANCELLED"];
      if (!allowed.includes(status)) {
        const error = new Error("status is not valid for a service job");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const job = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, user_id, provider_id FROM Service_Jobs WHERE ROWID = " + jobId
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
      await req.catalystApp.datastore().table("Service_Jobs").updateRow({
        ROWID: jobId,
        status,
      });
      if (status === "COMPLETED" || status === "CANCELLED") {
        await req.catalystApp.datastore().table("Providers").updateRow({
          ROWID: providerId,
          status: "AVAILABLE",
        });
      }
      await req.catalystApp.datastore().table("Job_Timeline").insertRow({
        job_id: jobId,
        provider_id: providerId,
        status,
        note: optionalText(req.body.note, "note", 255) || null,
        happened_at: nowSql(),
      });
      await notifyJobStatus(req, job, status);
      sendOk(res, { job_id: jobId, status });
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
      await req.catalystApp.datastore().table("Live_Locations").insertRow({
        job_id: jobId,
        provider_id: providerId,
        latitude,
        longitude,
        heading: num(req.body.heading),
        speed: num(req.body.speed),
        status: optionalText(req.body.status, "status", 40) || null,
        recorded_at: nowSql(),
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
