const {
  APP_BASE,
  signSession,
  isAllowedOrigin,
  publicUser,
  catalystUser,
  bearerUser,
  requireUser,
} = require("../lib/session");
const crypto = require("crypto");
const { asId, optionalText, rowOf, rowsOf, num, sendOk, sqlString } = require("../lib/http");

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 45;
const MAX_MIGRATED_QTY = 99;

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function mapCatalystUser(user) {
  return {
    user_id: user.userId || user.user_id || user.zuid || "",
    email: user.email_id || user.email || "",
    first_name: user.first_name || user.firstName || "",
    last_name: user.last_name || user.lastName || "",
  };
}

function normalizeMobile(value) {
  let text = String(value || "").trim().replace(/[\s\-()]/g, "");
  if (text.startsWith("00")) {
    text = "+" + text.slice(2);
  }
  if (/^\d{10}$/.test(text)) {
    text = "+91" + text;
  }
  if (!/^\+\d{8,15}$/.test(text)) {
    const error = new Error("Enter a valid mobile number with country code");
    error.status = 400;
    throw error;
  }
  return text;
}

function otpHash(mobile, otp) {
  return crypto
    .createHmac("sha256", process.env.AUTH_SESSION_SECRET || "baylen-dev-session-key")
    .update(`${mobile}:${otp}`)
    .digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function getClientIp(req) {
  return String(
    req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      ""
  )
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function expiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

function parseDate(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function latestOtpChallenge(req, mobile) {
  const rows = rowsOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed, CREATEDTIME FROM Auth_Otp_Challenges WHERE mobile = " +
          sqlString(mobile) +
          " AND is_consumed = false"
      ),
    "Auth_Otp_Challenges"
  );
  rows.sort((a, b) => parseDate(b.CREATEDTIME) - parseDate(a.CREATEDTIME));
  return rows[0] || null;
}

async function consumeExpiredOtpChallenges(req, mobile) {
  const rows = rowsOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, expires_at FROM Auth_Otp_Challenges WHERE mobile = " +
          sqlString(mobile) +
          " AND is_consumed = false"
      ),
    "Auth_Otp_Challenges"
  );
  for (const row of rows) {
    await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
      ROWID: row.ROWID,
      is_consumed: true,
    });
  }
}

async function assertCanRequestOtp(req, mobile) {
  const latest = await latestOtpChallenge(req, mobile);
  if (!latest) {
    return;
  }
  const createdAt = parseDate(latest.CREATEDTIME);
  if (createdAt && Date.now() - createdAt < OTP_RESEND_SECONDS * 1000) {
    const error = new Error("Please wait before requesting another OTP");
    error.status = 429;
    throw error;
  }
}

async function sendOtp(mobile, otp) {
  const tataApiKey = process.env.TATA_WHATSAPP_API_KEY || "";
  const tataTemplate = process.env.TATA_TEMPLATE_NAME || "baylen_app_auth";

  // 1. Dispatch real WhatsApp message via Tata Smartflo Omni Gateway
  if (tataApiKey && tataTemplate) {
    const rawDigits = mobile.replace(/\D/g, "").slice(-10);
    try {
      const response = await fetch("https://wb.omni.tatatelebusiness.com/whatsapp-cloud/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tataApiKey}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: `91${rawDigits}`,
          type: "template",
          template: {
            name: tataTemplate,
            language: { code: "en" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: otp },
                ],
              },
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                  { type: "text", text: otp },
                ],
              },
            ],
          },
        }),
      });
      if (response.ok) {
        console.log(`[sendOtp] WhatsApp message successfully dispatched to +91${rawDigits}`);
        return { sentVia: "WHATSAPP" };
      }
      const errText = await response.text();
      console.error("[sendOtp] Tata Omni error response:", response.status, errText);
    } catch (err) {
      console.error("[sendOtp] Tata Omni network error:", err.message);
    }
  }

  // 2. Try Generic SMS Webhook if configured
  const webhookUrl = String(process.env.SMS_OTP_WEBHOOK_URL || "").trim();
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.SMS_OTP_WEBHOOK_TOKEN
            ? { Authorization: `Bearer ${process.env.SMS_OTP_WEBHOOK_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          to: mobile,
          otp,
          message: `Your Baylen verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`,
          purpose: "BAYLEN_LOGIN",
        }),
      });
      if (response.ok) {
        return { sentVia: "SMS" };
      }
    } catch (err) {
      console.error("[sendOtp] SMS webhook error:", err.message);
    }
  }

  // 3. Fallback for Development & Testing
  const devReturnOtp =
    String(process.env.AUTH_OTP_DEV_RETURN_CODE || "true").toLowerCase() === "true";
  if (devReturnOtp) {
    console.log(`[sendOtp DEV FALLBACK] Mobile: ${mobile}, OTP: ${otp}`);
    return { sentVia: "DEV", debugOtp: otp };
  }

  const error = new Error("Could not send OTP via WhatsApp or SMS gateway");
  error.status = 502;
  throw error;
}

function internalEmailForMobile(mobile) {
  return `${mobile.replace(/\D/g, "")}@phone.baylen.local`;
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "Baylen",
    lastName: parts.slice(1).join(" ") || "Customer",
  };
}

function normalizeGuestSessionId(value) {
  const text = optionalText(value, "guest_session_id", 80);
  if (!text) {
    return "";
  }
  if (!/^guest_[a-f0-9]{32}$/.test(text)) {
    const error = new Error("guest_session_id is invalid");
    error.status = 400;
    throw error;
  }
  return text;
}

async function ensureCustomerAccount(req, mobile) {
  const zcql = req.catalystApp.zcql();
  let isNewUser = false;
  let user = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, Email, Phone, First_Name, Last_Name, gender, date_of_birth FROM Users WHERE Phone = " +
        sqlString(mobile)
    ),
    "Users"
  );

  if (!user) {
    isNewUser = true;
    const tempEmail = `${mobile.replace(/\D/g, "")}@pending.baylen.local`;
    await req.catalystApp.datastore().table("Users").insertRow({
      Email: tempEmail,
      Phone: mobile,
      First_Name: "Pending",
      Last_Name: "Registration",
      date_of_birth: "2000-01-01",
      gender: "UNSPECIFIED",
      status: "Active",
      Role: "Customer",
    });
    user = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, Email, Phone, First_Name, Last_Name, gender, date_of_birth FROM Users WHERE Phone = " +
          sqlString(mobile)
      ),
      "Users"
    );
  }

  if (!user) {
    const error = new Error("Could not create customer account");
    error.status = 500;
    throw error;
  }

  const userId = String(user.ROWID);
  let profile = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, full_name, mobile, email, gender, date_of_birth FROM User_Profiles WHERE user_id = " +
        userId
    ),
    "User_Profiles"
  );

  if (!profile) {
    await req.catalystApp.datastore().table("User_Profiles").insertRow({
      user_id: userId,
      full_name: isNewUser ? "" : [user.First_Name, user.Last_Name].filter(Boolean).join(" "),
      mobile,
      email: isNewUser ? "" : user.Email,
      gender: isNewUser ? "" : user.gender || "",
      date_of_birth: null,
      profile_photo_url: null,
      default_address_id: null,
      loyalty_tier: "Base",
      loyalty_points: 0,
      is_active: true,
    });
    profile = rowOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, full_name, mobile, email, gender, date_of_birth FROM User_Profiles WHERE user_id = " +
          userId
      ),
      "User_Profiles"
    );
  }

  const email = (profile?.email && !profile.email.includes(".local")) ? profile.email : (user.Email && !user.Email.includes(".local") ? user.Email : "");
  const rawFirst = user.First_Name || "";
  const firstName = (rawFirst === "Pending" || rawFirst === "Baylen") ? "" : rawFirst;
  const rawLast = user.Last_Name || "";
  const lastName = (rawLast === "Registration" || rawLast === "Customer") ? "" : rawLast;

  const isComplete = Boolean(
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 1 &&
    email.trim().length > 3 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );

  return {
    user_id: userId,
    email: email,
    first_name: firstName,
    last_name: lastName,
    mobile,
    gender: profile?.gender || user.gender || "",
    date_of_birth: profile?.date_of_birth || "",
    is_new_user: isNewUser,
    is_profile_complete: isComplete,
  };
}

async function getOrCreateUserCartForMigration(req, userId) {
  const zcql = req.catalystApp.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, coupon_code, discount_amount FROM Carts WHERE user_id = " +
        userId +
        " AND status = 'ACTIVE' AND is_active = true"
    ),
    "Carts"
  );
  if (existing) {
    return existing;
  }
  await req.catalystApp.datastore().table("Carts").insertRow({
    user_id: userId,
    status: "ACTIVE",
    currency: "INR",
    coupon_code: null,
    discount_amount: 0,
    guest_session_id: null,
    is_active: true,
  });
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, coupon_code, discount_amount FROM Carts WHERE user_id = " +
        userId +
        " AND status = 'ACTIVE' AND is_active = true"
    ),
    "Carts"
  );
}

async function migrateGuestCart(req, userId, guestSessionId, stats) {
  const zcql = req.catalystApp.zcql();
  const guestCarts = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, coupon_code, discount_amount FROM Carts WHERE guest_session_id = " +
        sqlString(guestSessionId) +
        " AND is_active = true"
    ),
    "Carts"
  );
  if (guestCarts.length === 0) {
    return;
  }

  const userCart = await getOrCreateUserCartForMigration(req, userId);
  if (!userCart) {
    const error = new Error("Could not prepare user cart for migration");
    error.status = 500;
    throw error;
  }

  for (const guestCart of guestCarts) {
    stats.guest_carts += 1;
    const guestItems = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, variant_id, quantity, unit_mrp, unit_price FROM Cart_Items WHERE cart_id = " +
          guestCart.ROWID +
          " AND is_active = true"
      ),
      "Cart_Items"
    );

    for (const item of guestItems) {
      let existingQuery =
        "SELECT ROWID, quantity FROM Cart_Items WHERE cart_id = " +
        userCart.ROWID +
        " AND product_id = " +
        asId(item.product_id, "product_id") +
        " AND is_active = true";
      existingQuery += item.variant_id
        ? " AND variant_id = " + asId(item.variant_id, "variant_id")
        : " AND variant_id IS NULL";
      const existing = rowOf(await zcql.executeZCQLQuery(existingQuery), "Cart_Items");

      if (existing) {
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: existing.ROWID,
          quantity: Math.min(MAX_MIGRATED_QTY, num(existing.quantity) + num(item.quantity)),
        });
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          quantity: 0,
          is_active: false,
        });
        stats.cart_items_merged += 1;
      } else {
        await req.catalystApp.datastore().table("Cart_Items").updateRow({
          ROWID: item.ROWID,
          cart_id: userCart.ROWID,
        });
        stats.cart_items_moved += 1;
      }
    }

    if (!userCart.coupon_code && guestCart.coupon_code) {
      await req.catalystApp.datastore().table("Carts").updateRow({
        ROWID: userCart.ROWID,
        coupon_code: guestCart.coupon_code,
        discount_amount: num(guestCart.discount_amount),
      });
      userCart.coupon_code = guestCart.coupon_code;
    }

    await req.catalystApp.datastore().table("Carts").updateRow({
      ROWID: guestCart.ROWID,
      status: "MERGED",
      is_active: false,
      guest_session_id: null,
    });
  }
}

async function migrateGuestWishlist(req, userId, guestSessionId, stats) {
  const zcql = req.catalystApp.zcql();
  const rows = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, variant_id FROM Wishlist WHERE guest_session_id = " +
        sqlString(guestSessionId) +
        " AND is_active = true"
    ),
    "Wishlist"
  );

  for (const row of rows) {
    let existingQuery =
      "SELECT ROWID FROM Wishlist WHERE user_id = " +
      userId +
      " AND product_id = " +
      asId(row.product_id, "product_id") +
      " AND is_active = true";
    existingQuery += row.variant_id
      ? " AND variant_id = " + asId(row.variant_id, "variant_id")
      : " AND variant_id IS NULL";
    const existing = rowOf(await zcql.executeZCQLQuery(existingQuery), "Wishlist");

    if (existing) {
      await req.catalystApp.datastore().table("Wishlist").updateRow({
        ROWID: row.ROWID,
        is_active: false,
        guest_session_id: null,
      });
      stats.wishlist_merged += 1;
    } else {
      await req.catalystApp.datastore().table("Wishlist").updateRow({
        ROWID: row.ROWID,
        user_id: userId,
        guest_session_id: null,
        is_active: true,
      });
      stats.wishlist_moved += 1;
    }
  }
}

async function migrateGuestData(req, userId, guestSessionId) {
  const stats = {
    guest_session_id: guestSessionId || "",
    guest_carts: 0,
    cart_items_moved: 0,
    cart_items_merged: 0,
    wishlist_moved: 0,
    wishlist_merged: 0,
  };
  if (!guestSessionId) {
    return stats;
  }
  await migrateGuestCart(req, userId, guestSessionId, stats);
  await migrateGuestWishlist(req, userId, guestSessionId, stats);
  return stats;
}

async function registerLoginDevice(req, userId) {
  const body = req.body || {};
  const deviceId = optionalText(body.device_id, "device_id", 150);
  if (!deviceId) {
    return;
  }
  const zcql = req.catalystApp.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Devices WHERE user_id = " +
        userId +
        " AND device_id = " +
        sqlString(deviceId)
    ),
    "Devices"
  );
  const payload = {
    user_id: userId,
    device_id: deviceId,
    device_type: optionalText(body.device_type, "device_type", 40) || "MOBILE",
    platform: optionalText(body.platform, "platform", 40) || "",
    os_version: optionalText(body.os_version, "os_version", 80) || "",
    app_version: optionalText(body.app_version, "app_version", 40) || "",
    push_token: optionalText(body.push_token, "push_token", 255) || null,
    is_active: true,
    last_active_at: nowSql(),
  };
  if (existing) {
    await req.catalystApp.datastore().table("Devices").updateRow({
      ROWID: existing.ROWID,
      ...payload,
    });
  } else {
    await req.catalystApp.datastore().table("Devices").insertRow(payload);
  }
}

function authRoutes(app) {
  app.get("/v1/auth/start", (req, res) => {
    const origin = String(req.query.app_origin || "").trim();
    if (!isAllowedOrigin(origin)) {
      res.status(400).json({ ok: false, error: "app_origin is not allowed" });
      return;
    }
    const callback =
      APP_BASE +
      "/v1/auth/callback?app_origin=" +
      encodeURIComponent(origin);
    const login =
      APP_BASE +
      "/__catalyst/auth/login?redirect_url=" +
      encodeURIComponent(callback) +
      "&serviceurl=" +
      encodeURIComponent(callback);
    res.redirect(302, login);
  });

  app.get("/v1/auth/callback", async (req, res, next) => {
    try {
      const origin = String(req.query.app_origin || "").trim();
      if (!isAllowedOrigin(origin)) {
        res.status(400).send("app_origin is not allowed");
        return;
      }
      const user = await catalystUser(req);
      if (!user) {
        const retry =
          APP_BASE +
          "/v1/auth/start?app_origin=" +
          encodeURIComponent(origin);
        res.redirect(302, retry);
        return;
      }
      const token = signSession(mapCatalystUser(user));
      const target = new URL(origin);
      target.hash = "auth=" + encodeURIComponent(token);
      res.redirect(302, target.toString());
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/auth/me", async (req, res, next) => {
    try {
      const fromToken = bearerUser(req);
      if (fromToken) {
        sendOk(res, { user: publicUser(fromToken) });
        return;
      }
      const user = await catalystUser(req);
      if (!user) {
        const error = new Error("Not signed in");
        error.status = 401;
        throw error;
      }
      sendOk(res, { user: publicUser(mapCatalystUser(user)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/otp/request", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.mobile);
      await consumeExpiredOtpChallenges(req, mobile);
      await assertCanRequestOtp(req, mobile);
      const otp = generateOtp();
      const sendResult = await sendOtp(mobile, otp);
      const expiresAt = expiryDate();
      const inserted = await req.catalystApp
        .datastore()
        .table("Auth_Otp_Challenges")
        .insertRow({
          mobile,
          otp_hash: otpHash(mobile, otp),
          expires_at: nowSql(expiresAt),
          attempts: 0,
          is_consumed: false,
          request_ip: getClientIp(req),
          user_agent: String(req.headers["user-agent"] || "").slice(0, 255),
          sent_via: sendResult.sentVia,
        });
      sendOk(res, {
        challenge_id: String(inserted.ROWID || inserted.rowid || ""),
        mobile,
        expires_in_seconds: OTP_TTL_MINUTES * 60,
        resend_after_seconds: OTP_RESEND_SECONDS,
        sent_via: sendResult.sentVia,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/otp/verify", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.mobile);
      const guestSessionId = normalizeGuestSessionId(
        req.body.guest_session_id || req.headers["x-baylen-guest-session"]
      );
      const otp = String(req.body.otp || "").trim();
      if (!/^\d{6}$/.test(otp)) {
        const error = new Error("Enter the 6 digit OTP");
        error.status = 400;
        throw error;
      }
      const challengeId = req.body.challenge_id
        ? asId(req.body.challenge_id, "challenge_id")
        : "";
      const challenge = challengeId
        ? rowOf(
            await req.catalystApp
              .zcql()
              .executeZCQLQuery(
                "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed FROM Auth_Otp_Challenges WHERE ROWID = " +
                  challengeId
              ),
            "Auth_Otp_Challenges"
          )
        : await latestOtpChallenge(req, mobile);
      if (!challenge || challenge.mobile !== mobile || challenge.is_consumed === true) {
        const error = new Error("OTP request not found. Please request a new OTP.");
        error.status = 404;
        throw error;
      }
      if (parseDate(challenge.expires_at) < Date.now()) {
        await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
          ROWID: challenge.ROWID,
          is_consumed: true,
        });
        const error = new Error("OTP has expired. Please request a new OTP.");
        error.status = 400;
        throw error;
      }
      if (num(challenge.attempts) >= OTP_MAX_ATTEMPTS) {
        await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
          ROWID: challenge.ROWID,
          is_consumed: true,
        });
        const error = new Error("Too many invalid attempts. Request a new OTP.");
        error.status = 429;
        throw error;
      }

      const isValidCode = challenge.otp_hash === otpHash(mobile, otp);
      if (!isValidCode) {
        const attempts = num(challenge.attempts) + 1;
        await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
          ROWID: challenge.ROWID,
          attempts,
        });
        const error = new Error("Incorrect OTP code. Please check and try again.");
        error.status = 400;
        throw error;
      }

      await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
        ROWID: challenge.ROWID,
        attempts: num(challenge.attempts) + 1,
        is_consumed: true,
      });
      const user = await ensureCustomerAccount(req, mobile);
      const migration = await migrateGuestData(req, user.user_id, guestSessionId);
      await registerLoginDevice(req, user.user_id);
      sendOk(res, {
        token: signSession(user),
        user: publicUser(user),
        is_new_user: user.is_new_user === true,
        migration,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/session/refresh", async (req, res, next) => {
    try {
      const user = requireUser(req);
      sendOk(res, {
        token: signSession(user),
        user: publicUser(user),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/session/revoke", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const deviceId = optionalText(req.body.device_id, "device_id", 150);
      if (deviceId) {
        const existing = rowOf(
          await req.catalystApp
            .zcql()
            .executeZCQLQuery(
              "SELECT ROWID FROM Devices WHERE user_id = " +
                user.user_id +
                " AND device_id = " +
                sqlString(deviceId)
            ),
          "Devices"
        );
        if (existing) {
          await req.catalystApp.datastore().table("Devices").updateRow({
            ROWID: existing.ROWID,
            is_active: false,
            push_token: null,
          });
        }
      }
      sendOk(res, { revoked: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/profile/complete", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const firstName = String(req.body?.first_name || "").trim().slice(0, 50);
      const lastName = String(req.body?.last_name || "").trim().slice(0, 50);
      const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 150);
      const gender = optionalText(req.body?.gender, "gender", 20).toUpperCase();
      const dob = optionalText(req.body?.date_of_birth, "date_of_birth", 20);

      if (firstName.length < 2) {
        const err = new Error("First name must be at least 2 characters");
        err.status = 400;
        throw err;
      }

      if (lastName.length < 1) {
        const err = new Error("Last name is required");
        err.status = 400;
        throw err;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const err = new Error("Please enter a valid email address");
        err.status = 400;
        throw err;
      }

      // Ensure email is not already taken by another account
      const existingEmailUser = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID FROM Users WHERE Email = " +
              sqlString(email) +
              " AND ROWID != " +
              user.user_id
          ),
        "Users"
      );
      if (existingEmailUser) {
        const err = new Error("This email address is already associated with another account");
        err.status = 400;
        throw err;
      }

      // Update Users table
      const userUpdatePayload = {
        ROWID: user.user_id,
        First_Name: firstName,
        Last_Name: lastName,
        Email: email,
      };
      if (dob) userUpdatePayload.date_of_birth = dob;
      if (gender) userUpdatePayload.gender = gender;
      await req.catalystApp.datastore().table("Users").updateRow(userUpdatePayload);

      // Update or insert User_Profiles table
      const fullName = `${firstName} ${lastName}`.trim();
      const existingProfile = rowOf(
        await req.catalystApp
          .zcql()
          .executeZCQLQuery(
            "SELECT ROWID FROM User_Profiles WHERE user_id = " + user.user_id
          ),
        "User_Profiles"
      );

      if (existingProfile) {
        await req.catalystApp.datastore().table("User_Profiles").updateRow({
          ROWID: existingProfile.ROWID,
          full_name: fullName,
          email: email,
          gender: gender || null,
          date_of_birth: dob || null,
        });
      } else {
        await req.catalystApp.datastore().table("User_Profiles").insertRow({
          user_id: user.user_id,
          full_name: fullName,
          mobile: user.mobile,
          email: email,
          gender: gender || null,
          date_of_birth: dob || null,
          loyalty_tier: "Base",
          loyalty_points: 0,
          is_active: true,
        });
      }

      const updatedUser = {
        user_id: user.user_id,
        email,
        first_name: firstName,
        last_name: lastName,
        mobile: user.mobile,
        gender,
        date_of_birth: dob,
        is_profile_complete: true,
      };

      sendOk(res, {
        token: signSession(updatedUser),
        user: publicUser(updatedUser),
        message: "Profile registered successfully",
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = authRoutes;
