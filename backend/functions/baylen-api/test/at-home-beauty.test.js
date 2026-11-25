"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  customerStatusLabel,
  canCustomerCancel,
  canShowLiveTracking,
} = require("../lib/at-home-beauty-fsm");
const { checkServiceability, listAtHomeServices, confirmPaidBooking, createBooking, normalizeGenderPreference, matchesBookingStatusFilter, listAvailableProviders } = require("../lib/at-home-beauty-engine");
const salonEngine = require("../lib/salon-engine");

function buildZcql({ outlets = [], zones = [], pincodes = [], services = [], prices = [] } = {}) {
  return {
    async executeZCQLQuery(query) {
      const sql = String(query);
      if (sql.includes("Beauty_Service_Zones")) {
        return zones.map((row) => ({ Beauty_Service_Zones: row }));
      }
      if (sql.includes("FROM Outlets")) {
        return outlets.map((row) => ({ Outlets: row }));
      }
      if (sql.includes("Serviceable_Pincodes")) {
        const match = sql.match(/pincode = '([^']+)'/);
        const pin = match ? match[1] : null;
        const row = pincodes.find((item) => item.pincode === pin);
        return row ? [{ Serviceable_Pincodes: row }] : [];
      }
      if (sql.includes("FROM Salon_Services")) {
        return services.map((row) => ({ Salon_Services: row }));
      }
      if (sql.includes("Outlet_Service_Prices")) {
        return prices.map((row) => ({ Outlet_Service_Prices: row }));
      }
      return [];
    },
  };
}

describe("at-home beauty FSM labels", () => {
  it("maps internal status to customer copy", () => {
    assert.equal(customerStatusLabel("EN_ROUTE"), "Professional on the way");
    assert.equal(customerStatusLabel("STARTED"), "Service in progress");
  });

  it("allows cancel before en-route", () => {
    assert.equal(canCustomerCancel("CONFIRMED"), true);
    assert.equal(canCustomerCancel("EN_ROUTE"), false);
  });

  it("enables tracking only after assignment travel", () => {
    assert.equal(canShowLiveTracking("ASSIGNED"), false);
    assert.equal(canShowLiveTracking("EN_ROUTE"), true);
  });
});

describe("serviceability", () => {
  it("marks location serviceable when outlet zone matches city", async () => {
    const zcql = buildZcql({
      zones: [{ ROWID: "1", outlet_id: "10", city: "Mumbai", state: "Maharashtra", is_active: true, max_radius_km: 20 }],
      outlets: [
        {
          ROWID: "10",
          name: "Baylen Andheri",
          city: "Mumbai",
          state: "Maharashtra",
          latitude: 19.11,
          longitude: 72.86,
          is_active: true,
          service_radius_km: 15,
        },
      ],
    });
    const result = await checkServiceability(zcql, {
      latitude: 19.12,
      longitude: 72.87,
      city: "Mumbai",
      state: "Maharashtra",
    });
    assert.equal(result.serviceable, true);
    assert.equal(result.eligible_outlets.length, 1);
  });

  it("returns not serviceable when no outlets match", async () => {
    const zcql = buildZcql({ outlets: [], zones: [] });
    const result = await checkServiceability(zcql, {
      latitude: 28.61,
      longitude: 77.2,
      city: "Delhi",
    });
    assert.equal(result.serviceable, false);
  });
});

describe("salon reuse for at-home services", () => {
  it("filters Salon_Services via salon-engine with is_at_home", async () => {
    const zcql = buildZcql({
      outlets: [{ ROWID: "10", name: "Baylen", city: "Mumbai", is_active: true }],
      services: [
        { ROWID: "1", name: "Haircut", service_type: "Hair", status: "ACTIVE", is_active: true, is_at_home: true, duration_minutes: 45, currency: "INR" },
        { ROWID: "2", name: "Bridal Makeup", service_type: "Makeup", status: "ACTIVE", is_active: true, is_at_home: false, duration_minutes: 90, currency: "INR" },
      ],
      prices: [
        { ROWID: "100", outlet_id: "10", service_id: "1", gender: "UNISEX", mrp: 500, selling_price: 399, duration_minutes: 45, is_active: true },
        { ROWID: "101", outlet_id: "10", service_id: "2", gender: "UNISEX", mrp: 5000, selling_price: 4500, duration_minutes: 90, is_active: true },
      ],
    });
    const services = await listAtHomeServices(zcql, "10", {});
    assert.equal(services.length, 1);
    assert.equal(services[0].name, "Haircut");
  });

  it("exposes isAtHomeEnabled helper on salon-engine", () => {
    assert.equal(salonEngine.isAtHomeEnabled(true), true);
    assert.equal(salonEngine.isAtHomeEnabled("true"), true);
    assert.equal(salonEngine.isAtHomeEnabled(false), false);
  });
});

describe("booking hardening", () => {
  it("normalizes gender preference", () => {
    assert.equal(normalizeGenderPreference("male"), "MALE");
    assert.equal(normalizeGenderPreference(" Female "), "FEMALE");
    assert.equal(normalizeGenderPreference("other"), "");
  });

  it("filters booking status buckets", () => {
    assert.equal(matchesBookingStatusFilter("CONFIRMED", "upcoming"), true);
    assert.equal(matchesBookingStatusFilter("COMPLETED", "upcoming"), false);
    assert.equal(matchesBookingStatusFilter("CANCELLED", "cancelled"), true);
    assert.equal(matchesBookingStatusFilter("COMPLETED", "completed"), true);
  });

  it("returns existing booking for duplicate idempotency key", async () => {
    const existing = {
      ROWID: "501",
      booking_number: "HS123",
      status: "REQUESTED",
      visit_line1: "Home",
      visit_city: "Ranchi",
      scheduled_at: "2026-09-06 10:00:00",
      grand_total: 999,
      currency: "INR",
      payment_status: "PENDING",
      gender_preference: "FEMALE",
      service_name_snapshot: "Hair Spa",
    };
    const app = {
      zcql() {
        return {
          async executeZCQLQuery(query) {
            const sql = String(query);
            if (sql.includes("idempotency_key")) {
              return [{ Service_Jobs: existing }];
            }
            return [];
          },
        };
      },
      datastore() {
        throw new Error("insert should not run");
      },
    };
    const result = await createBooking(
      app,
      { user_id: "100" },
      { idempotency_key: "retry-1", gender: "FEMALE" }
    );
    assert.equal(result.idempotent, true);
    assert.equal(result.booking.id, "501");
    assert.equal(result.booking.gender_preference, "FEMALE");
  });
});

describe("confirmPaidBooking ownership", () => {
  function buildJobApp(job) {
    return {
      zcql() {
        return {
          async executeZCQLQuery(query) {
            const sql = String(query);
            if (sql.includes("FROM Service_Jobs")) {
              return [{ Service_Jobs: job }];
            }
            return [];
          },
        };
      },
      datastore() {
        return {
          table() {
            return {
              async updateRow() {
                return {};
              },
              async insertRow() {
                return {};
              },
            };
          },
        };
      },
    };
  }

  it("rejects confirm when booking belongs to another user", async () => {
    const app = buildJobApp({ ROWID: "900", status: "REQUESTED", user_id: "200" });
    await assert.rejects(
      () => confirmPaidBooking(app, "900", { user_id: "100" }),
      (error) => error.status === 404
    );
  });
});

describe("home service professionals", () => {
  function buildProviderZcql(state) {
    return {
      async executeZCQLQuery(query) {
        const sql = String(query);
        if (sql.includes("FROM Outlets")) {
          return [{ Outlets: state.outlet }];
        }
        if (sql.includes("FROM Provider_Services")) {
          return (state.providerServices || []).map((row) => ({ Provider_Services: row }));
        }
        if (sql.includes("FROM Service_Areas")) {
          return (state.serviceAreas || []).map((row) => ({ Service_Areas: row }));
        }
        if (sql.includes("FROM Providers")) {
          if (sql.includes("status = 'AVAILABLE'")) {
            return (state.providers || [])
              .filter((row) => row.status === "AVAILABLE" && row.is_active !== false)
              .map((row) => ({ Providers: { ROWID: row.ROWID } }));
          }
          return (state.providers || []).map((row) => ({ Providers: row }));
        }
        if (sql.includes("FROM Staff_Services")) {
          return (state.staffServices || []).map((row) => ({ Staff_Services: row }));
        }
        if (sql.includes("FROM Staff")) {
          let rows = state.staff || [];
          const inMatch = sql.match(/ROWID IN \(([^)]+)\)/);
          if (inMatch) {
            const ids = new Set(inMatch[1].split(",").map((part) => part.trim()));
            rows = rows.filter((row) => ids.has(String(row.ROWID)));
          }
          return rows.map((row) => ({ Staff: row }));
        }
        return [];
      },
    };
  }

  it("falls back to outlet staff when provider tables are empty", async () => {
    const zcql = buildProviderZcql({
      outlet: { ROWID: "10", name: "Baylen", city: "Mumbai", is_active: true, opening_time: "09:00", closing_time: "20:00" },
      staffServices: [{ staff_id: "201", service_id: "1" }],
      staff: [
        {
          ROWID: "201",
          first_name: "Anita",
          last_name: "Sharma",
          designation: "Stylist",
          outlet_id: "10",
          gender: "FEMALE",
          rating: 4.8,
          experience_years: 5,
          status: "ACTIVE",
          is_active: true,
        },
        {
          ROWID: "202",
          first_name: "Ravi",
          last_name: "Kumar",
          designation: "Barber",
          outlet_id: "10",
          gender: "MALE",
          rating: 4.5,
          experience_years: 3,
          status: "ACTIVE",
          is_active: true,
        },
      ],
    });
    const professionals = await listAvailableProviders(zcql, {
      outlet_id: "10",
      service_id: "1",
      city: "Mumbai",
      gender: "FEMALE",
    });
    assert.equal(professionals.length, 1);
    assert.equal(professionals[0].id, "201");
    assert.equal(professionals[0].name, "Anita Sharma");
    assert.equal(professionals[0].designation, "Stylist");
  });

  it("prefers dedicated providers when provider tables are populated", async () => {
    const zcql = buildProviderZcql({
      outlet: { ROWID: "10", name: "Baylen", city: "Mumbai", is_active: true, opening_time: "09:00", closing_time: "20:00" },
      providerServices: [{ provider_id: "301", service_id: "1" }],
      serviceAreas: [{ provider_id: "301", city: "Mumbai", is_active: true }],
      providers: [
        {
          ROWID: "301",
          first_name: "Priya",
          last_name: "Singh",
          designation: "Makeup Artist",
          status: "AVAILABLE",
          is_active: true,
          rating: 4.9,
        },
      ],
      staff: [
        {
          ROWID: "201",
          first_name: "Anita",
          last_name: "Sharma",
          outlet_id: "10",
          gender: "FEMALE",
          status: "ACTIVE",
          is_active: true,
        },
      ],
    });
    const professionals = await listAvailableProviders(zcql, {
      outlet_id: "10",
      service_id: "1",
      city: "Mumbai",
      gender: "FEMALE",
    });
    assert.equal(professionals.length, 1);
    assert.equal(professionals[0].id, "301");
    assert.equal(professionals[0].name, "Priya Singh");
  });
});
