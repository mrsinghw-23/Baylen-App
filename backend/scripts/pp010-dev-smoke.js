#!/usr/bin/env node
"use strict";

/**
 * PP-010 Development smoke — notifications, support, cancel, no-show.
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
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-arrival-engine"));
const { writeProfessionalLocationCache } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-cache"
));
const {
  cancelProfessionalJobByPartner,
  reportProfessionalJobNoShow,
  getNoShowEligibility,
  createPartnerSupportTicket,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-lifecycle"));
const {
  listPartnerNotifications,
  markPartnerNotificationsRead,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-partner-notify"));
const { buildPartnerDashboard } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/partner-dashboard"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";
process.env.PROFESSIONAL_NO_SHOW_WAIT_MINUTES = "0";

const HOME_LAT = 23.3448;
const HOME_LNG = 85.3101;

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

async function prepareArrivedHomeJob(ctx, manifest) {
  const homeJobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  const session = partnerSession(manifest.partners.A);
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: homeJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });
  await acceptProfessionalJobOffer(ctx.app, homeJobId, session);
  await startProfessionalJobTravel(ctx.app, homeJobId, session);
  await writeProfessionalLocationCache(
    ctx.app,
    homeJobId,
    {
      latitude: HOME_LAT,
      longitude: HOME_LNG,
      accuracy_m: 8,
      captured_at: new Date().toISOString(),
      professional_row_id: manifest.partners.A,
    },
    { reference_type: "SERVICE_JOB", reference_row_id: serviceJobId }
  );
  await confirmProfessionalJobArrival(ctx.app, homeJobId, session);
  return { homeJobId, serviceJobId, session };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { app } = ctx;
  const manifest = await setupPp004Fixtures();
  const report = { scenarios: {}, ok: true, note: "PP-010 backend smoke — not real device test" };

  const arrived = await prepareArrivedHomeJob(ctx, manifest);
  const support = await createPartnerSupportTicket(app, arrived.session, {
    category: "JOB_ISSUE",
    message: "Customer not responding at door",
    professional_job_id: arrived.homeJobId,
  });
  report.scenarios.supportTicket = {
    ok: Boolean(support.ticket_id && support.ticket_number),
    ticket_number: support.ticket_number,
  };

  const notifications = await listPartnerNotifications(app.zcql(), manifest.partners.A, { limit: 5 });
  report.scenarios.notifications = {
    ok: notifications.length >= 1,
    count: notifications.length,
    latest_type: notifications[0]?.type || "",
  };

  if (notifications[0]?.id) {
    const read = await markPartnerNotificationsRead(app, manifest.partners.A, [notifications[0].id]);
    report.scenarios.notificationRead = { ok: read.updated >= 1 };
  } else {
    report.scenarios.notificationRead = { ok: false };
  }

  const eligibility = await getNoShowEligibility(app, arrived.homeJobId, arrived.session);
  report.scenarios.noShowEligibility = {
    ok: eligibility.eligible === true,
    remaining_seconds: eligibility.remaining_seconds,
  };

  const noShow = await reportProfessionalJobNoShow(app, arrived.homeJobId, arrived.session, {
    note: "Customer unavailable after wait",
  });
  const serviceJob = unwrap(
    await ctx.zcql.query(
      "SELECT status FROM Service_Jobs WHERE ROWID = " + arrived.serviceJobId
    ),
    "Service_Jobs"
  )[0];
  report.scenarios.noShow = {
    ok: noShow.success === true && String(serviceJob.status).toUpperCase() === "NO_SHOW",
    professional_status: noShow.status,
    service_job_status: serviceJob.status,
  };

  const cancelJobId = manifest.jobs.homeReject.professional_job_id;
  const cancelRef = manifest.references.homeRejectRef;
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: cancelJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: cancelRef,
  });
  await acceptProfessionalJobOffer(app, cancelJobId, arrived.session);
  const cancelled = await cancelProfessionalJobByPartner(app, cancelJobId, arrived.session, {
    reason_code: "CUSTOMER_REQUEST",
    note: "Customer asked to cancel",
  });
  report.scenarios.partnerCancel = {
    ok: cancelled.success === true && cancelled.status === "CANCELLED",
    status: cancelled.status,
  };

  const dashboard = await buildPartnerDashboard({ catalystApp: app }, "dp_" + manifest.partners.A);
  report.scenarios.dashboardUnread = {
    ok: typeof dashboard.stats.unread_notifications === "number",
    unread_notifications: dashboard.stats.unread_notifications,
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
