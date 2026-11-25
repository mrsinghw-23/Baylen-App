#!/usr/bin/env node
"use strict";

/**
 * PP-007 Development smoke — home service execution after OTP verification.
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const {
  acceptProfessionalJobOffer,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-offer-engine"));
const {
  startProfessionalJobTravel,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-engine"));
const {
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-arrival-engine"));
const {
  startProfessionalJobService,
  updateProfessionalJobChecklistItem,
  completeProfessionalJobService,
  getProfessionalJobExecution,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-execution-engine"));
const { writeProfessionalLocationCache } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-cache"
));
const { respondExtraService } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/at-home-beauty-extra"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const DEST_LAT = 23.3448;
const DEST_LNG = 85.3101;

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

async function prepareOtpVerifiedJob(ctx, manifest) {
  const homeJobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: homeJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });
  const { app } = ctx;
  await acceptProfessionalJobOffer(app, homeJobId, partnerSession(manifest.partners.A));
  await startProfessionalJobTravel(app, homeJobId, partnerSession(manifest.partners.A));
  await writeProfessionalLocationCache(
    app,
    homeJobId,
    {
      latitude: DEST_LAT,
      longitude: DEST_LNG,
      accuracy_m: 8,
      captured_at: new Date().toISOString(),
      professional_row_id: manifest.partners.A,
    },
    { reference_type: "SERVICE_JOB", reference_row_id: serviceJobId }
  );
  await confirmProfessionalJobArrival(app, homeJobId, partnerSession(manifest.partners.A));
  const otpRaw = (await app.cache().segment().getValue("beauty_job_otp:" + serviceJobId)) || "";
  const otpState = JSON.parse(otpRaw);
  await verifyProfessionalJobOtp(
    app,
    homeJobId,
    partnerSession(manifest.partners.A),
    otpState.otp_code
  );
  return { homeJobId, serviceJobId };
}

async function completeMandatoryChecklist(app, jobId, partnerRowId) {
  const execution = await getProfessionalJobExecution(app, jobId, partnerSession(partnerRowId));
  for (const item of execution.checklist) {
    if (item.mandatory && !item.done) {
      await updateProfessionalJobChecklistItem(
        app,
        jobId,
        partnerSession(partnerRowId),
        item.id,
        true
      );
    }
  }
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const manifest = await setupPp004Fixtures();
  const { homeJobId, serviceJobId } = await prepareOtpVerifiedJob(ctx, manifest);
  const session = partnerSession(manifest.partners.A);

  const report = { scenarios: {}, ok: true, note: "PP-007 backend smoke — not real device test" };

  const executionBefore = await getProfessionalJobExecution(app, homeJobId, session);
  report.scenarios.executionReady = {
    ok: executionBefore.can_start_service === true,
    phase: executionBefore.phase,
  };

  const started = await startProfessionalJobService(app, homeJobId, session);
  report.scenarios.startService = {
    ok: started.status === "IN_PROGRESS",
    service_started_at: started.service_started_at,
  };

  const startedAgain = await startProfessionalJobService(app, homeJobId, session);
  report.scenarios.startIdempotent = { ok: startedAgain.idempotent === true };

  const itemId = started.checklist?.[0]?.id || executionBefore.checklist[0]?.id;
  if (itemId) {
    const checklistUpdate = await updateProfessionalJobChecklistItem(
      app,
      homeJobId,
      session,
      itemId,
      true
    );
    report.scenarios.checklistUpdate = { ok: checklistUpdate.done === true, item_id: itemId };
  }

  await completeMandatoryChecklist(app, homeJobId, manifest.partners.A);
  const completed = await completeProfessionalJobService(app, homeJobId, session);
  report.scenarios.completeService = {
    ok: completed.status === "COMPLETED",
    payment_status: completed.payment_status,
  };

  const completedAgain = await completeProfessionalJobService(app, homeJobId, session);
  report.scenarios.completeIdempotent = { ok: completedAgain.idempotent === true };

  const serviceJob = unwrap(
    await zcql.query("SELECT status, payment_status FROM Service_Jobs WHERE ROWID = " + serviceJobId),
    "Service_Jobs"
  )[0];
  report.scenarios.serviceJobSync = {
    ok: String(serviceJob.status).toUpperCase() === "COMPLETED",
    status: serviceJob.status,
    payment_status: serviceJob.payment_status,
  };

  const history = unwrap(
    await zcql.query(
      "SELECT new_status, reason FROM Job_Status_History WHERE professional_job_row_id = " +
        homeJobId +
        " ORDER BY CREATEDTIME ASC"
    ),
    "Job_Status_History"
  );
  const reasons = history.map((row) => row.reason);
  report.scenarios.auditHistory = {
    ok: reasons.includes("SERVICE_STARTED") && reasons.includes("SERVICE_COMPLETED"),
    reasons,
  };

  for (const val of Object.values(report.scenarios)) {
    if (val.ok === false) report.ok = false;
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
