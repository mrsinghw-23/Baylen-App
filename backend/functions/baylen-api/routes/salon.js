const { asId, asText, optionalText, rowOf, rowsOf, num, isTruthy, insertedRowId, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");
const {
  notifyBookingWhatsapp,
} = require("../lib/booking-notify");
const engine = require("../lib/salon-engine");

function money(value) {
  return engine.money(value);
}

function slotDateValue(value) {
  return engine.isoDate(value);
}

function mapOutlet(row, extras = {}) {
  return engine.mapOutlet(row, extras);
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
    service_type: row.service_type || engine.serviceTypeFromCategory(row),
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
    gender: row.gender || "UNISEX",
    rating: num(row.rating),
    experience_years: num(row.experience_years),
    profile_photo_url: row.profile_photo_url || row.profile_image || "",
    bio: row.bio || "",
    availability: row.availability || "AVAILABLE",
  };
}

function mapAppointment(row, items) {
  return {
    id: String(row.ROWID),
    appointment_number: row.appointment_number,
    outlet_id: row.outlet_id ? String(row.outlet_id) : "",
    staff_id: row.staff_id ? String(row.staff_id) : "",
    slot_id: row.slot_id ? String(row.slot_id) : "",
    package_id: row.package_id ? String(row.package_id) : "",
    appointment_date: slotDateValue(row.appointment_date),
    start_time: row.start_time,
    end_time: row.end_time,
    status: row.status,
    payment_status: row.payment_status,
    currency: row.currency || "INR",
    subtotal: money(row.subtotal),
    grand_total: money(row.grand_total),
    salon_name: row.salon_name_snapshot || "",
    location: row.location_snapshot || "",
    package_name: row.package_name_snapshot || "",
    service_name: row.service_name_snapshot || "",
    employee_name: row.employee_name_snapshot || "",
    gender: row.gender_snapshot || "",
    notification_status: row.notification_status || "",
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

async function loadPackageMap(zcql, outletIds) {
  const packages = await engine.loadPackages(zcql);
  const byPackageId = new Map(packages.map((item) => [item.id, item]));
  const byOutlet = new Map();
  if (!outletIds.length) {
    return byOutlet;
  }
  const links = await engine.safeRows(
    zcql,
    "SELECT ROWID, outlet_id, package_id, is_active FROM Outlet_Packages",
    "Outlet_Packages"
  );
  const priceRows = await engine.safeRows(
    zcql,
    "SELECT outlet_id, package_id FROM Outlet_Service_Prices WHERE is_active = true",
    "Outlet_Service_Prices"
  );
  const pricedByOutlet = new Map();
  for (const row of priceRows) {
    const outletId = String(row.outlet_id);
    if (!outletIds.includes(outletId)) {
      continue;
    }
    if (!pricedByOutlet.has(outletId)) {
      pricedByOutlet.set(outletId, new Set());
    }
    pricedByOutlet.get(outletId).add(String(row.package_id));
  }
  for (const link of links) {
    if (!isTruthy(link.is_active) && link.is_active !== undefined) {
      continue;
    }
    const outletId = String(link.outlet_id);
    if (!outletIds.includes(outletId)) {
      continue;
    }
    const pkg = byPackageId.get(String(link.package_id));
    if (!pkg) {
      continue;
    }
    if (!pricedByOutlet.get(outletId)?.has(pkg.id)) {
      continue;
    }
    if (!byOutlet.has(outletId)) {
      byOutlet.set(outletId, []);
    }
    byOutlet.get(outletId).push(pkg);
  }
  for (const list of byOutlet.values()) {
    list.sort((a, b) => num(a.sort_order) - num(b.sort_order));
  }
  return byOutlet;
}

const APPOINTMENT_SELECT =
  "SELECT ROWID, user_id, outlet_id, staff_id, slot_id, package_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total, salon_name_snapshot, location_snapshot, package_name_snapshot, service_name_snapshot, employee_name_snapshot, gender_snapshot FROM Appointments";

async function loadAppointmentRow(zcql, appointmentId, userId) {
  try {
    return rowOf(
      await zcql.executeZCQLQuery(
        APPOINTMENT_SELECT +
          " WHERE ROWID = " +
          appointmentId +
          (userId ? " AND user_id = " + userId : "")
      ),
      "Appointments"
    );
  } catch (_) {
    return rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, user_id, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total FROM Appointments WHERE ROWID = " +
          appointmentId +
          (userId ? " AND user_id = " + userId : "")
      ),
      "Appointments"
    );
  }
}

async function loadBookedWindows(zcql, staffId, date) {
  const day = slotDateValue(date);
  const appointments = await engine.safeRows(
    zcql,
    "SELECT start_time, end_time, status FROM Appointments WHERE staff_id = " +
      staffId +
      " AND appointment_date = '" +
      day +
      "'",
    "Appointments"
  );
  const slots = await engine.safeRows(
    zcql,
    "SELECT start_time, end_time, status FROM Appointment_Slots WHERE staff_id = " +
      staffId +
      " AND slot_date = '" +
      day +
      "'",
    "Appointment_Slots"
  );
  const blocked = new Set(["CANCELLED", "AVAILABLE", "NO_SHOW"]);
  return [...appointments, ...slots]
    .filter((row) => !blocked.has(String(row.status || "").toUpperCase()))
    .map((row) => ({
      start: engine.parseClock(row.start_time),
      end: engine.parseClock(row.end_time),
    }))
    .filter((row) => row.start != null && row.end != null);
}

function fail(message, status) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

async function notifyBooking(req, user, appointment, details) {
  return notifyBookingWhatsapp(req, user, appointment, details);
}

async function createDirectBooking(req, user) {
  const body = req.body || {};
  const outletId = asId(body.outlet_id, "outlet_id");
  const serviceId = asId(body.service_id, "service_id");
  const staffId = asId(body.staff_id, "staff_id");
  const packageId = body.package_id ? asId(body.package_id, "package_id") : "";
  const gender = String(body.gender || "UNISEX").toUpperCase();
  const appointmentDate = slotDateValue(asText(body.appointment_date, "appointment_date", 10));
  const startTime = asText(body.start_time, "start_time", 12);
  const zcql = req.catalystApp.zcql();

  const outlet = await engine.loadActiveOutlet(zcql, outletId);
  const service = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, duration_minutes, selling_price, mrp, currency, status, is_active, gender, service_type FROM Salon_Services WHERE ROWID = " +
        serviceId
    ),
    "Salon_Services"
  );
  if (!service || String(service.status || "").toUpperCase() !== "ACTIVE" || (service.is_active !== undefined && !isTruthy(service.is_active))) {
    fail("This service is not available", 404);
  }

  let packageRow = null;
  if (packageId) {
    packageRow = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, slug, is_active FROM Salon_Packages WHERE ROWID = " + packageId
      ),
      "Salon_Packages"
    );
    if (!packageRow || (packageRow.is_active !== undefined && !isTruthy(packageRow.is_active))) {
      fail("This category is not available", 404);
    }
    const link = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID FROM Outlet_Packages WHERE outlet_id = " +
          outletId +
          " AND package_id = " +
          packageId +
          " AND is_active = true"
      ),
      "Outlet_Packages"
    );
    if (!link) {
      fail("This salon does not offer the selected category", 400);
    }
  }

  const staff = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, first_name, last_name, designation, outlet_id, gender, status, is_active FROM Staff WHERE ROWID = " +
        staffId
    ),
    "Staff"
  );
  if (!staff || String(staff.status || "").toUpperCase() !== "ACTIVE" || (staff.is_active !== undefined && !isTruthy(staff.is_active))) {
    fail("No service experts are available for this service.", 404);
  }
  if (String(staff.outlet_id) !== outletId) {
    fail("This professional does not work at the selected salon", 400);
  }
  if (!engine.staffGenderMatches(staff.gender, gender)) {
    fail("This professional is not available for the selected gender", 400);
  }
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
    fail("This professional does not offer the selected service", 400);
  }

  let priceQuery =
    "SELECT ROWID, outlet_id, package_id, service_id, gender, mrp, selling_price, duration_minutes, is_active FROM Outlet_Service_Prices WHERE outlet_id = " +
    outletId +
    " AND service_id = " +
    serviceId +
    " AND is_active = true";
  if (packageId) {
    priceQuery += " AND package_id = " + packageId;
  }
  const priceRows = rowsOf(await zcql.executeZCQLQuery(priceQuery), "Outlet_Service_Prices");
  const priceRow = engine.pickPriceRow(priceRows, gender);
  if (!priceRow) {
    fail("This service is not available for the selected category", 404);
  }
  const price = money(priceRow.selling_price);
  const duration = num(priceRow.duration_minutes) || num(service.duration_minutes) || 45;
  const startMinutes = engine.parseClock(startTime);
  if (startMinutes == null) {
    fail("Please select a valid time", 400);
  }
  const endTime = engine.formatClock(startMinutes + duration);
  const booked = await loadBookedWindows(zcql, staffId, appointmentDate);
  if (
    booked.some((item) =>
      engine.slotsOverlap(startMinutes, startMinutes + duration, item.start, item.end)
    )
  ) {
    fail("This time slot is no longer available. Please select another time.", 409);
  }

  const snapshot = {
    salon_name_snapshot: String(outlet.name || "").slice(0, 120),
    location_snapshot: engine.locationLabel(outlet).slice(0, 255),
    package_name_snapshot: String((packageRow && packageRow.name) || "").slice(0, 80),
    service_name_snapshot: String(service.name || "").slice(0, 120),
    employee_name_snapshot: [staff.first_name, staff.last_name].filter(Boolean).join(" ").slice(0, 120),
    gender_snapshot: gender.slice(0, 20),
  };

  let slotId = "";
  try {
    const slotInserted = await req.catalystApp.datastore().table("Appointment_Slots").insertRow({
      outlet_id: outletId,
      staff_id: staffId,
      service_id: serviceId,
      slot_date: appointmentDate,
      start_time: engine.formatClock(startMinutes),
      end_time: endTime,
      status: "AVAILABLE",
    });
    slotId = insertedRowId(slotInserted);
  } catch (_) {
    slotId = "";
  }

  const appointmentPayload = {
    user_id: user.user_id,
    outlet_id: outletId,
    staff_id: staffId,
    appointment_number: ("BAY" + Date.now()).slice(0, 30),
    appointment_date: appointmentDate,
    start_time: engine.formatClock(startMinutes),
    end_time: endTime,
    status: "PENDING_PAYMENT",
    payment_status: "PENDING",
    currency: service.currency || "INR",
    subtotal: price,
    discount_amount: 0,
    tax_amount: 0,
    grand_total: price,
    ...snapshot,
  };
  if (packageId) {
    appointmentPayload.package_id = packageId;
  }
  if (slotId) {
    appointmentPayload.slot_id = slotId;
  }

  let inserted;
  try {
    inserted = await req.catalystApp.datastore().table("Appointments").insertRow(appointmentPayload);
  } catch (_) {
    const { salon_name_snapshot, location_snapshot, package_name_snapshot, service_name_snapshot, employee_name_snapshot, gender_snapshot, package_id, ...legacy } = appointmentPayload;
    inserted = await req.catalystApp.datastore().table("Appointments").insertRow(legacy);
  }
  const appointmentId = insertedRowId(inserted);
  if (!appointmentId) {
    fail("Could not create appointment", 500);
  }

  const latestBooked = await loadBookedWindows(zcql, staffId, appointmentDate);
  const conflict = latestBooked.filter((item) =>
    engine.slotsOverlap(startMinutes, startMinutes + duration, item.start, item.end)
  );
  if (conflict.length > 1) {
    await req.catalystApp.datastore().table("Appointments").updateRow({
      ROWID: appointmentId,
      status: "CANCELLED",
    });
    if (slotId) {
      await req.catalystApp.datastore().table("Appointment_Slots").updateRow({
        ROWID: slotId,
        status: "CANCELLED",
      });
    }
    fail("This time slot is no longer available. Please select another time.", 409);
  }

  await req.catalystApp.datastore().table("Appointment_Items").insertRow({
    appointment_id: appointmentId,
    service_id: serviceId,
    staff_id: staffId,
    service_name: service.name,
    duration_minutes: duration,
    quantity: 1,
    unit_price: price,
    line_total: price,
    status: "PENDING_PAYMENT",
  });

  if (slotId) {
    await req.catalystApp.datastore().table("Appointment_Slots").updateRow({
      ROWID: slotId,
      status: "BOOKED",
      appointment_id: appointmentId,
    });
  }

  const row = await loadAppointmentRow(zcql, asId(appointmentId, "appointment_id"), user.user_id);
  if (row && !row.appointment_number) {
    row.appointment_number = engine.bookingNumber(outlet.code || outlet.slug, appointmentId);
  } else if (row && String(row.appointment_number).startsWith("BAY")) {
    const nextNumber = engine.bookingNumber(outlet.code || outlet.slug || outlet.name, appointmentId);
    try {
      await req.catalystApp.datastore().table("Appointments").updateRow({
        ROWID: appointmentId,
        appointment_number: nextNumber,
      });
      row.appointment_number = nextNumber;
    } catch (_) {}
  }

  const notification = { status: "SKIPPED", reason: "Advance payment is required before confirmation" };

  return {
    appointment: mapAppointment(row, await loadAppointmentItems(zcql, asId(appointmentId, "appointment_id"))),
    notification,
  };
}

function salonRoutes(app) {
  app.get("/v1/salon/locations", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT city, state, postal_code, latitude, longitude, is_active FROM Outlets WHERE is_active = true"
        ),
        "Outlets"
      );
      const byCity = new Map();
      for (const row of rows) {
        const city = String(row.city || "").trim();
        if (!city) {
          continue;
        }
        const key = city.toLowerCase() + "|" + String(row.state || "").trim().toLowerCase();
        const current = byCity.get(key) || {
          city,
          state: String(row.state || ""),
          pincode: String(row.postal_code || ""),
          latitude: num(row.latitude),
          longitude: num(row.longitude),
          outlet_count: 0,
        };
        current.outlet_count += 1;
        if (!current.pincode && row.postal_code) {
          current.pincode = String(row.postal_code);
        }
        if ((!current.latitude || !current.longitude) && row.latitude && row.longitude) {
          current.latitude = num(row.latitude);
          current.longitude = num(row.longitude);
        }
        byCity.set(key, current);
      }
      const locations = Array.from(byCity.values()).sort((a, b) =>
        a.city.localeCompare(b.city)
      );
      sendOk(res, { locations });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/salon/outlets", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      if (req.query.id) {
        const outletId = asId(req.query.id, "id");
        const row = await engine.loadActiveOutlet(zcql, outletId);
        const packages = await engine.loadOutletPackages(zcql, outletId);
        sendOk(res, {
          outlet: mapOutlet(row, { packages }),
          packages,
        });
        return;
      }

      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, code, salon_category, address_line1, area, city, state, postal_code, phone, latitude, longitude, opening_time, closing_time, rating, review_count, image_url, google_maps_url, is_active FROM Outlets WHERE is_active = true"
        ),
        "Outlets"
      );
      const matched = engine.filterOutletsByLocation(rows, req.query || {});
      const q = optionalText(req.query.q || req.query.search, "q", 80).toLowerCase();
      const searched = q
        ? matched.filter((item) =>
            [
              item.row.name,
              item.row.slug,
              item.row.address_line1,
              item.row.area,
              item.row.city,
              item.row.state,
              item.row.postal_code,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q)
          )
        : matched;
      const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10) || 50, 1), 100);
      const start = (page - 1) * limit;
      const pageRows = searched.slice(start, start + limit);
      const packageMap = await loadPackageMap(
        zcql,
        pageRows.map((item) => String(item.row.ROWID))
      );
      sendOk(res, {
        location: {
          city: req.query.city || req.query.location || "",
          pincode: req.query.pincode || "",
          lat: req.query.lat || req.query.latitude || "",
          lng: req.query.lng || req.query.longitude || "",
        },
        total: searched.length,
        page,
        outlets: pageRows.map((item) =>
          mapOutlet(item.row, {
            packages: packageMap.get(String(item.row.ROWID)) || [],
            distance_km: item.distance,
            availability: "AVAILABLE",
          })
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/salon/packages", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      if (req.query.outlet_id) {
        const outletId = asId(req.query.outlet_id, "outlet_id");
        const packages = await engine.loadOutletPackages(zcql, outletId);
        sendOk(res, { packages });
        return;
      }
      sendOk(res, { packages: await engine.loadPackages(zcql) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/salon/services", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      if (req.query.outlet_id) {
        const outletId = asId(req.query.outlet_id, "outlet_id");
        const atHomeOnly =
          req.query.is_at_home === "true" ||
          String(req.query.fulfillment_mode || "").trim().toUpperCase() === "AT_HOME";
        const packageId = req.query.package_id ? asId(req.query.package_id, "package_id") : "";
        const grouped = await engine.loadOutletServiceOffers(zcql, outletId, {
          service_type: optionalText(req.query.service_type, "service_type", 40),
          gender: optionalText(req.query.gender, "gender", 20),
          q: optionalText(req.query.q || req.query.search, "q", 80).toLowerCase(),
          package_id: packageId || undefined,
          is_at_home: atHomeOnly ? true : undefined,
          fulfillment_mode: atHomeOnly ? "AT_HOME" : undefined,
        });
        const types = Array.from(
          new Set(grouped.map((item) => item.service_type).filter(Boolean))
        );
        sendOk(res, { services: grouped, service_types: ["All", ...types] });
        return;
      }

      let query =
        "SELECT ROWID, name, slug, description, category_id, image_url, duration_minutes, gender, mrp, selling_price, currency, service_type, is_at_home FROM Salon_Services WHERE status = 'ACTIVE' AND is_active = true";
      if (req.query.is_at_home === "true") {
        query += " AND is_at_home = true";
      }
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
          "SELECT ROWID, first_name, last_name, designation, outlet_id, gender, rating, experience_years, profile_photo_url, profile_image, bio, status, is_active FROM Staff WHERE outlet_id = " +
            outletId +
            " AND status = 'ACTIVE' AND is_active = true"
        ),
        "Staff"
      );
      const gender = optionalText(req.query.gender, "gender", 20);
      const q = optionalText(req.query.q || req.query.search, "q", 80).toLowerCase();
      const staff = rows
        .filter((row) => !allowedIds || allowedIds.has(String(row.ROWID)))
        .filter((row) => engine.staffGenderMatches(row.gender, gender))
        .filter((row) => {
          if (!q) return true;
          return [row.first_name, row.last_name, row.designation, row.bio]
            .join(" ")
            .toLowerCase()
            .includes(q);
        })
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
        const row = await loadAppointmentRow(zcql, id, user.user_id);
        if (!row) {
          fail("Appointment not found", 404);
        }
        sendOk(res, {
          appointment: mapAppointment(row, await loadAppointmentItems(zcql, id)),
        });
        return;
      }

      let rows = [];
      try {
        rows = rowsOf(
          await zcql.executeZCQLQuery(APPOINTMENT_SELECT + " WHERE user_id = " + user.user_id),
          "Appointments"
        );
      } catch (_) {
        rows = rowsOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, outlet_id, staff_id, slot_id, appointment_number, appointment_date, start_time, end_time, status, payment_status, currency, subtotal, grand_total FROM Appointments WHERE user_id = " +
              user.user_id
          ),
          "Appointments"
        );
      }
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
      if (!req.body.slot_id && req.body.outlet_id && req.body.staff_id && req.body.start_time) {
        sendOk(res, await createDirectBooking(req, user));
        return;
      }

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
        fail("Slot not found", 404);
      }
      if (slot.status !== "AVAILABLE") {
        fail("This time slot is no longer available. Please select another time.", 409);
      }
      if (slot.service_id && String(slot.service_id) !== serviceId) {
        fail("This slot is not for the selected service", 400);
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
        fail("Service not found", 404);
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
        fail("This professional does not offer the selected service", 400);
      }

      let price = money(service.selling_price);
      if (req.body.package_id && slot.outlet_id) {
        const priced = engine.pickPriceRow(
          rowsOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID, gender, mrp, selling_price, duration_minutes, is_active FROM Outlet_Service_Prices WHERE outlet_id = " +
                asId(slot.outlet_id, "outlet_id") +
                " AND package_id = " +
                asId(req.body.package_id, "package_id") +
                " AND service_id = " +
                serviceId +
                " AND is_active = true"
            ),
            "Outlet_Service_Prices"
          ),
          req.body.gender || "UNISEX"
        );
        if (priced) {
          price = money(priced.selling_price);
        }
      }

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
        status: "PENDING_PAYMENT",
        payment_status: "PENDING",
        currency: service.currency || "INR",
        subtotal: price,
        discount_amount: 0,
        tax_amount: 0,
        grand_total: price,
      });

      const appointmentId = insertedRowId(inserted);
      if (!appointmentId) {
        fail("Could not create appointment", 500);
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
        status: "PENDING_PAYMENT",
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
        fail("This time slot is no longer available. Please select another time.", 409);
      }

      await req.catalystApp.datastore().table("Appointment_Slots").updateRow({
        ROWID: slot.ROWID,
        status: "BOOKED",
        appointment_id: appointmentId,
      });

      const row = await loadAppointmentRow(zcql, asId(appointmentId, "appointment_id"), user.user_id);
      const notification = { status: "SKIPPED", reason: "Advance payment is required before confirmation" };

      sendOk(res, {
        appointment: mapAppointment(
          row,
          await loadAppointmentItems(zcql, asId(appointmentId, "appointment_id"))
        ),
        notification,
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = salonRoutes;
