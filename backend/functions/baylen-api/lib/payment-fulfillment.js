"use strict";

const { asId, rowOf, rowsOf } = require("./http");
const { commitReservation } = require("./inventory-ops");
const { confirmPaidBooking } = require("./at-home-beauty-engine");
const professionalJobs = require("./professional-job-engine");
const { notifyOrderWhatsapp, recordOrderNotification } = require("./order-notify");
const { notifyBookingWhatsapp } = require("./booking-notify");

async function finalize(app, payment, req = {}) {
  const id = asId(payment.reference_id, "reference_id");
  if (payment.reference_type === "JOB") {
    await confirmPaidBooking(app, id, { user_id: payment.user_id });
    await app.datastore().table("Service_Jobs").updateRow({ ROWID: id, payment_status: "PAID" });
    await professionalJobs.ensureHomeServiceJob(app, id, {
      actorId: payment.user_id, actorRole: "customer", userId: payment.user_id,
    });
    return;
  }
  if (payment.reference_type === "APPOINTMENT") {
    await app.datastore().table("Appointments").updateRow({
      ROWID: id,
      payment_status: "PAID",
      status: "CONFIRMED",
    });
    try {
      const appointment = rowOf(await app.zcql().executeZCQLQuery(
        "SELECT ROWID, user_id, appointment_number, status, appointment_date, start_time, grand_total, salon_name_snapshot, location_snapshot, package_name_snapshot, service_name_snapshot, employee_name_snapshot, gender_snapshot FROM Appointments WHERE ROWID = " + id
      ), "Appointments");
      if (appointment) {
        appointment.status = "CONFIRMED";
        await notifyBookingWhatsapp({ catalystApp: app }, { user_id: payment.user_id }, appointment, {
          salonName: appointment.salon_name_snapshot || "",
          location: appointment.location_snapshot || "",
          packageName: appointment.package_name_snapshot || "",
          serviceName: appointment.service_name_snapshot || "",
          employeeName: appointment.employee_name_snapshot || "",
          gender: appointment.gender_snapshot || "",
          date: appointment.appointment_date || "",
          startTime: appointment.start_time || "",
          price: appointment.grand_total,
          status: "CONFIRMED",
        });
      }
    } catch (error) {
      console.error("[payments] salon confirmation notification failed", error.message);
    }
    return;
  }
  const zcql = app.zcql();
  const children = rowsOf(await zcql.executeZCQLQuery(
    "SELECT ROWID, status FROM Orders WHERE parent_order_id = " + id), "Orders");
  const parent = rowOf(await zcql.executeZCQLQuery(
    "SELECT ROWID, status FROM Orders WHERE ROWID = " + id), "Orders");
  if (!parent) throw new Error("Paid order could not be found");
  // Split orders reserve stock on their children, not on the summary order.
  for (const target of children.length ? children : [parent]) {
    await commitReservation(app, target.ROWID);
  }
  for (const target of [...children, parent]) {
    await app.datastore().table("Orders").updateRow({
      ROWID: target.ROWID, payment_status: "PAID",
      ...(["PENDING_PAYMENT", "PLACED"].includes(target.status) ? { status: "CONFIRMED" } : {}),
    });
  }
  // The legacy bulk helper logs job failures and returns. Payment finalization must retry them.
  for (const target of children.length ? children : [parent]) {
    await professionalJobs.ensureProductDeliveryJob(app, target.ROWID, {
      actorId: payment.user_id, actorRole: "customer", userId: payment.user_id,
    });
  }
  // Notifications must not change a verified payment's outcome.
  try {
    const order = rowOf(await zcql.executeZCQLQuery(
      "SELECT ROWID, order_number, grand_total, payment_method, shipping_name, shipping_phone, shipping_city, shipping_postal_code FROM Orders WHERE ROWID = " + id), "Orders");
    const context = { ...req, catalystApp: app };
    const user = { user_id: payment.user_id };
    const result = await notifyOrderWhatsapp(context, user, order);
    await recordOrderNotification(context, user.user_id, id, result, "Order confirmation", "Order " + order.order_number + " paid");
  } catch (error) {
    console.error("[payments] confirmation notification failed", error.message);
  }
}

module.exports = { finalize };
