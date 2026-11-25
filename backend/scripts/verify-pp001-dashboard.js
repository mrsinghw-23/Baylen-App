#!/usr/bin/env node
"use strict";

const path = require("path");
const { signSession } = require(path.join(
  __dirname,
  "../functions/baylen-api/lib/session"
));

const BASE =
  process.env.BAYLEN_DEV_API_BASE ||
  "https://baylen-app-60069781151.development.catalystserverless.in";

async function callDashboard(partner) {
  const token = signSession({
    sub: partner.delivery_partner_id,
    role: "delivery_partner",
    delivery_partner_id: partner.delivery_partner_id,
    outlet_id: partner.outlet_id,
    phone: partner.phone,
    status: partner.status,
    first_name: partner.first_name,
    last_name: partner.last_name,
  });
  const res = await fetch(BASE + "/v1/delivery-partner/dashboard", {
    headers: { "x-baylen-token": token },
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  return { status: res.status, body };
}

async function setStatus(partner, onlineStatus) {
  const token = signSession({
    sub: partner.delivery_partner_id,
    role: "delivery_partner",
    delivery_partner_id: partner.delivery_partner_id,
    outlet_id: partner.outlet_id,
    phone: partner.phone,
    status: partner.status,
  });
  const res = await fetch(BASE + "/v1/delivery-partner/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-baylen-token": token,
    },
    body: JSON.stringify({ online_status: onlineStatus }),
  });
  const body = await res.json().catch(async () => ({ raw: await res.text() }));
  return { status: res.status, body };
}

async function main() {
  const active = {
    delivery_partner_id: "dp_36851000000379403",
    outlet_id: "36851000000286399",
    phone: "+919825391754",
    status: "active",
    first_name: "Neha",
    last_name: "Singh",
  };
  const pending = {
    delivery_partner_id: "dp_36851000000381800",
    outlet_id: "36851000000291792",
    phone: "+919876543211",
    status: "pending_kyc",
    first_name: "Priya",
    last_name: "Sharma",
  };

  const activeDash = await callDashboard(active);
  const pendingDash = await callDashboard(pending);
  const offlineAttempt = await setStatus(active, "OFFLINE");
  const onlineAttempt = await setStatus(active, "ONLINE_AVAILABLE");

  console.log(
    JSON.stringify(
      {
        active_dashboard: {
          status: activeDash.status,
          body: activeDash.body,
        },
        pending_dashboard: {
          status: pendingDash.status,
          body: pendingDash.body,
        },
        offline_with_active_job: {
          status: offlineAttempt.status,
          body: offlineAttempt.body,
        },
        online_restore: {
          status: onlineAttempt.status,
          body: onlineAttempt.body,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
