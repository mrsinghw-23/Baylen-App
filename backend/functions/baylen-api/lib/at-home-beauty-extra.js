"use strict";

const { num, asId, rowOf, rowsOf } = require("./http");

const EXTRA_TTL_MINUTES = 60;

function extraCacheKey(jobId) {
  return "beauty_job_extra:" + String(jobId);
}

async function readExtraRequest(app, jobId) {
  try {
    const raw = await app.cache().segment().getValue(extraCacheKey(jobId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function writeExtraRequest(app, jobId, payload) {
  await app.cache().segment().put(
    extraCacheKey(jobId),
    JSON.stringify({
      ...payload,
      updated_at: new Date().toISOString(),
    }),
    EXTRA_TTL_MINUTES
  );
}

async function requestExtraService(app, jobId, providerId, body) {
  const name = String(body.name || body.service_name || "").trim();
  const price = num(body.price);
  if (!name) {
    const error = new Error("name is required for an additional service");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(price) || price <= 0) {
    const error = new Error("price must be greater than zero");
    error.status = 400;
    throw error;
  }
  const request = {
    job_id: String(jobId),
    provider_id: String(providerId),
    name,
    price,
    service_id: body.service_id ? asId(body.service_id, "service_id") : null,
    status: "PENDING",
    requested_at: new Date().toISOString(),
  };
  await writeExtraRequest(app, jobId, request);
  return request;
}

async function respondExtraService(app, jobId, decision) {
  const pending = await readExtraRequest(app, jobId);
  if (!pending || pending.status !== "PENDING") {
    const error = new Error("No pending additional service request");
    error.status = 404;
    throw error;
  }
  const approved = String(decision || "").trim().toUpperCase() === "APPROVE";
  pending.status = approved ? "APPROVED" : "DECLINED";
  pending.responded_at = new Date().toISOString();
  await writeExtraRequest(app, jobId, pending);

  if (approved) {
    const zcql = app.zcql();
    const job = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, grand_total FROM Service_Jobs WHERE ROWID = " + asId(jobId, "job_id")
      ),
      "Service_Jobs"
    );
    const currentTotal = num(job?.grand_total);
    const newTotal = Math.round((currentTotal + pending.price) * 100) / 100;
    await app.datastore().table("Service_Jobs").updateRow({
      ROWID: jobId,
      grand_total: newTotal,
    });
    await app.datastore().table("Job_Items").insertRow({
      job_id: jobId,
      service_id: pending.service_id,
      service_name: pending.name + " (add-on)",
      quantity: 1,
      unit_price: pending.price,
      line_total: pending.price,
    });
    return { ...pending, grand_total: newTotal };
  }

  return pending;
}

async function requestExtraServiceFromCatalog(app, { jobId, serviceId, outletRowId, providerId, quantity = 1 }) {
  const zcql = app.zcql();
  const service = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, selling_price, is_at_home FROM Salon_Services WHERE ROWID = " +
        asId(serviceId, "service_id")
    ),
    "Salon_Services"
  );
  if (!service) {
    const error = new Error("Service not found");
    error.status = 404;
    error.code = "SERVICE_NOT_FOUND";
    throw error;
  }
  if (service.is_at_home !== true && String(service.is_at_home).toLowerCase() !== "true") {
    const error = new Error("Service is not available for home delivery");
    error.status = 409;
    error.code = "SERVICE_NOT_AT_HOME";
    throw error;
  }

  let unitPrice = num(service.selling_price);
  if (outletRowId) {
    const priced = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT selling_price FROM Outlet_Service_Prices WHERE outlet_id = " +
          asId(outletRowId, "outlet_id") +
          " AND service_id = " +
          asId(serviceId, "service_id") +
          " LIMIT 1"
      ),
      "Outlet_Service_Prices"
    );
    if (priced && num(priced.selling_price) > 0) {
      unitPrice = num(priced.selling_price);
    }
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    const error = new Error("Service price is unavailable");
    error.status = 409;
    error.code = "PRICE_UNAVAILABLE";
    throw error;
  }

  const pending = await readExtraRequest(app, jobId);
  if (pending && pending.status === "PENDING") {
    const error = new Error("An add-on request is already pending customer approval");
    error.status = 409;
    error.code = "ADDON_ALREADY_PENDING";
    throw error;
  }

  const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
  const request = {
    job_id: String(jobId),
    provider_id: String(providerId),
    name: service.name || "Add-on service",
    price: lineTotal,
    unit_price: unitPrice,
    quantity,
    service_id: String(serviceId),
    status: "PENDING",
    requested_at: new Date().toISOString(),
  };
  await writeExtraRequest(app, jobId, request);
  return request;
}

module.exports = {
  readExtraRequest,
  requestExtraService,
  requestExtraServiceFromCatalog,
  respondExtraService,
};
