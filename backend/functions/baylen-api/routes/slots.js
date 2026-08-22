const { asId, asText, rowOf, rowsOf, sendOk } = require("../lib/http");

function slotRoutes(app) {
  app.get("/v1/slots", async (req, res, next) => {
    try {
      const outletId = asId(req.query.outlet_id, "outlet_id");
      const slotDate = asText(req.query.slot_date, "slot_date", 10);
      const staffId = req.query.staff_id
        ? asId(req.query.staff_id, "staff_id")
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

      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Appointment_Slots");
      sendOk(res, { slots: rows });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/slots/lock", async (req, res, next) => {
    try {
      const slotId = asId(req.body.slot_id, "slot_id");
      const appointmentId = req.body.appointment_id
        ? asId(req.body.appointment_id, "appointment_id")
        : null;

      const zcql = req.catalystApp.zcql();
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
