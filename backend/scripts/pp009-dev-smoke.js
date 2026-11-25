#!/usr/bin/env node
"use strict";

/**
 * PP-009 Development smoke — invoice + earnings on job completion.
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
  completeProfessionalJobDelivery,
  startProfessionalJobPickup,
  confirmProfessionalJobPickupArrival,
  verifyProfessionalJobPickup,
  confirmProfessionalJobPickedUp,
  startProfessionalJobDelivery,
  confirmProfessionalJobDeliveryArrival,
  verifyProfessionalJobDeliveryOtp,
  confirmProfessionalJobDelivered,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-delivery-engine"));
const {
  startProfessionalJobTravel,
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
const { buildPartnerDashboard } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/partner-dashboard"
));
const { findEarningByJob, findInvoiceByJob } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-finance-engine"
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

async function ensureOutletCoords(ctx, outletRowId) {
  await ctx.updateRow("Outlets", {
    ROWID: outletRowId,
    latitude: PICKUP_LAT,
    longitude: PICKUP_LNG,
  });
}

async function seedLocation(app, jobId, orderId, partnerRowId, lat, lng) {
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
    { reference_type: "ORDER", reference_row_id: orderId }
  );
}

async function completeProductJob(ctx, manifest, { cod = false } = {}) {
  const jobKey = cod ? "productCod" : "productPrepaid";
  const refKey = cod ? "codRef" : "prepaidRef";
  const productJobId = manifest.jobs[jobKey].professional_job_id;
  const orderId = manifest.references[refKey];
  const session = partnerSession(manifest.partners.A);
  await ensureOutletCoords(ctx, manifest.outlet_row_id);
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: productJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: orderId,
  });
  await acceptProfessionalJobOffer(ctx.app, productJobId, session);
  await startProfessionalJobPickup(ctx.app, productJobId, session);
  await seedLocation(ctx.app, productJobId, orderId, manifest.partners.A, PICKUP_LAT, PICKUP_LNG);
  await confirmProfessionalJobPickupArrival(ctx.app, productJobId, session);
  const pickupOtpRaw = (await ctx.app.cache().segment().getValue("delivery_pickup_otp:" + orderId)) || "";
  await verifyProfessionalJobPickup(ctx.app, productJobId, session, JSON.parse(pickupOtpRaw).otp_code);
  await confirmProfessionalJobPickedUp(ctx.app, productJobId, session);
  await startProfessionalJobDelivery(ctx.app, productJobId, session);
  await seedLocation(ctx.app, productJobId, orderId, manifest.partners.A, DEST_LAT, DEST_LNG);
  await confirmProfessionalJobDeliveryArrival(ctx.app, productJobId, session);
  const dropOtpRaw = (await ctx.app.cache().segment().getValue("delivery_drop_otp:" + orderId)) || "";
  await verifyProfessionalJobDeliveryOtp(ctx.app, productJobId, session, JSON.parse(dropOtpRaw).otp_code);
  await confirmProfessionalJobDelivered(ctx.app, productJobId, session);
  const completed = await completeProfessionalJobDelivery(ctx.app, productJobId, session);
  return { productJobId, orderId, completed, session };
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

async function completeHomeJob(ctx, manifest) {
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
  const otpRaw = (await ctx.app.cache().segment().getValue("beauty_job_otp:" + serviceJobId)) || "";
  await verifyProfessionalJobOtp(ctx.app, homeJobId, session, JSON.parse(otpRaw).otp_code);
  await startProfessionalJobService(ctx.app, homeJobId, session);
  await completeMandatoryChecklist(ctx.app, homeJobId, manifest.partners.A);
  const completed = await completeProfessionalJobService(ctx.app, homeJobId, session);
  return { homeJobId, completed, session };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const manifest = await setupPp004Fixtures();
  const report = { scenarios: {}, ok: true, note: "PP-009 backend smoke — not real device test" };

  const prepaid = await completeProductJob(ctx, manifest, { cod: false });
  report.scenarios.prepaidFinance = {
    ok: prepaid.completed.finance_settled === true && prepaid.completed.invoice_status === "GENERATED",
    earning_status: prepaid.completed.earning_status,
    net_amount: prepaid.completed.net_amount,
    payment_status: prepaid.completed.payment_status,
  };

  const earning = await findEarningByJob(app.zcql(), prepaid.productJobId);
  const invoice = await findInvoiceByJob(app.zcql(), prepaid.productJobId);
  report.scenarios.ledgerRows = {
    ok: Boolean(earning && invoice),
    earning_number: earning?.earning_number || "",
    invoice_number: invoice?.invoice_number || "",
  };

  const prepaidAgain = await completeProfessionalJobDelivery(
    app,
    prepaid.productJobId,
    prepaid.session
  );
  report.scenarios.duplicateFinance = {
    ok: prepaidAgain.idempotent === true && prepaidAgain.finance_idempotent === true,
  };

  const cod = await completeProductJob(ctx, manifest, { cod: true });
  const codOrder = unwrap(
    await zcql.query("SELECT payment_status FROM Orders WHERE ROWID = " + cod.orderId),
    "Orders"
  )[0];
  report.scenarios.codFinance = {
    ok:
      cod.completed.finance_settled === true &&
      cod.completed.earning_status === "PENDING" &&
      String(codOrder.payment_status).toUpperCase() !== "PAID",
    payment_status: codOrder.payment_status,
    earning_status: cod.completed.earning_status,
  };

  const home = await completeHomeJob(ctx, manifest);
  report.scenarios.homeFinance = {
    ok: home.completed.finance_settled === true && home.completed.earning_status === "AVAILABLE",
    net_amount: home.completed.net_amount,
  };

  const dashboard = await buildPartnerDashboard({ catalystApp: app }, "dp_" + manifest.partners.A);
  report.scenarios.dashboard = {
    ok: dashboard.stats.earnings_today >= 0,
    earnings_today: dashboard.stats.earnings_today,
    pending_earnings: dashboard.stats.pending_earnings,
    available_earnings: dashboard.stats.available_earnings,
    completed_today: dashboard.stats.completed_today,
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
