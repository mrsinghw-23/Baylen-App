"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  calculateEarningAmounts,
  resolveEarningStatus,
  settleProfessionalJobFinance,
  findEarningByJob,
  sumPartnerEarnings,
  sumPartnerPendingEarnings,
  sumPartnerAvailableEarnings,
  listPartnerEarningsHistory,
  EARNING_STATUS,
} = require("../lib/professional-finance-engine");
const { buildPartnerEarnings } = require("../lib/partner-dashboard");
const { JOB_TYPES, REFERENCE_TYPES } = require("../lib/professional-job-engine");

const PARTNER_ID = "36851000000379403";
const JOB_ID = "36851000000391424";
const SERVICE_JOB_ID = "36851000000388549";

function homeServiceJob(overrides = {}) {
  return {
    id: JOB_ID,
    job_number: "PJ20260001",
    job_type: JOB_TYPES.HOME_SERVICE,
    reference_type: REFERENCE_TYPES.SERVICE_JOB,
    reference_row_id: SERVICE_JOB_ID,
    delivery_partner_row_id: PARTNER_ID,
    status: "COMPLETED",
    ...overrides,
  };
}

function buildFinanceApp(paymentStatus = "PAID") {
  const state = {
    earnings: [],
    invoices: [],
    nextEarningId: 9001,
    nextInvoiceId: 8001,
    serviceJobs: {
      [SERVICE_JOB_ID]: {
        ROWID: SERVICE_JOB_ID,
        booking_number: "BK-100",
        user_id: "100",
        grand_total: 1000,
        currency: "INR",
        payment_status: paymentStatus,
      },
    },
  };

  const zcql = {
    async executeZCQLQuery(sql) {
      const query = String(sql);
      if (query.includes("FROM Professional_Earnings WHERE professional_job_row_id")) {
        const found = state.earnings.find((row) => String(row.professional_job_row_id) === JOB_ID);
        return found ? [{ Professional_Earnings: found }] : [];
      }
      if (query.includes("FROM Professional_Invoices WHERE professional_job_row_id")) {
        const found = state.invoices.find((row) => String(row.professional_job_row_id) === JOB_ID);
        return found ? [{ Professional_Invoices: found }] : [];
      }
      if (query.includes("FROM Service_Jobs WHERE ROWID")) {
        return [{ Service_Jobs: state.serviceJobs[SERVICE_JOB_ID] }];
      }
      if (query.includes("SUM(net_amount)") && query.includes("status = 'PENDING'")) {
        const total = state.earnings
          .filter((row) => row.status === "PENDING")
          .reduce((sum, row) => sum + Number(row.net_amount), 0);
        return [{ Professional_Earnings: { total } }];
      }
      if (query.includes("SUM(net_amount)") && query.includes("status = 'AVAILABLE'")) {
        const total = state.earnings
          .filter((row) => row.status === "AVAILABLE")
          .reduce((sum, row) => sum + Number(row.net_amount), 0);
        return [{ Professional_Earnings: { total } }];
      }
      if (query.includes("SUM(net_amount)")) {
        const total = state.earnings
          .filter((row) => String(row.professional_row_id) === PARTNER_ID)
          .reduce((sum, row) => sum + Number(row.net_amount), 0);
        return [{ Professional_Earnings: { total } }];
      }
      if (query.includes("FROM Professional_Earnings WHERE professional_row_id") && query.includes("ORDER BY")) {
        return state.earnings
          .filter((row) => String(row.professional_row_id) === PARTNER_ID)
          .map((row) => ({ Professional_Earnings: row }));
      }
      if (query.includes("net_amount, metadata_json FROM Professional_Earnings")) {
        return state.earnings
          .filter((row) => String(row.professional_row_id) === PARTNER_ID)
          .map((row) => ({
            Professional_Earnings: {
              net_amount: row.net_amount,
              metadata_json: row.metadata_json,
            },
          }));
      }
      return [];
    },
  };

  const app = {
    zcql: () => zcql,
    datastore: () => ({
      table(name) {
        return {
          async insertRow(row) {
            if (name === "Professional_Earnings") {
              const id = String(state.nextEarningId++);
              const record = { ROWID: id, ...row };
              state.earnings.push(record);
              return { ROWID: id };
            }
            if (name === "Professional_Invoices") {
              const id = String(state.nextInvoiceId++);
              const record = { ROWID: id, ...row };
              state.invoices.push(record);
              return { ROWID: id };
            }
            return {};
          },
        };
      },
    }),
    _state: state,
  };
  return app;
}

describe("professional-finance PP-009", () => {
  it("calculates commission and net from gross", () => {
    const amounts = calculateEarningAmounts(1000, { tip: 50 });
    assert.equal(amounts.gross_amount, 1000);
    assert.equal(amounts.commission_amount, 200);
    assert.equal(amounts.tip_amount, 50);
    assert.equal(amounts.net_amount, 850);
  });

  it("marks prepaid earnings as AVAILABLE", () => {
    assert.equal(resolveEarningStatus("PAID"), EARNING_STATUS.AVAILABLE);
    assert.equal(resolveEarningStatus("SUCCESS"), EARNING_STATUS.AVAILABLE);
  });

  it("keeps COD earnings PENDING", () => {
    assert.equal(resolveEarningStatus("PENDING"), EARNING_STATUS.PENDING);
    assert.equal(resolveEarningStatus("COD_PENDING"), EARNING_STATUS.PENDING);
  });

  it("duplicate earning idempotency key is deterministic", () => {
    const keyA = "earning:professional_job:36851000000393001";
    const keyB = "earning:professional_job:36851000000393001";
    assert.equal(keyA, keyB);
  });
});

describe("Module 5 earnings and finance", () => {
  it("calculateEarningAmounts applies incentive, tip, and adjustment", () => {
    const amounts = calculateEarningAmounts(1000, {
      incentive: 100,
      tip: 50,
      adjustment: -10,
    });
    assert.equal(amounts.commission_amount, 200);
    assert.equal(amounts.incentive_amount, 100);
    assert.equal(amounts.tip_amount, 50);
    assert.equal(amounts.adjustment_amount, -10);
    assert.equal(amounts.net_amount, 940);
  });

  it("settleProfessionalJobFinance is idempotent on repeat settlement", async () => {
    const app = buildFinanceApp("PAID");
    const partner = { row_id: PARTNER_ID };
    const job = homeServiceJob();
    const first = await settleProfessionalJobFinance(app, { job, partner });
    const second = await settleProfessionalJobFinance(app, { job, partner });
    assert.equal(first.finance_settled, true);
    assert.equal(first.finance_idempotent, false);
    assert.equal(first.net_amount, 800);
    assert.equal(second.finance_idempotent, true);
    assert.equal(second.earning_id, first.earning_id);
    assert.equal(app._state.earnings.length, 1);
    assert.equal(app._state.invoices.length, 1);
  });

  it("findEarningByJob returns existing earning without creating a new row", async () => {
    const app = buildFinanceApp("PAID");
    await settleProfessionalJobFinance(app, { job: homeServiceJob(), partner: { row_id: PARTNER_ID } });
    const zcql = app.zcql();
    const found = await findEarningByJob(zcql, JOB_ID);
    assert.ok(found);
    assert.equal(Number(found.net_amount), 800);
    assert.equal(app._state.earnings.length, 1);
  });

  it("sumPartnerEarnings totals net amounts across multiple jobs", async () => {
    const app = buildFinanceApp("PAID");
    app._state.earnings.push(
      {
        ROWID: "9001",
        professional_row_id: PARTNER_ID,
        net_amount: 800,
        status: "AVAILABLE",
        metadata_json: JSON.stringify({ job_type: "HOME_SERVICE", reference_label: "BK-1" }),
      },
      {
        ROWID: "9002",
        professional_row_id: PARTNER_ID,
        net_amount: 640,
        status: "AVAILABLE",
        metadata_json: JSON.stringify({ job_type: "HOME_SERVICE", reference_label: "BK-2" }),
      }
    );
    const total = await sumPartnerEarnings(app.zcql(), PARTNER_ID);
    assert.equal(total, 1440);
  });

  it("listPartnerEarningsHistory returns mapped earning rows", async () => {
    const app = buildFinanceApp("PAID");
    app._state.earnings.push(
      {
        ROWID: "9001",
        earning_number: "PE20260001",
        professional_row_id: PARTNER_ID,
        professional_job_row_id: JOB_ID,
        reference_type: "SERVICE_JOB",
        gross_amount: 1000,
        commission_amount: 200,
        tip_amount: 0,
        net_amount: 800,
        currency: "INR",
        status: "AVAILABLE",
        created_at: "2026-09-09 10:00:00",
        metadata_json: JSON.stringify({
          reference_label: "BK-100",
          job_type: "HOME_SERVICE",
        }),
      }
    );
    const history = await listPartnerEarningsHistory(app.zcql(), PARTNER_ID, { limit: 10 });
    assert.equal(history.length, 1);
    assert.equal(history[0].job_title, "BK-100");
    assert.equal(history[0].net_amount, 800);
    assert.equal(history[0].status, "AVAILABLE");
  });

  it("settlement marks online prepaid earnings as AVAILABLE", async () => {
    const app = buildFinanceApp("PAID");
    const result = await settleProfessionalJobFinance(app, {
      job: homeServiceJob(),
      partner: { row_id: PARTNER_ID },
    });
    assert.equal(result.earning_status, EARNING_STATUS.AVAILABLE);
    assert.equal(app._state.earnings[0].status, "AVAILABLE");
  });

  it("settlement keeps COD earnings PENDING until collected", async () => {
    const app = buildFinanceApp("COD_PENDING");
    const result = await settleProfessionalJobFinance(app, {
      job: homeServiceJob(),
      partner: { row_id: PARTNER_ID },
    });
    assert.equal(result.earning_status, EARNING_STATUS.PENDING);
    assert.equal(app._state.earnings[0].status, "PENDING");
  });

  it("partner earnings dashboard reflects today and available totals", async () => {
    const app = buildFinanceApp("PAID");
    app._state.earnings.push(
      {
        ROWID: "9001",
        professional_row_id: PARTNER_ID,
        net_amount: 800,
        status: "AVAILABLE",
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        metadata_json: JSON.stringify({ job_type: "HOME_SERVICE" }),
      },
      {
        ROWID: "9002",
        professional_row_id: PARTNER_ID,
        net_amount: 500,
        status: "PENDING",
        created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        metadata_json: JSON.stringify({ job_type: "HOME_SERVICE" }),
      }
    );
    const partnerRow = {
      ROWID: PARTNER_ID,
      phone: "+919876543210",
      status: "active",
      online_status: "ONLINE_AVAILABLE",
    };
    const zcqlRef = app.zcql();
    const baseQuery = zcqlRef.executeZCQLQuery.bind(zcqlRef);
    zcqlRef.executeZCQLQuery = async (sql) => {
      const query = String(sql);
      if (query.includes("FROM Delivery_Partners WHERE ROWID")) {
        return [{ Delivery_Partners: partnerRow }];
      }
      if (query.includes("SUM(commission_amount)")) {
        return [{ Professional_Earnings: { total: 200 } }];
      }
      if (query.includes("COUNT(ROWID)") && query.includes("COMPLETED")) {
        return [{ Professional_Jobs: { total: 2 } }];
      }
      return baseQuery(sql);
    };
    const req = {
      catalystApp: {
        zcql: () => zcqlRef,
        datastore: app.datastore,
      },
    };
    const earnings = await buildPartnerEarnings(req, "dp_" + PARTNER_ID, { limit: 10 });
    assert.equal(earnings.summary.total_earnings, 1300);
    assert.equal(earnings.summary.available_earnings, 800);
    assert.equal(earnings.summary.pending_earnings, 500);
    assert.equal(earnings.history.length, 2);
  });
});
