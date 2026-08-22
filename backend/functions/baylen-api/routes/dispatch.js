const { asId, rowOf, rowsOf, sendOk } = require("../lib/http");

function dispatchRoutes(app) {
  app.post("/v1/jobs/dispatch", async (req, res, next) => {
    try {
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
        offered_at: new Date().toISOString().slice(0, 19).replace("T", " "),
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

      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
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
}

module.exports = dispatchRoutes;
