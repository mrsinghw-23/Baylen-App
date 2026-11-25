const { asId, optionalText, rowOf, rowsOf, sendOk, sqlString } = require("../lib/http");
const { requireUser } = require("../lib/session");
const { loadAccountSnapshot } = require("../lib/account-recover");
const { writeCustomerAudit } = require("../lib/audit");

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
    created_at: row ? row.CREATEDTIME || "" : "",
  };
}

function mapAddress(row) {
  return {
    id: String(row.ROWID),
    label: row.label || row.address_type || "",
    full_name: row.full_name || row.recipient_name || "",
    phone: row.phone || row.recipient_phone || "",
    line1: row.line1 || row.address_line1 || "",
    line2: row.line2 || row.address_line2 || "",
    landmark: row.landmark || "",
    city: row.city || "",
    state: row.state || "",
    postal_code: row.postal_code || "",
    country: row.country || "India",
    latitude: row.latitude || "",
    longitude: row.longitude || "",
    is_default: row.is_default === true || row.is_default === "true",
  };
}

function validateIndianPhone(phone) {
  if (!/^[6-9]\d{9}$/.test(String(phone || "").trim())) {
    const error = new Error("Enter a valid 10-digit Indian phone number");
    error.status = 400;
    throw error;
  }
}

function validateIndianPin(postalCode) {
  if (!/^\d{6}$/.test(String(postalCode || "").trim())) {
    const error = new Error("Enter a valid 6-digit PIN code");
    error.status = 400;
    throw error;
  }
}

function validateCoordinate(value, field, min, max) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    const error = new Error(`${field} is invalid`);
    error.status = 400;
    throw error;
  }
  return String(n);
}

function normalizeAddressPayload(body, partial = false) {
  const payload = {};
  const label = optionalText(body.label, "label", 50);
  const fullName = optionalText(body.full_name, "full_name", 120);
  const phone = optionalText(body.phone, "phone", 20);
  const line1 = optionalText(body.line1, "line1", 255);
  const line2 = optionalText(body.line2, "line2", 255);
  const city = optionalText(body.city, "city", 100);
  const state = optionalText(body.state, "state", 100);
  const postalCode = optionalText(body.postal_code, "postal_code", 20);
  const country = optionalText(body.country, "country", 80);

  if (!partial && (!line1 || !city || !state || !postalCode)) {
    const error = new Error("line1, city, state, and postal_code are required");
    error.status = 400;
    throw error;
  }
  if (phone) validateIndianPhone(phone);
  if (postalCode) validateIndianPin(postalCode);

  if (label) payload.label = label;
  if (fullName) payload.full_name = fullName;
  if (phone) payload.phone = phone;
  if (line1) payload.line1 = line1;
  if (line2 || !partial) payload.line2 = line2 || null;
  if (city) payload.city = city;
  if (state) payload.state = state;
  if (postalCode) payload.postal_code = postalCode;
  if (country || !partial) payload.country = country || "India";

  const latitude = validateCoordinate(body.latitude, "latitude", -90, 90);
  const longitude = validateCoordinate(body.longitude, "longitude", -180, 180);
  if (latitude !== null) payload.latitude = latitude;
  if (longitude !== null) payload.longitude = longitude;

  const landmark = optionalText(body.landmark, "landmark", 255);
  if (landmark || !partial) payload.landmark = landmark || null;

  if (payload.full_name) payload.recipient_name = payload.full_name;
  if (payload.phone) payload.recipient_phone = payload.phone;
  if (payload.line1) payload.address_line1 = payload.line1;
  if (payload.line2 !== undefined) payload.address_line2 = payload.line2;
  if (payload.label) payload.address_type = payload.label;

  return payload;
}

async function persistAddressRow(req, payload, existingId) {
  const table = req.catalystApp.datastore().table("Addresses");
  try {
    if (existingId) {
      return await table.updateRow({ ROWID: existingId, ...payload });
    }
    return await table.insertRow(payload);
  } catch (_) {
    const fallback = { ...payload };
    delete fallback.landmark;
    delete fallback.recipient_name;
    delete fallback.recipient_phone;
    delete fallback.address_line1;
    delete fallback.address_line2;
    delete fallback.address_type;
    if (existingId) {
      return await table.updateRow({ ROWID: existingId, ...fallback });
    }
    return await table.insertRow(fallback);
  }
}

async function loadAddresses(req, userId) {
  const zcql = req.catalystApp.zcql();
  try {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, label, address_type, full_name, recipient_name, phone, recipient_phone, line1, address_line1, line2, address_line2, landmark, city, state, postal_code, country, latitude, longitude, is_default FROM Addresses WHERE user_id = " +
          userId +
          " AND is_active = true"
      ),
      "Addresses"
    ).map(mapAddress);
  } catch (_) {
    return rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, label, full_name, phone, line1, line2, city, state, postal_code, country, latitude, longitude, is_default FROM Addresses WHERE user_id = " +
          userId +
          " AND is_active = true"
      ),
      "Addresses"
    ).map(mapAddress);
  }
}

async function ensureOneDefaultAddress(req, userId) {
  const addresses = await loadAddresses(req, userId);
  if (addresses.length === 0 || addresses.some((address) => address.is_default || address.isDefault)) {
    return;
  }
  await req.catalystApp.datastore().table("Addresses").updateRow({
    ROWID: addresses[0].id,
    is_default: true,
  });
}

async function loadProfile(req, user) {
  const zcql = req.catalystApp.zcql();
  const row = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, full_name, mobile, email, gender, date_of_birth, profile_photo_url, loyalty_tier, loyalty_points, CREATEDTIME FROM User_Profiles WHERE user_id = " +
        user.user_id +
        " AND is_active = true"
    ),
    "User_Profiles"
  );
  const mapped = mapProfile(row, user);
  mapped.created_at = (row && row.CREATEDTIME) || user.created_at || "";
  if (!mapped.profile_photo_url && user.profile_photo_url) {
    mapped.profile_photo_url = user.profile_photo_url;
  }
  return mapped;
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
  async function sendAccountRecovery(req, res) {
    const user = requireUser(req);
    const snapshot = await loadAccountSnapshot(req, user);
    sendOk(res, snapshot);
  }

  app.get("/v1/account/recover", async (req, res, next) => {
    try {
      await sendAccountRecovery(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/me/bootstrap", async (req, res, next) => {
    try {
      await sendAccountRecovery(req, res);
    } catch (error) {
      next(error);
    }
  });

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
      await writeCustomerAudit(req, user.user_id, "PROFILE_UPDATE", "User_Profiles", user.user_id, null, {
        full_name: payload.full_name,
        email,
        gender,
      });
      sendOk(res, { profile: await loadProfile(req, user) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/addresses", async (req, res, next) => {
    try {
      const user = requireUser(req);
      sendOk(res, { addresses: await loadAddresses(req, user.user_id) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/location/pincode", async (req, res, next) => {
    try {
      const pincode = optionalText(req.query.pincode, "pincode", 6);
      validateIndianPin(pincode);
      const { lookupPostalPincode } = require("../lib/postal-pincode-lookup");
      const location = await lookupPostalPincode(req.catalystApp, pincode);
      sendOk(res, location);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/addresses", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const payload = normalizeAddressPayload(body);
      const existing = await loadAddresses(req, user.user_id);
      const isDefault = body.is_default === true || body.is_default === "true";
      if (isDefault || existing.length === 0) {
        await markOtherAddressesNotDefault(req, user.user_id);
      }

      await persistAddressRow(req, {
        user_id: user.user_id,
        ...payload,
        label: payload.label || "Home",
        is_default: isDefault || existing.length === 0,
        is_active: true,
      });
      sendOk(res, { addresses: await loadAddresses(req, user.user_id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/address/update", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = req.body || {};
      const addressId = asId(body.address_id, "address_id");
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
      const payload = normalizeAddressPayload(body, true);
      if (Object.keys(payload).length === 0 && body.is_default === undefined) {
        const error = new Error("No address changes were provided");
        error.status = 400;
        throw error;
      }
      const isDefault = body.is_default === true || body.is_default === "true";
      if (isDefault) {
        await markOtherAddressesNotDefault(req, user.user_id);
      }
      await persistAddressRow(
        req,
        {
          ...payload,
          ...(body.is_default !== undefined ? { is_default: isDefault } : {}),
        },
        row.ROWID
      );
      await ensureOneDefaultAddress(req, user.user_id);
      sendOk(res, { addresses: await loadAddresses(req, user.user_id) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/address/default", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const addressId = asId(req.body.address_id, "address_id");
      const zcql = req.catalystApp.zcql();
      const row = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Addresses WHERE ROWID = " +
            addressId +
            " AND user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
        "Addresses"
      );
      if (!row) {
        const error = new Error("Address not found");
        error.status = 404;
        throw error;
      }
      await markOtherAddressesNotDefault(req, user.user_id);
      await req.catalystApp.datastore().table("Addresses").updateRow({
        ROWID: row.ROWID,
        is_default: true,
      });
      sendOk(res, { addresses: await loadAddresses(req, user.user_id) });
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
      await ensureOneDefaultAddress(req, user.user_id);
      sendOk(res, { removed: true, addresses: await loadAddresses(req, user.user_id) });
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
