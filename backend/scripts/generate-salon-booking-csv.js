"use strict";

const fs = require("fs");
const path = require("path");

const { SALON_CATEGORIES, MASTER_COLUMNS } = require("../functions/baylen-api/lib/salon-csv-contract");

const seedsRoot = path.resolve(__dirname, "../seeds");
const templateDir = path.resolve(__dirname, "../docs/salon-booking/templates");

const OUTLETS = [
  {
    outlet_code: "LALPUR-GOLD",
    outlet_id: "36851000000307517",
    name: "Baylen Premium Salon Lalpur",
    slug: "baylen-premium-salon-lalpur",
    salon_category: "Gold",
    area: "Lalpur",
    address_line1: "Lalpur Main Road",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834001",
    phone: "+919876543210",
    latitude: 23.3782,
    longitude: 85.3315,
    opening_time: "10:00",
    closing_time: "21:00",
    rating: 4.7,
    review_count: 128,
    image_url: "assets/icon/logo.png",
  },
  {
    outlet_code: "BARIATU-SILVER",
    outlet_id: "36851000000286399",
    name: "Baylen Style Hub Bariatu",
    slug: "baylen-style-hub-bariatu",
    salon_category: "Silver",
    area: "Bariatu",
    address_line1: "Bariatu Road",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834009",
    phone: "+919876543211",
    latitude: 23.4012,
    longitude: 85.3198,
    opening_time: "10:00",
    closing_time: "21:00",
    rating: 4.5,
    review_count: 96,
    image_url: "assets/icon/logo.png",
  },
  {
    outlet_code: "MAINROAD-LUXURY",
    outlet_id: "36851000000302499",
    name: "Baylen Luxury Salon Main Road",
    slug: "baylen-luxury-salon-main-road",
    salon_category: "Luxury",
    area: "Hindpiri",
    address_line1: "Main Road",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834001",
    phone: "+919876543212",
    latitude: 23.346,
    longitude: 85.3235,
    opening_time: "10:00",
    closing_time: "21:00",
    rating: 4.8,
    review_count: 210,
    image_url: "assets/icon/logo.png",
  },
  {
    outlet_code: "KANKE-BRONZE",
    outlet_id: "36851000000308173",
    name: "Baylen Express Salon Kanke",
    slug: "baylen-express-salon-kanke",
    salon_category: "Bronze",
    area: "Kanke",
    address_line1: "Kanke Road",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834006",
    phone: "+919876543213",
    latitude: 23.2954,
    longitude: 85.3221,
    opening_time: "10:00",
    closing_time: "20:00",
    rating: 4.4,
    review_count: 74,
    image_url: "assets/icon/logo.png",
  },
  {
    outlet_code: "DORANDA-ROYAL",
    outlet_id: "36851000000291792",
    name: "Baylen Elite Salon Doranda",
    slug: "baylen-elite-salon-doranda",
    salon_category: "Royal",
    area: "Doranda",
    address_line1: "Doranda Market",
    city: "Ranchi",
    state: "Jharkhand",
    postal_code: "834002",
    phone: "+919876543214",
    latitude: 23.3528,
    longitude: 85.3092,
    opening_time: "10:00",
    closing_time: "21:00",
    rating: 4.6,
    review_count: 112,
    image_url: "assets/icon/logo.png",
  },
];

const SERVICES = [
  {
    service_code: "SVC-HAIRCUT",
    service_id: "36851000000299095",
    name: "Haircut",
    slug: "haircut",
    service_type: "Hair",
    description: "Precision haircut with wash and blow dry.",
    duration_minutes: 45,
  },
  {
    service_code: "SVC-HAIR-SPA",
    service_id: "36851000000295759",
    name: "Hair Spa",
    slug: "hair-spa",
    service_type: "Spa",
    description: "Deep conditioning spa for scalp and hair repair.",
    duration_minutes: 60,
  },
  {
    service_code: "SVC-MANICURE",
    service_id: "36851000000295760",
    name: "Manicure",
    slug: "manicure",
    service_type: "Nails",
    description: "Classic manicure with cuticle care and polish.",
    duration_minutes: 45,
  },
  {
    service_code: "SVC-CLEANUP",
    service_id: "36851000000299096",
    name: "Cleanup",
    slug: "cleanup",
    service_type: "Skin",
    description: "Express skin cleanup and toning.",
    duration_minutes: 60,
  },
  {
    service_code: "SVC-FACIAL",
    service_id: "36851000000299097",
    name: "Facial",
    slug: "facial",
    service_type: "Skin",
    description: "Signature facial with massage and mask.",
    duration_minutes: 75,
  },
];

const CATEGORY_HAIRCUT_MALE = {
  Bronze: 200,
  Silver: 300,
  Gold: 500,
  Royal: 700,
  Luxury: 1000,
  Diamond: 1200,
};

const SERVICE_MULTIPLIER = {
  "SVC-HAIRCUT": 1,
  "SVC-MANICURE": 1,
  "SVC-HAIR-SPA": 1.8,
  "SVC-CLEANUP": 1.8,
  "SVC-FACIAL": 2.7,
};

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function roundPrice(value) {
  return Math.round(value);
}

function femalePrice(malePrice) {
  return roundPrice(malePrice * 1.25);
}

function blankMasterRow() {
  const row = {};
  for (const col of MASTER_COLUMNS) {
    row[col.key] = "";
  }
  return row;
}

function buildPriceRows() {
  const rows = [];
  for (const outlet of OUTLETS) {
    for (const category of SALON_CATEGORIES) {
      const haircutMale = CATEGORY_HAIRCUT_MALE[category];
      for (const service of SERVICES) {
        const multiplier = SERVICE_MULTIPLIER[service.service_code] || 1;
        const male = roundPrice(haircutMale * multiplier);
        const female = femalePrice(male);
        for (const gender of ["MALE", "FEMALE"]) {
          const selling = gender === "MALE" ? male : female;
          rows.push({
            outlet_code: outlet.outlet_code,
            package_slug: category.toLowerCase(),
            service_code: service.service_code,
            gender,
            mrp: selling,
            selling_price: selling,
            duration_minutes: service.duration_minutes,
            is_active: "true",
          });
        }
      }
    }
  }
  return rows;
}

function buildMasterRows() {
  const priceRows = buildPriceRows();
  const rows = [];

  for (const outlet of OUTLETS) {
    const row = blankMasterRow();
    row.record_type = "OUTLET";
    row.outlet_code = outlet.outlet_code;
    row.outlet_id = outlet.outlet_id;
    row.salon_name = outlet.name;
    row.salon_slug = outlet.slug;
    row.salon_category = outlet.salon_category;
    row.area = outlet.area;
    row.address_line1 = outlet.address_line1;
    row.city = outlet.city;
    row.state = outlet.state;
    row.postal_code = outlet.postal_code;
    row.phone = outlet.phone;
    row.latitude = outlet.latitude;
    row.longitude = outlet.longitude;
    row.opening_time = outlet.opening_time;
    row.closing_time = outlet.closing_time;
    row.rating = outlet.rating;
    row.review_count = outlet.review_count;
    row.image_url = outlet.image_url;
    row.is_active = "true";
    rows.push(row);
  }

  for (const service of SERVICES) {
    const row = blankMasterRow();
    row.record_type = "SERVICE";
    row.service_code = service.service_code;
    row.service_id = service.service_id;
    row.service_name = service.name;
    row.service_type = service.service_type;
    row.service_description = service.description;
    row.duration_minutes = service.duration_minutes;
    row.is_active = "true";
    rows.push(row);
  }

  for (const price of priceRows) {
    const service = SERVICES.find((item) => item.service_code === price.service_code) || {};
    const row = blankMasterRow();
    row.record_type = "PRICE";
    row.outlet_code = price.outlet_code;
    row.package_slug = price.package_slug;
    row.service_code = price.service_code;
    row.service_id = service.service_id || "";
    row.service_name = service.name || "";
    row.service_type = service.service_type || "";
    row.duration_minutes = price.duration_minutes;
    row.gender = price.gender;
    row.mrp = price.mrp;
    row.selling_price = price.selling_price;
    row.is_active = price.is_active;
    rows.push(row);
  }

  return rows;
}

function main() {
  const masterRows = buildMasterRows();
  const headers = MASTER_COLUMNS.map((col) => col.key);
  const masterCsv = toCsv(headers, masterRows);

  fs.mkdirSync(templateDir, { recursive: true });
  const target = path.join(seedsRoot, "salon-master.csv");
  const temp = path.join(seedsRoot, "salon-master.csv.tmp");
  fs.writeFileSync(temp, masterCsv, "utf8");
  try {
    fs.rmSync(target, { force: true });
  } catch (_) {
    // File may be open in Excel — leave .tmp for manual replace.
  }
  try {
    fs.renameSync(temp, target);
  } catch (error) {
    console.warn("Could not replace salon-master.csv — close Excel if it is open.");
    console.warn("Clean file saved as:", temp);
    process.exitCode = 0;
    return;
  }
  fs.writeFileSync(path.join(templateDir, "salon-master-template.csv"), toCsv(headers, []), "utf8");

  console.log("Generated backend/seeds/salon-master.csv");
  console.log("  OUTLET:", masterRows.filter((row) => row.record_type === "OUTLET").length);
  console.log("  SERVICE:", masterRows.filter((row) => row.record_type === "SERVICE").length);
  console.log("  PRICE:", masterRows.filter((row) => row.record_type === "PRICE").length);
  console.log("  TOTAL:", masterRows.length);
  console.log("");
  console.log("Staff is not in CSV — manage experts in Catalyst Data Store.");
}

main();
