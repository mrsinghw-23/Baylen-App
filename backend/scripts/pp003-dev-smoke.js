#!/usr/bin/env node
"use strict";

/**
 * PP-003 Development smoke — dispatch engine + partner jobs HTTP API.
 *
 * Usage:
 *   node backend/scripts/pp003-dev-smoke.js
 *
 * Optional env overrides:
 *   BAYLEN_API_BASE
 *   PP003_PARTNER_TOKEN — skip token minting if set
 *   AUTH_SESSION_SECRET — override (else fetched from dev baylen-api env)
 */

const path = require("path");
const https = require("https");

const CLI_LIB = path.join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "zcatalyst-cli",
  "lib"
);
const config = require(path.join(CLI_LIB, "util_modules", "config-store")).default;
const { getActiveDC } = require(path.join(CLI_LIB, "util_modules", "dc"));
const Credential = require(path.join(CLI_LIB, "authentication", "credential")).default;
const API = require(path.join(CLI_LIB, "internal", "api")).default;
const endpoints = require(path.join(CLI_LIB, "endpoints"));

const {
  dispatchPendingJobs,
  dispatchProfessionalJob,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-dispatch-engine"));
const {
  mapDeliveryPartner,
  deliveryPartnerSessionPayload,
  DP_SELECT,
} = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner"));
const { signSession } = require(path.join(__dirname, "../functions/baylen-api/lib/session"));

const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const ENV = "Development";
const DEFAULT_BASE = "https://baylen-app-60069781151.development.catalystserverless.in";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function unwrap(rows, table) {
  return (rows || []).map((row) => row[table] || row);
}

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

async function getDevFunctionEnv() {
  Credential.init(config.get(getActiveDC() + ".credential"));
  const api = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const fn = (await api.getAllFunctions()).find((x) => x.name === "baylen-api");
  return fn?.configuration?.environment?.variables || {};
}

async function main() {
  process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";
  Credential.init(config.get(getActiveDC() + ".credential"));
  const zcql = await endpoints.zcqlAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const ds = await endpoints.datastoreAPI({
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
  });
  const tables = await ds.getAllTables();
  const byName = new Map(
    tables.map((t) => [String(t.table_name || t.name), String(t.table_id || t.id)])
  );

  const apiOpts = {
    projectId: PROJECT_ID,
    env: ENV,
    org: ORG_ID,
    authNeeded: true,
    resolveOnError: true,
    printError: false,
  };

  async function updateRow(tableName, payload) {
    const tableId = byName.get(tableName);
    if (!tableId) throw new Error("Missing table " + tableName);
    const clean = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== null && value !== undefined && value !== "") {
        clean[key] = value;
      }
    }
    await sleep(200);
    Credential.init(config.get(getActiveDC() + ".credential"));
    const fresh = new API(apiOpts);
    const res = await fresh.put(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
      body: [clean],
      json: true,
      headers: { "Catalyst-org": ORG_ID, Environment: ENV },
    });
    if (res.status >= 400 || res.body?.status === "failure") {
      throw new Error("update " + tableName + ": " + JSON.stringify(res.body));
    }
    return res.body.data;
  }

  const app = {
    zcql() {
      return {
        executeZCQLQuery(query) {
          return zcql.query(String(query));
        },
      };
    },
    datastore() {
      return {
        table(name) {
          return {
            async updateRow(payload) {
              return updateRow(name, payload);
            },
            async insertRow(payload) {
              const tableId = byName.get(name);
              await sleep(200);
              Credential.init(config.get(getActiveDC() + ".credential"));
              const fresh = new API(apiOpts);
              const res = await fresh.post(`/baas/v1/project/${PROJECT_ID}/table/${tableId}/row`, {
                body: [payload],
                json: true,
                headers: { "Catalyst-org": ORG_ID, Environment: ENV },
              });
              if (res.status >= 400 || res.body?.status === "failure") {
                throw new Error("insert " + name + ": " + JSON.stringify(res.body));
              }
              return res.body?.data;
            },
          };
        },
      };
    },
    cache() {
      return {
        segment() {
          return {
            async getValue() {
              return null;
            },
            async put() {},
          };
        },
      };
    },
  };

  const report = { steps: [] };

  async function ensureDevFixtures() {
    const partner = partners[0];
    if (!partner) {
      return { skipped: true, reason: "no_active_partner" };
    }
    const outletRef = String(partner.outlet_row_id || partner.outlet_id || "");
    const providerRef = String(partner.legacy_provider_id || "").trim();
    const serviceRef = "36851000000380001";
    const fixes = [];

    const productJob = pendingBefore.find((j) => j.job_type === "PRODUCT_DELIVERY");
    if (productJob) {
      const orderRef = unwrap(
        await zcql.query(
          "SELECT reference_row_id FROM Professional_Jobs WHERE ROWID = " + productJob.ROWID
        ),
        "Professional_Jobs"
      )[0]?.reference_row_id;
      if (orderRef && outletRef) {
        await updateRow("Orders", {
          ROWID: orderRef,
          fulfillment_store_id: outletRef,
        });
        fixes.push({ table: "Orders", row_id: orderRef, field: "fulfillment_store_id", value: outletRef });
      }
    }

    const homeJob = pendingBefore.find((j) => j.job_type === "HOME_SERVICE");
    let serviceJobRef = "";
    let visitCity = "";
    if (homeJob) {
      serviceJobRef = unwrap(
        await zcql.query(
          "SELECT reference_row_id FROM Professional_Jobs WHERE ROWID = " + homeJob.ROWID
        ),
        "Professional_Jobs"
      )[0]?.reference_row_id || "";
      if (serviceJobRef) {
        visitCity =
          unwrap(
            await zcql.query(
              "SELECT visit_city FROM Service_Jobs WHERE ROWID = " + serviceJobRef + " LIMIT 1"
            ),
            "Service_Jobs"
          )[0]?.visit_city || "";
        const existingItems = unwrap(
          await zcql.query(
            "SELECT ROWID FROM Job_Items WHERE job_id = " + serviceJobRef + " LIMIT 1"
          ),
          "Job_Items"
        );
        if (!existingItems.length) {
          await app.datastore().table("Job_Items").insertRow({
            job_id: serviceJobRef,
            service_id: serviceRef,
            service_name: "PP-003 smoke service",
            quantity: 1,
            unit_price: 499,
            line_total: 499,
            duration_minutes: 60,
          });
          fixes.push({ table: "Job_Items", job_id: serviceJobRef, service_id: serviceRef });
        }
      }
    }

    if (providerRef) {
      const existingSkill = unwrap(
        await zcql.query(
          "SELECT ROWID FROM Provider_Services WHERE provider_id = " +
            providerRef +
            " AND service_id = " +
            serviceRef +
            " LIMIT 1"
        ),
        "Provider_Services"
      );
      if (!existingSkill.length) {
        await app.datastore().table("Provider_Services").insertRow({
          provider_id: providerRef,
          service_id: serviceRef,
          is_active: true,
        });
        fixes.push({
          table: "Provider_Services",
          provider_id: providerRef,
          service_id: serviceRef,
        });
      }

      if (visitCity) {
        const existingArea = unwrap(
          await zcql.query(
            "SELECT ROWID FROM Service_Areas WHERE provider_id = " +
              providerRef +
              " AND city = '" +
              String(visitCity).replace(/'/g, "''") +
              "' LIMIT 1"
          ),
          "Service_Areas"
        );
        if (!existingArea.length) {
          await app.datastore().table("Service_Areas").insertRow({
            provider_id: providerRef,
            city: visitCity,
            is_active: true,
          });
          fixes.push({ table: "Service_Areas", provider_id: providerRef, city: visitCity });
        }
      }
    }

    return { fixes };
  }

  const pendingBefore = unwrap(
    await zcql.query(
      "SELECT ROWID, job_number, job_type, job_status, delivery_partner_row_id FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Professional_Jobs"
  );
  report.pending_before = pendingBefore;

  const partners = unwrap(
    await zcql.query(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE status = 'active' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Delivery_Partners"
  );
  report.active_partners = partners.map((p) => ({
    ROWID: String(p.ROWID),
    phone: p.phone,
    online_status: p.online_status,
    outlet_row_id: p.outlet_row_id || p.outlet_id,
    legacy_provider_id: p.legacy_provider_id,
    legacy_rider_id: p.legacy_rider_id,
  }));

  if (partners.length) {
    const target = partners.find((p) => p.online_status === "ONLINE_AVAILABLE") || partners[0];
    if (target.online_status !== "ONLINE_AVAILABLE") {
      await updateRow("Delivery_Partners", {
        ROWID: target.ROWID,
        online_status: "ONLINE_AVAILABLE",
      });
      report.steps.push({
        step: "partner_set_online",
        partner_row_id: String(target.ROWID),
      });
    }
  }

  report.steps.push({
    step: "dev_fixture_repair",
    ...(await ensureDevFixtures()),
  });

  const dispatchResults = await dispatchPendingJobs(app, 5);
  report.steps.push({
    step: "engine_dispatch_pending",
    results: dispatchResults.map((r) => ({
      job_row_id: r.job_row_id,
      dispatched: r.dispatched,
      reason: r.reason,
      partner_row_id: r.partner_row_id,
    })),
  });

  const assigned = unwrap(
    await zcql.query(
      "SELECT ROWID, job_number, job_type, job_status, delivery_partner_row_id, assigned_at FROM Professional_Jobs WHERE job_status = 'ASSIGNED' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Professional_Jobs"
  );
  report.assigned_jobs = assigned;

  const history = unwrap(
    await zcql.query(
      "SELECT professional_job_row_id, old_status, new_status, actor_role, reason FROM Job_Status_History WHERE new_status = 'ASSIGNED' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Job_Status_History"
  );
  report.assignment_history = history;

  const base = String(process.env.BAYLEN_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const fnEnv = await getDevFunctionEnv();
  if (!process.env.AUTH_SESSION_SECRET) {
    process.env.AUTH_SESSION_SECRET =
      fnEnv.AUTH_SESSION_SECRET || require(path.join(__dirname, "../functions/baylen-api/lib/runtime-config")).DEV_SESSION_FALLBACK;
  }

  let partnerToken = process.env.PP003_PARTNER_TOKEN || "";
  let partnerRow = assigned[0]?.delivery_partner_row_id
    ? partners.find((p) => String(p.ROWID) === String(assigned[0].delivery_partner_row_id))
    : partners[0];

  if (!partnerToken && partnerRow) {
    const mapped = mapDeliveryPartner(partnerRow);
    partnerToken = signSession(deliveryPartnerSessionPayload(mapped));
    report.minted_partner_token_for = mapped.delivery_partner_id;
  }

  if (partnerToken) {
    const auth = { "X-Baylen-Token": partnerToken };
    const dash = await httpRequest(base, "GET", "/v1/delivery-partner/dashboard", auth);
    report.steps.push({
      step: "http_dashboard",
      status: dash.status,
      delivery_offers: dash.json?.data?.stats?.delivery_offers_count,
      home_offers: dash.json?.data?.stats?.home_service_offers_count,
    });

    const offered = await httpRequest(
      base,
      "GET",
      "/v1/delivery-partner/jobs?view=offered",
      auth
    );
    report.steps.push({
      step: "http_jobs_offered",
      status: offered.status,
      total: offered.json?.data?.total,
      jobs: (offered.json?.data?.jobs || []).slice(0, 3).map((j) => ({
        id: j.professional_job_id,
        type: j.job_type,
        title: j.title,
      })),
    });

    if (assigned[0]) {
      const detail = await httpRequest(
        base,
        "GET",
        "/v1/delivery-partner/jobs/detail?professional_job_id=" + assigned[0].ROWID,
        auth
      );
      report.steps.push({
        step: "http_job_detail",
        status: detail.status,
        job_id: assigned[0].ROWID,
        authorized: detail.status === 200,
      });
    }

    if (partners[1] && assigned[0]) {
      const other = mapDeliveryPartner(partners[1]);
      if (String(other.row_id) !== String(assigned[0].delivery_partner_row_id)) {
        const otherToken = signSession(deliveryPartnerSessionPayload(other));
        const forbidden = await httpRequest(
          base,
          "GET",
          "/v1/delivery-partner/jobs/detail?professional_job_id=" + assigned[0].ROWID,
          { "X-Baylen-Token": otherToken }
        );
        report.steps.push({
          step: "http_job_detail_cross_partner_denied",
          status: forbidden.status,
          ok: forbidden.status === 404,
        });
      }
    }
  } else {
    report.steps.push({
      step: "http_skipped",
      reason: "No active partner available to mint token",
    });
  }

  if (fnEnv.ADMIN_API_KEY && pendingBefore[0]) {
    const concurrent = await Promise.all([
      dispatchProfessionalJob(app, pendingBefore[0].ROWID),
      dispatchProfessionalJob(app, pendingBefore[0].ROWID),
    ]);
    report.steps.push({
      step: "concurrent_dispatch_safety",
      outcomes: concurrent.map((r) => ({
        dispatched: r.dispatched,
        reason: r.reason,
        assigned: r.assigned,
      })),
    });
  }

  report.ok =
    report.steps.some((s) => s.step === "engine_dispatch_pending") &&
    (report.assigned_jobs?.length > 0 || report.pending_before?.length === 0);

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok && report.pending_before?.length > 0 && !report.assigned_jobs?.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
