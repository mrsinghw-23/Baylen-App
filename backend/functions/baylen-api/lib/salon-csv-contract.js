"use strict";

/**
 * Salon package CSV import contract — one file per package tier.
 * Files live under backend/seeds/salon/. Header-only until real data is supplied.
 */

const PACKAGE_TIERS = ["GOLD", "SILVER", "LUXURY", "BRONZE", "ROYAL"];

const SERVICE_CATEGORIES = ["Hair", "Skin", "Bridal", "Spa", "Nails"];

const PACKAGE_CSV_FILES = {
  GOLD: "salon-gold.csv",
  SILVER: "salon-silver.csv",
  LUXURY: "salon-luxury.csv",
  BRONZE: "salon-bronze.csv",
  ROYAL: "salon-royal.csv",
};

const PACKAGE_CSV_COLUMNS = [
  { key: "salon_id", required: false, description: "Catalyst Outlets ROWID. Used for upsert updates." },
  { key: "salon_code", required: true, description: "Stable outlet code e.g. BAYLEN-RNC-001." },
  { key: "salon_name", required: false, description: "Outlet display name." },
  { key: "salon_slug", required: false, description: "Outlet URL slug." },
  { key: "location", required: false, description: "Area/locality or street label." },
  { key: "city", required: false, description: "City name." },
  { key: "state", required: false, description: "State name." },
  { key: "pincode", required: false, description: "6-digit postal code." },
  {
    key: "package_category",
    required: true,
    description: "Must match file tier: GOLD|SILVER|LUXURY|BRONZE|ROYAL.",
  },
  {
    key: "package_code",
    required: true,
    description: "Stable package code e.g. gold, royal. Maps to Salon_Packages.slug.",
  },
  {
    key: "service_category",
    required: true,
    description: "Hair|Skin|Bridal|Spa|Nails.",
  },
  { key: "service_id", required: false, description: "Catalyst Salon_Services ROWID for updates." },
  { key: "service_code", required: true, description: "Stable service identifier. Primary upsert key." },
  { key: "service_name", required: true, description: "Customer-facing service name." },
  { key: "service_slug", required: false, description: "URL/search slug." },
  { key: "service_description", required: false, description: "Service description." },
  {
    key: "service_gender",
    required: false,
    description: "MALE|FEMALE|UNISEX. Use one row per gender per service (recommended).",
  },
  { key: "male_price", required: false, description: "Selling price for Male (INR)." },
  { key: "female_price", required: false, description: "Selling price for Female (INR)." },
  { key: "both_price", required: false, description: "Unisex/both price if applicable (INR)." },
  { key: "duration_minutes", required: true, description: "Service duration in minutes." },
  { key: "male_service_available", required: false, description: "true|false." },
  { key: "female_service_available", required: false, description: "true|false." },
  { key: "both_service_available", required: false, description: "true|false." },
  { key: "staff_id", required: false, description: "Stable staff identifier. Primary staff upsert key." },
  { key: "staff_name", required: false, description: "Staff display name." },
  { key: "staff_gender", required: false, description: "MALE|FEMALE|UNISEX." },
  { key: "staff_profile_image", required: false, description: "Profile image URL or asset path." },
  { key: "staff_rating", required: false, description: "Staff rating 0-5." },
  { key: "staff_experience_years", required: false, description: "Years of experience." },
  { key: "service_available", required: false, description: "true|false for this offer row." },
  { key: "available_days", required: false, description: "Comma-separated days e.g. Mon,Tue,Wed." },
  { key: "available_time_slots", required: false, description: "Comma-separated slots e.g. 10:00-13:00,14:00-18:00." },
  { key: "service_image", required: false, description: "Service image URL or asset path." },
  { key: "service_video", required: false, description: "Service video URL." },
  { key: "search_keywords", required: false, description: "Comma-separated search keywords." },
  { key: "search_aliases", required: false, description: "Comma-separated aliases e.g. haircut,hair cut." },
  { key: "tags", required: false, description: "Comma-separated tags." },
  { key: "status", required: false, description: "ACTIVE|INACTIVE." },
  { key: "sort_order", required: false, description: "Display sort order integer." },
  { key: "created_at", required: false, description: "ISO timestamp. Optional on import." },
  { key: "updated_at", required: false, description: "ISO timestamp. Optional on import." },
];

function packageCsvHeaderRow() {
  return PACKAGE_CSV_COLUMNS.map((column) => column.key).join(",");
}

/** @deprecated Use PACKAGE_CSV_COLUMNS — legacy master CSV contract */
const SALON_CATEGORIES = ["Bronze", "Silver", "Gold", "Royal", "Luxury", "Diamond"];
const GENDERS = ["MALE", "FEMALE"];
const MASTER_RECORD_TYPES = ["OUTLET", "SERVICE", "PRICE"];
const MASTER_COLUMNS = [
  { key: "record_type", required: true, description: "OUTLET | SERVICE | PRICE" },
  { key: "outlet_code", required: false, description: "Stable salon code." },
  { key: "outlet_id", required: false, description: "Catalyst Outlets ROWID." },
  { key: "salon_name", required: false, description: "OUTLET display name." },
  { key: "salon_slug", required: false, description: "OUTLET URL slug." },
  { key: "salon_category", required: false, description: "Outlet list tier." },
  { key: "area", required: false, description: "OUTLET locality." },
  { key: "address_line1", required: false, description: "OUTLET street address." },
  { key: "city", required: false, description: "OUTLET city." },
  { key: "state", required: false, description: "OUTLET state." },
  { key: "postal_code", required: false, description: "OUTLET pincode." },
  { key: "phone", required: false, description: "OUTLET phone." },
  { key: "latitude", required: false, description: "OUTLET latitude." },
  { key: "longitude", required: false, description: "OUTLET longitude." },
  { key: "opening_time", required: false, description: "OUTLET opening time." },
  { key: "closing_time", required: false, description: "OUTLET closing time." },
  { key: "rating", required: false, description: "OUTLET rating." },
  { key: "review_count", required: false, description: "OUTLET review count." },
  { key: "image_url", required: false, description: "OUTLET icon path." },
  { key: "is_active", required: false, description: "true/false." },
  { key: "package_slug", required: false, description: "PRICE package slug." },
  { key: "service_code", required: false, description: "SERVICE/PRICE code." },
  { key: "service_id", required: false, description: "Salon_Services ROWID." },
  { key: "service_name", required: false, description: "SERVICE/PRICE name." },
  { key: "service_type", required: false, description: "Hair|Skin|Spa|Nails|Bridal." },
  { key: "service_description", required: false, description: "SERVICE description." },
  { key: "duration_minutes", required: false, description: "Duration in minutes." },
  { key: "gender", required: false, description: "PRICE: MALE or FEMALE." },
  { key: "mrp", required: false, description: "PRICE MRP." },
  { key: "selling_price", required: false, description: "PRICE customer price." },
];

module.exports = {
  PACKAGE_TIERS,
  SERVICE_CATEGORIES,
  PACKAGE_CSV_FILES,
  PACKAGE_CSV_COLUMNS,
  packageCsvHeaderRow,
  SALON_CATEGORIES,
  GENDERS,
  MASTER_RECORD_TYPES,
  MASTER_COLUMNS,
};
