#!/usr/bin/env node
"use strict";

/**
 * PP-004 Development smoke — all scenarios, deterministic fixtures.
 *
 * Usage:
 *   node backend/scripts/pp004-dev-smoke.js
 *   node backend/scripts/pp004-dev-smoke.js --skip-pp003-restore
 */

const path = require("path");
const https = require("https");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  restorePp003SmokeFixtures,
  prepareProfessionalJobOffer,
  PHONE_A,
  PHONE_B,
  PHONE_C,
  PHONE_D,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const {
  acceptProfessionalJobOffer,
  rejectProfessionalJobOffer,
  processExpiredProfessionalOffers,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-offer-engine"));
const {
  mapDeliveryPartner,
  deliveryPartnerSessionPayload,
  DP_SELECT,
} = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner"));
const { signSession } = require(path.join(__dirname, "../functions/baylen-api/lib/session"));
const { dispatchProfessionalJob } = require(path.join(__dirname, "../functions/baylen-api/lib/professional-dispatch-engine"));

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

function pastExpirySql() {
  return new Date(Date.now() - 120000).toISOString().slice(0, 19).replace("T", " ");
}

function partnerSessionForRow(partnerRow) {
  return deliveryPartnerSessionPayload(mapDeliveryPartner(partnerRow));
}

function sessionForPartnerRowId(partnerRowId) {
  return {
    delivery_partner_id: "dp_" + partnerRowId,
    role: "delivery_partner",
  };
}

async function jobHistory(zcql, jobRowId) {
  return unwrap(
    await zcql.query(
      "SELECT old_status, new_status, actor_role, reason FROM Job_Status_History WHERE professional_job_row_id = " +
        jobRowId +
        " ORDER BY CREATEDTIME ASC"
    ),
    "Job_Status_History"
  );
}

async function loadJob(zcql, jobRowId) {
  return unwrap(
    await zcql.query(
      "SELECT ROWID, job_status, delivery_partner_row_id, job_type, reference_row_id, metadata_json FROM Professional_Jobs WHERE ROWID = " +
        jobRowId
    ),
    "Professional_Jobs"
  )[0];
}

function jobPrep(manifest, jobKey) {
  const refByJob = {
    homeAccept: "homeAcceptRef",
    homeReject: "homeRejectRef",
    productPrepaid: "prepaidRef",
    productCod: "codRef",
    productConcur: "concurRef",
    productExpire: "expireRef",
  };
  const jobType = jobKey.startsWith("home") ? "HOME_SERVICE" : "PRODUCT_DELIVERY";
  return {
    professionalJobId: manifest.jobs[jobKey].professional_job_id,
    jobType,
    referenceRowId: manifest.references[refByJob[jobKey]],
  };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const base = String(process.env.BAYLEN_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
  const fnEnv = await (async () => {
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
  })();
  if (!process.env.AUTH_SESSION_SECRET) {
    process.env.AUTH_SESSION_SECRET =
      fnEnv.AUTH_SESSION_SECRET ||
      require(path.join(__dirname, "../functions/baylen-api/lib/runtime-config")).DEV_SESSION_FALLBACK;
  }

  const manifest = await setupPp004Fixtures();
  require("fs").writeFileSync(path.join(__dirname, "pp004-smoke-checkpoint.txt"), "after_fixtures");
  const partnerRows = manifest.partners.rows;
  const authA = { "X-Baylen-Token": partnerTokenFor(partnerRows.A) };
  const authB = { "X-Baylen-Token": partnerTokenFor(partnerRows.B) };
  const authC = { "X-Baylen-Token": partnerTokenFor(partnerRows.C) };
  const authD = { "X-Baylen-Token": partnerTokenFor(partnerRows.D) };

  const report = {
    fixtures: {
      partners: {
        A: manifest.partners.A,
        B: manifest.partners.B,
        C: manifest.partners.C,
        D: manifest.partners.D,
      },
      jobs: Object.fromEntries(
        Object.entries(manifest.jobs).map(([key, val]) => [
          key,
          {
            professional_job_id: val.professional_job_id,
            job_status: val.job_status,
            delivery_partner_row_id: val.delivery_partner_row_id,
          },
        ])
      ),
    },
    scenarios: {},
    architecture_note:
      "PP-004 assigns one professional per offer (ASSIGNED). Simultaneous multi-offer broadcast is not supported; concurrency is enforced via row lock + single assignee ownership.",
    ok: false,
  };

  function scenario(name, result) {
    report.scenarios[name] = result;
  }

  try {
  // A — Home Service accept
  {
    const prep = jobPrep(manifest, "homeAccept");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, prep);
    const acceptHttp = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const detail = await httpRequest(
      base,
      "GET",
      "/v1/delivery-partner/jobs/detail?professional_job_id=" + pj,
      authA
    );
    const job = await loadJob(zcql, pj);
    const ref = job.reference_row_id;
    const bridge = unwrap(
      await zcql.query(
        "SELECT status, delivery_partner_row_id FROM Service_Jobs WHERE ROWID = " + ref + " LIMIT 1"
      ),
      "Service_Jobs"
    )[0];
    const history = await jobHistory(zcql, pj);
    scenario("A_home_service_accept", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        acceptHttp.status === 200 &&
        acceptHttp.json?.data?.new_status === "ACCEPTED" &&
        job.job_status === "ACCEPTED" &&
        bridge?.status === "ACCEPTED" &&
        history.some((h) => h.new_status === "ACCEPTED"),
      http_status: acceptHttp.status,
      detail_phase: detail.json?.data?.job?.phase,
      service_job_status: bridge?.status,
    });
  }

  // B — Reject → redispatch → B accepts
  {
    const prep = jobPrep(manifest, "homeReject");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, {
      ...prep,
      assignToPartnerRowId: manifest.partners.A,
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      const offered = await loadJob(zcql, pj);
      if (
        offered.job_status === "ASSIGNED" &&
        String(offered.delivery_partner_row_id) === manifest.partners.A
      ) {
        break;
      }
      await ctx.sleep(300);
    }
    const rejectResult = await rejectProfessionalJobOffer(
      app,
      pj,
      partnerSessionForRow(partnerRows.A),
      "TOO_FAR"
    );
    let job = await loadJob(zcql, pj);
    if (job.job_status === "ASSIGNMENT_PENDING") {
      await dispatchProfessionalJob(app, pj);
      job = await loadJob(zcql, pj);
    }
    const historyAfterReject = await jobHistory(zcql, pj);
    const assignedToB = String(job.delivery_partner_row_id) === manifest.partners.B;
    const acceptB = assignedToB
      ? await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authB, {
          professional_job_id: pj,
        })
      : { status: 0, json: null };
    const finalJob = await loadJob(zcql, pj);
    const finalHistory = await jobHistory(zcql, pj);
    scenario("B_reject_redispatch", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        (rejectResult?.success === true) &&
        historyAfterReject.some((h) => h.new_status === "REASSIGNMENT_REQUIRED") &&
        assignedToB &&
        acceptB.status === 200 &&
        finalJob.job_status === "ACCEPTED" &&
        finalHistory.filter((h) => h.new_status === "ASSIGNED").length >= 2,
      reject_via: "engine",
      reject_success: rejectResult?.success === true,
      reject_new_status: rejectResult?.new_status || null,
      reassigned_to_b: assignedToB,
      b_accept_status: acceptB.status,
      single_pj_row: pj,
    });
  }

  // C — Product prepaid accept
  {
    const prep = jobPrep(manifest, "productPrepaid");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, prep);
    const acceptHttp = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const job = await loadJob(zcql, pj);
    const order = unwrap(
      await zcql.query(
        "SELECT payment_status, fulfillment_rider_id FROM Orders WHERE ROWID = " +
          job.reference_row_id +
          " LIMIT 1"
      ),
      "Orders"
    )[0];
    scenario("C_product_delivery_accept", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        acceptHttp.status === 200 && job.job_status === "ACCEPTED" && order?.payment_status === "PAID",
      http_status: acceptHttp.status,
      payment_status: order?.payment_status,
    });
  }

  // F — Cross-professional concurrency (single assignee architecture)
  {
    const prep = jobPrep(manifest, "productConcur");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, {
      ...prep,
      assignToPartnerRowId: manifest.partners.A,
    });
    const jobBefore = await loadJob(zcql, pj);
    const bAttempt = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authB, {
      professional_job_id: pj,
    });
    const aAccept = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const jobAfter = await loadJob(zcql, pj);
    scenario("F_cross_professional_concurrency", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        String(jobBefore.delivery_partner_row_id) === manifest.partners.A &&
        (bAttempt.status === 404 || bAttempt.status === 403 || bAttempt.status === 409) &&
        aAccept.status === 200 &&
        jobAfter.job_status === "ACCEPTED" &&
        String(jobAfter.delivery_partner_row_id) === manifest.partners.A,
      b_attempt_status: bAttempt.status,
      a_accept_status: aAccept.status,
      guarantee: "single_assignee_per_offer",
    });
  }

  // Idempotency — A accepts twice on prepaid (already accepted in C), then B blocked
  {
    const pj = manifest.jobs.productPrepaid.professional_job_id;
    const historyBefore = await jobHistory(zcql, pj);
    const acceptCountBefore = historyBefore.filter((h) => h.new_status === "ACCEPTED").length;
    const first = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const second = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const bBlocked = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authB, {
      professional_job_id: pj,
    });
    const history = await jobHistory(zcql, pj);
    const acceptCountAfter = history.filter((h) => h.new_status === "ACCEPTED").length;
    scenario("idempotency", {
      ok:
        first.status === 200 &&
        second.status === 200 &&
        (bBlocked.status === 404 || bBlocked.status === 409) &&
        acceptCountAfter === acceptCountBefore,
      first_status: first.status,
      second_status: second.status,
      b_status: bBlocked.status,
      accept_history_count: acceptCountAfter,
      accept_history_delta: acceptCountAfter - acceptCountBefore,
    });
  }

  // Security — before COD accept consumes the job
  {
    const prep = jobPrep(manifest, "productCod");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, {
      ...prep,
      assignToPartnerRowId: manifest.partners.A,
    });
    const pendingKyc = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authC, {
      professional_job_id: pj,
    });
    const suspended = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authD, {
      professional_job_id: pj,
    });
    const crossDetail = await httpRequest(
      base,
      "GET",
      "/v1/delivery-partner/jobs/detail?professional_job_id=" + pj,
      authB
    );
    scenario("security", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        (pendingKyc.status === 403 || pendingKyc.status === 401) &&
        (suspended.status === 403 || suspended.status === 401) &&
        (crossDetail.status === 404 || crossDetail.status === 403),
      pending_kyc_status: pendingKyc.status,
      suspended_status: suspended.status,
      cross_detail_status: crossDetail.status,
    });
  }

  // D — COD accept
  {
    const pj = manifest.jobs.productCod.professional_job_id;
    const orderBefore = unwrap(
      await zcql.query(
        "SELECT payment_status, payment_method FROM Orders WHERE ROWID = " +
          manifest.references.codRef +
          " LIMIT 1"
      ),
      "Orders"
    )[0];
    const acceptHttp = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const job = await loadJob(zcql, pj);
    scenario("D_cod_accept", {
      ok:
        acceptHttp.status === 200 &&
        job.job_status === "ACCEPTED" &&
        String(orderBefore?.payment_method || "").toUpperCase() === "COD" &&
        orderBefore?.payment_status !== "PAID",
      http_status: acceptHttp.status,
      payment_status_before: orderBefore?.payment_status,
      payment_method: orderBefore?.payment_method,
    });
  }

  // E — Expiry
  {
    const prep = jobPrep(manifest, "productExpire");
    const pj = prep.professionalJobId;
    const prepared = await prepareProfessionalJobOffer(ctx, {
      ...prep,
      assignToPartnerRowId: manifest.partners.A,
    });
    await ctx.updateRow("Professional_Jobs", {
      ROWID: pj,
      offer_expires_at: pastExpirySql(),
    });
    const results = await processExpiredProfessionalOffers(app, 5);
    const job = await loadJob(zcql, pj);
    const staleAccept = await httpRequest(base, "POST", "/v1/delivery-partner/professional-job-accept", authA, {
      professional_job_id: pj,
    });
    const history = await jobHistory(zcql, pj);
    const idempotent = await processExpiredProfessionalOffers(app, 5);
    scenario("E_offer_expiry", {
      ok:
        prepared.job_status === "ASSIGNED" &&
        String(prepared.delivery_partner_row_id) === manifest.partners.A &&
        results.some((r) => r.expired === true) &&
        staleAccept.status >= 400 &&
        job.job_status === "ASSIGNED" &&
        history.some((h) => h.reason === "OFFER_EXPIRED") &&
        idempotent.filter((r) => r.expired === true).length === 0,
      final_status: job.job_status,
      stale_accept_status: staleAccept.status,
      assigned_partner: String(job.delivery_partner_row_id || ""),
    });
  }
  } catch (scenarioError) {
    report.fatal_error = String(scenarioError && scenarioError.stack ? scenarioError.stack : scenarioError);
  } finally {
  report.ok =
    !report.fatal_error && Object.values(report.scenarios).every((s) => s && s.ok === true);
  let reportJson = "";
  try {
    reportJson = JSON.stringify(report, null, 2);
  } catch (stringifyError) {
    reportJson = JSON.stringify(
      {
        ok: false,
        stringify_error: String(stringifyError),
        scenarios: report.scenarios,
        fatal_error: report.fatal_error || null,
      },
      null,
      2
    );
  }
  console.log(reportJson);
  require("fs").writeFileSync(path.join(__dirname, "pp004-smoke-report.json"), reportJson);

  if (!process.argv.includes("--skip-pp003-restore")) {
    try {
      const pp003Restore = await restorePp003SmokeFixtures();
      report.pp003_restore = pp003Restore;
      const restoreJson = JSON.stringify({ pp003_restore: pp003Restore }, null, 2);
      console.log(restoreJson);
      require("fs").writeFileSync(path.join(__dirname, "pp003-restore-report.json"), restoreJson);
    } catch (restoreError) {
      const restoreFail = JSON.stringify({ pp003_restore_error: String(restoreError.stack || restoreError) });
      console.log(restoreFail);
      require("fs").writeFileSync(path.join(__dirname, "pp003-restore-report.json"), restoreFail);
      report.ok = false;
    }
  }

  if (!report.ok) {
    process.exitCode = 1;
  }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
