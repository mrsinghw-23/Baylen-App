const { asId, asText, num, rowOf, rowsOf, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const engine = require("../lib/salon-engine");

function mapSlot(row) {
  const text = String(row.slot_date || "").trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return {
    id: String(row.ROWID),
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    staff_id: row.staff_id ? String(row.staff_id) : "",
    service_id: row.service_id ? String(row.service_id) : "",
    slot_date: iso ? iso[1] : text.slice(0, 10),
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
  };
}

function slotRoutes(app) {
  app.get("/v1/slots", async (req, res, next) => {
    try {
      const outletId = asId(req.query.outlet_id, "outlet_id");
      const slotDate = asText(req.query.slot_date, "slot_date", 10);
      const staffId = req.query.staff_id
        ? asId(req.query.staff_id, "staff_id")
        : null;
      const serviceId = req.query.service_id
        ? asId(req.query.service_id, "service_id")
        : null;

      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, outlet_id, staff_id, service_id, slot_date, start_time, end_time, status FROM Appointment_Slots WHERE outlet_id = " +
        outletId +
        " AND slot_date = '" +
        slotDate +
        "' AND status = 'AVAILABLE'";
      if (staffId) {
        query += " AND staff_id = " + staffId;
      }
      if (serviceId) {
        query += " AND (service_id = " + serviceId + " OR service_id IS NULL)";
      }

      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Appointment_Slots");
      if (rows.length) {
        sendOk(res, { slots: rows.map(mapSlot), source: "stored" });
        return;
      }

      const outlet = await engine.loadActiveOutlet(zcql, outletId);
      let duration = 45;
      if (serviceId) {
        const priced = await engine.safeRows(
          zcql,
          "SELECT duration_minutes FROM Outlet_Service_Prices WHERE outlet_id = " +
            outletId +
            " AND service_id = " +
            serviceId +
            " AND is_active = true",
          "Outlet_Service_Prices"
        );
        const service = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT duration_minutes FROM Salon_Services WHERE ROWID = " + serviceId
          ),
          "Salon_Services"
        );
        duration = num(priced[0] && priced[0].duration_minutes) || num(service && service.duration_minutes) || 45;
      }
      const staffIds = staffId
        ? [staffId]
        : (
            await engine.safeRows(
              zcql,
              "SELECT ROWID FROM Staff WHERE outlet_id = " +
                outletId +
                " AND status = 'ACTIVE' AND is_active = true",
              "Staff"
            )
          ).map((row) => String(row.ROWID));
      const generated = [];
      const day = String(slotDate);
      const isToday = day === engine.todayIsoInIst();
      for (const id of staffIds) {
        const booked = [];
        const appointments = await engine.safeRows(
          zcql,
          "SELECT start_time, end_time, status FROM Appointments WHERE staff_id = " +
            id +
            " AND appointment_date = '" +
            day +
            "'",
          "Appointments"
        );
        for (const row of appointments) {
          if (["CANCELLED", "NO_SHOW"].includes(String(row.status || "").toUpperCase())) {
            continue;
          }
          booked.push({
            start: engine.parseClock(row.start_time),
            end: engine.parseClock(row.end_time),
          });
        }
        const reservedSlots = await engine.safeRows(
          zcql,
          "SELECT start_time, end_time, status FROM Appointment_Slots WHERE staff_id = " +
            id +
            " AND slot_date = '" +
            day +
            "'",
          "Appointment_Slots"
        );
        for (const row of reservedSlots) {
          if (!["BOOKED", "HELD"].includes(String(row.status || "").toUpperCase())) {
            continue;
          }
          booked.push({
            start: engine.parseClock(row.start_time),
            end: engine.parseClock(row.end_time),
          });
        }
        const slots = engine.generateDaySlots({
          opening: outlet.opening_time,
          closing: outlet.closing_time,
          duration,
          booked,
          isToday,
        });
        for (const slot of slots) {
          generated.push({
            id: "",
            outlet_id: outletId,
            staff_id: id,
            service_id: serviceId || "",
            slot_date: day,
            start_time: slot.start_time,
            end_time: slot.end_time,
            status: "AVAILABLE",
            generated: true,
          });
        }
      }
      sendOk(res, { slots: generated, source: "generated" });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/slots/lock", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const slotId = asId(req.body.slot_id, "slot_id");
      const appointmentId = asId(req.body.appointment_id, "appointment_id");

      const zcql = req.catalystApp.zcql();
      const owned = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Appointments WHERE ROWID = " +
            appointmentId +
            " AND user_id = " +
            user.user_id
        ),
        "Appointments"
      );
      if (!owned) {
        const error = new Error("Appointment not found");
        error.status = 404;
        throw error;
      }

      const query =
        "SELECT ROWID, status, appointment_id FROM Appointment_Slots WHERE ROWID = " +
        slotId;
      const row = rowOf(await zcql.executeZCQLQuery(query), "Appointment_Slots");
      if (!row) {
        const error = new Error("Slot not found");
        error.status = 404;
        throw error;
      }
      if (row.status !== "AVAILABLE") {
        const error = new Error("Slot is not available");
        error.status = 409;
        throw error;
      }

      const update = {
        ROWID: row.ROWID,
        status: "BOOKED",
      };
      if (appointmentId) {
        update.appointment_id = appointmentId;
      }
      await req.catalystApp.datastore().table("Appointment_Slots").updateRow(update);

      sendOk(res, {
        slot_id: row.ROWID,
        status: "BOOKED",
        appointment_id: appointmentId,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = slotRoutes;
