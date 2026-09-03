"use strict";

/**
 * Canonical CSV / import contract for Baylen product bulk management.
 * Importer, template, and documentation must stay in sync with this file.
 */

const CSV_COLUMNS = [
  { key: "product_code", required: true, description: "Stable product master code. Used for upsert matching." },
  { key: "product_name", required: true, description: "Product display name." },
  { key: "slug", required: false, description: "URL slug. Auto-generated from product_name when blank." },
  { key: "brand", required: true, description: "Brand name. Must match Brands.name or Brands.slug." },
  { key: "product_type", required: false, description: "SIMPLE or VARIABLE. Default SIMPLE." },
  { key: "category_path", required: true, description: "Primary category path. Example: Skin > Serums" },
  { key: "extra_categories", required: false, description: "Additional categories delimited by |. Example: Natural > Skin > Serums|Offers" },
  { key: "description", required: false, description: "Long description." },
  { key: "short_description", required: false, description: "Short description." },
  { key: "sku", required: true, description: "Variant SKU. Unique operational identifier." },
  { key: "barcode", required: false, description: "Barcode / EAN / UPC value." },
  { key: "ean", required: false, description: "EAN code." },
  { key: "upc", required: false, description: "UPC code." },
  { key: "gtin", required: false, description: "GTIN code." },
  { key: "variant_name", required: false, description: "Variant display name. Defaults to size/color/sku." },
  { key: "size", required: false, description: "Size label e.g. 30ml / M." },
  { key: "unit", required: false, description: "Size unit e.g. ml / g." },
  { key: "volume", required: false, description: "Volume label." },
  { key: "weight", required: false, description: "Weight label." },
  { key: "color", required: false, description: "Color name." },
  { key: "color_hex", required: false, description: "Hex color e.g. #FF0000." },
  { key: "shade", required: false, description: "Shade name." },
  { key: "finish", required: false, description: "Finish e.g. Matte." },
  { key: "mrp", required: true, description: "MRP as number." },
  { key: "selling_price", required: true, description: "Selling price as number." },
  { key: "cost_price", required: false, description: "Cost price as number." },
  { key: "tax_percent", required: false, description: "GST / tax percent." },
  { key: "hsn_code", required: false, description: "HSN code." },
  { key: "gender", required: false, description: "Women / Men / Unisex / Kids." },
  { key: "age_group", required: false, description: "Adult / Teen / Baby / Kids." },
  { key: "skin_types", required: false, description: "Pipe-delimited. Example: Oily|Combination" },
  { key: "hair_types", required: false, description: "Pipe-delimited. Example: Dry|Damaged" },
  { key: "concerns", required: false, description: "Pipe-delimited. Example: Acne|Pigmentation" },
  { key: "ingredients", required: false, description: "Pipe-delimited. Example: Vitamin C|Niacinamide" },
  { key: "tags", required: false, description: "Pipe-delimited. Example: Brightening|Glow" },
  { key: "search_keywords", required: false, description: "Pipe or comma delimited keywords." },
  { key: "status", required: false, description: "ACTIVE / DRAFT / ARCHIVED / INACTIVE. Default ACTIVE." },
  { key: "is_featured", required: false, description: "true/false." },
  { key: "is_returnable", required: false, description: "true/false." },
  { key: "image_1", required: false, description: "Primary image URL or File Store reference." },
  { key: "image_2", required: false, description: "Gallery image URL / reference." },
  { key: "image_3", required: false, description: "Gallery image URL / reference." },
  { key: "video_url", required: false, description: "Product video URL." },
  { key: "seo_title", required: false, description: "SEO title." },
  { key: "seo_description", required: false, description: "SEO description." },
  { key: "warehouse_code", required: false, description: "Warehouse code for stock row. Default HQ." },
  { key: "stock", required: false, description: "Quantity on hand for warehouse_code." },
  { key: "reorder_level", required: false, description: "Reorder level." },
  { key: "reorder_quantity", required: false, description: "Suggested reorder quantity." },
  { key: "safety_stock", required: false, description: "Safety stock." },
];

const REQUIRED_HEADERS = CSV_COLUMNS.filter((c) => c.required).map((c) => c.key);
const ALL_HEADERS = CSV_COLUMNS.map((c) => c.key);
const REL_DELIM = "|";
const PATH_DELIM = ">";

function templateHeaderRow() {
  return ALL_HEADERS.join(",");
}

function splitPipe(value) {
  return String(value || "")
    .split(REL_DELIM)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitCategoryPath(value) {
  return String(value || "")
    .split(PATH_DELIM)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return fallback;
}

function parseMoney(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  const n = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) {
    const error = new Error(field + " must be a non-negative number");
    error.code = "INVALID_NUMBER";
    throw error;
  }
  return Math.round(n * 100) / 100;
}

module.exports = {
  CSV_COLUMNS,
  REQUIRED_HEADERS,
  ALL_HEADERS,
  REL_DELIM,
  PATH_DELIM,
  templateHeaderRow,
  splitPipe,
  splitCategoryPath,
  parseBool,
  parseMoney,
};
