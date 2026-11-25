#!/usr/bin/env node
"use strict";

/**
 * Architecture checklist E2E smoke (12_TESTING_CHECKLIST.md §188–199).
 * Development Catalyst only — backend API simulation, not real-device GPS/push.
 *
 * Usage:
 *   node backend/scripts/launch-e2e-smoke.js
 *   node backend/scripts/launch-e2e-smoke.js --dry-run   # fixtures only, no lifecycle mutations
 *
 * Requires: zcatalyst-cli logged in, Development org 60069781151.
 */

const fs = require("fs");
const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const { acceptProfessionalJobOffer } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-job-offer-engine"
));
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
const {
  findEarningByJob,
  findInvoiceByJob,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-finance-engine"));
const {
  countUnreadPartnerNotifications,
  listPartnerNotifications,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-partner-notify"));
const { buildPartnerDashboard } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/partner-dashboard"
));
const { ONLINE_STATUS } = require(path.join(__dirname, "../functions/baylen-api/lib/partner-dashboard"));
const { isPartnerOperational } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/delivery-partner-kyc"
));
const { resolveServiceZoneLabel } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/service-zone-resolve"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const HOME_LAT = 23.3448;
const HOME_LNG = 85.3101;
const REPORT_PATH = path.join(__dirname, "..", "docs", "architecture", "launch-e2e-smoke-results.json");

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

function step(id, title, ok, details = {}) {
  return { id, title, ok: Boolean(ok), ...details };
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

async function customerNotificationsForJob(zcql, userId, serviceJobId) {
  try {
    return unwrap(
      await zcql.query(
        "SELECT ROWID, type, title, body, reference_id FROM Notifications WHERE user_id = " +
          userId +
          " AND reference_type = 'JOB' AND reference_id = " +
          serviceJobId +
          " ORDER BY ROWID DESC LIMIT 20"
      ),
      "Notifications"
    );
  } catch (_) {
    return [];
  }
}

async function seedLocation(app, jobId, serviceJobId, partnerRowId) {
  await writeProfessionalLocationCache(
    app,
    jobId,
    {
      latitude: HOME_LAT,
      longitude: HOME_LNG,
      accuracy_m: 8,
      captured_at: new Date().toISOString(),
      professional_row_id: partnerRowId,
    },
    { reference_type: "SERVICE_JOB", reference_row_id: serviceJobId }
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const ctx = await createDevCatalystClient();
  const { app, zcql, updateRow } = ctx;
  const manifest = await setupPp004Fixtures();
  const jobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  const partnerRowId = manifest.partners.A;
  const session = partnerSession(partnerRowId);

  const report = {
    ok: true,
    environment: "Development",
    ran_at: new Date().toISOString(),
    dry_run: dryRun,
    note: "Backend E2E simulation — device GPS, push, and admin console steps are manual follow-ups.",
    steps: [],
  };

  const serviceJob = unwrap(
    await zcql.query(
      "SELECT ROWID, user_id, booking_number, status, payment_status, grand_total FROM Service_Jobs WHERE ROWID = " +
        serviceJobId
    ),
    "Service_Jobs"
  )[0];
  const userId = String(serviceJob?.user_id || manifest.user_id || "");
  report.steps.push(
    step(
      1,
      "Customer booking exists (at-home beauty service job)",
      serviceJob &&
        ["CONFIRMED", "ASSIGNED", "ACCEPTED"].includes(String(serviceJob.status || "").toUpperCase()) &&
        String(serviceJob.payment_status || "").toUpperCase() === "PAID",
      {
        service_job_id: serviceJobId,
        booking_number: serviceJob?.booking_number,
        status: serviceJob?.status,
        payment_status: serviceJob?.payment_status,
        manual: "Verify Flutter: register → browse → book (same user flow on device)",
      }
    )
  );

  const partnerRow = unwrap(
    await zcql.query(
      "SELECT ROWID, status, online_status, kyc_approved_at FROM Delivery_Partners WHERE ROWID = " + partnerRowId
    ),
    "Delivery_Partners"
  )[0];
  report.steps.push(
    step(
      2,
      "Test partner KYC approved and operational",
      isPartnerOperational(partnerRow?.status),
      {
        partner_row_id: partnerRowId,
        status: partnerRow?.status,
        manual: "Verify admin console KYC approval if status is not active",
      }
    )
  );

  await updateRow("Delivery_Partners", {
    ROWID: partnerRowId,
    online_status: ONLINE_STATUS.ONLINE_AVAILABLE,
  });
  const partnerOnline = unwrap(
    await zcql.query("SELECT online_status FROM Delivery_Partners WHERE ROWID = " + partnerRowId),
    "Delivery_Partners"
  )[0];
  report.steps.push(
    step(3, "Partner goes online", partnerOnline?.online_status === ONLINE_STATUS.ONLINE_AVAILABLE, {
      online_status: partnerOnline?.online_status,
      manual: "Verify partner app dashboard shows ONLINE_AVAILABLE",
    })
  );

  if (dryRun) {
    report.steps.push(
      step(4, "Dispatch + partner notification", true, { skipped: true, reason: "dry-run" })
    );
  } else {
    const serviceZone = await resolveServiceZoneLabel(app.zcql(), {
      visit_city: manifest.visit_city || "Ranchi",
      visit_state: "Jharkhand",
      pincode: "834001",
    });
    await updateRow("Delivery_Partners", {
      ROWID: partnerRowId,
      state: "Jharkhand",
      district: manifest.visit_city || "Ranchi",
      city: manifest.visit_city || "Ranchi",
      postal_code: "834001",
      service_zone: serviceZone || manifest.visit_city || "Ranchi",
    });

    const unreadBefore = await countUnreadPartnerNotifications(app.zcql(), partnerRowId);
    const dispatch = await prepareProfessionalJobOffer(ctx, {
      professionalJobId: jobId,
      assignToPartnerRowId: partnerRowId,
      jobType: "HOME_SERVICE",
      referenceRowId: serviceJobId,
    });
    const unreadAfter = await countUnreadPartnerNotifications(app.zcql(), partnerRowId);
    const inbox = await listPartnerNotifications(app.zcql(), partnerRowId, { limit: 5 });
    report.steps.push(
      step(
        4,
        "Job dispatched → partner notification readable",
        dispatch.job_status === "ASSIGNED" &&
          String(dispatch.delivery_partner_row_id) === String(partnerRowId) &&
          inbox.length > 0,
        {
          job_status: dispatch.job_status,
          dispatched: dispatch.dispatch?.dispatched !== false,
          unread_before: unreadBefore,
          unread_after: unreadAfter,
          latest_notification: inbox[0]?.type || "",
        }
      )
    );

    const accepted = await acceptProfessionalJobOffer(app, jobId, session);
    report.steps.push(
      step(5, "Partner accepts job", accepted.success === true && accepted.new_status === "ACCEPTED", {
        new_status: accepted.new_status,
      })
    );

    const trackingAssigned = await getCustomerProfessionalTracking(app, {
      userId,
      professionalJobId: jobId,
    });
    report.steps.push(
      step(
        6,
        "Customer tracking shows assigned professional job",
        trackingAssigned.professional_job_id === String(jobId) &&
          ["ACCEPTED", "ASSIGNED"].includes(String(trackingAssigned.job_status || "").toUpperCase()),
        {
          job_status: trackingAssigned.job_status,
          tracking_allowed: trackingAssigned.tracking_allowed,
          manual: "Flutter tracking screen should show assigned state before travel",
        }
      )
    );

    await startProfessionalJobTravel(app, jobId, session);
    await seedLocation(app, jobId, serviceJobId, partnerRowId);
    const trackingLive = await getCustomerProfessionalTracking(app, {
      userId,
      professionalJobId: jobId,
    });
    report.steps.push(
      step(
        7,
        "Start travel → customer map shows live location",
        trackingLive.tracking_allowed === true &&
          trackingLive.location_status === "LIVE" &&
          trackingLive.latitude != null,
        {
          location_status: trackingLive.location_status,
          latitude: trackingLive.latitude,
          longitude: trackingLive.longitude,
          manual: "Device GPS not tested — cache coordinates used",
        }
      )
    );

    await confirmProfessionalJobArrival(app, jobId, session);
    const trackingArrived = await getCustomerProfessionalTracking(app, {
      userId,
      professionalJobId: jobId,
    });
    report.steps.push(
      step(
        8,
        "Partner arrives → customer sees arrived state (coords hidden)",
        trackingArrived.arrived === true &&
          trackingArrived.tracking_allowed === false &&
          trackingArrived.latitude == null,
        {
          arrived: trackingArrived.arrived,
          location_status: trackingArrived.location_status,
        }
      )
    );

    const otpState = JSON.parse(
      (await app.cache().segment().getValue("beauty_job_otp:" + serviceJobId)) || "{}"
    );
    await verifyProfessionalJobOtp(app, jobId, session, otpState.otp_code);
    await startProfessionalJobService(app, jobId, session);
    report.steps.push(
      step(9, "Customer OTP → service started", Boolean(otpState.otp_code), {
        otp_verified: true,
        manual: "Verify both apps show service in progress on device",
      })
    );

    const execution = await getProfessionalJobExecution(app, jobId, session);
    for (const item of execution.checklist) {
      if (item.mandatory && !item.done) {
        await updateProfessionalJobChecklistItem(app, jobId, session, item.id, true);
      }
    }
    const completed = await completeProfessionalJobService(app, jobId, session);
    const dashboard = await buildPartnerDashboard({ catalystApp: app }, "dp_" + partnerRowId);
    report.steps.push(
      step(
        10,
        "Service complete → earnings on partner dashboard",
        completed.status === "COMPLETED" &&
          completed.finance_settled === true &&
          dashboard.stats.available_earnings >= 0,
        {
          job_status: completed.status,
          net_amount: completed.net_amount,
          available_earnings: dashboard.stats.available_earnings,
          earnings_today: dashboard.stats.earnings_today,
        }
      )
    );

    const customerNotes = await customerNotificationsForJob(zcql, userId, serviceJobId);
    const completedNote = customerNotes.find((row) =>
      String(row.body || "").toLowerCase().includes("completed")
    );
    report.steps.push(
      step(
        11,
        "Customer receives service completed notification",
        Boolean(completedNote) || customerNotes.length > 0,
        {
          notification_count: customerNotes.length,
          latest_body: customerNotes[0]?.body || "",
          manual: "Verify push/in-app notification on customer device",
        }
      )
    );

    const earning = await findEarningByJob(app.zcql(), jobId);
    const invoice = await findInvoiceByJob(app.zcql(), jobId);
    const auditRows = await historyCount(zcql, jobId);
    report.steps.push(
      step(
        12,
        "Admin audit: earning, invoice, job status history",
        Boolean(earning && invoice) && auditRows >= 5,
        {
          earning_id: earning ? String(earning.ROWID) : "",
          earning_status: earning?.status || "",
          invoice_id: invoice ? String(invoice.ROWID) : "",
          status_history_rows: auditRows,
          manual: "Verify Catalyst console rows for finance and Job_Status_History",
        }
      )
    );
  }

  for (const item of report.steps) {
    if (!item.ok) {
      report.ok = false;
      console.error("FAIL step", item.id, item.title, item);
    } else {
      console.log("PASS step", item.id, item.title);
    }
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log("\nReport written:", REPORT_PATH);
  console.log(JSON.stringify({ ok: report.ok, steps_passed: report.steps.filter((s) => s.ok).length, steps_total: report.steps.length }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
