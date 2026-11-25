#!/usr/bin/env node
"use strict";

/**
 * Verifies employee login → dashboard → offline/sign-out API flow against Dev.
 * Usage: node backend/scripts/test-employee-auth-flow.js [phone] [password]
 */

const path = require("path");
const { createDevCatalystClient, unwrap } = require(path.join(__dirname, "lib/dev-catalyst-client"));
const { loginWithPassword } = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner-registration"));
const { signSession } = require(path.join(__dirname, "../functions/baylen-api/lib/session"));
const { deliveryPartnerSessionPayload } = require(path.join(__dirname, "../functions/baylen-api/lib/delivery-partner"));

const BASE = "https://baylen-app-60069781151.development.catalystserverless.in";

async function http(method, apiPath, { token, body } = {}) {
  const res = await fetch(BASE + apiPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  const data = json?.data ?? json;
  return { status: res.status, data, json };
}

async function main() {
  const phone = process.argv[2] || "8877227718";
  const password = process.argv[3] || process.env.EMPLOYEE_TEST_PASSWORD || "";

  const ctx = await createDevCatalystClient();
  const req = { catalystApp: ctx.app };

  if (!password) {
    console.error("Set EMPLOYEE_TEST_PASSWORD or pass phone password args.");
    process.exit(2);
  }

  const partner = await loginWithPassword(req, phone, password);
  const token = signSession(deliveryPartnerSessionPayload(partner));
  console.log("OK loginWithPassword", partner.delivery_partner_id, partner.status);

  const dash = await http("GET", "/v1/delivery-partner/dashboard", { token });
  if (dash.status !== 200) {
    throw new Error("Dashboard failed: " + dash.status + " " + JSON.stringify(dash.data));
  }
  console.log("OK dashboard", dash.data?.online_status || dash.data?.partner?.online_status);

  const offline = await http("POST", "/v1/delivery-partner/status", {
    token,
    body: { online_status: "OFFLINE" },
  });
  if (offline.status !== 200) {
    throw new Error("Offline status failed: " + offline.status);
  }
  console.log("OK set OFFLINE");

  const dash2 = await http("GET", "/v1/delivery-partner/dashboard", { token });
  if (dash2.status !== 200) {
    throw new Error("Dashboard after offline failed");
  }
  console.log("OK dashboard still accessible with valid token (session not revoked server-side)");

  console.log("PASS employee auth API flow");
}

main().catch((err) => {
  console.error("FAIL", err.message);
  process.exit(1);
});
