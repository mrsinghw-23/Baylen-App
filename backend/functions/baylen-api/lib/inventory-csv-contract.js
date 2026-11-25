"use strict";

/**
 * Canonical inventory-only CSV contract.
 * Importer, template, and documentation must stay in sync with this file.
 */

const INVENTORY_CSV_COLUMNS = [
  {
    key: "warehouse_code",
    required: true,
    description: "Existing warehouse code. Required on every row. No HQ fallback.",
  },
  {
    key: "sku",
    required: true,
    description: "Existing product or variant SKU. Inventory identity is warehouse_code + sku.",
  },
  {
    key: "stock",
    required: true,
    description: "Absolute quantity_on_hand (not a delta). Non-negative integer.",
  },
  {
    key: "reorder_level",
    required: false,
    description: "Optional reorder level. Preserves existing value when omitted.",
  },
  {
    key: "reorder_quantity",
    required: false,
    description: "Optional reorder quantity. Preserves existing value when omitted.",
  },
  {
    key: "safety_stock",
    required: false,
    description: "Optional safety stock. Preserves existing value when omitted.",
  },
];

const INVENTORY_REQUIRED_HEADERS = INVENTORY_CSV_COLUMNS.filter((col) => col.required).map(
  (col) => col.key
);
const INVENTORY_ALL_HEADERS = INVENTORY_CSV_COLUMNS.map((col) => col.key);

/** Recommended operational batch size for synchronous Advanced I/O imports. */
const INVENTORY_RECOMMENDED_BATCH_SIZE = 500;

/** Hard row cap enforced by the inventory import parser (not a platform guarantee). */
const INVENTORY_MAX_ROWS = 5000;

function inventoryTemplateHeaderRow() {
  return INVENTORY_ALL_HEADERS.join(",");
}

function inventoryTemplateExampleRows() {
  return [
    "WH-RNC-001,MIN-NIA10-30ML,25,5,20,3",
    "WH-RNC-002,MIN-NIA10-30ML,15,5,20,3",
    "WH-RNC-003,MIN-NIA10-30ML,30,8,25,5",
    "WH-RNC-001,LOR-EOHS-100ML,10,3,10,2",
  ];
}

function inventoryTemplateCsv() {
  return [inventoryTemplateHeaderRow(), ...inventoryTemplateExampleRows()].join("\n") + "\n";
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function parseNonNegativeInteger(value, field, { required = false } = {}) {
  if (!hasValue(value)) {
    if (required) {
      return {
        error: {
          field,
          code: field === "stock" ? "MISSING_STOCK" : "REQUIRED",
          message: field + " is required",
        },
      };
    }
    return { value: undefined };
  }
  const raw = String(value).trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(raw)) {
    return {
      error: {
        field,
        code: field === "stock" ? "INVALID_STOCK" : "INVALID_NUMBER",
        message: field + " must be a non-negative integer",
      },
    };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      error: {
        field,
        code: field === "stock" ? "INVALID_STOCK" : "INVALID_NUMBER",
        message: field + " must be a non-negative integer",
      },
    };
  }
  return { value: Math.round(parsed) };
}

function inventoryRowIdentity(warehouseCode, sku) {
  return (
    String(warehouseCode || "")
      .trim()
      .toUpperCase() +
    "|" +
    String(sku || "")
      .trim()
      .toUpperCase()
  );
}

module.exports = {
  INVENTORY_CSV_COLUMNS,
  INVENTORY_REQUIRED_HEADERS,
  INVENTORY_ALL_HEADERS,
  INVENTORY_RECOMMENDED_BATCH_SIZE,
  INVENTORY_MAX_ROWS,
  inventoryTemplateHeaderRow,
  inventoryTemplateExampleRows,
  inventoryTemplateCsv,
  hasValue,
  parseNonNegativeInteger,
  inventoryRowIdentity,
};
