#!/usr/bin/env node
"use strict";

/**
 * PP-012 Final QA smoke — product + home E2E, concurrency, lifecycle, security, earnings.
 * Development Catalyst only. Not a substitute for real-device GPS testing.
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
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
  getNoShowEligibility,
  reportProfessionalJobNoShow,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-lifecycle"));
const {
  startProfessionalJobPickup,
  confirmProfessionalJobPickupArrival,
  verifyProfessionalJobPickup,
  confirmProfessionalJobPickedUp,
  startProfessionalJobDelivery,
  confirmProfessionalJobDeliveryArrival,
  verifyProfessionalJobDeliveryOtp,
  confirmProfessionalJobDelivered,
  completeProfessionalJobDelivery,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-delivery-engine"));
const {
  startProfessionalJobTravel,
  getCustomerProfessionalTracking,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-engine"));
const {
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-arrival-engine"));
const {
  startProfessionalJobService,
  completeProfessionalJobService,
  updateProfessionalJobChecklistItem,
  getProfessionalJobExecution,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-execution-engine"));
const { writeProfessionalLocationCache } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-cache"
));
const { getPartnerJobDetail } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-job-list"
));
const { findEarningByJob, findInvoiceByJob } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-finance-engine"
));
const { listPartnerNotifications } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-partner-notify"
));
const { buildPartnerDashboard } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/partner-dashboard"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PICKUP_LAT = 23.3505;
const PICKUP_LNG = 85.3205;
const DEST_LAT = 23.3505;
const DEST_LNG = 85.3205;
const HOME_LAT = 23.3448;
const HOME_LNG = 85.3101;

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

async function seedLocation(app, jobId, refType, refId, partnerRowId, lat, lng) {
  await writeProfessionalLocationCache(
    app,
    jobId,
    {
      latitude: lat,
      longitude: lng,
      accuracy_m: 8,
      captured_at: new Date().toISOString(),
      professional_row_id: partnerRowId,
    },
    { reference_type: refType, reference_row_id: refId }
  );
}

async function historyCount(zcql, jobId) {
  const rows = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Job_Status_History WHERE professional_job_row_id = " + jobId
    ),
    "Job_Status_History"
  );
  return rows.length;
}

async function completeProductFlow(ctx, manifest, { cod = false } = {}) {
  const jobKey = cod ? "productCod" : "productPrepaid";
  const refKey = cod ? "codRef" : "prepaidRef";
  const jobId = manifest.jobs[jobKey].professional_job_id;
  const orderId = manifest.references[refKey];
  const session = partnerSession(manifest.partners.A);
  await ctx.updateRow("Outlets", {
    ROWID: manifest.outlet_row_id,
    latitude: PICKUP_LAT,
    longitude: PICKUP_LNG,
  });
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: jobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: orderId,
  });
  await acceptProfessionalJobOffer(ctx.app, jobId, session);
  await startProfessionalJobPickup(ctx.app, jobId, session);
  await seedLocation(ctx.app, jobId, "ORDER", orderId, manifest.partners.A, PICKUP_LAT, PICKUP_LNG);
  await confirmProfessionalJobPickupArrival(ctx.app, jobId, session);
  const pickupOtp = JSON.parse(
    (await ctx.app.cache().segment().getValue("delivery_pickup_otp:" + orderId)) || "{}"
  );
  await verifyProfessionalJobPickup(ctx.app, jobId, session, pickupOtp.otp_code);
  await confirmProfessionalJobPickedUp(ctx.app, jobId, session);
  await startProfessionalJobDelivery(ctx.app, jobId, session);
  await seedLocation(ctx.app, jobId, "ORDER", orderId, manifest.partners.A, DEST_LAT, DEST_LNG);
  const trackingUserId = unwrap(
    await ctx.zcql.query("SELECT user_id FROM Orders WHERE ROWID = " + orderId),
    "Orders"
  )[0]?.user_id;
  const tracking = await getCustomerProfessionalTracking(ctx.app, {
    userId: String(trackingUserId || ""),
    orderId,
  });
  await confirmProfessionalJobDeliveryArrival(ctx.app, jobId, session);
  const dropOtp = JSON.parse(
    (await ctx.app.cache().segment().getValue("delivery_drop_otp:" + orderId)) || "{}"
  );
  await verifyProfessionalJobDeliveryOtp(ctx.app, jobId, session, dropOtp.otp_code);
  await confirmProfessionalJobDelivered(ctx.app, jobId, session);
  const completed = await completeProfessionalJobDelivery(ctx.app, jobId, session);
  const order = unwrap(
    await ctx.zcql.query("SELECT status, payment_status FROM Orders WHERE ROWID = " + orderId),
    "Orders"
  )[0];
  return { jobId, orderId, completed, order, tracking, session };
}

async function completeHomeFlow(ctx, manifest) {
  const jobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  const session = partnerSession(manifest.partners.A);
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: jobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });
  await acceptProfessionalJobOffer(ctx.app, jobId, session);
  await startProfessionalJobTravel(ctx.app, jobId, session);
  await seedLocation(ctx.app, jobId, "SERVICE_JOB", serviceJobId, manifest.partners.A, HOME_LAT, HOME_LNG);
  await confirmProfessionalJobArrival(ctx.app, jobId, session);
  const otpState = JSON.parse(
    (await ctx.app.cache().segment().getValue("beauty_job_otp:" + serviceJobId)) || "{}"
  );
  await verifyProfessionalJobOtp(ctx.app, jobId, session, otpState.otp_code);
  await startProfessionalJobService(ctx.app, jobId, session);
  const execution = await getProfessionalJobExecution(ctx.app, jobId, session);
  for (const item of execution.checklist) {
    if (item.mandatory && !item.done) {
      await updateProfessionalJobChecklistItem(ctx.app, jobId, session, item.id, true);
    }
  }
  const completed = await completeProfessionalJobService(ctx.app, jobId, session);
  const serviceJob = unwrap(
    await ctx.zcql.query("SELECT status, payment_status FROM Service_Jobs WHERE ROWID = " + serviceJobId),
    "Service_Jobs"
  )[0];
  return { jobId, serviceJobId, completed, serviceJob, session };
}

async function expectFailure(promise, { status, code } = {}) {
  try {
    await promise;
    return { ok: false, reason: "expected failure" };
  } catch (error) {
    if (status && error.status !== status) {
      return { ok: false, reason: "status=" + error.status };
    }
    if (code && error.code !== code) {
      return { ok: false, reason: "code=" + error.code };
    }
    return { ok: true };
  }
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { app, zcql } = ctx;
  const manifest = await setupPp004Fixtures();
  const report = {
    ok: true,
    note: "PP-012 final smoke — Dev Catalyst; GPS uses cache coordinates, not real device",
    scenarios: {},
  };

  const prepaid = await completeProductFlow(ctx, manifest, { cod: false });
  const prepaidHistory = await historyCount(zcql, prepaid.jobId);
  const prepaidEarning = await findEarningByJob(app.zcql(), prepaid.jobId);
  const prepaidInvoice = await findInvoiceByJob(app.zcql(), prepaid.jobId);
  report.scenarios.productPrepaidE2E = {
    ok:
      prepaid.completed.status === "COMPLETED" &&
      prepaid.tracking.tracking_allowed === true &&
      prepaidHistory >= 5 &&
      Boolean(prepaidEarning && prepaidInvoice) &&
      prepaid.completed.earning_status === "AVAILABLE",
    job_status: prepaid.completed.status,
    payment_status: prepaid.order.payment_status,
    earning_status: prepaid.completed.earning_status,
    history_rows: prepaidHistory,
  };

  const cod = await completeProductFlow(ctx, manifest, { cod: true });
  report.scenarios.productCodE2E = {
    ok:
      cod.completed.status === "COMPLETED" &&
      cod.completed.earning_status === "PENDING" &&
      String(cod.order.payment_status).toUpperCase() !== "PAID",
    payment_status: cod.order.payment_status,
    earning_status: cod.completed.earning_status,
  };

  const home = await completeHomeFlow(ctx, manifest);
  const homeHistory = await historyCount(zcql, home.jobId);
  const homeEarning = await findEarningByJob(app.zcql(), home.jobId);
  report.scenarios.homeServiceE2E = {
    ok:
      home.completed.status === "COMPLETED" &&
      homeHistory >= 5 &&
      Boolean(homeEarning) &&
      home.completed.finance_settled === true,
    service_job_status: home.serviceJob.status,
    history_rows: homeHistory,
  };

  const raceJobId = manifest.jobs.homeReject.professional_job_id;
  const raceRef = manifest.references.homeRejectRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: raceJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: raceRef,
  });
  const [raceA, raceB] = await Promise.allSettled([
    acceptProfessionalJobOffer(app, raceJobId, partnerSession(manifest.partners.A)),
    acceptProfessionalJobOffer(app, raceJobId, partnerSession(manifest.partners.B)),
  ]);
  const raceSuccess = [raceA, raceB].filter((r) => r.status === "fulfilled").length;
  const raceFail = [raceA, raceB].filter((r) => r.status === "rejected").length;
  report.scenarios.concurrentAccept = {
    ok: raceSuccess === 1 && raceFail === 1,
    success_count: raceSuccess,
    fail_count: raceFail,
  };

  const dupAccept = await acceptProfessionalJobOffer(app, raceJobId, partnerSession(manifest.partners.A));
  report.scenarios.duplicateAccept = {
    ok: dupAccept.success === true && dupAccept.new_status === "ACCEPTED",
    status: dupAccept.new_status,
  };

  const rejectJobId = manifest.jobs.productConcur.professional_job_id;
  const rejectRef = manifest.references.concurRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: rejectJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: rejectRef,
  });
  const firstReject = await rejectProfessionalJobOffer(
    app,
    rejectJobId,
    partnerSession(manifest.partners.A),
    "OTHER",
    null
  );
  report.scenarios.rejectAndReassign = {
    ok: firstReject.success === true,
    reassigned_status: firstReject.status,
  };

  const cancelJobId = manifest.jobs.productExpire.professional_job_id;
  const cancelRef = manifest.references.expireRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: cancelJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: cancelRef,
  });
  await acceptProfessionalJobOffer(app, cancelJobId, partnerSession(manifest.partners.A));
  await cancelProfessionalJobByPartner(app, cancelJobId, partnerSession(manifest.partners.A), {
    reason_code: "CUSTOMER_REQUEST",
  });
  const cancelAgain = await cancelProfessionalJob(app, cancelJobId, {
    actorId: "dp_" + manifest.partners.A,
    actorRole: "PROFESSIONAL",
    reason: "repeat",
    syncReference: false,
  });
  report.scenarios.cancellationIdempotent = {
    ok: cancelAgain.idempotent === true && cancelAgain.status === "CANCELLED",
  };

  const noShowJobId = manifest.jobs.homeReject.professional_job_id;
  const noShowRef = manifest.references.homeRejectRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: noShowJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: noShowRef,
  });
  await acceptProfessionalJobOffer(app, noShowJobId, partnerSession(manifest.partners.A));
  await startProfessionalJobTravel(app, noShowJobId, partnerSession(manifest.partners.A));
  await seedLocation(app, noShowJobId, "SERVICE_JOB", noShowRef, manifest.partners.A, HOME_LAT, HOME_LNG);
  await confirmProfessionalJobArrival(app, noShowJobId, partnerSession(manifest.partners.A));
  const eligibility = await getNoShowEligibility(app, noShowJobId, partnerSession(manifest.partners.A));
  const noShow = await reportProfessionalJobNoShow(app, noShowJobId, partnerSession(manifest.partners.A));
  report.scenarios.noShowFlow = {
    ok: eligibility.eligible === true && noShow.status === "CANCELLED",
    eligibility: eligibility.eligible,
    status: noShow.status,
  };

  report.scenarios.securityWrongPartner = {
    ok: (
      await expectFailure(
        getPartnerJobDetail(app.zcql(), manifest.partners.B, prepaid.jobId, app),
        { status: 404 }
      )
    ).ok,
  };

  const notifications = await listPartnerNotifications(app.zcql(), manifest.partners.A, { limit: 10 });
  report.scenarios.notifications = {
    ok: Array.isArray(notifications),
    count: notifications.length,
  };

  const financeDup = await completeProfessionalJobDelivery(app, prepaid.jobId, prepaid.session);
  report.scenarios.duplicateEarnings = {
    ok: financeDup.finance_idempotent === true,
  };

  const dashboard = await buildPartnerDashboard({ catalystApp: app }, "dp_" + manifest.partners.A);
  report.scenarios.dashboardEarnings = {
    ok: dashboard.stats.available_earnings >= 0 && dashboard.stats.pending_earnings >= 0,
    available: dashboard.stats.available_earnings,
    pending: dashboard.stats.pending_earnings,
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
