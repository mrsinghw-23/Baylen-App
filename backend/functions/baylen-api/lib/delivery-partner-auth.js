"use strict";

const crypto = require("crypto");
const { getAuthSessionSecret } = require("./runtime-config");
const { asId, rowOf, rowsOf, num, isTruthy, insertedRowId, sendOk, sqlString } = require("./http");
const {
  parseDeliveryPartnerId,
  ensureDeliveryPartnerAccount,
  deliveryPartnerSessionPayload,
  findDeliveryPartnerByPhone,
} = require("./delivery-partner");
const { signSession } = require("./session");
const { canonicalMobile, findUserByMobile, phonesMatch, phoneLookupKeys } = require("./phone-identity");
const {
  getWhatsappOtpStatus,
  isDevOtpFallbackEnabled,
  sendWhatsappOtp,
} = require("./whatsapp-otp");
const { requireDeliveryPartner } = require("./session");
const {
  REGISTRATION_PHASE,
  normalizeRegistrationPhase,
  inferRegistrationPhase,
  getRegistrationStatus,
  savePersonalProfile,
  saveRegistrationPhoto,
  saveRegistrationPassword,
  completeRegistration,
  loginWithPassword,
  partnerRequiresPasswordLogin,
  ensureRegistrationSeed,
  loadRegistrationBundle,
  validatePasswordPair,
  hashPassword,
  resetPartnerPasswordByMobile,
} = require("./delivery-partner-registration");

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_SECONDS = 45;
const OTP_PURPOSE = "delivery_partner";
const OTP_RESET_PURPOSE = "delivery_partner_password_reset";

function normalizeMobile(value) {
  try {
    return canonicalMobile(value);
  } catch (_) {
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
}

function otpHash(mobile, otp, purpose = OTP_PURPOSE) {
  return crypto
    .createHmac("sha256", getAuthSessionSecret())
    .update(`${purpose}:${mobile}:${otp}`)
    .digest("hex");
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function nowSql(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function expiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

function parseDate(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function otpPurposeMatches(row, purpose = OTP_PURPOSE) {
  const rowPurpose = String(row.purpose || "customer").trim() || "customer";
  return rowPurpose === purpose;
}

async function latestOtpChallenge(req, mobile, purpose = OTP_PURPOSE) {
  const keys = [...new Set([mobile, ...phoneLookupKeys(mobile)])];
  const seen = new Set();
  const rows = [];
  for (const key of keys) {
    if (!key) {
      continue;
    }
    const batch = rowsOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed, purpose, CREATEDTIME FROM Auth_Otp_Challenges WHERE mobile = " +
            sqlString(key)
        ),
      "Auth_Otp_Challenges"
    );
    for (const row of batch) {
      const id = String(row.ROWID);
      if (!seen.has(id)) {
        seen.add(id);
        rows.push(row);
      }
    }
  }
  const open = rows.filter(
    (row) => !isTruthy(row.is_consumed) && otpPurposeMatches(row, purpose)
  );
  open.sort((a, b) => parseDate(b.CREATEDTIME) - parseDate(a.CREATEDTIME));
  return open[0] || null;
}

async function loadResetOtpCandidates(req, mobile, challengeId = "") {
  if (challengeId) {
    const row = rowOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed, purpose, CREATEDTIME FROM Auth_Otp_Challenges WHERE ROWID = " +
            challengeId
        ),
      "Auth_Otp_Challenges"
    );
    return row ? [row] : [];
  }
  const keys = [...new Set([mobile, ...phoneLookupKeys(mobile)])];
  const seen = new Set();
  const rows = [];
  for (const key of keys) {
    if (!key) {
      continue;
    }
    const batch = rowsOf(
      await req.catalystApp
        .zcql()
        .executeZCQLQuery(
          "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed, purpose, CREATEDTIME FROM Auth_Otp_Challenges WHERE mobile = " +
            sqlString(key)
        ),
      "Auth_Otp_Challenges"
    );
    for (const row of batch) {
      const id = String(row.ROWID);
      if (!seen.has(id)) {
        seen.add(id);
        rows.push(row);
      }
    }
  }
  return rows.filter((row) => !isTruthy(row.is_consumed));
}

function pickResetOtpChallenge(candidates, mobile, challengeId = "") {
  const eligible = candidates.filter((row) => phonesMatch(row.mobile, mobile));
  if (!eligible.length) {
    return null;
  }
  if (challengeId) {
    return eligible[0];
  }
  const purposeMatch = eligible.find((row) => otpPurposeMatches(row, OTP_RESET_PURPOSE));
  if (purposeMatch) {
    return purposeMatch;
  }
  eligible.sort((a, b) => parseDate(b.CREATEDTIME) - parseDate(a.CREATEDTIME));
  return eligible[0] || null;
}

async function consumeExpiredOtpChallenges(req, mobile, purpose = OTP_PURPOSE) {
  const rows = rowsOf(
    await req.catalystApp
      .zcql()
      .executeZCQLQuery(
        "SELECT ROWID, expires_at, is_consumed, purpose FROM Auth_Otp_Challenges WHERE mobile = " +
          sqlString(mobile)
      ),
    "Auth_Otp_Challenges"
  );
  for (const row of rows) {
    if (isTruthy(row.is_consumed) || !otpPurposeMatches(row, purpose)) {
      continue;
    }
    if (parseDate(row.expires_at) >= Date.now()) {
      continue;
    }
    await req.catalystApp.datastore().table("Auth_Otp_Challenges").updateRow({
      ROWID: row.ROWID,
      is_consumed: true,
    });
  }
}

async function assertCanRequestOtp(req, mobile, purpose = OTP_PURPOSE) {
  const latest = await latestOtpChallenge(req, mobile, purpose);
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
  const allowDev = isDevOtpFallbackEnabled();
  try {
    return await sendWhatsappOtp(mobile, otp);
  } catch (err) {
    if (allowDev) {
      console.log(`[delivery-partner OTP DEV FALLBACK] Mobile: ${mobile}, OTP: ${otp}`);
      return {
        sentVia: "DEV",
        debugOtp: otp,
        whatsappError: err.details || err.message,
      };
    }
    throw err;
  }
}

async function resolveAvailableRoles(req, mobile) {
  const canonical = canonicalMobile(mobile);
  const zcql = req.catalystApp.zcql();
  const roles = [];
  const user = await findUserByMobile(zcql, canonical);
  if (user) {
    roles.push("customer");
  }
  const partner = await findDeliveryPartnerByPhone(zcql, canonical);
  if (partner) {
    roles.push("delivery_partner");
  }
  if (roles.length === 0) {
    return ["customer", "delivery_partner"];
  }
  return roles;
}

function registerDeliveryPartnerAuthRoutes(app) {
  app.post("/v1/auth/role-select", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
      const available_roles = await resolveAvailableRoles(req, mobile);
      sendOk(res, { available_roles, phone: mobile });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/otp/request", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
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
          purpose: OTP_PURPOSE,
          request_ip: String(
            req.headers["x-forwarded-for"] ||
              req.headers["x-real-ip"] ||
              req.socket?.remoteAddress ||
              ""
          )
            .split(",")[0]
            .trim()
            .slice(0, 80),
          user_agent: String(req.headers["user-agent"] || "").slice(0, 255),
          sent_via: sendResult.sentVia,
        });
      sendOk(res, {
        otp_sent: true,
        challenge_id: insertedRowId(inserted),
        phone: mobile,
        expires_in: OTP_TTL_MINUTES * 60,
        expires_in_seconds: OTP_TTL_MINUTES * 60,
        resend_after_seconds: OTP_RESEND_SECONDS,
        sent_via: sendResult.sentVia,
        ...(sendResult.sentVia === "DEV" && sendResult.debugOtp
          ? { debug_otp: sendResult.debugOtp }
          : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/otp/verify", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
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
                "SELECT ROWID, mobile, otp_hash, expires_at, attempts, is_consumed, purpose FROM Auth_Otp_Challenges WHERE ROWID = " +
                  challengeId
              ),
            "Auth_Otp_Challenges"
          )
        : await latestOtpChallenge(req, mobile);
      if (
        !challenge ||
        challenge.mobile !== mobile ||
        isTruthy(challenge.is_consumed) ||
        !otpPurposeMatches(challenge)
      ) {
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

      const partner = await ensureDeliveryPartnerAccount(req, mobile);
      const zcql = req.catalystApp.zcql();
      if (partner.is_new_partner) {
        await ensureRegistrationSeed(req.catalystApp, zcql, parseDeliveryPartnerId(partner.delivery_partner_id));
      }
      const bundle = await loadRegistrationBundle(zcql, partner.delivery_partner_id);
      const registrationPhase = bundle ? inferRegistrationPhase(bundle) : REGISTRATION_PHASE.OTP_VERIFIED;
      const requiresPasswordLogin = await partnerRequiresPasswordLogin(zcql, partner.delivery_partner_id);

      if (requiresPasswordLogin) {
        sendOk(res, {
          otp_verified: true,
          requires_password_login: true,
          registration_phase: registrationPhase,
          phone: partner.phone,
          delivery_partner_id: partner.delivery_partner_id,
          message: "Registration complete. Sign in with your mobile number and password.",
        });
        return;
      }

      const sessionPayload = deliveryPartnerSessionPayload(partner);
      sendOk(res, {
        token: signSession(sessionPayload),
        role: "delivery_partner",
        status: partner.status,
        delivery_partner_id: partner.delivery_partner_id,
        outlet_id: partner.outlet_id || null,
        phone: partner.phone,
        is_new_partner: partner.is_new_partner === true,
        registration_phase: registrationPhase,
        registration_complete: registrationPhase === REGISTRATION_PHASE.REGISTERED,
        requires_password_login: false,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/login", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
      const password = String(req.body.password || "");
      if (!password) {
        const error = new Error("Password is required");
        error.status = 400;
        throw error;
      }
      const partner = await loginWithPassword(req, mobile, password);
      const sessionPayload = deliveryPartnerSessionPayload(partner);
      sendOk(res, {
        token: signSession(sessionPayload),
        role: "delivery_partner",
        status: partner.status,
        delivery_partner_id: partner.delivery_partner_id,
        outlet_id: partner.outlet_id || null,
        phone: partner.phone,
        registration_phase: partner.registration_phase || REGISTRATION_PHASE.REGISTERED,
        registration_complete: true,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/auth/delivery-partner/registration/status", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const registration = await getRegistrationStatus(req, partner);
      sendOk(res, { registration });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/registration/profile", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const result = await savePersonalProfile(req, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/registration/photos", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const result = await saveRegistrationPhoto(req, partner, req.body || {});
      sendOk(res, result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/registration/password", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const registration = await saveRegistrationPassword(req, partner, req.body || {});
      sendOk(res, { registration });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/registration/complete", async (req, res, next) => {
    try {
      const partner = requireDeliveryPartner(req);
      const registration = await completeRegistration(req, partner);
      sendOk(res, { registration });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/password/forgot/request", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
      const zcql = req.catalystApp.zcql();
      const partner = await findDeliveryPartnerByPhone(zcql, mobile);
      if (!partner) {
        const error = new Error("No employee account found for this mobile number");
        error.status = 404;
        error.code = "PARTNER_NOT_FOUND";
        throw error;
      }
      const hasPassword = await partnerRequiresPasswordLogin(zcql, partner.delivery_partner_id);
      if (!hasPassword) {
        const error = new Error("Complete employee registration before resetting your password");
        error.status = 409;
        error.code = "REGISTRATION_INCOMPLETE";
        throw error;
      }
      await consumeExpiredOtpChallenges(req, mobile, OTP_RESET_PURPOSE);
      await assertCanRequestOtp(req, mobile, OTP_RESET_PURPOSE);
      const otp = generateOtp();
      const sendResult = await sendOtp(mobile, otp);
      const inserted = await req.catalystApp
        .datastore()
        .table("Auth_Otp_Challenges")
        .insertRow({
          mobile,
          otp_hash: otpHash(mobile, otp, OTP_RESET_PURPOSE),
          expires_at: nowSql(expiryDate()),
          attempts: 0,
          is_consumed: false,
          purpose: OTP_RESET_PURPOSE,
          sent_via: sendResult.sentVia,
        });
      sendOk(res, {
        otp_sent: true,
        challenge_id: insertedRowId(inserted),
        phone: mobile,
        expires_in_seconds: OTP_TTL_MINUTES * 60,
        resend_after_seconds: OTP_RESEND_SECONDS,
        sent_via: sendResult.sentVia,
        ...(sendResult.sentVia === "DEV" && sendResult.debugOtp
          ? { debug_otp: sendResult.debugOtp }
          : {}),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/auth/delivery-partner/password/forgot/reset", async (req, res, next) => {
    try {
      const mobile = normalizeMobile(req.body.phone || req.body.mobile);
      const otp = String(req.body.otp || "").trim();
      validatePasswordPair(req.body.password, req.body.confirm_password);
      if (!/^\d{6}$/.test(otp)) {
        const error = new Error("Enter the 6 digit OTP");
        error.status = 400;
        throw error;
      }
      const challengeId = req.body.challenge_id
        ? asId(req.body.challenge_id, "challenge_id")
        : "";
      const candidates = await loadResetOtpCandidates(req, mobile, challengeId);
      const challenge = pickResetOtpChallenge(candidates, mobile, challengeId);
      if (!challenge) {
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

      const resetHash = otpHash(mobile, otp, OTP_RESET_PURPOSE);
      if (challenge.otp_hash !== resetHash) {
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

      const partner = await findDeliveryPartnerByPhone(req.catalystApp.zcql(), mobile);
      if (!partner) {
        const error = new Error("Employee account not found");
        error.status = 404;
        throw error;
      }
      await resetPartnerPasswordByMobile(
        req.catalystApp,
        req.catalystApp.zcql(),
        partner.delivery_partner_id,
        req.body.password
      );
      sendOk(res, { reset: true, phone: mobile });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = {
  OTP_PURPOSE,
  normalizeMobile,
  registerDeliveryPartnerAuthRoutes,
  resolveAvailableRoles,
};
