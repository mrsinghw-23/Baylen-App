"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  ONLINE_STATUS,
  normalizeOnlineStatus,
  effectiveOnlineStatus,
  buildJobsTodayQuery,
  buildActiveJobQuery,
  mapActiveJob,
  mapPartnerProfile,
  updatePartnerOnlineStatus,
  buildPartnerDashboard,
  partnerHasActiveJob,
} = require("../lib/partner-dashboard");
const { requireDeliveryPartner, signSession } = require("../lib/session");
const { validateQualification, validateAge, computeAgeFromDob } = require("../lib/delivery-partner-kyc");

function mockReq({ zcql, partnerRow, activeJob = null, jobsToday = 0 }) {
  const partnerRowId = String(partnerRow.ROWID);
  return {
    catalystApp: {
      zcql: () => ({
        async executeZCQLQuery(query) {
          if (query.includes("FROM Delivery_Partners WHERE ROWID")) {
            return [{ Delivery_Partners: partnerRow }];
          }
          if (query.includes("COUNT(ROWID)")) {
            return [{ Service_Jobs: { total: jobsToday } }];
          }
          if (query.includes("status NOT IN ('COMPLETED','CANCELLED')")) {
            return activeJob ? [{ Service_Jobs: activeJob }] : [];
          }
          return zcql ? zcql(query) : [];
        },
      }),
      datastore: () => ({
        table() {
          return {
            async updateRow(row) {
              Object.assign(partnerRow, row);
              return row;
            },
          };
        },
      }),
    },
  };
}

describe("partner dashboard PP-001", () => {
  it("normalizes online status values", () => {
    assert.equal(normalizeOnlineStatus("online_available"), ONLINE_STATUS.ONLINE_AVAILABLE);
    assert.equal(normalizeOnlineStatus(""), ONLINE_STATUS.OFFLINE);
    assert.equal(normalizeOnlineStatus("invalid"), ONLINE_STATUS.OFFLINE);
  });

  it("computes effective busy status when an active job exists", () => {
    assert.equal(
      effectiveOnlineStatus(ONLINE_STATUS.ONLINE_AVAILABLE, true),
      ONLINE_STATUS.ONLINE_BUSY
    );
    assert.equal(
      effectiveOnlineStatus(ONLINE_STATUS.OFFLINE, true),
      ONLINE_STATUS.OFFLINE
    );
  });

  it("builds partner-scoped ZCQL queries", () => {
    assert.match(buildJobsTodayQuery("12"), /delivery_partner_row_id = 12/);
    assert.match(buildActiveJobQuery("12"), /delivery_partner_row_id = 12/);
    assert.match(buildActiveJobQuery("12"), /NOT IN \('COMPLETED','CANCELLED'\)/);
  });

  it("maps active job rows for dashboard cards", () => {
    const mapped = mapActiveJob({
      ROWID: "501",
      booking_number: "AHB-2026-0001",
      status: "ACCEPTED",
      visit_line1: "12 MG Road",
      visit_city: "Ranchi",
      scheduled_at: "2026-09-05 14:00:00",
      grand_total: 1299,
      currency: "INR",
      service_name_snapshot: "Home Facial",
    });
    assert.equal(mapped.id, "501");
    assert.equal(mapped.booking_number, "AHB-2026-0001");
    assert.equal(mapped.service_name, "Home Facial");
  });

  it("maps extended partner profile fields", () => {
    const mapped = mapPartnerProfile({
      ROWID: "7",
      phone: "+919876543210",
      outlet_id: "2",
      status: "active",
      first_name: "Asha",
      last_name: "Singh",
      age: 29,
      qualification: "graduation",
      online_status: "ONLINE_AVAILABLE",
      legacy_provider_id: "3",
      legacy_rider_id: "4",
      profile_photo_url: "https://example.com/photo.jpg",
      rating: 4.8,
    });
    assert.equal(mapped.delivery_partner_id, "dp_7");
    assert.equal(mapped.qualification, "graduation");
    assert.equal(mapped.legacy_provider_id, "3");
  });

  it("returns server-computed dashboard stats for the signed-in partner", async () => {
    const partnerRow = {
      ROWID: "9",
      phone: "+919825391754",
      outlet_id: "1",
      status: "active",
      first_name: "Neha",
      last_name: "Singh",
      age: 28,
      qualification: "intermediate",
      online_status: "ONLINE_AVAILABLE",
      legacy_provider_id: "11",
      legacy_rider_id: "",
      profile_photo_url: "",
      rating: 4.6,
    };
    const req = mockReq({ partnerRow, jobsToday: 2 });
    const dashboard = await buildPartnerDashboard(req, "dp_9");
    assert.equal(dashboard.stats.jobs_today, 2);
    assert.equal(dashboard.stats.earnings_today, 0);
    assert.equal(dashboard.partner.delivery_partner_id, "dp_9");
    assert.equal(dashboard.partner.outlet_id, "1");
    assert.equal(dashboard.can_go_offline, true);
  });

  it("does not treat ASSIGNED offers as active jobs blocking availability", async () => {
    const zcql = async (query) => {
      if (query.includes("FROM Professional_Jobs") && query.includes("ASSIGNED")) {
        return [{ Professional_Jobs: { ROWID: "900" } }];
      }
      if (query.includes("FROM Professional_Jobs")) {
        return [];
      }
      return [];
    };
    const hasActive = await partnerHasActiveJob({ executeZCQLQuery: zcql }, "9");
    assert.equal(hasActive, false);
  });

  it("blocks going offline while an active job is in progress", async () => {
    const partnerRow = {
      ROWID: "9",
      phone: "+919825391754",
      outlet_id: "1",
      status: "active",
      first_name: "Neha",
      last_name: "Singh",
      age: 28,
      qualification: "intermediate",
      online_status: "ONLINE_AVAILABLE",
    };
    const req = mockReq({
      partnerRow,
      activeJob: {
        ROWID: "501",
        booking_number: "AHB-2026-0001",
        status: "EN_ROUTE",
        visit_line1: "12 MG Road",
        visit_city: "Ranchi",
        scheduled_at: "2026-09-05 14:00:00",
        grand_total: 999,
        currency: "INR",
        service_name_snapshot: "Home Facial",
      },
    });
    await assert.rejects(
      () => updatePartnerOnlineStatus(req, "dp_9", ONLINE_STATUS.OFFLINE),
      (error) => error.code === "ACTIVE_JOB_IN_PROGRESS"
    );
  });

  it("persists online status updates through the API layer", async () => {
    const partnerRow = {
      ROWID: "9",
      phone: "+919825391754",
      outlet_id: "1",
      status: "active",
      first_name: "Neha",
      last_name: "Singh",
      age: 28,
      qualification: "intermediate",
      online_status: "OFFLINE",
    };
    const req = mockReq({ partnerRow });
    const dashboard = await updatePartnerOnlineStatus(
      req,
      "dp_9",
      ONLINE_STATUS.ONLINE_AVAILABLE
    );
    assert.equal(partnerRow.online_status, ONLINE_STATUS.ONLINE_AVAILABLE);
    assert.equal(dashboard.partner.online_status, ONLINE_STATUS.ONLINE_AVAILABLE);
  });

  it("requires delivery partner role for dashboard access", () => {
    const customerToken = signSession({
      sub: "user_1",
      role: "customer",
      user_id: "user_1",
    });
    assert.throws(() => requireDeliveryPartner({ headers: { "x-baylen-token": customerToken } }));
  });

  it("validates age and qualification inputs", () => {
    assert.equal(validateQualification("graduation"), "graduation");
    assert.equal(validateQualification("12th"), "intermediate");
    assert.equal(validateAge("28"), 28);
    assert.equal(computeAgeFromDob("1995-06-15"), computeAgeFromDob("1995-06-15"));
  });
});
