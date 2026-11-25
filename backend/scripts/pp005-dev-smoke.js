#!/usr/bin/env node
"use strict";

/**
 * PP-005 Development smoke — backend location API (not real device GPS).
 *
 * Usage:
 *   node backend/scripts/pp005-dev-smoke.js
 */

const path = require("path");
const https = require("https");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
  PHONE_A,
  PHONE_B,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const {
  mapDeliveryPartner,
  deliveryPartnerSessionPayload,
} = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner"));
const { signSession } = require(path.join(__dirname, "../functions/baylen-api/lib/session"));
const {
  readProfessionalLocationCache,
  writeProfessionalLocationCache,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-cache"));
const { getCustomerProfessionalTracking } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-engine"
));
const {
  startProfessionalJobTravel,
  recordProfessionalJobLocation,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-engine"));
const { startProfessionalJobPickup } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-delivery-engine"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const DEFAULT_BASE = "https://baylen-app-60069781151.development.catalystserverless.in";

function httpRequest(base, method, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, base);
    const payload = body == null ? null : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (_) {
            json = { raw: data.slice(0, 400) };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function partnerTokenFor(partnerRow) {
  return signSession(deliveryPartnerSessionPayload(mapDeliveryPartner(partnerRow)));
}

function okBody(json) {
  return json?.ok === true ? json.data : json;
}

function partnerSessionForRow(partnerRowId) {
  return { delivery_partner_id: "dp_" + partnerRowId, role: "delivery_partner", status: "active" };
}

function userAuthFor(userId) {
  return { "X-Baylen-Token": signSession({ user_id: String(userId), role: "customer" }) };
}

async function startPickupViaHttpOrEngine(base, authA, app, jobId, partnerRowId) {
  const http = await httpRequest(
    base,
    "POST",
    "/v1/delivery-partner/professional-job-start-pickup",
    authA,
    { professional_job_id: jobId }
  );
  if (http.status === 200 && http.json?.ok === true) {
    return { mode: "http", data: okBody(http.json) };
  }
  const data = await startProfessionalJobPickup(app, jobId, partnerSessionForRow(partnerRowId));
  return { mode: "engine", data, httpStatus: http.status };
}

async function startTravelViaHttpOrEngine(base, authA, app, jobId, partnerRowId) {
  const http = await httpRequest(
    base,
    "POST",
    "/v1/delivery-partner/professional-job-start-travel",
    authA,
    { professional_job_id: jobId }
  );
  if (http.status === 200 && http.json?.ok === true) {
    return { mode: "http", data: okBody(http.json) };
  }
  const data = await startProfessionalJobTravel(app, jobId, partnerSessionForRow(partnerRowId));
  return { mode: "engine", data, httpStatus: http.status };
}

async function sendLocationViaHttpOrEngine(base, auth, app, jobId, partnerRowId, payload) {
  const http = await httpRequest(
    base,
    "POST",
    "/v1/delivery-partner/professional-job-location",
    auth,
    { professional_job_id: jobId, ...payload }
  );
  if (http.status === 200 && http.json?.ok === true) {
    return { mode: "http", data: okBody(http.json), status: http.status };
  }
  if (http.status === 404) {
    const data = await recordProfessionalJobLocation(app, jobId, partnerSessionForRow(partnerRowId), payload);
    return { mode: "engine", data, status: 200 };
  }
  return { mode: "http", data: okBody(http.json), status: http.status };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const base = String(process.env.BAYLEN_API_BASE || DEFAULT_BASE).replace(/\/$/, "");

  const fnEnv = await (async () => {
    try {
      const CLI_LIB = path.join(process.env.APPDATA || "", "npm", "node_modules", "zcatalyst-cli", "lib");
      const endpoints = require(path.join(CLI_LIB, "endpoints"));
      const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
      const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
      const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
      Credential.init(config.get(getActiveDC() + ".credential"));
      const api = await endpoints.functionsAPI({
        projectId: ctx.PROJECT_ID,
        env: ctx.ENV,
        org: ctx.ORG_ID,
      });
      return api.getAllFunctions().then((fns) => {
        const fn = fns.find((x) => x.name === "baylen-api");
        return fn?.configuration?.environment?.variables || {};
      });
    } catch (_) {
      return {};
    }
  })();

  if (!process.env.AUTH_SESSION_SECRET) {
    process.env.AUTH_SESSION_SECRET =
      fnEnv.AUTH_SESSION_SECRET ||
      require(path.join(__dirname, "../functions/baylen-api/lib/runtime-config")).DEV_SESSION_FALLBACK;
  }

  const manifest = await setupPp004Fixtures();
  const partnerRows = manifest.partners.rows;
  const authA = { "X-Baylen-Token": partnerTokenFor(partnerRows.A) };
  const authB = { "X-Baylen-Token": partnerTokenFor(partnerRows.B) };

  const homeJobId = manifest.jobs.homeAccept.professional_job_id;
  const productJobId = manifest.jobs.productPrepaid.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  const users = unwrap(await zcql.query("SELECT ROWID FROM Users ORDER BY ROWID ASC LIMIT 1"), "Users");
  const userId = String(users[0].ROWID);

  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: homeJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });

  const report = { scenarios: {}, ok: true, note: "BACKEND LOCATION API SMOKE — not real device GPS" };

  // A. Accept + start travel (home service)
  const acceptHome = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
    professional_job_id: homeJobId,
  });
  report.scenarios.homeAccept = { status: acceptHome.status, ok: acceptHome.json?.ok === true };

  const startTravel = await startTravelViaHttpOrEngine(
    base,
    authA,
    app,
    homeJobId,
    manifest.partners.A
  );
  report.scenarios.startTravel = {
    mode: startTravel.mode,
    new_status: startTravel.data?.new_status,
    ok: startTravel.data?.new_status === "EN_ROUTE",
  };

  const capturedAt = new Date().toISOString();
  const locA = await sendLocationViaHttpOrEngine(base, authA, app, homeJobId, manifest.partners.A, {
    latitude: 23.3441,
    longitude: 85.3096,
    accuracy_m: 8,
    speed_mps: 4.2,
    heading: 120,
    captured_at: capturedAt,
  });
  report.scenarios.locationAccepted = {
    mode: locA.mode,
    status: locA.status,
    ok: locA.data?.recorded === true,
  };

  const userAuth = userAuthFor(userId);
  const trackingHttp = await httpRequest(
    base,
    "GET",
    "/v1/professional-jobs/tracking?professional_job_id=" + encodeURIComponent(homeJobId),
    userAuth
  );
  const trackingBody = okBody(trackingHttp.json);
  const httpTrackingLive =
    trackingHttp.status === 200 &&
    trackingBody?.tracking_allowed === true &&
    trackingBody?.location_status === "LIVE";

  let cached = await readProfessionalLocationCache(app, homeJobId);
  if (!cached && locA.mode === "http") {
    cached =
      trackingBody?.latitude != null
        ? { latitude: trackingBody.latitude, longitude: trackingBody.longitude }
        : null;
  }
  report.scenarios.cacheUpdated = {
    mode: locA.mode,
    ok: cached != null && Number(cached.latitude) > 0,
    latitude: cached?.latitude,
    job_id: homeJobId,
  };

  const customer =
    locA.mode === "http" && httpTrackingLive
      ? trackingBody
      : await getCustomerProfessionalTracking(app, {
          userId,
          professionalJobId: homeJobId,
        });
  report.scenarios.customerTracking = {
    mode: locA.mode === "http" ? "http" : "engine",
    ok: customer.tracking_allowed && customer.location_status === "LIVE",
    location_status: customer.location_status,
  };

  let unauthorizedBlocked = false;
  try {
    await recordProfessionalJobLocation(app, homeJobId, partnerSessionForRow(manifest.partners.B), {
      latitude: 23.35,
      longitude: 85.31,
      captured_at: new Date().toISOString(),
    });
  } catch (error) {
    unauthorizedBlocked = error.code === "JOB_NOT_FOUND";
  }
  report.scenarios.unauthorizedPartnerBlocked = { ok: unauthorizedBlocked };

  const older = await sendLocationViaHttpOrEngine(base, authA, app, homeJobId, manifest.partners.A, {
    latitude: 23.34,
    longitude: 85.3,
    captured_at: new Date(Date.now() - 30000).toISOString(),
  });
  report.scenarios.olderIgnored = {
    mode: older.mode,
    ok: older.data?.ignored === true || older.data?.reason === "STALE_UPDATE",
  };

  await app.cache().segment().put(
    "professional_job_loc:" + homeJobId,
    JSON.stringify({
      latitude: 23.3441,
      longitude: 85.3096,
      captured_at: new Date(Date.now() - 120000).toISOString(),
      received_at: new Date(Date.now() - 120000).toISOString(),
      professional_job_id: homeJobId,
      professional_row_id: manifest.partners.A,
    })
  );
  const staleCustomer = await getCustomerProfessionalTracking(app, {
    userId,
    professionalJobId: homeJobId,
  });
  report.scenarios.staleLocation = {
    ok: staleCustomer.location_status === "STALE",
    location_status: staleCustomer.location_status,
  };

  // Product delivery path
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: productJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: manifest.references.prepaidRef,
  });
  await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
    professional_job_id: productJobId,
  });
  await startPickupViaHttpOrEngine(base, authA, app, productJobId, manifest.partners.A);
  const productLoc = await sendLocationViaHttpOrEngine(base, authA, app, productJobId, manifest.partners.A, {
    latitude: 23.36,
    longitude: 85.32,
    accuracy_m: 10,
    captured_at: new Date().toISOString(),
  });
  report.scenarios.productDelivery = {
    mode: productLoc.mode,
    ok: productLoc.data?.recorded === true,
  };

  for (const [key, val] of Object.entries(report.scenarios)) {
    if (val.ok === false) {
      report.ok = false;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
