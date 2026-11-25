"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  normalizeAvailabilitySchedule,
  jobFitsPartnerSchedule,
  summarizeSchedule,
} = require("../lib/professional-availability-schedule");
const { evaluatePartnerEligibility } = require("../lib/professional-dispatch-engine");

describe("professional availability schedule", () => {
  it("normalizes a weekly schedule JSON string", () => {
    const json = normalizeAvailabilitySchedule({
      mon: [{ start: "09:00", end: "18:00" }],
      tue: [{ start: "10:00", end: "17:00" }],
    });
    const parsed = JSON.parse(json);
    assert.equal(parsed.mon[0].start, "09:00");
    assert.equal(parsed.tue[0].end, "17:00");
  });

  it("rejects invalid time ranges", () => {
    assert.throws(
      () =>
        normalizeAvailabilitySchedule({
          mon: [{ start: "18:00", end: "09:00" }],
        }),
      /End time must be after start time/
    );
  });

  it("allows jobs when no schedule is configured", () => {
    const result = jobFitsPartnerSchedule("", new Date("2026-09-09T10:00:00"), 60);
    assert.equal(result.ok, true);
    assert.equal(result.configured, false);
  });

  it("blocks jobs outside configured day windows", () => {
    const schedule = JSON.stringify({
      mon: [{ start: "09:00", end: "18:00" }],
    });
    const monMorning = new Date("2026-09-07T10:00:00");
    const tuesday = new Date("2026-09-08T10:00:00");
    assert.equal(jobFitsPartnerSchedule(schedule, monMorning, 60).ok, true);
    assert.equal(jobFitsPartnerSchedule(schedule, tuesday, 60).ok, false);
  });

  it("summarizes configured days", () => {
    const summary = summarizeSchedule(
      JSON.stringify({ wed: [{ start: "09:00", end: "13:00" }] })
    );
    assert.equal(summary.configured, true);
    assert.equal(summary.days.length, 1);
    assert.equal(summary.days[0].day, "wed");
  });
});

describe("dispatch schedule filter", () => {
  it("excludes partner when job is outside availability window", async () => {
    const schedule = JSON.stringify({
      mon: [{ start: "09:00", end: "18:00" }],
    });
    const zcql = {
      async executeZCQLQuery(sql) {
        if (sql.includes("Provider_Services")) {
          return [{ Provider_Services: { ROWID: "1" } }];
        }
        if (sql.includes("Service_Areas")) {
          return [{ Service_Areas: { city: "Ranchi" } }];
        }
        if (sql.includes("Professional_Jobs WHERE delivery_partner_row_id")) {
          return [{ Professional_Jobs: { total: 0 } }];
        }
        if (sql.includes("job_status IN ('ASSIGNED'")) {
          return [];
        }
        return [];
      },
    };
    const result = await evaluatePartnerEligibility(
      zcql,
      {
        row_id: "36851000001234567",
        status: "active",
        online_status: "ONLINE_AVAILABLE",
        outlet_row_id: "1001",
        legacy_provider_id: "501",
        availability_schedule: schedule,
      },
      {
        job_type: "HOME_SERVICE",
        outlet_row_id: "1001",
        priority: 0,
      },
      {
        kind: "HOME_SERVICE",
        is_at_home: true,
        service_id: "55",
        visit_city: "Ranchi",
        visit_state: "Jharkhand",
        outlet_row_id: "1001",
        scheduled_at: "2026-09-08 10:00:00",
        duration_minutes: 60,
      },
      {
        partnerLocationRow: {
          state: "Jharkhand",
          district: "Ranchi",
          city: "Ranchi",
          postal_code: "834001",
        },
      }
    );
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes("OUTSIDE_AVAILABILITY_WINDOW"));
  });
});
