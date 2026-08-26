const { asId, rowOf, rowsOf, num, sendOk } = require("../lib/http");
const { requireUser } = require("../lib/session");

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function mapNotification(row) {
  return {
    id: String(row.ROWID),
    type: row.type || "",
    title: row.title || "",
    body: row.body || "",
    reference_type: row.reference_type || "",
    reference_id: row.reference_id ? String(row.reference_id) : "",
    delivery_status: row.delivery_status || "PENDING",
    created_at: row.CREATEDTIME || row.created_at || "",
    read_at: row.read_at || "",
  };
}

function asBool(value, fallback) {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return fallback;
}

function mapPreferences(row) {
  return {
    push_enabled: row ? asBool(row.push_enabled, true) : true,
    email_enabled: row ? asBool(row.email_enabled, true) : true,
    order_updates: row ? asBool(row.order_updates, true) : true,
    booking_updates: row ? asBool(row.booking_updates, true) : true,
    service_tracking: row ? asBool(row.service_tracking, true) : true,
    offers: row ? asBool(row.offers, true) : true,
  };
}

function notificationsRoutes(app) {
  app.get("/v1/notifications", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const limit = Math.min(Math.max(num(req.query.limit) || 50, 1), 100);
      const rows = rowsOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, type, title, body, reference_type, reference_id, delivery_status, read_at, CREATEDTIME FROM Notifications WHERE user_id = " +
              user.user_id
          ),
        "Notifications"
      );
      rows.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      sendOk(res, {
        unread_count: rows.filter((row) => !row.read_at).length,
        notifications: rows.slice(0, limit).map(mapNotification),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/notifications/read", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const table = req.catalystApp.datastore().table("Notifications");
      const readAt = nowSql();

      if (req.body.all === true) {
        const rows = rowsOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID, read_at FROM Notifications WHERE user_id = " + user.user_id
            ),
          "Notifications"
        );
        for (const row of rows) {
          if (!row.read_at) {
            await table.updateRow({ ROWID: row.ROWID, read_at: readAt });
          }
        }
        sendOk(res, { read: rows.length });
        return;
      }

      const notificationId = asId(req.body.notification_id, "notification_id");
      const existing = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID FROM Notifications WHERE ROWID = " +
              notificationId +
              " AND user_id = " +
              user.user_id
          ),
        "Notifications"
      );
      if (!existing) {
        const error = new Error("Notification not found");
        error.status = 404;
        throw error;
      }

      await table.updateRow({ ROWID: existing.ROWID, read_at: readAt });
      sendOk(res, { read: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/notifications/preferences", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const row = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID, push_enabled, email_enabled, order_updates, booking_updates, service_tracking, offers FROM Notification_Preferences WHERE user_id = " +
              user.user_id
          ),
        "Notification_Preferences"
      );
      sendOk(res, { preferences: mapPreferences(row) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/notifications/preferences", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      const existing = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Notification_Preferences WHERE user_id = " + user.user_id
        ),
        "Notification_Preferences"
      );
      const payload = {
        user_id: user.user_id,
        push_enabled: asBool(req.body.push_enabled, true),
        email_enabled: asBool(req.body.email_enabled, true),
        order_updates: asBool(req.body.order_updates, true),
        booking_updates: asBool(req.body.booking_updates, true),
        service_tracking: asBool(req.body.service_tracking, true),
        offers: asBool(req.body.offers, true),
      };
      if (existing) {
        await req.catalystApp.datastore().table("Notification_Preferences").updateRow({
          ROWID: existing.ROWID,
          ...payload,
        });
      } else {
        await req.catalystApp.datastore().table("Notification_Preferences").insertRow(payload);
      }
      sendOk(res, { preferences: mapPreferences(payload) });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = notificationsRoutes;
