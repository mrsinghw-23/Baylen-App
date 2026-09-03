"use strict";

const { asId, optionalText, rowOf, rowsOf, num, isTruthy, sqlString, insertedRowId } = require("./http");
const { slugify } = require("../data/shop-taxonomy");

function money(value) {
  return Math.round(num(value) * 100) / 100;
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function assertSku(value) {
  const sku = normalizeSku(value);
  if (!sku || sku.length > 80) {
    const error = new Error("sku is required and must be at most 80 characters");
    error.status = 400;
    throw error;
  }
  if (!/^[A-Z0-9][A-Z0-9\-_.]*$/.test(sku)) {
    const error = new Error("sku may only contain letters, numbers, hyphen, underscore and dot");
    error.status = 400;
    throw error;
  }
  return sku;
}

async function findProductByCode(zcql, productCode) {
  const code = optionalText(productCode, "product_code", 80);
  if (!code) return null;
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, status FROM Products WHERE product_code = " +
        sqlString(code)
    ),
    "Products"
  );
}

async function findProductBySku(zcql, sku) {
  const value = normalizeSku(sku);
  if (!value) return null;
  const byProduct = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, status FROM Products WHERE sku = " +
        sqlString(value)
    ),
    "Products"
  );
  if (byProduct) return byProduct;
  const variant = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, sku FROM Product_Variants WHERE sku = " + sqlString(value)
    ),
    "Product_Variants"
  );
  if (!variant) return null;
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, status FROM Products WHERE ROWID = " +
        asId(variant.product_id, "product_id")
    ),
    "Products"
  );
}

async function findVariantBySku(zcql, sku) {
  const value = normalizeSku(sku);
  if (!value) return null;
  return rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, product_id, sku, barcode, variant_name, mrp, selling_price, is_active, status FROM Product_Variants WHERE sku = " +
        sqlString(value)
    ),
    "Product_Variants"
  );
}

async function assertUniqueSku(zcql, sku, { excludeVariantId = null, excludeProductId = null } = {}) {
  const value = assertSku(sku);
  const variant = await findVariantBySku(zcql, value);
  if (variant && (!excludeVariantId || String(variant.ROWID) !== String(excludeVariantId))) {
    const error = new Error("SKU already exists on another variant: " + value);
    error.status = 409;
    error.code = "DUPLICATE_SKU";
    throw error;
  }
  const product = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, sku FROM Products WHERE sku = " + sqlString(value)
    ),
    "Products"
  );
  if (
    product &&
    (!excludeProductId || String(product.ROWID) !== String(excludeProductId)) &&
    (!excludeVariantId || true)
  ) {
    // Product-level SKU conflict only when no variant ownership is intended for that product.
    if (!excludeProductId || String(product.ROWID) !== String(excludeProductId)) {
      const ownedVariant = excludeProductId
        ? null
        : rowOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID FROM Product_Variants WHERE product_id = " +
                asId(product.ROWID, "product_id") +
                " AND sku = " +
                sqlString(value)
            ),
            "Product_Variants"
          );
      if (!ownedVariant && String(product.ROWID) !== String(excludeProductId || "")) {
        const error = new Error("SKU already exists on another product: " + value);
        error.status = 409;
        error.code = "DUPLICATE_SKU";
        throw error;
      }
    }
  }
  return value;
}

async function resolveBrandId(zcql, brandValue) {
  const value = optionalText(brandValue, "brand", 150);
  if (!value) {
    const error = new Error("brand is required");
    error.status = 400;
    throw error;
  }
  const byName = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug FROM Brands WHERE name = " + sqlString(value) + " AND is_active = true"
    ),
    "Brands"
  );
  if (byName) return String(byName.ROWID);
  const slug = slugify(value);
  const bySlug = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug FROM Brands WHERE slug = " + sqlString(slug) + " AND is_active = true"
    ),
    "Brands"
  );
  if (bySlug) return String(bySlug.ROWID);
  const error = new Error('Brand "' + value + '" does not exist');
  error.status = 400;
  error.code = "INVALID_BRAND";
  throw error;
}

async function resolveCategoryPath(zcql, pathValue) {
  const parts = String(pathValue || "")
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    const error = new Error("category_path is required");
    error.status = 400;
    throw error;
  }
  let parentId = null;
  let current = null;
  for (const name of parts) {
    let query =
      "SELECT ROWID, name, slug, parent_category_id FROM Categories WHERE name = " +
      sqlString(name) +
      " AND is_active = true";
    if (parentId) {
      query += " AND parent_category_id = " + parentId;
    } else {
      query += " AND parent_category_id IS NULL";
    }
    current = rowOf(await zcql.executeZCQLQuery(query), "Categories");
    if (!current) {
      // fallback: match by slug anywhere under parent
      const slug = slugify(name);
      let slugQuery =
        "SELECT ROWID, name, slug, parent_category_id FROM Categories WHERE slug = " +
        sqlString(slug) +
        " AND is_active = true";
      if (parentId) slugQuery += " AND parent_category_id = " + parentId;
      current = rowOf(await zcql.executeZCQLQuery(slugQuery), "Categories");
    }
    if (!current) {
      const error = new Error('Category path not found at "' + name + '" in "' + pathValue + '"');
      error.status = 400;
      error.code = "INVALID_CATEGORY";
      throw error;
    }
    parentId = String(current.ROWID);
  }
  return String(current.ROWID);
}

async function linkProductCategory(app, productId, categoryId, { isPrimary = false } = {}) {
  const zcql = app.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, is_primary FROM Product_Categories WHERE product_id = " +
        productId +
        " AND category_id = " +
        categoryId +
        " AND is_active = true"
    ),
    "Product_Categories"
  );
  if (existing) {
    if (isPrimary && !isTruthy(existing.is_primary)) {
      await app.datastore().table("Product_Categories").updateRow({
        ROWID: existing.ROWID,
        is_primary: true,
      });
    }
    return String(existing.ROWID);
  }
  const inserted = await app.datastore().table("Product_Categories").insertRow({
    product_id: productId,
    category_id: categoryId,
    is_primary: !!isPrimary,
    is_active: true,
    display_order: 0,
  });
  return insertedRowId(inserted);
}

async function replaceProductCategories(app, productId, categoryIds, primaryCategoryId) {
  const zcql = app.zcql();
  const existing = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, category_id FROM Product_Categories WHERE product_id = " + productId
    ),
    "Product_Categories"
  );
  const keep = new Set((categoryIds || []).map(String));
  for (const row of existing) {
    if (!keep.has(String(row.category_id))) {
      await app.datastore().table("Product_Categories").updateRow({
        ROWID: row.ROWID,
        is_active: false,
      });
    }
  }
  for (const categoryId of keep) {
    await linkProductCategory(app, productId, categoryId, {
      isPrimary: String(categoryId) === String(primaryCategoryId),
    });
  }
}

async function backfillProductCategories(app) {
  const zcql = app.zcql();
  const products = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, category_id FROM Products WHERE category_id IS NOT NULL"
    ),
    "Products"
  );
  let linked = 0;
  for (const product of products) {
    if (!product.category_id) continue;
    await linkProductCategory(app, String(product.ROWID), String(product.category_id), {
      isPrimary: true,
    });
    linked += 1;
  }
  return { products: products.length, linked };
}

async function upsertRelationRows(app, tableName, productId, items, fields) {
  const zcql = app.zcql();
  const existing = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM " + tableName + " WHERE product_id = " + productId
    ),
    tableName
  );
  for (const row of existing) {
    await app.datastore().table(tableName).updateRow({ ROWID: row.ROWID, is_active: false });
  }
  for (const item of items || []) {
    await app.datastore().table(tableName).insertRow({
      product_id: productId,
      ...fields(item),
      is_active: true,
    });
  }
}

async function resolveTaxonomyTerm(app, name, categoryType) {
  const zcql = app.zcql();
  const value = optionalText(name, "term", 150);
  if (!value) return null;
  const exact = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug FROM Categories WHERE category_type = " +
        sqlString(categoryType) +
        " AND name = " +
        sqlString(value) +
        " AND is_active = true"
    ),
    "Categories"
  );
  if (exact) return exact;
  const slug = slugify(value);
  const bySlug = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug FROM Categories WHERE category_type = " +
        sqlString(categoryType) +
        " AND slug = " +
        sqlString(slug) +
        " AND is_active = true"
    ),
    "Categories"
  );
  if (bySlug) return bySlug;
  const inserted = await app.datastore().table("Categories").insertRow({
    name: value,
    slug,
    description: categoryType,
    category_type: categoryType,
    parent_category_id: null,
    image_url: null,
    display_order: 0,
    is_active: true,
    status: "PUBLISHED",
  });
  return { ROWID: insertedRowId(inserted), name: value, slug };
}

async function syncProductTaxonomy(app, productId, payload) {
  const mapNames = async (names, type) => {
    const out = [];
    for (const name of names || []) {
      const term = await resolveTaxonomyTerm(app, name, type);
      out.push({ name, term });
    }
    return out;
  };

  const concerns = await mapNames(payload.concerns, "CONCERN");
  await upsertRelationRows(app, "Product_Concerns", productId, concerns, (item) => ({
    concern_category_id: item.term ? item.term.ROWID : null,
    concern_name: item.name,
  }));

  const skinTypes = await mapNames(payload.skin_types, "SKIN_TYPE");
  await upsertRelationRows(app, "Product_Skin_Types", productId, skinTypes, (item) => ({
    skin_type_category_id: item.term ? item.term.ROWID : null,
    skin_type_name: item.name,
  }));

  const hairTypes = await mapNames(payload.hair_types, "HAIR_TYPE");
  await upsertRelationRows(app, "Product_Hair_Types", productId, hairTypes, (item) => ({
    hair_type_category_id: item.term ? item.term.ROWID : null,
    hair_type_name: item.name,
  }));

  const fragrances = await mapNames(payload.fragrance_families, "FRAGRANCE");
  await upsertRelationRows(app, "Product_Fragrance_Families", productId, fragrances, (item) => ({
    fragrance_category_id: item.term ? item.term.ROWID : null,
    fragrance_name: item.name,
  }));

  const ingredients = await mapNames(payload.ingredients, "INGREDIENT");
  await upsertRelationRows(app, "Product_Ingredients", productId, ingredients, (item) => ({
    ingredient_category_id: item.term ? item.term.ROWID : null,
    ingredient_name: item.name,
  }));

  const tags = await mapNames(payload.tags, "TAG");
  await upsertRelationRows(app, "Product_Tags", productId, tags, (item) => ({
    tag_category_id: item.term ? item.term.ROWID : null,
    tag_name: item.name,
  }));
}

async function upsertProductMaster(app, body) {
  const zcql = app.zcql();
  const name = optionalText(body.product_name || body.name, "product_name", 150);
  if (!name) {
    const error = new Error("product_name is required");
    error.status = 400;
    throw error;
  }
  const productCode =
    optionalText(body.product_code, "product_code", 80) || slugify(name).slice(0, 80);
  const brandId = body.brand_id
    ? asId(body.brand_id, "brand_id")
    : await resolveBrandId(zcql, body.brand);
  const categoryId = body.category_id
    ? asId(body.category_id, "category_id")
    : await resolveCategoryPath(zcql, body.category_path);
  const slug = optionalText(body.slug, "slug", 180) || slugify(name);
  const status = optionalText(body.status, "status", 20) || "ACTIVE";
  const payload = {
    name,
    slug,
    product_code: productCode,
    sku: body.sku ? assertSku(body.sku) : null,
    brand_id: brandId,
    category_id: categoryId,
    product_type: optionalText(body.product_type, "product_type", 20) || "SIMPLE",
    short_description: optionalText(body.short_description, "short_description", 255) || null,
    description: optionalText(body.description, "description", 255) || null,
    mrp: money(body.mrp),
    selling_price: money(body.selling_price),
    cost_price: body.cost_price === undefined || body.cost_price === "" ? null : money(body.cost_price),
    currency: optionalText(body.currency, "currency", 10) || "INR",
    tax_percent: body.tax_percent === undefined || body.tax_percent === "" ? null : money(body.tax_percent),
    hsn_code: optionalText(body.hsn_code, "hsn_code", 20) || null,
    gender: optionalText(body.gender, "gender", 30) || null,
    age_group: optionalText(body.age_group, "age_group", 40) || null,
    seo_title: optionalText(body.seo_title, "seo_title", 180) || null,
    seo_description: optionalText(body.seo_description, "seo_description", 255) || null,
    search_keywords: optionalText(body.search_keywords, "search_keywords", 255) || null,
    thumbnail_url: optionalText(body.image_1 || body.thumbnail_url, "thumbnail_url", 255) || null,
    has_variants: isTruthy(body.has_variants) || !!body.sku,
    is_featured: isTruthy(body.is_featured),
    is_returnable: body.is_returnable === undefined ? true : isTruthy(body.is_returnable),
    status,
    visibility: optionalText(body.visibility, "visibility", 30) || "PUBLISHED",
  };

  let existing =
    (body.id ? rowOf(await zcql.executeZCQLQuery("SELECT ROWID FROM Products WHERE ROWID = " + asId(body.id, "id")), "Products") : null) ||
    (await findProductByCode(zcql, productCode));
  let action = "created";
  let productId;
  if (existing) {
    productId = String(existing.ROWID);
    await app.datastore().table("Products").updateRow({ ROWID: productId, ...payload });
    action = "updated";
  } else {
    const inserted = await app.datastore().table("Products").insertRow(payload);
    productId = insertedRowId(inserted);
    action = "created";
  }

  const categoryIds = [categoryId];
  const extras = String(body.extra_categories || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const path of extras) {
    categoryIds.push(await resolveCategoryPath(zcql, path));
  }
  await replaceProductCategories(app, productId, categoryIds, categoryId);
  await syncProductTaxonomy(app, productId, {
    concerns: body.concerns,
    skin_types: body.skin_types,
    hair_types: body.hair_types,
    fragrance_families: body.fragrance_families,
    ingredients: body.ingredients,
    tags: body.tags,
  });

  return { id: productId, action, product_code: productCode, category_id: categoryId, brand_id: brandId };
}

async function upsertVariant(app, productId, body) {
  const zcql = app.zcql();
  const sku = await assertUniqueSku(zcql, body.sku, {
    excludeVariantId: body.id || null,
    excludeProductId: productId,
  });
  const existing = body.id
    ? rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Product_Variants WHERE ROWID = " + asId(body.id, "id")
        ),
        "Product_Variants"
      )
    : await findVariantBySku(zcql, sku);
  const payload = {
    product_id: productId,
    sku,
    variant_code: optionalText(body.variant_code, "variant_code", 80) || sku,
    variant_name:
      optionalText(body.variant_name, "variant_name", 100) ||
      optionalText(body.size, "size", 40) ||
      optionalText(body.color, "color", 60) ||
      sku,
    variant_value: optionalText(body.variant_value || body.size || body.color, "variant_value", 80) || null,
    option1_name: body.size ? "Size" : body.color ? "Color" : null,
    option1_value: optionalText(body.size || body.color, "option1_value", 80) || null,
    option2_name: body.size && body.color ? "Color" : null,
    option2_value: body.size && body.color ? optionalText(body.color, "color", 60) : null,
    color_hex: optionalText(body.color_hex, "color_hex", 10) || null,
    color_name: optionalText(body.color, "color", 60) || null,
    shade: optionalText(body.shade, "shade", 60) || null,
    finish: optionalText(body.finish, "finish", 60) || null,
    size_label: optionalText(body.size, "size", 40) || null,
    size_unit: optionalText(body.unit, "unit", 20) || null,
    volume_label: optionalText(body.volume, "volume", 40) || null,
    weight_label: optionalText(body.weight, "weight", 40) || null,
    barcode: optionalText(body.barcode, "barcode", 50) || null,
    ean: optionalText(body.ean, "ean", 40) || null,
    upc: optionalText(body.upc, "upc", 40) || null,
    gtin: optionalText(body.gtin, "gtin", 40) || null,
    mrp: money(body.mrp),
    selling_price: money(body.selling_price),
    cost_price: body.cost_price === undefined || body.cost_price === "" ? null : money(body.cost_price),
    tax_percent: body.tax_percent === undefined || body.tax_percent === "" ? null : money(body.tax_percent),
    currency: optionalText(body.currency, "currency", 10) || "INR",
    thumbnail_url: optionalText(body.image_1 || body.thumbnail_url, "thumbnail_url", 255) || null,
    is_default: isTruthy(body.is_default) || true,
    is_active: body.is_active === undefined ? true : isTruthy(body.is_active),
    status: optionalText(body.status, "status", 20) || "ACTIVE",
    display_order: Math.max(0, Math.round(num(body.display_order))),
  };

  if (existing) {
    await app.datastore().table("Product_Variants").updateRow({ ROWID: existing.ROWID, ...payload });
    return { id: String(existing.ROWID), action: "updated", sku };
  }
  const inserted = await app.datastore().table("Product_Variants").insertRow(payload);
  return { id: insertedRowId(inserted), action: "created", sku };
}

module.exports = {
  money,
  normalizeSku,
  assertSku,
  findProductByCode,
  findProductBySku,
  findVariantBySku,
  assertUniqueSku,
  resolveBrandId,
  resolveCategoryPath,
  linkProductCategory,
  replaceProductCategories,
  backfillProductCategories,
  syncProductTaxonomy,
  upsertProductMaster,
  upsertVariant,
};
