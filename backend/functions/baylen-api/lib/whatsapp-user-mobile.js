"use strict";

const { rowOf, rowsOf, sqlString } = require("./http");
const { phoneLookupKeys, nationalDigits } = require("./phone-identity");
const { normalizeIndianMobile } = require("./whatsapp-transactional");

async function latestOtpMobileForKeys(zcql, keys) {
  let bestMobile = "";
  let bestCreated = 0;
  for (const key of keys) {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT mobile, CREATEDTIME FROM Auth_Otp_Challenges WHERE mobile = " + sqlString(key)
      ),
      "Auth_Otp_Challenges"
    );
    for (const row of rows) {
      const created = Date.parse(String(row.CREATEDTIME || "").replace(" ", "T"));
      if (Number.isFinite(created) && created >= bestCreated) {
        const mobile = normalizeIndianMobile(row.mobile);
        if (mobile.length === 10) {
          bestCreated = created;
          bestMobile = mobile;
        }
      }
    }
  }
  return bestMobile;
}

async function resolveCustomerWhatsappMobile(req, user) {
  const userId = String(user && user.user_id ? user.user_id : "").trim();
  const fromSession = normalizeIndianMobile(user && (user.mobile || user.phone));
  if (fromSession.length === 10) {
    return fromSession;
  }
  if (!userId || !/^\d+$/.test(userId)) {
    return "";
  }
  try {
    const { loadCustomerIdentity } = require("./account-recover");
    const identity = await loadCustomerIdentity(req, userId);
    const fromProfile = normalizeIndianMobile(identity && identity.mobile);
    if (fromProfile.length === 10) {
      return fromProfile;
    }
    const keys = phoneLookupKeys(identity && identity.mobile);
    if (keys.length > 0) {
      const fromOtp = await latestOtpMobileForKeys(req.catalystApp.zcql(), keys);
      if (fromOtp.length === 10) {
        return fromOtp;
      }
    }
  } catch (_) {}
  return "";
}

async function resolveCustomerDisplayName(req, user) {
  const sessionName = [user && user.first_name, user && user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (sessionName && sessionName !== "Baylen Customer" && !sessionName.startsWith("Pending ")) {
    return sessionName;
  }
  const userId = String(user && user.user_id ? user.user_id : "").trim();
  if (!userId || !/^\d+$/.test(userId)) {
    return sessionName || "there";
  }
  try {
    const { loadCustomerIdentity } = require("./account-recover");
    const identity = await loadCustomerIdentity(req, userId);
    const name = [identity.first_name, identity.last_name].filter(Boolean).join(" ").trim();
    if (name) {
      return name;
    }
  } catch (_) {}
  return sessionName || "there";
}

function formatIndianMobileForStorage(value) {
  const digits = nationalDigits(value);
  if (digits.length !== 10) {
    return "";
  }
  return "+91" + digits;
}

module.exports = {
  resolveCustomerWhatsappMobile,
  resolveCustomerDisplayName,
  formatIndianMobileForStorage,
};
