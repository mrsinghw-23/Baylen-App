const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const catalyst = require("zcatalyst-sdk-node");

const app = express();

const PORT = Number(process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000);
const OTP_TTL_MS = 5 * 60 * 1000;
const PHONE_REGEX = /^[6-9]\d{9}$/;
const OTP_REGEX = /^\d{6}$/;
const TATA_WHATSAPP_ENDPOINT = process.env.TATA_WHATSAPP_ENDPOINT || "https://wb.omni.tatatelebusiness.com/whatsapp-cloud/messages";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const allowedOriginPatterns = [
  /^https?:\/\/localhost(?::\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/,
  /^https:\/\/.*\.catalystserverless\.in$/,
  /^https:\/\/.*\.catalystappsail\.in$/,
  /^https:\/\/.*\.catalystapp\.in$/,
  /^https:\/\/.*\.catalystapps\.in$/,
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOriginPatterns.some((pattern) => pattern.test(origin))) {
        callback(null, true);
        return;
      }
      callback(httpError(403, "Origin is not allowed"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Origin",
      "X-Requested-With",
      "Content-Type",
      "Accept",
      "Authorization",
      "X-Baylen-Token",
      "X-Baylen-Guest-Session",
      "x-device-id",
    ],
    credentials: true,
    optionsSuccessStatus: 204,
  })
);

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  try {
    req.catalystApp = catalyst.initialize(req);
    next();
  } catch (error) {
    next(error);
  }
});

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function sqlString(value) {
  return "'" + String(value ?? "").replace(/'/g, "''") + "'";
}

function unwrapRows(result, tableName) {
  if (!Array.isArray(result)) return [];
  return result
    .map((entry) => entry?.[tableName] || entry)
    .filter((entry) => entry && typeof entry === "object");
}

function firstRow(result, tableName) {
  return unwrapRows(result, tableName)[0] || null;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw httpError(503, `${name} is not configured`);
  return value;
}

function normalizePhone(value) {
  const phone = String(value || "").trim().replace(/\D/g, "");
  if (!PHONE_REGEX.test(phone)) {
    throw httpError(400, "Enter a valid 10-digit Indian mobile number");
  }
  return phone;
}

function normalizeOtp(value) {
  const otp = String(value || "").trim();
  if (!OTP_REGEX.test(otp)) {
    throw httpError(400, "Enter the valid 6-digit OTP");
  }
  return otp;
}

function optionalText(value, field, maxLength) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) {
    throw httpError(400, `${field} is too long`);
  }
  return text;
}

function normalizeEmail(value) {
  const email = optionalText(value, "email", 160);
  if (!email) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(400, "Enter a valid email address");
  }
  return email.toLowerCase();
}

function normalizeGuestSessionId(value) {
  const text = optionalText(value, "guest_session_id", 120);
  if (!text) return "";
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(text)) {
    throw httpError(400, "guest_session_id is invalid");
  }
  return text;
}

function generateSecureOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function sessionSecret() {
  const configured = String(process.env.AUTH_SESSION_SECRET || "").trim();
  if (configured) return configured;
  return requiredEnv("TATA_WHATSAPP_API_KEY");
}

function base64Url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function signSession(user) {
  const payload = {
    sub: String(user.user_id),
    phone_number: String(user.phone_number || ""),
    iat: Date.now(),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encodedPayload = base64Url(payload);
  const signature = crypto
    .createHmac("sha256", sessionSecret())
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifySession(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) {
    throw httpError(401, "Authentication required");
  }
  const expected = crypto
    .createHmac("sha256", sessionSecret())
    .update(encodedPayload)
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw httpError(401, "Invalid session");
  }
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  if (!payload.exp || Date.now() > Number(payload.exp)) {
    throw httpError(401, "Session expired");
  }
  return payload;
}

function requireSession(req) {
  const header = String(req.headers.authorization || "");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const session = verifySession(token);
  if (!session.sub) {
    throw httpError(401, "Authentication required");
  }
  return session;
}

function userIdFromRow(row) {
  return String(row?.user_id || row?.ROWID || "");
}

function publicUser(row) {
  return {
    user_id: userIdFromRow(row),
    phone_number: String(row?.phone_number || ""),
    full_name: String(row?.full_name || ""),
    email: String(row?.email || ""),
    created_at: row?.created_at || null,
  };
}

async function purgeOtpRows(appInstance, phoneNumber) {
  const rows = unwrapRows(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID FROM OTP_Store WHERE phone_number = " + sqlString(phoneNumber)
    ),
    "OTP_Store"
  );
  const table = appInstance.datastore().table("OTP_Store");
  for (const row of rows) {
    await table.deleteRow(row.ROWID);
  }
}

async function saveOtp(appInstance, phoneNumber, otpCode, expiresAt) {
  await appInstance.datastore().table("OTP_Store").insertRow({
    phone_number: phoneNumber,
    otp_code: otpCode,
    expires_at: expiresAt,
  });
}

async function sendWhatsappOtp(phoneNumber, otpCode) {
  const apiKey = requiredEnv("TATA_WHATSAPP_API_KEY");
  const sender = requiredEnv("TATA_WHATSAPP_SENDER");
  const templateName = requiredEnv("TATA_TEMPLATE_NAME");

  const payload = {
    messaging_product: "whatsapp",
    from: sender,
    to: `91${phoneNumber}`,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: otpCode }],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: otpCode }],
        },
      ],
    },
  };

  try {
    const response = await axios.post(TATA_WHATSAPP_ENDPOINT, payload, {
      timeout: 15000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw httpError(502, "Could not send WhatsApp OTP", response.data);
    }
    return response.data;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(502, "Could not reach Tata Smartflo WhatsApp API", {
      message: error.message,
    });
  }
}

async function findOtp(appInstance, phoneNumber, otpCode) {
  return firstRow(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID, phone_number, otp_code, expires_at FROM OTP_Store WHERE phone_number = " +
        sqlString(phoneNumber) +
        " AND otp_code = " +
        sqlString(otpCode)
    ),
    "OTP_Store"
  );
}

async function deleteOtp(appInstance, rowId) {
  await appInstance.datastore().table("OTP_Store").deleteRow(rowId);
}

async function findUserByPhone(appInstance, phoneNumber) {
  return firstRow(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID, phone_number, full_name, email, created_at FROM Users WHERE phone_number = " +
        sqlString(phoneNumber)
    ),
    "Users"
  );
}

async function findUserById(appInstance, userId) {
  return firstRow(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID, phone_number, full_name, email, created_at FROM Users WHERE ROWID = " +
        sqlString(userId)
    ),
    "Users"
  );
}

async function getOrCreateUser(appInstance, phoneNumber) {
  const existing = await findUserByPhone(appInstance, phoneNumber);
  if (existing) return { user: existing, isNewUser: false };

  await appInstance.datastore().table("Users").insertRow({
    phone_number: phoneNumber,
    full_name: "",
    email: "",
    created_at: Date.now(),
  });

  const created = await findUserByPhone(appInstance, phoneNumber);
  if (!created) {
    throw httpError(500, "Could not create user profile");
  }
  return { user: created, isNewUser: true };
}

async function findGuestCartRows(appInstance, guestSessionId) {
  return unwrapRows(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID, user_id, guest_session_id, item_id, quantity FROM Cart WHERE guest_session_id = " +
        sqlString(guestSessionId)
    ),
    "Cart"
  );
}

async function findUserCartItem(appInstance, userId, itemId) {
  return firstRow(
    await appInstance.zcql().executeZCQLQuery(
      "SELECT ROWID, user_id, guest_session_id, item_id, quantity FROM Cart WHERE user_id = " +
        sqlString(userId) +
        " AND item_id = " +
        sqlString(itemId)
    ),
    "Cart"
  );
}

async function migrateGuestCart(appInstance, userId, guestSessionId) {
  const stats = {
    guest_session_id: guestSessionId || "",
    moved: 0,
    merged: 0,
    skipped: 0,
  };
  if (!guestSessionId) return stats;

  const cartTable = appInstance.datastore().table("Cart");
  const guestRows = await findGuestCartRows(appInstance, guestSessionId);

  for (const guestRow of guestRows) {
    const itemId = String(guestRow.item_id || "").trim();
    const guestQuantity = Math.max(0, Number(guestRow.quantity || 0));
    if (!itemId || guestQuantity <= 0) {
      stats.skipped += 1;
      continue;
    }

    const existingUserItem = await findUserCartItem(appInstance, userId, itemId);
    if (existingUserItem && String(existingUserItem.ROWID) !== String(guestRow.ROWID)) {
      await cartTable.updateRow({
        ROWID: existingUserItem.ROWID,
        quantity: Number(existingUserItem.quantity || 0) + guestQuantity,
      });
      await cartTable.deleteRow(guestRow.ROWID);
      stats.merged += 1;
      continue;
    }

    await cartTable.updateRow({
      ROWID: guestRow.ROWID,
      user_id: userId,
      guest_session_id: null,
    });
    stats.moved += 1;
  }

  return stats;
}

app.get(["/health", "/api/health"], (req, res) => {
  res.status(200).json({ ok: true, service: "baylen-auth-appsail" });
});

app.post("/api/auth/send-otp", async (req, res, next) => {
  try {
    const phoneNumber = normalizePhone(req.body?.phone_number || req.body?.mobile);
    await purgeOtpRows(req.catalystApp, phoneNumber);

    const otpCode = generateSecureOtp();
    const expiresAt = Date.now() + OTP_TTL_MS;

    await saveOtp(req.catalystApp, phoneNumber, otpCode, expiresAt);
    await sendWhatsappOtp(phoneNumber, otpCode);

    res.status(200).json({
      ok: true,
      message: "OTP sent successfully",
      data: {
        phone_number: phoneNumber,
        expires_in_seconds: OTP_TTL_MS / 1000,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/verify-otp", async (req, res, next) => {
  try {
    const phoneNumber = normalizePhone(req.body?.phone_number || req.body?.mobile);
    const otpCode = normalizeOtp(req.body?.otp_code || req.body?.otp);
    const guestSessionId = normalizeGuestSessionId(req.body?.guest_session_id);

    const otpRow = await findOtp(req.catalystApp, phoneNumber, otpCode);
    if (!otpRow) {
      throw httpError(400, "OTP is invalid or has already been used");
    }

    if (Date.now() > Number(otpRow.expires_at || 0)) {
      await deleteOtp(req.catalystApp, otpRow.ROWID);
      throw httpError(400, "OTP expired. Please request a new OTP.");
    }

    await deleteOtp(req.catalystApp, otpRow.ROWID);

    const { user, isNewUser } = await getOrCreateUser(req.catalystApp, phoneNumber);
    const signedUser = publicUser(user);
    const migration = await migrateGuestCart(
      req.catalystApp,
      signedUser.user_id,
      guestSessionId
    );

    res.status(200).json({
      ok: true,
      message: "OTP verified successfully",
      data: {
        token: signSession(signedUser),
        user: signedUser,
        is_new_user: isNewUser,
        migration,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/user/profile", async (req, res, next) => {
  try {
    const session = requireSession(req);
    const user = await findUserById(req.catalystApp, session.sub);
    if (!user) {
      throw httpError(404, "User profile not found");
    }

    const fullName = optionalText(req.body?.full_name, "full_name", 120);
    const email = normalizeEmail(req.body?.email);

    const update = { ROWID: user.ROWID };
    if (req.body?.full_name !== undefined) update.full_name = fullName;
    if (req.body?.email !== undefined) update.email = email;

    if (Object.keys(update).length === 1) {
      throw httpError(400, "No profile fields supplied");
    }

    await req.catalystApp.datastore().table("Users").updateRow(update);
    const updated = await findUserById(req.catalystApp, session.sub);

    res.status(200).json({
      ok: true,
      message: "Profile updated successfully",
      data: { user: publicUser(updated) },
    });
  } catch (error) {
    next(error);
  }
});

// 🚀 ENDPOINT: Fetch products/services live from Zoho Books
// ðŸš€ ENDPOINT: Fetch products/services live from Zoho Books
app.get('/api/shop/books-image', async (req, res) => {
  try {
    const itemId = req.query.item_id;
    if (!itemId) return res.status(400).send('item_id required');

    const catalystApp = req.catalystApp || catalyst.initialize(req);
    let authHeader = '';
    try {
      const creds = await catalystApp.connections().getConnectionCredentials('zoho_books');
      authHeader = creds?.headers?.Authorization || '';
      if (!authHeader && creds?.parameters?.access_token) {
        authHeader = 'Zoho-oauthtoken ' + creds.parameters.access_token;
      }
    } catch (e) {}

    const orgId = process.env.ZOHO_BOOKS_ORGANIZATION_ID || '60068933706';
    const url = `https://www.zohoapis.in/books/v3/items/${itemId}/image?organization_id=${orgId}`;

    const axiosParams = { responseType: 'stream' };
    if (authHeader) {
      axiosParams.headers = { Authorization: authHeader.startsWith('Zoho-') || authHeader.startsWith('Bearer') ? authHeader : `Zoho-oauthtoken ${authHeader}` };
    }

    const imgRes = await axios.get(url, axiosParams);
    res.setHeader('Content-Type', imgRes.headers['content-type']);
    imgRes.data.pipe(res);
  } catch (err) {
    res.status(404).send('Image not found');
  }
});

app.get("/api/shop/books-products", async (req, res) => {
  try {
    const catalystApp = req.catalystApp || catalyst.initialize(req);

    // 1. Fetch authorized OAuth credentials from Catalyst Connection
    let authHeader = "";
    try {
      const credentials = await catalystApp
        .connections()
        .getConnectionCredentials("zoho_books");
      const headers = credentials?.headers || {};
      authHeader =
        headers.Authorization ||
        headers.authorization ||
        headers.AUTHORIZATION ||
        (credentials?.parameters?.access_token
          ? `Zoho-oauthtoken ${credentials.parameters.access_token}`
          : "");
    } catch (connErr) {
      console.warn("Connection credentials error:", connErr.message);
    }

    // 2. Define your Organization ID
    const organizationId =
      process.env.ZOHO_BOOKS_ORGANIZATION_ID || "60068933706";

    // 3. Set the official Zoho Books API URL (Uses .in for Indian Data Centers)
    const booksApiUrl = `https://www.zohoapis.in/books/v3/items?organization_id=${organizationId}`;

    // 4. Fire the secure request with axios
    const reqHeaders = { "Content-Type": "application/json" };
    if (authHeader) {
      reqHeaders["Authorization"] =
        authHeader.startsWith("Zoho-oauthtoken") || authHeader.startsWith("Bearer")
          ? authHeader
          : `Zoho-oauthtoken ${authHeader}`;
    }

    const apiResponse = await axios.get(booksApiUrl, { headers: reqHeaders });
    const jsonResult = apiResponse.data;

    // 5. Extract and map items list cleanly for your Flutter UI cards
    const rawItems = jsonResult.items || [];
    const activeProducts = rawItems;

    // 6. Return the clean products payload back to Flutter
    return res.status(200).json({
      status: "success",
      count: activeProducts.length,
      products: activeProducts,
    });
  } catch (error) {
    const detail = error.response?.data?.message || error.message;
    return res.status(500).json({
      status: "error",
      message: `Zoho Books Integration Failed: ${detail}`,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Route not found" });
});

app.use((error, req, res, next) => {
  const status = Number(error.status || 500);
  const responseBody = {
    ok: false,
    error: status >= 500 ? "Internal server error" : error.message,
  };
  if (error.details && status < 500) responseBody.details = error.details;
  if (status >= 500) console.error(error);
  res.status(status).json(responseBody);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Baylen auth AppSail service listening on ${PORT}`);
  });
}

module.exports = app;
