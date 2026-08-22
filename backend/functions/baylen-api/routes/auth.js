const {
  APP_BASE,
  signSession,
  isAllowedOrigin,
  publicUser,
  catalystUser,
  bearerUser,
} = require("../lib/session");
const { sendOk } = require("../lib/http");

function mapCatalystUser(user) {
  return {
    user_id: user.userId || user.user_id || user.zuid || "",
    email: user.email_id || user.email || "",
    first_name: user.first_name || user.firstName || "",
    last_name: user.last_name || user.lastName || "",
  };
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
}

module.exports = authRoutes;
