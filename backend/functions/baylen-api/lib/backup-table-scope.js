"use strict";

/**
 * Baylen Data Store backup table scope.
 * Derived from admin schema checks, provision scripts, and runtime table usage.
 */

const SCHEMA_VERSION = "baylen-backup-schema-v1";

const TABLE_CLASSIFICATION = {
  PRODUCTION_CRITICAL: [
    "Users",
    "User_Profiles",
    "Addresses",
    "Devices",
    "Categories",
    "Brands",
    "Products",
    "Product_Variants",
    "Product_Media",
    "Product_Categories",
    "Product_Tags",
    "Product_Concerns",
    "Product_Skin_Types",
    "Product_Hair_Types",
    "Product_Fragrance_Families",
    "Product_Ingredients",
    "Product_Attributes",
    "Warehouses",
    "Inventory",
    "Stock_Movements",
    "Serviceable_Pincodes",
    "Outlets",
    "Orders",
    "Order_Items",
    "Order_Timeline",
    "Payments",
    "Returns",
    "Refunds",
    "Carts",
    "Cart_Items",
    "Wishlist",
    "Import_Jobs",
    "Import_Job_Rows",
    "Import_Errors",
    "Salon_Services",
    "Salon_Packages",
    "Outlet_Packages",
    "Outlet_Service_Prices",
    "Staff",
    "Staff_Services",
    "Appointment_Slots",
    "Appointments",
    "Appointment_Items",
    "Providers",
    "Provider_Services",
    "Service_Areas",
    "Service_Jobs",
    "Job_Items",
    "Job_Dispatch",
    "Job_Timeline",
    "Job_Status_History",
    "Job_Proofs",
    "Professional_Jobs",
    "Delivery_Partners",
    "Delivery_Partner_KYC",
    "Live_Locations",
    "Beauty_Service_Zones",
    "Beauty_Service_Addons",
    "Home_Services",
    "Provider_Availability",
    "Staff_Availability",
    "Riders",
    "Delivery_Tracking",
    "Coupons",
    "Reviews",
    "Audit_Logs",
  ],
  OPERATIONAL: [
    "Notifications",
    "Notification_Preferences",
    "Auth_Otp_Challenges",
    "Home_Banners",
    "Media_Assets",
    "Nav_Menus",
  ],
  OPTIONAL: [
    "Search_Documents",
    "Stores",
    "Launch_Promos",
    "Onboarding_Slides",
  ],
};

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function allClassifiedTables() {
  return uniqueSorted([
    ...TABLE_CLASSIFICATION.PRODUCTION_CRITICAL,
    ...TABLE_CLASSIFICATION.OPERATIONAL,
    ...TABLE_CLASSIFICATION.OPTIONAL,
  ]);
}

function defaultExportTables({ includeOptional = true } = {}) {
  const tables = [
    ...TABLE_CLASSIFICATION.PRODUCTION_CRITICAL,
    ...TABLE_CLASSIFICATION.OPERATIONAL,
  ];
  if (includeOptional) {
    tables.push(...TABLE_CLASSIFICATION.OPTIONAL);
  }
  return uniqueSorted(tables);
}

function classifyTable(tableName) {
  for (const [tier, names] of Object.entries(TABLE_CLASSIFICATION)) {
    if (names.includes(tableName)) {
      return tier;
    }
  }
  return "UNKNOWN";
}

function assertExportScope(tableNames) {
  const missingCritical = TABLE_CLASSIFICATION.PRODUCTION_CRITICAL.filter(
    (name) => !tableNames.includes(name)
  );
  if (missingCritical.length) {
    const error = new Error(
      "Backup scope missing production-critical tables: " + missingCritical.join(", ")
    );
    error.code = "BACKUP_SCOPE_INCOMPLETE";
    error.missingCritical = missingCritical;
    throw error;
  }
}

module.exports = {
  SCHEMA_VERSION,
  TABLE_CLASSIFICATION,
  allClassifiedTables,
  defaultExportTables,
  classifyTable,
  assertExportScope,
};
