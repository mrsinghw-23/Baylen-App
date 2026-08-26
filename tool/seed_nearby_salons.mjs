import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const apiBase = (process.env.BAYLEN_API_BASE ||
  "https://baylen-app-60069781151.development.catalystserverless.in").replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY || "";
const adminUser = process.env.BAYLEN_ADMIN_USER || "seed-nearby-salons";
const outletsCsvPath = path.resolve(root, process.env.OUTLETS_CSV || "backend/seeds/nearby_outlets.csv");
const servicesCsvPath = path.resolve(root, process.env.SERVICES_CSV || "backend/seeds/salon_services.csv");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((item) => item.some((value) => String(value || "").trim()));
}

function csvHasDataRows(text) {
  return parseCsv(text).length > 1;
}

function firstOutletLocation(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return null;
  }
  const headers = rows[0].map((header) => String(header || "").trim().toLowerCase());
  const latitudeIndex = headers.indexOf("latitude");
  const longitudeIndex = headers.indexOf("longitude");
  if (latitudeIndex === -1 || longitudeIndex === -1) {
    return null;
  }
  for (const row of rows.slice(1)) {
    const latitude = Number(row[latitudeIndex]);
    const longitude = Number(row[longitudeIndex]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }
  return null;
}

async function readCsv(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function postJson(route, payload, includeAdmin = true) {
  const response = await fetch(`${apiBase}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(includeAdmin
        ? {
            "x-baylen-admin-key": adminKey,
            "x-baylen-admin-user": adminUser,
          }
        : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`${route} failed: ${body.error || response.statusText}`);
  }
  return body.data;
}

async function seedBulk(label, route, csvText) {
  if (!csvHasDataRows(csvText)) {
    console.log(`${label}: skipped, CSV has header only`);
    return null;
  }
  const data = await postJson(route, { csv_text: csvText });
  const result = data.import || {};
  console.log(
    `${label}: total=${result.total || 0}, created=${result.created || 0}, updated=${result.updated || 0}, failed=${result.failed || 0}`
  );
  if (Array.isArray(result.errors) && result.errors.length) {
    console.log(`${label} row errors:`);
    for (const item of result.errors) {
      console.log(`  row ${item.row}: ${item.error}`);
    }
  }
  return result;
}

async function main() {
  if (!adminKey) {
    throw new Error("ADMIN_API_KEY is required. Set it in this terminal before running the seed.");
  }

  const [outletsCsv, servicesCsv] = await Promise.all([
    readCsv(outletsCsvPath),
    readCsv(servicesCsvPath),
  ]);

  await seedBulk("Salon services", "/v1/admin/services/bulk", servicesCsv);
  await seedBulk("Nearby outlets", "/v1/admin/outlets/bulk", outletsCsv);

  const location = firstOutletLocation(outletsCsv);
  if (location) {
    const nearby = await postJson(
      "/v1/outlets/nearby",
      { lat: location.latitude, lng: location.longitude, limit: 10 },
      false
    );
    const outlets = nearby.outlets || [];
    console.log(`Nearby verification: ${outlets.length} outlet(s) returned`);
    outlets.slice(0, 5).forEach((outlet, index) => {
      console.log(`${index + 1}. ${outlet.name} - ${outlet.distance_km} km`);
    });
  } else {
    console.log("Nearby verification skipped, no outlet latitude/longitude found.");
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
