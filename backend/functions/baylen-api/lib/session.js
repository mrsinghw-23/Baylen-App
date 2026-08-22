const crypto = require("crypto");

const SECRET = process.env.AUTH_SESSION_SECRET || "baylen-dev-session-key";
const APP_BASE =
  "https://baylen-app-60069781151.development.catalystserverless.in";

function signSession(payload) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data || data.exp < Date.now()) {
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function isAllowedOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol === "baylen:") {
      return true;
    }
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
    return url.origin === APP_BASE;
  } catch (_) {
    return false;
  }
}

function publicUser(data) {
  return {
    user_id: String(data.user_id || ""),
    email: data.email || "",
    first_name: data.first_name || "",
    last_name: data.last_name || "",
  };
}

async function catalystUser(req) {
  try {
    return await req.catalystApp.userManagement().getCurrentUser();
  } catch (_) {
    return null;
  }
}

function bearerUser(req) {
  const custom = req.headers["x-baylen-token"];
  if (custom) {
    return verifySession(String(custom).trim());
  }
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return verifySession(header.slice(7).trim());
}

function requireUser(req) {
  const user = bearerUser(req);
  const userId = String(user && user.user_id ? user.user_id : "").trim();
  if (!user || !/^\d+$/.test(userId)) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  return {
    user_id: userId,
    email: user.email || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
  };
}

module.exports = {
  APP_BASE,
  signSession,
  verifySession,
  isAllowedOrigin,
  publicUser,
  catalystUser,
  bearerUser,
  requireUser,
};
