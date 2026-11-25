"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const {
  insertPartnerNotification,
  notifyPartnerWithRetry,
  emitProfessionalLifecycleEvent,
  countUnreadPartnerNotifications,
  listPartnerNotifications,
  markPartnerNotificationsRead,
} = require("../lib/professional-partner-notify");
const { notifyPartnerAssigned, buildJobOfferNotification } = require("../lib/professional-dispatch-engine");

const PARTNER_ID = "36851000000379403";
const JOB_ID = "36851000000391424";

function buildNotifyApp() {
  const state = {
    notifications: [],
    whatsapp: [],
    nextId: 1,
  };

  const zcql = {
    async executeZCQLQuery(sql) {
      const query = String(sql);
      if (query.includes("COUNT(ROWID)") && query.includes("read_at IS NULL")) {
        const unread = state.notifications.filter(
          (row) => String(row.partner_row_id) === PARTNER_ID && !row.read_at
        );
        return [{ Partner_Notifications: { total: unread.length } }];
      }
      if (query.includes("FROM Partner_Notifications WHERE partner_row_id")) {
        return state.notifications
          .filter((row) => String(row.partner_row_id) === PARTNER_ID)
          .map((row) => ({ Partner_Notifications: row }));
      }
      return [];
    },
  };

  return {
    _state: state,
    zcql: () => zcql,
    datastore: () => ({
      table(name) {
        return {
          async insertRow(row) {
            if (name === "Partner_Notifications") {
              const id = String(state.nextId++);
              const record = { ROWID: id, read_at: null, ...row };
              state.notifications.push(record);
              return { ROWID: id };
            }
            if (name === "WhatsApp_Notifications") {
              state.whatsapp.push(row);
              return { ROWID: String(state.nextId++) };
            }
            return {};
          },
          async updateRow(row) {
            if (name === "Partner_Notifications") {
              const existing = state.notifications.find((item) => String(item.ROWID) === String(row.ROWID));
              if (existing) {
                Object.assign(existing, row);
              }
            }
          },
        };
      },
    }),
  };
}

describe("Module 6 partner notifications", () => {
  it("job assigned creates Partner_Notifications row readable via list API", async () => {
    const app = buildNotifyApp();
    const payload = buildJobOfferNotification(
      { row_id: PARTNER_ID, phone: "+919876543210", delivery_partner_id: "dp_" + PARTNER_ID },
      { id: JOB_ID, job_number: "PJ20260001", reference_type: "SERVICE_JOB", reference_row_id: "501" },
      { service_name: "Home Facial", visit_city: "Ranchi" }
    );
    const inserted = await insertPartnerNotification(app, payload);
    assert.ok(inserted?.ROWID);
    const listed = await listPartnerNotifications(app.zcql(), PARTNER_ID, { limit: 10 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].type, "PROFESSIONAL_JOB_ASSIGNED");
    assert.equal(listed[0].professional_job_row_id, JOB_ID);
    assert.equal(listed[0].read, false);
  });

  it("notifyPartnerAssigned integration writes inbox notification", async () => {
    const app = buildNotifyApp();
    const result = await notifyPartnerAssigned(
      null,
      {
        row_id: PARTNER_ID,
        phone: "+919876543210",
        delivery_partner_id: "dp_" + PARTNER_ID,
      },
      {
        id: JOB_ID,
        job_number: "PJ20260002",
        reference_type: "SERVICE_JOB",
        reference_row_id: "501",
      },
      { service_name: "Spa at Home" },
      app
    );
    assert.equal(result.recorded, true);
    assert.equal(app._state.notifications.length, 1);
    assert.equal(app._state.notifications[0].notification_type, "PROFESSIONAL_JOB_ASSIGNED");
  });

  it("job cancelled emits partner notification", async () => {
    const app = buildNotifyApp();
    const result = await emitProfessionalLifecycleEvent(app, null, {
      event: "PROFESSIONAL_JOB_CANCELLED",
      job: {
        id: JOB_ID,
        reference_type: "SERVICE_JOB",
        reference_row_id: "501",
      },
      partnerRowId: PARTNER_ID,
      partnerPhone: "+919876543210",
      note: "Customer cancelled the booking",
    });
    assert.equal(result.partner_notification.ok, true);
    assert.equal(app._state.notifications.length, 1);
    assert.equal(app._state.notifications[0].notification_type, "PROFESSIONAL_JOB_CANCELLED");
  });

  it("unread count increments when new notifications arrive", async () => {
    const app = buildNotifyApp();
    assert.equal(await countUnreadPartnerNotifications(app.zcql(), PARTNER_ID), 0);
    await notifyPartnerWithRetry(app, null, {
      event: "PROFESSIONAL_JOB_ASSIGNED",
      partner_row_id: PARTNER_ID,
      partner_phone: "+919876543210",
      title: "New job assigned",
      body: "Facial booking",
      reference_type: "SERVICE_JOB",
      reference_id: "501",
      professional_job_row_id: JOB_ID,
    });
    assert.equal(await countUnreadPartnerNotifications(app.zcql(), PARTNER_ID), 1);
  });

  it("mark as read decrements unread count", async () => {
    const app = buildNotifyApp();
    await insertPartnerNotification(app, {
      partner_row_id: PARTNER_ID,
      notification_type: "PROFESSIONAL_JOB_ASSIGNED",
      title: "New job assigned",
      body: "Facial booking",
      reference_type: "SERVICE_JOB",
      reference_id: "501",
      professional_job_row_id: JOB_ID,
    });
    const listed = await listPartnerNotifications(app.zcql(), PARTNER_ID);
    assert.equal(await countUnreadPartnerNotifications(app.zcql(), PARTNER_ID), 1);
    const result = await markPartnerNotificationsRead(app, PARTNER_ID, [listed[0].id]);
    assert.equal(result.updated, 1);
    assert.equal(await countUnreadPartnerNotifications(app.zcql(), PARTNER_ID), 0);
    const refreshed = await listPartnerNotifications(app.zcql(), PARTNER_ID);
    assert.equal(refreshed[0].read, true);
  });

  it("critical events create WhatsApp audit rows", async () => {
    const app = buildNotifyApp();
    await notifyPartnerWithRetry(app, null, {
      event: "PROFESSIONAL_JOB_ASSIGNED",
      partner_row_id: PARTNER_ID,
      partner_phone: "+919876543210",
      title: "New job assigned",
      body: "Facial booking",
      reference_type: "SERVICE_JOB",
      reference_id: "501",
      professional_job_row_id: JOB_ID,
      template_name: "professional_job_assigned",
      template_variables: ["PJ20260001", "Facial"],
    });
    assert.equal(app._state.whatsapp.length, 1);
    assert.equal(app._state.whatsapp[0].notification_type, "PROFESSIONAL_JOB_ASSIGNED");
    assert.equal(app._state.whatsapp[0].mobile, "+919876543210");
  });
});
