const crypto = require("crypto");
const { getAuthSessionSecret } = require("./runtime-config");
const APP_BASE =
  "https://baylen-app-60069781151.development.catalystserverless.in";

function signSession(payload) {
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", getAuthSessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", getAuthSessionSecret()).update(body).digest("base64url");
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
  const rawEmail = String(data.email || "");
  const email = rawEmail.includes(".local") ? "" : rawEmail;
  const rawFirst = String(data.first_name || "");
  const firstName = (rawFirst === "Pending" || rawFirst === "Baylen") ? "" : rawFirst;
  const rawLast = String(data.last_name || "");
  const lastName = (rawLast === "Registration" || rawLast === "Customer") ? "" : rawLast;

  const isComplete = Boolean(
    data.is_profile_complete === true ||
    (firstName.trim().length >= 2 &&
     lastName.trim().length >= 1 &&
     email.trim().length > 3 &&
     /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  );

  return {
    user_id: String(data.user_id || ""),
    email: email,
    first_name: firstName,
    last_name: lastName,
    mobile: data.mobile || data.phone || "",
    gender: data.gender || "",
    date_of_birth: data.date_of_birth || "",
    profile_photo_url: data.profile_photo_url || "",
    created_at: data.created_at || "",
    is_profile_complete: isComplete,
  };
}

async function catalystUser(req) {
  try {
    const app = req.catalystUserApp || req.catalystApp;
    return await app.userManagement().getCurrentUser();
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

function sessionRole(session) {
  if (!session) {
    return "";
  }
  const role = String(session.role || "").trim().toLowerCase();
  if (role === "delivery_partner") {
    return "delivery_partner";
  }
  return "customer";
}

function forbiddenRoleError(requiredRole) {
  const error = new Error(
    requiredRole === "delivery_partner"
      ? "This action requires a delivery partner account"
      : "This action requires a customer account"
  );
  error.status = 403;
  error.code = "FORBIDDEN_ROLE";
  return error;
}

function requireRole(req, role) {
  const session = bearerUser(req);
  if (!session) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  const actualRole = sessionRole(session);
  if (actualRole !== role) {
    throw forbiddenRoleError(role);
  }
  req.user = session;
  return session;
}

function customerFromSession(session) {
  const userId = String(session.user_id || "").trim();
  if (!/^\d+$/.test(userId)) {
    return null;
  }
  return {
    user_id: userId,
    email: session.email || "",
    first_name: session.first_name || "",
    last_name: session.last_name || "",
    mobile: session.mobile || session.phone || "",
    gender: session.gender || "",
    date_of_birth: session.date_of_birth || "",
    profile_photo_url: session.profile_photo_url || "",
    created_at: session.created_at || "",
    is_profile_complete: session.is_profile_complete === true,
    role: "customer",
  };
}

function requireUser(req) {
  const session = bearerUser(req);
  if (!session) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  if (sessionRole(session) !== "customer") {
    throw forbiddenRoleError("customer");
  }
  const user = customerFromSession(session);
  if (!user) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  return user;
}

function requireDeliveryPartner(req) {
  const session = bearerUser(req);
  if (!session) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  if (sessionRole(session) !== "delivery_partner") {
    throw forbiddenRoleError("delivery_partner");
  }
  const deliveryPartnerId = String(
    session.delivery_partner_id || session.sub || ""
  ).trim();
  if (!deliveryPartnerId) {
    const error = new Error("Sign in required");
    error.status = 401;
    throw error;
  }
  return {
    delivery_partner_id: deliveryPartnerId,
    outlet_id: String(session.outlet_id || "").trim(),
    phone: session.phone || session.mobile || "",
    status: String(session.status || "pending_profile").trim() || "pending_profile",
    first_name: session.first_name || "",
    last_name: session.last_name || "",
    role: "delivery_partner",
  };
}

function signedInUser(req) {
  const session = bearerUser(req);
  if (sessionRole(session) !== "customer") {
    return null;
  }
  return customerFromSession(session);
}

function signedInDeliveryPartner(req) {
  const session = bearerUser(req);
  if (sessionRole(session) !== "delivery_partner") {
    return null;
  }
  try {
    return requireDeliveryPartner(req);
  } catch (_) {
    return null;
  }
}

function guestSessionId(req) {
  const raw = String(req.headers["x-baylen-guest-session"] || "").trim();
  if (!raw) {
    return "";
  }
  if (!/^guest_[a-f0-9]{32}$/.test(raw)) {
    const error = new Error("guest_session_id is invalid");
    error.status = 400;
    throw error;
  }
  return raw;
}

module.exports = {
  APP_BASE,
  signSession,
  verifySession,
  isAllowedOrigin,
  publicUser,
  catalystUser,
  bearerUser,
  sessionRole,
  requireRole,
  requireUser,
  requireDeliveryPartner,
  signedInUser,
  signedInDeliveryPartner,
  guestSessionId,
};
