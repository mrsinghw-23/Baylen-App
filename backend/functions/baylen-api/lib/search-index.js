"use strict";

const { asId, rowOf, rowsOf, num, isTruthy, sqlString, insertedRowId } = require("./http");
const { normalizeQuery, tokenize, expandWithSynonyms, detectIntent, suggestionsFor } = require("./search-engine");
const { fetchAllTableRows, activeRows } = require("./paged");

async function loadRelationNames(zcql, table, productId, nameField) {
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT " +
          nameField +
          " FROM " +
          table +
          " WHERE product_id = " +
          productId +
          " AND is_active = true"
      ),
      table
    );
    return rows.map((row) => String(row[nameField] || "")).filter(Boolean);
  } catch (_) {
    return [];
  }
}

async function buildSearchDocument(app, productId) {
  const zcql = app.zcql();
  const product = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, product_type, short_description, description, search_keywords, mrp, selling_price, is_featured, status FROM Products WHERE ROWID = " +
        asId(productId, "product_id")
    ),
    "Products"
  );
  if (!product) return null;

  const brand = product.brand_id
    ? rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name FROM Brands WHERE ROWID = " + asId(product.brand_id, "brand_id")
        ),
        "Brands"
      )
    : null;

  let categoryNames = [];
  try {
    const links = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT category_id FROM Product_Categories WHERE product_id = " +
          asId(productId, "product_id") +
          " AND is_active = true"
      ),
      "Product_Categories"
    );
    for (const link of links) {
      const category = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT name FROM Categories WHERE ROWID = " + asId(link.category_id, "category_id")
        ),
        "Categories"
      );
      if (category?.name) categoryNames.push(category.name);
    }
  } catch (_) {
    if (product.category_id) {
      const category = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT name FROM Categories WHERE ROWID = " + asId(product.category_id, "category_id")
        ),
        "Categories"
      );
      if (category?.name) categoryNames = [category.name];
    }
  }

  const variants = rowsOf(
    await zcql.executeZCQLQuery(
      "SELECT sku, barcode, ean, upc, gtin, variant_name, color_name, shade, finish, size_label FROM Product_Variants WHERE product_id = " +
        asId(productId, "product_id") +
        " AND is_active = true"
    ),
    "Product_Variants"
  );

  const [concerns, skinTypes, hairTypes, ingredients, tags, fragrances] = await Promise.all([
    loadRelationNames(zcql, "Product_Concerns", asId(productId, "product_id"), "concern_name"),
    loadRelationNames(zcql, "Product_Skin_Types", asId(productId, "product_id"), "skin_type_name"),
    loadRelationNames(zcql, "Product_Hair_Types", asId(productId, "product_id"), "hair_type_name"),
    loadRelationNames(zcql, "Product_Ingredients", asId(productId, "product_id"), "ingredient_name"),
    loadRelationNames(zcql, "Product_Tags", asId(productId, "product_id"), "tag_name"),
    loadRelationNames(
      zcql,
      "Product_Fragrance_Families",
      asId(productId, "product_id"),
      "fragrance_name"
    ),
  ]);

  const skuList = [
    product.sku,
    ...variants.map((row) => row.sku),
  ]
    .filter(Boolean)
    .join("|")
    .slice(0, 255);
  const barcodeList = variants
    .flatMap((row) => [row.barcode, row.ean, row.upc, row.gtin])
    .filter(Boolean)
    .join("|")
    .slice(0, 255);

  const keywords = [
    product.search_keywords,
    ...concerns,
    ...skinTypes,
    ...hairTypes,
    ...ingredients,
    ...tags,
    ...fragrances,
    ...variants.flatMap((row) => [row.variant_name, row.color_name, row.shade, row.finish, row.size_label]),
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 2000);

  const documentText = [
    product.name,
    brand?.name,
    categoryNames.join(" "),
    product.product_type,
    product.short_description,
    product.description,
    keywords,
    skuList,
    barcodeList,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .slice(0, 5000);

  let inStock = false;
  try {
    const inventory = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT quantity_on_hand, quantity_reserved, quantity_committed FROM Inventory WHERE product_id = " +
          asId(productId, "product_id") +
          " AND is_active = true AND status = 'ACTIVE'"
      ),
      "Inventory"
    );
    inStock = inventory.some(
      (row) =>
        num(row.quantity_on_hand) - num(row.quantity_reserved) - num(row.quantity_committed) > 0
    );
  } catch (_) {
    inStock = false;
  }

  return {
    product_id: asId(productId, "product_id"),
    product_name: product.name,
    slug: product.slug,
    product_code: product.product_code || "",
    sku_list: skuList,
    barcode_list: barcodeList,
    brand_name: brand?.name || "",
    brand_id: product.brand_id || null,
    category_names: categoryNames.join("|").slice(0, 255),
    product_type: product.product_type || "",
    keywords,
    document_text: documentText,
    status: product.status || "ACTIVE",
    selling_price: num(product.selling_price),
    mrp: num(product.mrp),
    is_featured: isTruthy(product.is_featured),
    in_stock: inStock,
    indexed_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    is_active: true,
  };
}

async function upsertSearchDocument(app, productId) {
  const doc = await buildSearchDocument(app, productId);
  if (!doc) return null;
  const zcql = app.zcql();
  const existing = rowOf(
    await zcql.executeZCQLQuery(
      "SELECT ROWID FROM Search_Documents WHERE product_id = " + asId(productId, "product_id")
    ),
    "Search_Documents"
  );
  if (existing) {
    await app.datastore().table("Search_Documents").updateRow({ ROWID: existing.ROWID, ...doc });
    return String(existing.ROWID);
  }
  const inserted = await app.datastore().table("Search_Documents").insertRow(doc);
  return insertedRowId(inserted);
}

async function rebuildSearchIndex(app, { limit = 5000 } = {}) {
  const products = rowsOf(
    await app.zcql().executeZCQLQuery("SELECT ROWID FROM Products"),
    "Products"
  ).slice(0, limit);
  let indexed = 0;
  let failed = 0;
  for (const product of products) {
    try {
      await upsertSearchDocument(app, String(product.ROWID));
      indexed += 1;
    } catch (_) {
      failed += 1;
    }
  }
  return { total: products.length, indexed, failed };
}

function scoreDocument(doc, needles, intent) {
  const name = String(doc.product_name || "").toLowerCase();
  const brand = String(doc.brand_name || "").toLowerCase();
  const categories = String(doc.category_names || "").toLowerCase();
  const skus = String(doc.sku_list || "").toLowerCase();
  const keywords = String(doc.keywords || "").toLowerCase();
  const body = String(doc.document_text || "").toLowerCase();
  let score = 0;
  needles.forEach((needle) => {
    if (!needle) return;
    if (name === needle) score += 120;
    else if (name.startsWith(needle)) score += 80;
    else if (name.includes(needle)) score += 50;
    if (skus.split("|").includes(needle) || skus.includes(needle)) score += 110;
    if (brand === needle) score += 90;
    else if (brand.includes(needle)) score += 45;
    if (categories.includes(needle)) score += 55;
    if (keywords.includes(needle)) score += 35;
    if (body.includes(needle)) score += 10;
  });
  if (intent?.brands?.some((b) => String(b.name || "").toLowerCase() === brand)) score += 40;
  if (intent?.priceMax && num(doc.selling_price) > intent.priceMax) score -= 50;
  if (isTruthy(doc.is_featured)) score += 5;
  if (isTruthy(doc.in_stock)) score += 3;
  return score;
}

async function searchIndexed(app, query, { page = 1, limit = 24, filters = {} } = {}) {
  const zcql = app.zcql();
  const [categoryRows, brandRows, synonymRows] = await Promise.all([
    fetchAllTableRows(app, "Categories"),
    fetchAllTableRows(app, "Brands"),
    fetchAllTableRows(app, "Categories"),
  ]);
  const categories = activeRows(categoryRows);
  const brands = activeRows(brandRows);
  const synonyms = activeRows(synonymRows).filter((row) => String(row.category_type) === "SYNONYM");
  const needles = expandWithSynonyms(query, synonyms);
  const intent = detectIntent(needles, categories, brands);

  let docs = [];
  try {
    docs = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, product_id, product_name, slug, product_code, sku_list, brand_name, brand_id, category_names, product_type, keywords, document_text, status, selling_price, mrp, is_featured, in_stock FROM Search_Documents WHERE is_active = true AND status = 'ACTIVE'"
      ),
      "Search_Documents"
    );
  } catch (_) {
    docs = [];
  }

  if (!docs.length) {
    // fallback to products table if index empty
    const products = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT ROWID, name, slug, sku, product_code, brand_id, category_id, product_type, short_description, description, search_keywords, mrp, selling_price, is_featured, status FROM Products WHERE status = 'ACTIVE'"
      ),
      "Products"
    );
    docs = products.map((product) => ({
      product_id: product.ROWID,
      product_name: product.name,
      slug: product.slug,
      product_code: product.product_code,
      sku_list: product.sku,
      brand_name: "",
      brand_id: product.brand_id,
      category_names: "",
      product_type: product.product_type,
      keywords: product.search_keywords || "",
      document_text: [product.name, product.short_description, product.description, product.sku]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      status: product.status,
      selling_price: product.selling_price,
      mrp: product.mrp,
      is_featured: product.is_featured,
      in_stock: true,
    }));
  }

  let ranked = docs
    .map((doc) => ({ doc, score: scoreDocument(doc, needles, intent) }))
    .filter((item) => item.score > 0);

  if (filters.brand_id) {
    ranked = ranked.filter((item) => String(item.doc.brand_id) === String(filters.brand_id));
  }
  if (filters.category) {
    const needle = String(filters.category).toLowerCase();
    ranked = ranked.filter((item) => String(item.doc.category_names || "").toLowerCase().includes(needle));
  }
  if (filters.min_price != null) {
    ranked = ranked.filter((item) => num(item.doc.selling_price) >= num(filters.min_price));
  }
  if (filters.max_price != null) {
    ranked = ranked.filter((item) => num(item.doc.selling_price) <= num(filters.max_price));
  }
  if (filters.in_stock === true || filters.in_stock === "true") {
    ranked = ranked.filter((item) => isTruthy(item.doc.in_stock));
  }

  ranked.sort((a, b) => b.score - a.score || String(a.doc.product_name).localeCompare(String(b.doc.product_name)));

  const safeLimit = Math.min(100, Math.max(1, num(limit) || 24));
  const safePage = Math.max(1, num(page) || 1);
  const offset = (safePage - 1) * safeLimit;
  const pageRows = ranked.slice(offset, offset + safeLimit);

  const zero = ranked.length === 0;
  const suggestionList = suggestionsFor(query, {
    categories,
    brands,
    products: docs.map((doc) => ({
      ROWID: doc.product_id,
      name: doc.product_name,
      slug: doc.slug,
    })),
  });

  return {
    query: normalizeQuery(query),
    tokens: tokenize(query),
    intent,
    page: safePage,
    limit: safeLimit,
    total: ranked.length,
    products: pageRows.map((item) => ({
      id: String(item.doc.product_id),
      name: item.doc.product_name,
      slug: item.doc.slug,
      sku: String(item.doc.sku_list || "").split("|")[0] || "",
      brand_id: item.doc.brand_id ? String(item.doc.brand_id) : "",
      brand_name: item.doc.brand_name || "",
      category_names: item.doc.category_names || "",
      product_type: item.doc.product_type || "",
      mrp: num(item.doc.mrp),
      selling_price: num(item.doc.selling_price),
      is_featured: isTruthy(item.doc.is_featured),
      available_quantity: isTruthy(item.doc.in_stock) ? 1 : 0,
      score: item.score,
    })),
    suggestions: suggestionList,
    zero_result: zero,
    did_you_mean: zero ? suggestionList.slice(0, 5) : [],
    related_categories: intent.categories.slice(0, 6).map((row) => ({
      id: String(row.ROWID),
      name: row.name,
      slug: row.slug,
    })),
    trending: categories
      .filter((row) => String(row.category_type) === "TRENDING")
      .slice(0, 8)
      .map((row) => row.name),
  };
}

module.exports = {
  buildSearchDocument,
  upsertSearchDocument,
  rebuildSearchIndex,
  searchIndexed,
};
