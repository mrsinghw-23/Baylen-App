#!/usr/bin/env node
"use strict";

/**
 * PP-011 Security smoke — adversarial professional platform checks.
 */

const path = require("path");
const { createDevCatalystClient } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const {
  acceptProfessionalJobOffer,
  rejectProfessionalJobOffer,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-offer-engine"));
const {
  cancelProfessionalJobByPartner,
  cancelProfessionalJob,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-lifecycle"));
const {
  startProfessionalJobService,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-execution-engine"));
const {
  getCustomerProfessionalTracking,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-engine"));
const { getPartnerJobDetail } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-job-list"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

function partnerSession(rowId, status = "active") {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status };
}

async function expectNotFound(promise) {
  try {
    await promise;
    return false;
  } catch (error) {
    return error.status === 404 || error.code === "JOB_NOT_FOUND";
  }
}

async function expectForbidden(promise) {
  try {
    await promise;
    return false;
  } catch (error) {
    return error.status === 403;
  }
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { app } = ctx;
  const manifest = await setupPp004Fixtures();
  const report = { scenarios: {}, ok: true, note: "PP-011 security smoke — not real device test" };

  const homeJobId = manifest.jobs.homeAccept.professional_job_id;
  const homeRef = manifest.references.homeAcceptRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: homeJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: homeRef,
  });
  await acceptProfessionalJobOffer(app, homeJobId, partnerSession(manifest.partners.A));

  report.scenarios.wrongPartnerDetail = {
    ok: await expectNotFound(
      getPartnerJobDetail(app.zcql(), manifest.partners.B, homeJobId, app)
    ),
  };

  report.scenarios.wrongPartnerCancel = {
    ok: await expectNotFound(
      cancelProfessionalJobByPartner(app, homeJobId, partnerSession(manifest.partners.B), {
        reason_code: "OTHER",
      })
    ),
  };

  const rejectJobId = manifest.jobs.homeReject.professional_job_id;
  const rejectRef = manifest.references.homeRejectRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: rejectJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: rejectRef,
  });
  await rejectProfessionalJobOffer(app, rejectJobId, partnerSession(manifest.partners.A), "OTHER", null);
  report.scenarios.reassignedPartnerBlocked = {
    ok: await expectNotFound(
      cancelProfessionalJobByPartner(app, rejectJobId, partnerSession(manifest.partners.A), {
        reason_code: "OTHER",
      })
    ),
  };

  const { updateRow } = ctx;
  await updateRow("Delivery_Partners", {
    ROWID: manifest.partners.A,
    status: "pending_kyc",
  });
  report.scenarios.pendingKycExecutionBlocked = {
    ok: await expectForbidden(
      startProfessionalJobService(app, homeJobId, partnerSession(manifest.partners.A))
    ),
  };
  await updateRow("Delivery_Partners", {
    ROWID: manifest.partners.A,
    status: "active",
  });

  report.scenarios.customerTrackingWrongUser = {
    ok: await expectNotFound(
      getCustomerProfessionalTracking(app, {
        userId: "99999999999999999",
        professionalJobId: homeJobId,
      })
    ),
  };

  await cancelProfessionalJobByPartner(app, homeJobId, partnerSession(manifest.partners.A), {
    reason_code: "CUSTOMER_REQUEST",
  });
  const cancelAgain = await cancelProfessionalJob(app, homeJobId, {
    actorId: "dp_" + manifest.partners.A,
    actorRole: "PROFESSIONAL",
    reason: "repeat",
    syncReference: false,
  });
  report.scenarios.duplicateCancelIdempotent = {
    ok: cancelAgain.idempotent === true && cancelAgain.status === "CANCELLED",
    status: cancelAgain.status,
  };

  for (const [name, scenario] of Object.entries(report.scenarios)) {
    if (!scenario.ok) {
      report.ok = false;
      console.error("FAIL:", name, scenario);
    }
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
