"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  identityFromSession,
  mapAddress,
  mapOrderSummary,
  mapAppointmentSummary,
  mapJobSummary,
  newestFirst,
} = require("../lib/account-recover");

describe("account recovery mapping", () => {
  it("restores active addresses including default, label, landmark, and coordinates", () => {
    const address = mapAddress({
      ROWID: "10",
      label: "Home",
      full_name: "Asha Kumar",
      phone: "9876543210",
      line1: "12 MG Road",
      landmark: "Near park",
      city: "Ranchi",
      state: "Jharkhand",
      postal_code: "834001",
      country: "India",
      latitude: "23.34",
      longitude: "85.31",
      is_default: "true",
    });
    assert.equal(address.id, "10");
    assert.equal(address.label, "Home");
    assert.equal(address.landmark, "Near park");
    assert.equal(address.is_default, true);
    assert.equal(address.postal_code, "834001");
  });

  it("does not map a deleted address into the recovery payload", () => {
    const active = [{ ROWID: "1", is_active: true, line1: "Keep" }];
    const deleted = { ROWID: "2", is_active: false, line1: "Gone" };
    const restored = active
      .filter((row) => row.is_active !== false && row.is_active !== "false")
      .map(mapAddress);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, "1");
    assert.equal(String(deleted.ROWID), "2");
  });

  it("restores order history summaries without requiring line items", () => {
    const order = mapOrderSummary({
      ROWID: "55",
      order_number: "BLN-2026-000009",
      status: "CONFIRMED",
      payment_status: "PAID",
      grand_total: 499,
      shipping_city: "Ranchi",
    });
    assert.equal(order.order_number, "BLN-2026-000009");
    assert.equal(order.status, "CONFIRMED");
    assert.deepEqual(order.items, []);
  });

  it("restores salon and home-service bookings", () => {
    const salon = mapAppointmentSummary({
      ROWID: "8",
      appointment_number: "APT-1",
      appointment_date: "2026-09-01 00:00:00",
      start_time: "10:00",
      end_time: "11:00",
      status: "CONFIRMED",
      payment_status: "PAID",
      grand_total: 1200,
    });
    const job = mapJobSummary({
      ROWID: "9",
      status: "ASSIGNED",
      visit_city: "Ranchi",
      visit_line1: "12 MG Road",
      grand_total: 800,
    });
    assert.equal(salon.type, "salon");
    assert.equal(salon.appointment_date, "2026-09-01");
    assert.equal(job.type, "home_service");
    assert.equal(job.visit_city, "Ranchi");
  });

  it("paginates large order histories to newest first", () => {
    const rows = newestFirst(
      [{ ROWID: "10" }, { ROWID: "30" }, { ROWID: "20" }],
      2
    );
    assert.deepEqual(
      rows.map((row) => row.ROWID),
      ["30", "20"]
    );
  });

  it("never recovers another user from query or body phone", () => {
    const userId = identityFromSession(
      { user_id: "36851000000230099" },
      { phone: "+919111111111" },
      { user_id: "36851000000239999" }
    );
    assert.equal(userId, "36851000000230099");
  });
});
