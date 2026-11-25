#!/usr/bin/env node
"use strict";

/**
 * PP-004 Development fixtures — deterministic partners + professional jobs.
 *
 * Usage:
 *   node backend/scripts/pp004-dev-fixtures.js
 *   node backend/scripts/pp004-dev-fixtures.js --restore-pp003
 *
 * Development only. Never import from production runtime.
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const { DP_SELECT } = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner"));
const {
  ensureHomeServiceJob,
  ensureProductDeliveryJob,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-job-engine"));
const {
  dispatchProfessionalJob,
  dispatchPendingJobs,
} = require(path.join(__dirname, "../functions/baylen-api/lib/professional-dispatch-engine"));

process.env.PROFESSIONAL_JOB_LOCK_LOCAL = "true";

const PHONE_A = "+919825391754";
const PHONE_B = "+919876543220";
const PHONE_C = "+919876543211";
const PHONE_D = "+919876543221";

const BOOKING_HOME_ACCEPT = "PP004-HOME-ACCEPT";
const BOOKING_HOME_REJECT = "PP004-HOME-REJECT";
const ORDER_PREPAID = "PP004-ORDER-PREPAID";
const ORDER_COD = "PP004-ORDER-COD";
const ORDER_CONCUR = "PP004-ORDER-CONCUR";
const ORDER_EXPIRE = "PP004-ORDER-EXPIRE";

const SERVICE_REF = "36851000000380001";

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function todaySchedule(hour) {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function partnerPayload(spec) {
  const payload = {
    phone: spec.phone,
    outlet_id: spec.outlet_id,
    outlet_row_id: spec.outlet_row_id != null ? spec.outlet_row_id : spec.outlet_id,
    status: spec.status,
    first_name: spec.first_name,
    last_name: spec.last_name,
    age: spec.age,
    qualification: spec.qualification,
    online_status: spec.online_status || "OFFLINE",
    rating: spec.rating,
  };
  if (spec.legacy_provider_id) {
    payload.legacy_provider_id = spec.legacy_provider_id;
    payload.legacy_provider_row_id = spec.legacy_provider_row_id || spec.legacy_provider_id;
  }
  if (spec.legacy_rider_id) {
    payload.legacy_rider_id = spec.legacy_rider_id;
    payload.legacy_rider_row_id = spec.legacy_rider_row_id || spec.legacy_rider_id;
  }
  if (spec.state) payload.state = spec.state;
  if (spec.district) payload.district = spec.district;
  if (spec.city) payload.city = spec.city;
  if (spec.postal_code) payload.postal_code = spec.postal_code;
  if (spec.service_zone) payload.service_zone = spec.service_zone;
  return payload;
}

function partnerLocationSpec(outlet, visitCity) {
  return {
    state: outlet.state || "Jharkhand",
    district: visitCity,
    city: visitCity,
    postal_code: "834001",
    service_zone: visitCity,
  };
}

async function ensurePartnerByPhone(ctx, spec) {
  const { zcql, updateRow, insertRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Delivery_Partners WHERE phone = '" +
        spec.phone.replace(/'/g, "''") +
        "' LIMIT 1"
    ),
    "Delivery_Partners"
  )[0];
  const payload = partnerPayload(spec);
  if (existing) {
    await updateRow("Delivery_Partners", { ROWID: existing.ROWID, ...payload });
    return String(existing.ROWID);
  }
  const inserted = await insertRow("Delivery_Partners", payload);
  return String(inserted.ROWID || inserted.rowid);
}

async function ensureProvider(ctx, { first_name, last_name, phone, rating }) {
  const { zcql, insertRow, updateRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Providers WHERE phone = '" + phone.replace(/'/g, "''") + "' LIMIT 1"
    ),
    "Providers"
  )[0];
  const payload = {
    first_name,
    last_name,
    phone,
    rating,
    status: "AVAILABLE",
    is_active: true,
  };
  if (existing) {
    await updateRow("Providers", { ROWID: existing.ROWID, ...payload });
    return String(existing.ROWID);
  }
  const inserted = await insertRow("Providers", payload);
  return String(inserted.ROWID || inserted.rowid);
}

async function ensureRider(ctx, { phone, name }) {
  const { zcql, insertRow, updateRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Riders WHERE phone = '" + phone.replace(/'/g, "''") + "' LIMIT 1"
    ),
    "Riders"
  )[0];
  const payload = {
    phone,
    name: name || "PP004 Rider",
    is_active: true,
    is_available: true,
  };
  if (existing) {
    await updateRow("Riders", { ROWID: existing.ROWID, ...payload });
    return String(existing.ROWID);
  }
  const inserted = await insertRow("Riders", payload);
  return String(inserted.ROWID || inserted.rowid);
}

async function ensureProviderSkill(ctx, providerId, serviceId) {
  const { zcql, insertRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Provider_Services WHERE provider_id = " +
        providerId +
        " AND service_id = " +
        serviceId +
        " LIMIT 1"
    ),
    "Provider_Services"
  )[0];
  if (existing) return;
  await insertRow("Provider_Services", {
    provider_id: providerId,
    service_id: serviceId,
    is_active: true,
  });
}

async function ensureServiceArea(ctx, providerId, city) {
  const { zcql, insertRow } = ctx;
  if (!city) return;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Service_Areas WHERE provider_id = " +
        providerId +
        " AND city = '" +
        String(city).replace(/'/g, "''") +
        "' LIMIT 1"
    ),
    "Service_Areas"
  )[0];
  if (existing) return;
  await insertRow("Service_Areas", {
    provider_id: providerId,
    city,
    is_active: true,
  });
}

async function ensureServiceJob(ctx, bookingNumber, spec) {
  const { zcql, insertRow, updateRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Service_Jobs WHERE booking_number = '" +
        bookingNumber.replace(/'/g, "''") +
        "' LIMIT 1"
    ),
    "Service_Jobs"
  )[0];
  const payload = {
    user_id: spec.user_id,
    job_number: bookingNumber,
    booking_number: bookingNumber,
    outlet_id: spec.outlet_row_id,
    outlet_row_id: spec.outlet_row_id,
    status: "CONFIRMED",
    payment_status: "PAID",
    start_time: spec.start_time || "10:00:00",
    visit_line1: spec.visit_line1,
    visit_city: spec.visit_city,
    visit_state: spec.visit_state || "Jharkhand",
    pincode: spec.pincode || "834001",
    scheduled_date: todayDateOnly(),
    scheduled_at: spec.scheduled_at,
    grand_total: spec.grand_total,
    subtotal: spec.grand_total,
    currency: "INR",
    service_name_snapshot: spec.service_name_snapshot,
    gender_preference: "any",
    visit_latitude: spec.visit_latitude != null ? spec.visit_latitude : 23.3448,
    visit_longitude: spec.visit_longitude != null ? spec.visit_longitude : 85.3101,
  };
  let rowId;
  if (existing) {
    await updateRow("Service_Jobs", { ROWID: existing.ROWID, ...payload });
    rowId = String(existing.ROWID);
  } else {
    const inserted = await insertRow("Service_Jobs", payload);
    rowId = String(inserted.ROWID || inserted.rowid);
  }
  const items = unwrap(
    await zcql.query("SELECT ROWID FROM Job_Items WHERE job_id = " + rowId + " LIMIT 1"),
    "Job_Items"
  );
  if (!items.length) {
    await insertRow("Job_Items", {
      job_id: rowId,
      service_id: SERVICE_REF,
      service_name: spec.service_name_snapshot,
      quantity: 1,
      unit_price: spec.grand_total,
      line_total: spec.grand_total,
      duration_minutes: 60,
    });
  }
  await ctx.clearBigIntColumn("Service_Jobs", rowId, "delivery_partner_row_id");
  return rowId;
}

async function ensureSalonServiceAtHome(ctx, serviceId) {
  const { updateRow } = ctx;
  await updateRow("Salon_Services", {
    ROWID: serviceId,
    is_at_home: true,
  });
}

async function ensureOrder(ctx, orderNumber, spec) {
  const { zcql, insertRow, updateRow } = ctx;
  const existing = unwrap(
    await zcql.query(
      "SELECT ROWID FROM Orders WHERE order_number = '" +
        orderNumber.replace(/'/g, "''") +
        "' LIMIT 1"
    ),
    "Orders"
  )[0];
  const amount = spec.grand_total != null ? spec.grand_total : spec.total_amount || 999;
  const payload = {
    user_id: spec.user_id,
    order_number: orderNumber,
    status: spec.status || "CONFIRMED",
    payment_status: spec.payment_status,
    payment_method: spec.payment_method,
    fulfillment_mode: spec.fulfillment_mode || "STANDARD",
    fulfillment_store_id: spec.fulfillment_store_id,
    currency: "INR",
    subtotal: amount,
    discount_amount: 0,
    tax_amount: 0,
    shipping_amount: 0,
    grand_total: amount,
    shipping_name: spec.shipping_name || "PP004 Test Customer",
    shipping_phone: spec.shipping_phone || "+919999999999",
    shipping_line1: spec.shipping_line1 || "PP004 test address",
    shipping_city: spec.shipping_city || spec.visit_city || "Ranchi",
    shipping_state: spec.shipping_state || "Jharkhand",
    shipping_postal_code: spec.shipping_postal_code || spec.pincode || "834001",
    shipping_country: "India",
  };
  if (existing) {
    await updateRow("Orders", { ROWID: existing.ROWID, ...payload });
    await ctx.clearBigIntColumn("Orders", existing.ROWID, "professional_job_row_id");
    await ctx.clearBigIntColumn("Orders", existing.ROWID, "fulfillment_rider_id");
    return String(existing.ROWID);
  }
  const inserted = await insertRow("Orders", payload);
  return String(inserted.ROWID || inserted.rowid);
}

async function resetProfessionalJob(ctx, pjRowId, { jobType, referenceRowId } = {}) {
  const { zcql } = ctx;
  await zcql.query(
    "UPDATE Professional_Jobs SET job_status = 'ASSIGNMENT_PENDING', assigned_at = NULL, accepted_at = NULL, offer_expires_at = NULL, metadata_json = NULL, delivery_partner_row_id = NULL, started_at = NULL, completed_at = NULL WHERE ROWID = " +
      String(pjRowId)
  );
  if (jobType === "HOME_SERVICE" && referenceRowId) {
    await zcql.query(
      "UPDATE Service_Jobs SET status = 'CONFIRMED', delivery_partner_row_id = NULL WHERE ROWID = " +
        String(referenceRowId)
    );
  }
  if (jobType === "PRODUCT_DELIVERY" && referenceRowId) {
    await zcql.query(
      "UPDATE Orders SET fulfillment_rider_id = NULL, professional_job_row_id = NULL, status = 'CONFIRMED' WHERE ROWID = " +
        String(referenceRowId)
    );
  }
}

async function ensureProfessionalJob(ctx, { jobType, referenceRowId, assignToPartnerRowId, dispatch = false }) {
  const { app } = ctx;
  let result;
  if (jobType === "HOME_SERVICE") {
    result = await ensureHomeServiceJob(app, referenceRowId, {
      actorId: "pp004-fixtures",
      actorRole: "SYSTEM",
    });
  } else {
    result = await ensureProductDeliveryJob(app, referenceRowId, {
      actorId: "pp004-fixtures",
      actorRole: "SYSTEM",
    });
  }
  const pjRowId = String(result.job.id);
  await resetProfessionalJob(ctx, pjRowId, {
    jobType,
    referenceRowId: String(referenceRowId),
  });
  if (assignToPartnerRowId) {
    await ctx.updateRow("Professional_Jobs", {
      ROWID: pjRowId,
      delivery_partner_row_id: assignToPartnerRowId,
    });
  }
  let dispatchResult = null;
  if (dispatch) {
    dispatchResult = await dispatchProfessionalJob(app, pjRowId);
  }
  const row = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, job_status, delivery_partner_row_id, job_type, reference_row_id FROM Professional_Jobs WHERE ROWID = " +
        pjRowId
    ),
    "Professional_Jobs"
  )[0];
  return {
    professional_job_id: pjRowId,
    job_status: row?.job_status,
    delivery_partner_row_id: String(row?.delivery_partner_row_id || ""),
    dispatch: dispatchResult,
    job: result.job,
  };
}

async function prepareProfessionalJobOffer(ctx, { professionalJobId, assignToPartnerRowId = null, jobType, referenceRowId }) {
  const { app } = ctx;
  await resetProfessionalJob(ctx, professionalJobId, { jobType, referenceRowId });
  if (assignToPartnerRowId) {
    await ctx.updateRow("Professional_Jobs", {
      ROWID: professionalJobId,
      delivery_partner_row_id: assignToPartnerRowId,
    });
  } else {
    await ctx.clearBigIntColumn("Professional_Jobs", professionalJobId, "delivery_partner_row_id");
  }
  const dispatch = await dispatchProfessionalJob(app, professionalJobId);
  const row = unwrap(
    await ctx.zcql.query(
      "SELECT ROWID, job_status, delivery_partner_row_id, offer_expires_at FROM Professional_Jobs WHERE ROWID = " +
        professionalJobId
    ),
    "Professional_Jobs"
  )[0];
  if (!row || row.job_status !== "ASSIGNED") {
    throw new Error(
      "prepareProfessionalJobOffer failed to assign job " +
        professionalJobId +
        ": " +
        JSON.stringify({ dispatch, row })
    );
  }
  return {
    professional_job_id: String(professionalJobId),
    job_status: row?.job_status,
    delivery_partner_row_id: String(row?.delivery_partner_row_id || ""),
    offer_expires_at: row?.offer_expires_at || "",
    dispatch,
  };
}

async function setupPp004Fixtures() {
  const ctx = await createDevCatalystClient();
  const { zcql, app, unwrap: u } = ctx;

  const users = u(
    await zcql.query("SELECT ROWID FROM Users ORDER BY ROWID ASC LIMIT 1"),
    "Users"
  );
  if (!users.length) {
    throw new Error("Need at least one Users row");
  }
  const userId = String(users[0].ROWID);

  const outlets = u(
    await zcql.query(
      "SELECT ROWID, name, city, state FROM Outlets WHERE is_active = true ORDER BY ROWID ASC LIMIT 2"
    ),
    "Outlets"
  );
  if (!outlets.length) {
    throw new Error("Need at least one active Outlet");
  }
  const outlet = outlets[0];
  const visitCity = outlet.city || "Ranchi";

  const providerA = await ensureProvider(ctx, {
    first_name: "Neha",
    last_name: "SinghA",
    phone: "+919000004001",
    rating: 4.9,
  });
  const providerB = await ensureProvider(ctx, {
    first_name: "Ravi",
    last_name: "KumarB",
    phone: "+919000004002",
    rating: 4.1,
  });
  const riderA = await ensureRider(ctx, { phone: "+919000005001", name: "PP004 Rider A" });
  const riderB = await ensureRider(ctx, { phone: "+919000005002", name: "PP004 Rider B" });

  await ensureSalonServiceAtHome(ctx, SERVICE_REF);

  for (const providerId of [providerA, providerB]) {
    await ensureProviderSkill(ctx, providerId, SERVICE_REF);
    await ensureServiceArea(ctx, providerId, visitCity);
  }

  const locationSpec = partnerLocationSpec(outlet, visitCity);
  const partnerA = await ensurePartnerByPhone(ctx, {
    phone: PHONE_A,
    outlet_id: outlet.ROWID,
    status: "active",
    first_name: "Neha",
    last_name: "Singh",
    age: 28,
    qualification: "graduation",
    online_status: "ONLINE_AVAILABLE",
    rating: 4.9,
    legacy_provider_id: providerA,
    legacy_rider_id: riderA,
    ...locationSpec,
  });
  const partnerB = await ensurePartnerByPhone(ctx, {
    phone: PHONE_B,
    outlet_id: outlet.ROWID,
    status: "active",
    first_name: "Ravi",
    last_name: "Kumar",
    age: 30,
    qualification: "graduation",
    online_status: "ONLINE_AVAILABLE",
    rating: 4.1,
    legacy_provider_id: providerB,
    legacy_rider_id: riderB,
    ...locationSpec,
  });
  const partnerC = await ensurePartnerByPhone(ctx, {
    phone: PHONE_C,
    outlet_id: outlet.ROWID,
    status: "pending_kyc",
    first_name: "Priya",
    last_name: "Pending",
    age: 24,
    qualification: "intermediate",
    online_status: "OFFLINE",
    rating: 4.5,
  });
  const partnerD = await ensurePartnerByPhone(ctx, {
    phone: PHONE_D,
    outlet_id: outlet.ROWID,
    status: "suspended",
    first_name: "Dev",
    last_name: "Suspended",
    age: 35,
    qualification: "graduation",
    online_status: "OFFLINE",
    rating: 3.0,
  });

  const homeAcceptRef = await ensureServiceJob(ctx, BOOKING_HOME_ACCEPT, {
    user_id: userId,
    outlet_row_id: outlet.ROWID,
    visit_line1: "PP004 Home Accept Street",
    visit_city: visitCity,
    start_time: "14:00:00",
    scheduled_at: todaySchedule(14),
    grand_total: 1299,
    service_name_snapshot: "PP004 Home Accept Service",
  });
  const homeRejectRef = await ensureServiceJob(ctx, BOOKING_HOME_REJECT, {
    user_id: userId,
    outlet_row_id: outlet.ROWID,
    visit_line1: "PP004 Home Reject Street",
    visit_city: visitCity,
    start_time: "16:00:00",
    scheduled_at: todaySchedule(16),
    grand_total: 999,
    service_name_snapshot: "PP004 Home Reject Service",
  });

  const prepaidRef = await ensureOrder(ctx, ORDER_PREPAID, {
    user_id: userId,
    payment_status: "PAID",
    payment_method: "ONLINE",
    fulfillment_store_id: outlet.ROWID,
    shipping_city: visitCity,
    grand_total: 1499,
  });
  const codRef = await ensureOrder(ctx, ORDER_COD, {
    user_id: userId,
    payment_status: "PENDING",
    payment_method: "COD",
    fulfillment_store_id: outlet.ROWID,
    shipping_city: visitCity,
    grand_total: 899,
  });
  const concurRef = await ensureOrder(ctx, ORDER_CONCUR, {
    user_id: userId,
    payment_status: "PAID",
    payment_method: "ONLINE",
    fulfillment_store_id: outlet.ROWID,
    shipping_city: visitCity,
    grand_total: 799,
  });
  const expireRef = await ensureOrder(ctx, ORDER_EXPIRE, {
    user_id: userId,
    payment_status: "PAID",
    payment_method: "ONLINE",
    fulfillment_store_id: outlet.ROWID,
    shipping_city: visitCity,
    grand_total: 699,
  });

  const jobs = {
    homeAccept: await ensureProfessionalJob(ctx, {
      jobType: "HOME_SERVICE",
      referenceRowId: homeAcceptRef,
    }),
    homeReject: await ensureProfessionalJob(ctx, {
      jobType: "HOME_SERVICE",
      referenceRowId: homeRejectRef,
    }),
    productPrepaid: await ensureProfessionalJob(ctx, {
      jobType: "PRODUCT_DELIVERY",
      referenceRowId: prepaidRef,
    }),
    productCod: await ensureProfessionalJob(ctx, {
      jobType: "PRODUCT_DELIVERY",
      referenceRowId: codRef,
    }),
    productConcur: await ensureProfessionalJob(ctx, {
      jobType: "PRODUCT_DELIVERY",
      referenceRowId: concurRef,
    }),
    productExpire: await ensureProfessionalJob(ctx, {
      jobType: "PRODUCT_DELIVERY",
      referenceRowId: expireRef,
    }),
  };

  const partners = u(
    await zcql.query("SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE ROWID IN (" + partnerA + "," + partnerB + "," + partnerC + "," + partnerD + ")"),
    "Delivery_Partners"
  );

  return {
    partners: {
      A: partnerA,
      B: partnerB,
      C: partnerC,
      D: partnerD,
      rows: {
        A: partners.find((p) => String(p.ROWID) === partnerA),
        B: partners.find((p) => String(p.ROWID) === partnerB),
        C: partners.find((p) => String(p.ROWID) === partnerC),
        D: partners.find((p) => String(p.ROWID) === partnerD),
      },
    },
    references: {
      homeAcceptRef,
      homeRejectRef,
      prepaidRef,
      codRef,
      concurRef,
      expireRef,
    },
    jobs,
    outlet_row_id: String(outlet.ROWID),
    service_ref: SERVICE_REF,
    visit_city: visitCity,
  };
}

async function restorePp003SmokeFixtures() {
  const ctx = await createDevCatalystClient();
  const { zcql, app, updateRow, unwrap: u } = ctx;

  const resetStatuses = ["ACCEPTED", "REASSIGNMENT_REQUIRED", "ASSIGNED"];
  for (const status of resetStatuses) {
    const rows = u(
      await zcql.query(
        "SELECT ROWID, reference_row_id, job_type FROM Professional_Jobs WHERE job_status = '" +
          status +
          "' LIMIT 20"
      ),
      "Professional_Jobs"
    );
    for (const row of rows) {
      await updateRow("Professional_Jobs", {
        ROWID: row.ROWID,
        job_status: "ASSIGNMENT_PENDING",
        assigned_at: "",
        accepted_at: "",
        offer_expires_at: "",
        metadata_json: "",
      });
      await ctx.clearBigIntColumn("Professional_Jobs", row.ROWID, "delivery_partner_row_id");
      if (row.job_type === "HOME_SERVICE" && row.reference_row_id) {
        await ctx.clearBigIntColumn("Service_Jobs", row.reference_row_id, "delivery_partner_row_id");
        await updateRow("Service_Jobs", {
          ROWID: row.reference_row_id,
          status: "CONFIRMED",
        });
      }
    }
  }

  const partners = u(
    await zcql.query(
      "SELECT " + DP_SELECT + " FROM Delivery_Partners WHERE status = 'active' ORDER BY CREATEDTIME DESC LIMIT 5"
    ),
    "Delivery_Partners"
  );
  const partner = partners[0];
  if (partner && partner.online_status !== "ONLINE_AVAILABLE") {
    await updateRow("Delivery_Partners", {
      ROWID: partner.ROWID,
      online_status: "ONLINE_AVAILABLE",
    });
  }

  const pending = u(
    await zcql.query(
      "SELECT ROWID, job_type FROM Professional_Jobs WHERE job_status = 'ASSIGNMENT_PENDING' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Professional_Jobs"
  );

  const providerRef = partner ? String(partner.legacy_provider_id || "").trim() : "";
  const outletRef = partner ? String(partner.outlet_row_id || partner.outlet_id || "") : "";
  const fixes = [];

  for (const job of pending) {
    if (job.job_type === "PRODUCT_DELIVERY") {
      const orderRef = u(
        await zcql.query(
          "SELECT reference_row_id FROM Professional_Jobs WHERE ROWID = " + job.ROWID
        ),
        "Professional_Jobs"
      )[0]?.reference_row_id;
      if (orderRef && outletRef) {
        await updateRow("Orders", {
          ROWID: orderRef,
          fulfillment_store_id: outletRef,
        });
        fixes.push({ orders: orderRef, fulfillment_store_id: outletRef });
      }
    }
    if (job.job_type === "HOME_SERVICE") {
      const serviceJobRef = u(
        await zcql.query(
          "SELECT reference_row_id FROM Professional_Jobs WHERE ROWID = " + job.ROWID
        ),
        "Professional_Jobs"
      )[0]?.reference_row_id;
      if (serviceJobRef) {
        const visitCity =
          u(
            await zcql.query(
              "SELECT visit_city FROM Service_Jobs WHERE ROWID = " + serviceJobRef + " LIMIT 1"
            ),
            "Service_Jobs"
          )[0]?.visit_city || "";
        const items = u(
          await zcql.query(
            "SELECT ROWID FROM Job_Items WHERE job_id = " + serviceJobRef + " LIMIT 1"
          ),
          "Job_Items"
        );
        if (!items.length) {
          await app.datastore().table("Job_Items").insertRow({
            job_id: serviceJobRef,
            service_id: SERVICE_REF,
            service_name: "PP-003 smoke service",
            quantity: 1,
            unit_price: 499,
            line_total: 499,
            duration_minutes: 60,
          });
        }
        if (providerRef && visitCity) {
          await ensureProviderSkill(ctx, providerRef, SERVICE_REF);
          await ensureServiceArea(ctx, providerRef, visitCity);
        }
      }
    }
  }

  const dispatchResults = await dispatchPendingJobs(app, 10);
  const assigned = u(
    await zcql.query(
      "SELECT ROWID, job_type, job_status, delivery_partner_row_id FROM Professional_Jobs WHERE job_status = 'ASSIGNED' ORDER BY CREATEDTIME DESC LIMIT 10"
    ),
    "Professional_Jobs"
  );

  return {
    fixes,
    dispatch_results: dispatchResults,
    assigned_jobs: assigned,
    ok: assigned.length > 0 || pending.length === 0,
  };
}

async function main() {
  const restore = process.argv.includes("--restore-pp003");
  if (restore) {
    const report = await restorePp003SmokeFixtures();
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  const manifest = await setupPp004Fixtures();
  console.log(JSON.stringify(manifest, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  setupPp004Fixtures,
  restorePp003SmokeFixtures,
  prepareProfessionalJobOffer,
  resetProfessionalJob,
  PHONE_A,
  PHONE_B,
  PHONE_C,
  PHONE_D,
  BOOKING_HOME_ACCEPT,
  BOOKING_HOME_REJECT,
  ORDER_PREPAID,
  ORDER_COD,
  ORDER_CONCUR,
  ORDER_EXPIRE,
};
