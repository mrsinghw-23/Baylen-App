#!/usr/bin/env node
"use strict";

/**
 * PP-008 Development smoke — product delivery execution.
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
  startProfessionalJobPickup,
  confirmProfessionalJobPickupArrival,
  verifyProfessionalJobPickup,
  confirmProfessionalJobPickedUp,
  startProfessionalJobDelivery,
  confirmProfessionalJobDeliveryArrival,
  verifyProfessionalJobDeliveryOtp,
  confirmProfessionalJobDelivered,
  completeProfessionalJobDelivery,
  getProfessionalJobDeliveryExecution,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-delivery-engine"));
const { writeProfessionalLocationCache } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-cache"
));
const { getCustomerProfessionalTracking } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-engine"
));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PICKUP_LAT = 23.3505;
const PICKUP_LNG = 85.3205;
const DEST_LAT = 23.3505;
const DEST_LNG = 85.3205;

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

async function prepareAcceptedProductJob(ctx, manifest, { cod = false } = {}) {
  const jobKey = cod ? "productCod" : "productPrepaid";
  const refKey = cod ? "codRef" : "prepaidRef";
  const productJobId = manifest.jobs[jobKey].professional_job_id;
  const orderId = manifest.references[refKey];
  await ensureOutletCoords(ctx, manifest.outlet_row_id);
  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: productJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "PRODUCT_DELIVERY",
    referenceRowId: orderId,
  });
  await acceptProfessionalJobOffer(ctx.app, productJobId, partnerSession(manifest.partners.A));
  return { productJobId, orderId };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const manifest = await setupPp004Fixtures();
  const { productJobId, orderId } = await prepareAcceptedProductJob(ctx, manifest);
  const session = partnerSession(manifest.partners.A);
  const report = { scenarios: {}, ok: true, note: "PP-008 backend smoke — not real device test" };

  const prepaidExec = await getProfessionalJobDeliveryExecution(app, productJobId, session);
  report.scenarios.executionReady = {
    ok: prepaidExec.can_start_pickup === true,
    phase: prepaidExec.phase,
  };

  const pickupStart = await startProfessionalJobPickup(app, productJobId, session);
  report.scenarios.startPickup = { ok: pickupStart.status === "GOING_TO_PICKUP" };

  await seedLocation(app, productJobId, orderId, manifest.partners.A, PICKUP_LAT, PICKUP_LNG);
  const pickupArrive = await confirmProfessionalJobPickupArrival(app, productJobId, session);
  report.scenarios.pickupArrive = { ok: pickupArrive.status === "ARRIVED_PICKUP" };

  const pickupOtpRaw = (await app.cache().segment().getValue("delivery_pickup_otp:" + orderId)) || "";
  const pickupOtp = JSON.parse(pickupOtpRaw);
  const pickupVerify = await verifyProfessionalJobPickup(
    app,
    productJobId,
    session,
    pickupOtp.otp_code
  );
  report.scenarios.pickupVerify = { ok: pickupVerify.status === "PICKUP_VERIFIED" };

  const pickedUp = await confirmProfessionalJobPickedUp(app, productJobId, session);
  report.scenarios.pickedUp = { ok: pickedUp.status === "PICKED_UP" };

  const startDelivery = await startProfessionalJobDelivery(app, productJobId, session);
  report.scenarios.startDelivery = { ok: startDelivery.status === "EN_ROUTE" };

  const userRow = unwrap(await zcql.query("SELECT ROWID FROM Users ORDER BY ROWID ASC LIMIT 1"), "Users")[0];
  const tracking = await getCustomerProfessionalTracking(app, {
    userId: String(userRow.ROWID),
    orderId,
  });
  report.scenarios.customerTracking = { ok: tracking.tracking_allowed === true };

  await seedLocation(app, productJobId, orderId, manifest.partners.A, DEST_LAT, DEST_LNG);
  const deliveryArrive = await confirmProfessionalJobDeliveryArrival(app, productJobId, session);
  report.scenarios.deliveryArrive = { ok: deliveryArrive.status === "ARRIVED" };

  const dropOtpRaw = (await app.cache().segment().getValue("delivery_drop_otp:" + orderId)) || "";
  const dropOtp = JSON.parse(dropOtpRaw);
  const deliveryVerify = await verifyProfessionalJobDeliveryOtp(
    app,
    productJobId,
    session,
    dropOtp.otp_code
  );
  report.scenarios.deliveryOtp = { ok: deliveryVerify.status === "DELIVERY_VERIFIED" };

  const delivered = await confirmProfessionalJobDelivered(app, productJobId, session);
  report.scenarios.delivered = { ok: delivered.status === "DELIVERED" };

  const completed = await completeProfessionalJobDelivery(app, productJobId, session);
  report.scenarios.completed = {
    ok: completed.status === "COMPLETED",
    payment_status: completed.payment_status,
  };

  const completedAgain = await completeProfessionalJobDelivery(app, productJobId, session);
  report.scenarios.completeIdempotent = { ok: completedAgain.idempotent === true };

  const order = unwrap(
    await zcql.query("SELECT status, payment_status FROM Orders WHERE ROWID = " + orderId),
    "Orders"
  )[0];
  report.scenarios.orderSync = {
    ok: String(order.status).toUpperCase() === "DELIVERED",
    payment_status: order.payment_status,
  };

  const { productJobId: codJobId, orderId: codOrderId } = await prepareAcceptedProductJob(ctx, manifest, {
    cod: true,
  });
  await startProfessionalJobPickup(app, codJobId, session);
  const codOrder = unwrap(
    await zcql.query("SELECT payment_status FROM Orders WHERE ROWID = " + codOrderId),
    "Orders"
  )[0];
  report.scenarios.codPending = {
    ok: String(codOrder.payment_status).toUpperCase() !== "PAID",
    payment_status: codOrder.payment_status,
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
