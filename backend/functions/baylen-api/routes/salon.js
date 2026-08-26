const { asId, asText, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function slotDateValue(value) {
  const text = String(value || "").trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    return iso[1];
  }
  return text.slice(0, 10);
}

function mapOutlet(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug || "",
    code: row.code || "",
    address_line1: row.address_line1 || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    phone: row.phone || "",
    opening_time: row.opening_time || "",
    closing_time: row.closing_time || "",
  };
}

function mapService(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug || "",
    description: row.description || "",
    category_id: row.category_id ? String(row.category_id) : "",
    image_url: row.image_url || "",
    duration_minutes: num(row.duration_minutes),
    gender: row.gender || "UNISEX",
    mrp: money(row.mrp),
    selling_price: money(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapStaff(row) {
  return {
    id: String(row.ROWID),
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    designation: row.designation || "",
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    name: [row.first_name, row.last_name].filter(Boolean).join(" "),
  };
}

function mapAppointment(row, items) {
  return {
    id: String(row.ROWID),
    appointment_number: row.appointment_number,
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    staff_id: row.staff_id ? String(row.staff_id) : "",
    slot_id: row.slot_id ? String(row.slot_id) : "",
    appointment_date: slotDateValue(row.appointment_date),
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    payment_status: row.payment_status,
    currency: row.currency || "INR",
    subtotal: money(row.subtotal),
    grand_total: money(row.grand_total),
    items: items || [],
  };
}

async function loadAppointmentItems(zcql, appointmentId) {
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, service_id, staff_id, service_name, duration_minutes, quantity, unit_price, line_total, status FROM Appointment_Items WHERE appointment_id = " +
        appointmentId
    ),
    "Appointment_Items"
  );
  return rows.map((row) => ({
    id: String(row.ROWID),
    service_id: String(row.service_id),
    staff_id: row.staff_id ? String(row.staff_id) : "",
    name: row.service_name,
    duration_minutes: num(row.duration_minutes),
    quantity: num(row.quantity),
    unit_price: money(row.unit_price),
    line_total: money(row.line_total),
    status: row.status,
  }));
}

function salonRoutes(app) {
  app.get("/v1/salon/outlets", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, code, address_line1, city, state, postal_code, phone, opening_time, closing_time FROM Outlets WHERE is_active = true"
        ),
        "Outlets"
      );
      sendOk(res, { outlets: rows.map(mapOutlet) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/salon/services", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency FROM Salon_Services WHERE status = 'ACTIVE' AND is_active = true";
      if (req.query.category_id) {
        query += " AND category_id = " + asId(req.query.category_id, "category_id");
      }
      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Salon_Services");
      sendOk(res, { services: rows.map(mapService) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/salon/staff", async (req, res, next) => {
    try {
      const outletId = asId(req.query.outlet_id, "outlet_id");
      const zcql = req.catalystApp.zcql();
      let allowedIds = null;
      if (req.query.service_id) {
        const serviceId = asId(req.query.service_id, "service_id");
        const links = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT staff_id FROM Staff_Services WHERE service_id = " +
              serviceId +
              " AND is_active = true"
          ),
          "Staff_Services"
        );
        allowedIds = new Set(links.map((row) => String(row.staff_id)));
      }

      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, first_name, last_name, designation, outlet_id FROM Staff WHERE outlet_id = " +
            outletId +
            " AND status = 'ACTIVE' AND is_active = true"
        ),
        "Staff"
      );
      const staff = rows
        .filter((row) => !allowedIds || allowedIds.has(String(row.ROWID)))
        .map(mapStaff);
      sendOk(res, { staff });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/appointments", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const id = asId(req.query.id, "id");
        const row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, user_id, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total FROM Appointments WHERE ROWID = " +
              id +
              " AND user_id = " +
              user.user_id
          ),
          "Appointments"
        );
        if (!row) {
          const error = new Error("Appointment not found");
          error.status = 404;
          throw error;
        }
        sendOk(res, {
          appointment: mapAppointment(row, await loadAppointmentItems(zcql, id)),
        });
        return;
      }

      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total FROM Appointments WHERE user_id = " +
            user.user_id
        ),
        "Appointments"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      const appointments = [];
      for (const row of rows) {
        appointments.push(
          mapAppointment(row, await loadAppointmentItems(zcql, asId(row.ROWID, "id")))
        );
      }
      sendOk(res, { appointments });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/appointments", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const slotId = asId(req.body.slot_id, "slot_id");
      const serviceId = asId(req.body.service_id, "service_id");
      const zcql = req.catalystApp.zcql();

      const slot = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, outlet_id, staff_id, service_id, slot_date, start_time, end_time, status FROM Appointment_Slots WHERE ROWID = " +
            slotId
        ),
        "Appointment_Slots"
      );
      if (!slot) {
        const error = new Error("Slot not found");
        error.status = 404;
        throw error;
      }
      if (slot.status !== "AVAILABLE") {
        const error = new Error("Slot is not available");
        error.status = 409;
        throw error;
      }
      if (slot.service_id && String(slot.service_id) !== serviceId) {
        const error = new Error("This slot is not for the selected service");
        error.status = 400;
        throw error;
      }

      const service = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, duration_minutes, selling_price, currency, status FROM Salon_Services WHERE ROWID = " +
            serviceId +
            " AND status = 'ACTIVE' AND is_active = true"
        ),
        "Salon_Services"
      );
      if (!service) {
        const error = new Error("Service not found");
        error.status = 404;
        throw error;
      }

      const staffId = asId(slot.staff_id, "staff_id");
      const staffLink = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Staff_Services WHERE staff_id = " +
            staffId +
            " AND service_id = " +
            serviceId +
            " AND is_active = true"
        ),
        "Staff_Services"
      );
      if (!staffLink) {
        const error = new Error("This professional does not offer the selected service");
        error.status = 400;
        throw error;
      }

      const price = money(service.selling_price);
      const appointmentDate = slotDateValue(slot.slot_date);
      asText(appointmentDate, "appointment_date", 10);
      const inserted = await req.catalystApp.datastore().table("Appointments").insertRow({
        user_id: user.user_id,
        outlet_id: slot.outlet_id,
        staff_id: staffId,
        slot_id: slot.ROWID,
        appointment_number: ("APT" + Date.now()).slice(0, 30),
        appointment_date: appointmentDate,
        start_time: slot.start_time,
        end_time: slot.end_time,
        status: "CONFIRMED",
        payment_status: "PENDING",
        currency: service.currency || "INR",
        subtotal: price,
        discount_amount: 0,
        tax_amount: 0,
        grand_total: price,
      });

      const appointmentId = inserted.ROWID || inserted.rowid;
      if (!appointmentId) {
        const error = new Error("Could not create appointment");
        error.status = 500;
        throw error;
      }

      await req.catalystApp.datastore().table("Appointment_Items").insertRow({
        appointment_id: appointmentId,
        service_id: serviceId,
        staff_id: staffId,
        service_name: service.name,
        duration_minutes: num(service.duration_minutes) || 30,
        quantity: 1,
        unit_price: price,
        line_total: price,
        status: "CONFIRMED",
      });

      const latest = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, status FROM Appointment_Slots WHERE ROWID = " + slotId
        ),
        "Appointment_Slots"
      );
      if (!latest || latest.status !== "AVAILABLE") {
        await req.catalystApp.datastore().table("Appointments").updateRow({
          ROWID: appointmentId,
          status: "CANCELLED",
        });
        const error = new Error("Slot is not available");
        error.status = 409;
        throw error;
      }

      await req.catalystApp.datastore().table("Appointment_Slots").updateRow({
        ROWID: slot.ROWID,
        status: "BOOKED",
        appointment_id: appointmentId,
      });

      const row = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total FROM Appointments WHERE ROWID = " +
            asId(appointmentId, "appointment_id")
        ),
        "Appointments"
      );
      sendOk(res, {
        appointment: mapAppointment(
          row,
          await loadAppointmentItems(zcql, asId(appointmentId, "appointment_id"))
        ),
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = salonRoutes;
