"use strict";

const apiBase = (
  process.env.BAYLEN_API_BASE ||
  "https://baylen-app-60069781151.development.catalystserverless.in"
).replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY || "";

async function adminPost(pathname, body) {
  if (!adminKey) {
    throw new Error("Set ADMIN_API_KEY before running this script");
  }
  const response = await fetch(apiBase + pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-baylen-admin-key": adminKey,
      "x-baylen-admin-user": process.env.BAYLEN_ADMIN_USER || "booking-whatsapp-test",
    },
    body: JSON.stringify(body || {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("Invalid JSON from API: " + text.slice(0, 300));
  }
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.message || text.slice(0, 300));
  }
  return data.data || data;
}

async function main() {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  const mobileArg = args.find((arg) => arg.startsWith("--mobile="));
  const mobile = mobileArg ? mobileArg.slice("--mobile=".length) : "";

  if (!mobile) {
    console.error(
      "Usage:\n" +
        "  node backend/scripts/test-booking-whatsapp.js --mobile=9876543210 [--preview]\n" +
        "\nOptional env: ADMIN_API_KEY, BAYLEN_API_BASE"
    );
    process.exit(1);
  }

  const health = await fetch(apiBase + "/health").then((r) => r.json());
  console.log("Health booking_whatsapp:", JSON.stringify(health?.data?.booking_whatsapp, null, 2));

  const result = await adminPost("/v1/admin/salon/booking/test-whatsapp", {
    mobile,
    preview_only: preview,
  });
  console.log(JSON.stringify(result, null, 2));

  if (!preview && result.result?.status === "SENT") {
    console.log("\nOK — test booking WhatsApp sent.");
  } else if (!preview && result.result?.status !== "SENT") {
    console.error("\nFAILED:", result.result?.reason || "unknown");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
