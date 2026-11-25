#!/usr/bin/env node
"use strict";

/**
 * PP-006 Development smoke — arrival + OTP (backend, not real device GPS).
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const {
  setupPp004Fixtures,
  prepareProfessionalJobOffer,
} = require(path.join(__dirname, "pp004-dev-fixtures"));
const {
  startProfessionalJobTravel,
  getCustomerProfessionalTracking,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-location-engine"));
const {
  confirmProfessionalJobArrival,
  verifyProfessionalJobOtp,
  getProfessionalJobArrivalPreview,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-arrival-engine"));
const { writeProfessionalLocationCache } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/professional-location-cache"
));

const DEST_LAT = 23.3448;
const DEST_LNG = 85.3101;

function partnerSession(rowId) {
  return { delivery_partner_id: "dp_" + rowId, role: "delivery_partner", status: "active" };
}

async function main() {
  const ctx = await createDevCatalystClient();
  const { zcql, app } = ctx;
  const manifest = await setupPp004Fixtures();
  const homeJobId = manifest.jobs.homeAccept.professional_job_id;
  const serviceJobId = manifest.references.homeAcceptRef;
  const users = unwrap(await zcql.query("SELECT ROWID FROM Users ORDER BY ROWID ASC LIMIT 1"), "Users");
  const userId = String(users[0].ROWID);

  await prepareProfessionalJobOffer(ctx, {
    professionalJobId: homeJobId,
    assignToPartnerRowId: manifest.partners.A,
    jobType: "HOME_SERVICE",
    referenceRowId: serviceJobId,
  });

  const { acceptProfessionalJobOffer } = require(path.join(
    __dirname,
    "../functions/baylen-api/lib/professional-job-offer-engine"
  ));
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

  const report = { scenarios: {}, ok: true, note: "PP-006 backend smoke — not real device test" };

  const preview = await getProfessionalJobArrivalPreview(
    app,
    homeJobId,
    partnerSession(manifest.partners.A)
  );
  report.scenarios.arrivalPreview = { ok: preview.eligible === true, distance: preview.distance_meters };

  const arrive = await confirmProfessionalJobArrival(app, homeJobId, partnerSession(manifest.partners.A));
  report.scenarios.arrive = { ok: arrive.status === "ARRIVED", status: arrive.status };

  const otpRaw = (await app.cache().segment().getValue("beauty_job_otp:" + serviceJobId)) || "";
  const otpState = JSON.parse(otpRaw);
  const verify = await verifyProfessionalJobOtp(
    app,
    homeJobId,
    partnerSession(manifest.partners.A),
    otpState.otp_code
  );
  report.scenarios.verifyOtp = { ok: verify.status === "OTP_VERIFIED", status: verify.status };

  const customer = await getCustomerProfessionalTracking(app, {
    userId,
    professionalJobId: homeJobId,
  });
  report.scenarios.customerTracking = {
    ok: customer.otp_verified === true,
    job_status: customer.job_status,
    otp_verified: customer.otp_verified,
  };

  try {
    await confirmProfessionalJobArrival(app, homeJobId, partnerSession(manifest.partners.B));
    report.scenarios.wrongPartner = { ok: false };
  } catch (error) {
    report.scenarios.wrongPartner = { ok: error.code === "JOB_NOT_FOUND" };
  }

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
