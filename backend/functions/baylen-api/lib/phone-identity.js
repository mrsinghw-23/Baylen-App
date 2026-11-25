"use strict";

const { asId, rowOf, rowsOf, sqlString } = require("./http");

const USER_SELECT =
  "ROWID, Email, Phone, First_Name, Last_Name, gender, date_of_birth, profile_image, CREATEDTIME";

function nationalDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

function canonicalMobile(value) {
  const national = nationalDigits(value);
  if (!/^[6-9]\d{9}$/.test(national)) {
    const error = new Error("Enter a valid 10-digit Indian mobile number");
    error.status = 400;
    throw error;
  }
  return "+91" + national;
}

function phoneLookupKeys(value) {
  const national = nationalDigits(value);
  if (national.length !== 10) {
    return [];
  }
  return [...new Set(["+91" + national, "91" + national, national, "0" + national])];
}

function phonesMatch(left, right) {
  const a = nationalDigits(left);
  const b = nationalDigits(right);
  return a.length === 10 && a === b;
}

function parseCreatedTime(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickOldestUser(users) {
  if (!Array.isArray(users) || users.length === 0) {
    return null;
  }
  const copy = users.slice();
  copy.sort((a, b) => {
    const created = parseCreatedTime(a.CREATEDTIME) - parseCreatedTime(b.CREATEDTIME);
    if (created !== 0) {
      return created;
    }
    return String(a.ROWID || "").localeCompare(String(b.ROWID || ""));
  });
  return copy[0];
}

function identityFromSession(sessionUser, query = {}, body = {}) {
  void query.phone;
  void query.mobile;
  void query.user_id;
  void body.phone;
  void body.mobile;
  void body.user_id;
  const userId = String(sessionUser && sessionUser.user_id ? sessionUser.user_id : "").trim();
  if (!/^\d+$/.test(userId)) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  return userId;
}

async function findUsersByMobile(zcql, mobile) {
  const keys = phoneLookupKeys(mobile);
  const found = new Map();
  for (const key of keys) {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " + USER_SELECT + " FROM Users WHERE Phone = " + sqlString(key)
      ),
      "Users"
    );
    for (const row of rows) {
      found.set(String(row.ROWID), row);
    }
  }
  for (const key of keys) {
    const profiles = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT user_id FROM User_Profiles WHERE mobile = " + sqlString(key)
      ),
      "User_Profiles"
    );
    for (const profile of profiles) {
      const userId = String(profile.user_id || "").trim();
      if (!/^\d+$/.test(userId) || found.has(userId)) {
        continue;
      }
      const user = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT " + USER_SELECT + " FROM Users WHERE ROWID = " + asId(userId, "user_id")
        ),
        "Users"
      );
      if (user) {
        found.set(String(user.ROWID), user);
      }
    }
  }
  return [...found.values()];
}

async function findUserByMobile(zcql, mobile) {
  return pickOldestUser(await findUsersByMobile(zcql, mobile));
}

module.exports = {
  USER_SELECT,
  nationalDigits,
  canonicalMobile,
  phoneLookupKeys,
  phonesMatch,
  parseCreatedTime,
  pickOldestUser,
  identityFromSession,
  findUsersByMobile,
  findUserByMobile,
};
