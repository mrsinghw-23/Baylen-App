const { asId, optionalText, rowOf, rowsOf, sendOk, sqlString } = require("../lib/http");
const { requireUser } = require("../lib/session");

function mapProfile(row, user) {
  return {
    user_id: String(user.user_id),
    full_name:
      row && row.full_name
        ? row.full_name
        : [user.first_name, user.last_name].filter(Boolean).join(" "),
    mobile: row ? row.mobile || "" : "",
    email: row && row.email ? row.email : user.email || "",
    gender: row ? row.gender || "" : "",
    date_of_birth: row ? row.date_of_birth || "" : "",
    profile_photo_url: row ? row.profile_photo_url || "" : "",
    loyalty_tier: row ? row.loyalty_tier || "Base" : "Base",
    loyalty_points: Number(row && row.loyalty_points ? row.loyalty_points : 0),
  };
}

function mapAddress(row) {
  return {
    id: String(row.ROWID),
    label: row.label || "",
    full_name: row.full_name || "",
    phone: row.phone || "",
    line1: row.line1 || "",
    line2: row.line2 || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    country: row.country || "India",
    latitude: row.latitude || "",
    longitude: row.longitude || "",
    is_default: row.is_default === true || row.is_default === "true",
  };
}

async function loadProfile(req, user) {
  const zcql = req.catalystApp.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, full_name, mobile, email, gender, date_of_birth, profile_photo_url, loyalty_tier, loyalty_points FROM User_Profiles WHERE user_id = " +
        user.user_id +
        " AND is_active = true"
    ),
    "User_Profiles"
  );
  return mapProfile(row, user);
}

async function markOtherAddressesNotDefault(req, userId) {
  const zcql = req.catalystApp.zcql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Addresses WHERE user_id = " + userId + " AND is_active = true"
    ),
    "Addresses"
  );
  for (const row of rows) {
    await req.catalystApp.datastore().table("Addresses").updateRow({
      ROWID: row.ROWID,
      is_default: false,
    });
  }
}

function accountRoutes(app) {
  app.get("/v1/profile", async (req, res, next) => {
    try {
      const user = requireUser(req);
      sendOk(res, { profile: await loadProfile(req, user) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/profile", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const fullName = optionalText(body.full_name, "full_name", 120);
      const mobile = optionalText(body.mobile, "mobile", 20);
      const email = optionalText(body.email, "email", 120) || user.email || "";
      const gender = optionalText(body.gender, "gender", 30);
      const dateOfBirth = optionalText(body.date_of_birth, "date_of_birth", 20);
      const profilePhotoUrl = optionalText(body.profile_photo_url, "profile_photo_url", 500);

      if (!mobile) {
        const error = new Error("mobile is required");
        error.status = 400;
        throw error;
      }
      if (!email) {
        const error = new Error("email is required");
        error.status = 400;
        throw error;
      }

      const zcql = req.catalystApp.zcql();
      const existing = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM User_Profiles WHERE user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
        "User_Profiles"
      );
      const payload = {
        user_id: user.user_id,
        full_name: fullName || [user.first_name, user.last_name].filter(Boolean).join(" "),
        mobile,
        email,
        gender: gender || null,
        date_of_birth: dateOfBirth || null,
        profile_photo_url: profilePhotoUrl || null,
        is_active: true,
      };
      if (existing) {
        await req.catalystApp.datastore().table("User_Profiles").updateRow({
          ROWID: existing.ROWID,
          ...payload,
        });
      } else {
        await req.catalystApp.datastore().table("User_Profiles").insertRow({
          ...payload,
          loyalty_tier: "Base",
          loyalty_points: 0,
        });
      }
      sendOk(res, { profile: await loadProfile(req, user) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/addresses", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, label, full_name, phone, line1, line2, city, state, postal_code, country, latitude, longitude, is_default FROM Addresses WHERE user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
        "Addresses"
      );
      sendOk(res, { addresses: rows.map(mapAddress) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/addresses", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const line1 = optionalText(body.line1, "line1", 255);
      const city = optionalText(body.city, "city", 100);
      const state = optionalText(body.state, "state", 100);
      const postalCode = optionalText(body.postal_code, "postal_code", 20);
      if (!line1 || !city || !state || !postalCode) {
        const error = new Error("line1, city, state, and postal_code are required");
        error.status = 400;
        throw error;
      }

      const isDefault = body.is_default === true || body.is_default === "true";
      if (isDefault) {
        await markOtherAddressesNotDefault(req, user.user_id);
      }

      await req.catalystApp.datastore().table("Addresses").insertRow({
        user_id: user.user_id,
        label: optionalText(body.label, "label", 50) || "Home",
        full_name: optionalText(body.full_name, "full_name", 120) || null,
        phone: optionalText(body.phone, "phone", 20) || null,
        line1,
        line2: optionalText(body.line2, "line2", 255) || null,
        city,
        state,
        postal_code: postalCode,
        country: optionalText(body.country, "country", 80) || "India",
        latitude: optionalText(body.latitude, "latitude", 40) || null,
        longitude: optionalText(body.longitude, "longitude", 40) || null,
        is_default: isDefault,
        is_active: true,
      });
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, label, full_name, phone, line1, line2, city, state, postal_code, country, latitude, longitude, is_default FROM Addresses WHERE user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
        "Addresses"
      );
      sendOk(res, { addresses: rows.map(mapAddress) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/address/remove", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const addressId = asId(req.body.address_id, "address_id");
      const zcql = req.catalystApp.zcql();
      const row = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Addresses WHERE ROWID = " +
            addressId +
            " AND user_id = " +
            user.user_id
        ),
        "Addresses"
      );
      if (!row) {
        const error = new Error("Address not found");
        error.status = 404;
        throw error;
      }
      await req.catalystApp.datastore().table("Addresses").updateRow({
        ROWID: row.ROWID,
        is_active: false,
        is_default: false,
      });
      sendOk(res, { removed: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/devices/register", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const deviceId = optionalText(body.device_id, "device_id", 150);
      if (!deviceId) {
        const error = new Error("device_id is required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const existing = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Devices WHERE user_id = " +
            user.user_id +
            " AND device_id = " +
            sqlString(deviceId)
        ),
        "Devices"
      );
      const payload = {
        user_id: user.user_id,
        device_id: deviceId,
        device_type: optionalText(body.device_type, "device_type", 40) || null,
        platform: optionalText(body.platform, "platform", 40) || null,
        os_version: optionalText(body.os_version, "os_version", 60) || null,
        app_version: optionalText(body.app_version, "app_version", 60) || null,
        push_token: optionalText(body.push_token, "push_token", 500) || null,
        last_active_at: new Date().toISOString().slice(0, 19).replace("T", " "),
        is_active: true,
      };
      if (existing) {
        await req.catalystApp.datastore().table("Devices").updateRow({
          ROWID: existing.ROWID,
          ...payload,
        });
      } else {
        await req.catalystApp.datastore().table("Devices").insertRow(payload);
      }
      sendOk(res, { registered: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = accountRoutes;
