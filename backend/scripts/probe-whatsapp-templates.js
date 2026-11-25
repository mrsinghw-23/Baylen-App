#!/usr/bin/env node
"use strict";

/**
 * Probe Tata WhatsApp template sends and print full gateway responses.
 * Usage: node backend/scripts/probe-whatsapp-templates.js --mobile=8825391754
 */

const path = require("path");
const BACKEND_ROOT = path.resolve(__dirname, "..");
const PROJECT_ID = "36851000000230006";
const ORG_ID = "60069781151";
const FUNCTION_NAME = "baylen-api";

function loadCliModules() {
  const cliRoot = path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "zcatalyst-cli",
    "lib"
  );
  const configStore = require(path.join(cliRoot, "util_modules", "config-store")).default;
  const { getActiveDC } = require(path.join(cliRoot, "util_modules", "dc"));
  const Credential = require(path.join(cliRoot, "authentication", "credential")).default;
  const endpoints = require(path.join(cliRoot, "endpoints"));
  return { configStore, getActiveDC, Credential, endpoints };
}

async function getFnVars() {
  const { configStore, getActiveDC, Credential, endpoints } = loadCliModules();
  const dc = getActiveDC();
  const credential = configStore.get(`${dc}.credential`);
  if (!credential) {
    throw new Error("Run catalyst login first");
  }
  Credential.init(credential);
  const functions = await endpoints.functionsAPI({
    projectId: PROJECT_ID,
    env: "Development",
    org: ORG_ID,
  });
  const fnList = await functions.getAllFunctions();
  const fn = fnList.find((entry) => entry.name === FUNCTION_NAME);
  if (!fn) {
    throw new Error(`${FUNCTION_NAME} not found`);
  }
  return fn.configuration?.environment?.variables || {};
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

async function probeTemplate({ label, vars, templateName, parameters, languages, includeFromVariants }) {
  const apiKey = vars.TATA_WHATSAPP_API_KEY;
  const sender = vars.TATA_WHATSAPP_SENDER;
  const endpoint =
    vars.TATA_WHATSAPP_ENDPOINT ||
    "https://wb.omni.tatatelebusiness.com/whatsapp-cloud/messages";
  const mobileArg = process.argv.find((a) => a.startsWith("--mobile="));
  const localMobile = digitsOnly(mobileArg ? mobileArg.slice(9) : "").slice(-10);
  if (localMobile.length !== 10) {
    throw new Error("Pass --mobile=10digit");
  }
  const to = "91" + localMobile;
  const from = sender ? "91" + digitsOnly(sender).slice(-10) : "";

  console.log("\n=== " + label + " (" + templateName + ") ===");
  for (const language of languages) {
    for (const includeFrom of includeFromVariants) {
      const body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components: [
            {
              type: "body",
              parameters: parameters.map((text) => ({ type: "text", text: String(text) })),
            },
          ],
        },
      };
      if (includeFrom && from) {
        body.from = from;
      }
      const tag = language + (includeFrom && from ? "+from" : "+nofrom");
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        const raw = await response.text();
        let parsed = raw;
        try {
          parsed = JSON.parse(raw);
        } catch (_) {}
        console.log("\n[" + tag + "] HTTP " + response.status);
        console.log(typeof parsed === "string" ? parsed.slice(0, 800) : JSON.stringify(parsed, null, 2));
      } catch (err) {
        console.log("\n[" + tag + "] ERROR", err.message);
      }
    }
  }
}

async function main() {
  const vars = await getFnVars();
  const bookingParams = [
    "Baylen Customer",
    "Baylen Premium Salon Lalpur",
    "Hair Cut",
    "Rohit Sharma",
    "2026-09-04",
    "10:30",
    "500",
    "BAY-PROBE-001",
  ];
  const orderParams = ["Baylen Customer", "BAY-PROBE-001", "999", "COD", "Ranchi 834001", "2-4 days"];
  const langs = ["en", "en_US", "en_GB", "en_IN"];
  const fromVariants = [true, false];

  await probeTemplate({
    label: "OTP auth",
    vars,
    templateName: vars.TATA_TEMPLATE_NAME || "baylen_app_auth",
    parameters: ["123456"],
    languages: langs,
    includeFromVariants: fromVariants,
  });
  await probeTemplate({
    label: "Booking utility",
    vars,
    templateName: vars.TATA_BOOKING_TEMPLATE_NAME || "baylen_booking_confirmed",
    parameters: bookingParams,
    languages: langs,
    includeFromVariants: fromVariants,
  });
  await probeTemplate({
    label: "Order utility",
    vars,
    templateName: vars.TATA_ORDER_TEMPLATE_NAME || "baylen_order_confirmed",
    parameters: orderParams,
    languages: langs,
    includeFromVariants: fromVariants,
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
