"use strict";

const { asId, num, sqlString, rowsOf } = require("./http");

const PRODUCT_LIST_COLUMNS =
  "ROWID, name, slug, sku, category_id, brand_id, product_type, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status, gender, age_group, quick_commerce_enabled, ecommerce_enabled, quick_commerce_restriction_reason, search_keywords";

const SORTS = {
  featured: { orderBy: "is_featured DESC, ROWID DESC", key: "featured" },
  newest: { orderBy: "ROWID DESC", key: "newest" },
  price_low: { orderBy: "selling_price ASC, ROWID ASC", key: "price_low" },
  price_high: { orderBy: "selling_price DESC, ROWID DESC", key: "price_high" },
};

function normalizeLimit(raw) {
  return Math.min(100, Math.max(1, Math.round(num(raw) || 24)));
}

function resolveSort(raw) {
  const key = String(raw || "featured").trim();
  return SORTS[key] || SORTS.featured;
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(raw) {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(raw), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (!parsed.r || !parsed.s) {
      return null;
    }
    return parsed;
  } catch (_) {
    const error = new Error("Invalid pagination cursor");
    error.status = 400;
    error.code = "INVALID_CURSOR";
    throw error;
  }
}

function escapeLike(value) {
  return String(value || "")
    .replace(/'/g, "''")
    .replace(/[%_]/g, "");
}

function buildKeysetClause(sortKey, cursor) {
  const rowId = asId(cursor.r, "cursor");
  if (sortKey === "newest" || sortKey === "featured") {
    return "ROWID < " + rowId;
  }
  if (sortKey === "price_low") {
    const price = num(cursor.p);
    return (
      "(selling_price > " +
      price +
      " OR (selling_price = " +
      price +
      " AND ROWID > " +
      rowId +
      "))"
    );
  }
  if (sortKey === "price_high") {
    const price = num(cursor.p);
    return (
      "(selling_price < " +
      price +
      " OR (selling_price = " +
      price +
      " AND ROWID < " +
      rowId +
      "))"
    );
  }
  return "ROWID < " + rowId;
}

function buildProductWhereClauses(filters) {
  const clauses = ["status = 'ACTIVE'"];

  if (filters.brandId) {
    clauses.push("brand_id = " + asId(filters.brandId, "brand_id"));
  }
  if (filters.categoryIds && filters.categoryIds.length) {
    const ids = filters.categoryIds.map((id) => asId(id, "category_id")).join(",");
    if (filters.linkedProductIds && filters.linkedProductIds.length) {
      const linked = filters.linkedProductIds.map((id) => asId(id, "product_id")).join(",");
      clauses.push("(category_id IN (" + ids + ") OR ROWID IN (" + linked + "))");
    } else {
      clauses.push("category_id IN (" + ids + ")");
    }
  } else if (filters.linkedProductIds && filters.linkedProductIds.length) {
    clauses.push(
      "ROWID IN (" + filters.linkedProductIds.map((id) => asId(id, "product_id")).join(",") + ")"
    );
  }
  if (filters.search) {
    const term = escapeLike(filters.search);
    if (term) {
      clauses.push(
        "(name LIKE '%" +
          term +
          "%' OR sku LIKE '%" +
          term +
          "%' OR search_keywords LIKE '%" +
          term +
          "%')"
      );
    }
  }
  if (Number.isFinite(filters.minPrice) && filters.minPrice > 0) {
    clauses.push("selling_price >= " + filters.minPrice);
  }
  if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) {
    clauses.push("selling_price <= " + filters.maxPrice);
  }
  if (filters.gender) {
    clauses.push("gender = " + sqlString(String(filters.gender)));
  }
  if (filters.ageGroup) {
    clauses.push("age_group = " + sqlString(String(filters.ageGroup)));
  }
  if (filters.quickOnly === true) {
    clauses.push("(quick_commerce_enabled = true OR quick_commerce_enabled = 'true')");
  }
  if (filters.standardOnly === true) {
    clauses.push("(ecommerce_enabled = true OR ecommerce_enabled = 'true')");
  }

  return clauses;
}

function buildProductListQuery(filters, { limit, cursor, sort }) {
  const sortDef = resolveSort(sort);
  const clauses = buildProductWhereClauses(filters);
  if (cursor) {
    clauses.push(buildKeysetClause(sortDef.key, cursor));
  }
  const query =
    "SELECT " +
    PRODUCT_LIST_COLUMNS +
    " FROM Products WHERE " +
    clauses.join(" AND ") +
    " ORDER BY " +
    sortDef.orderBy +
    " LIMIT " +
    (Math.max(1, limit) + 1);
  return { query, sortKey: sortDef.key };
}

async function fetchProductListPage(zcql, filters, { limit, cursor, sort }) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  const { query, sortKey } = buildProductListQuery(filters, {
    limit,
    cursor: decoded,
    sort,
  });
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  let nextCursor = null;
  if (hasMore && pageRows.length) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({
      r: String(last.ROWID),
      s: sortKey,
      p: num(last.selling_price),
    });
  }
  return {
    rows: pageRows,
    has_more: hasMore,
    next_cursor: nextCursor,
    queries_executed: 1,
    rows_fetched: rows.length,
  };
}

/**
 * Over-fetch pages until post-availability filters fill the requested page size.
 * Never loads the entire catalog — only sequential ZCQL keyset pages.
 */
async function fetchProductListPageWithPostFilters(
  zcql,
  filters,
  { limit, cursor, sort },
  { applyPostFilters, maxScans = 25 }
) {
  let workingCursor = cursor || null;
  let collected = [];
  let scans = 0;
  let totalFetched = 0;
  let lastNextCursor = null;
  let lastHasMore = false;

  while (collected.length < limit && scans < maxScans) {
    scans += 1;
    const batchLimit = Math.min(100, Math.max(limit, 24));
    const page = await fetchProductListPage(zcql, filters, {
      limit: batchLimit,
      cursor: workingCursor,
      sort,
    });
    totalFetched += page.rows_fetched;
    lastNextCursor = page.next_cursor;
    lastHasMore = page.has_more;
    if (!page.rows.length) {
      break;
    }
    const filtered = applyPostFilters ? await applyPostFilters(page.rows) : page.rows;
    collected = collected.concat(filtered);
    if (!page.has_more) {
      break;
    }
    workingCursor = page.next_cursor;
  }

  const pageRows = collected.slice(0, limit);
  const consumedExtra = collected.length > limit;
  let nextCursor = lastNextCursor;
  let hasMore = lastHasMore || consumedExtra;
  if (pageRows.length && !nextCursor) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({
      r: String(last.ROWID),
      s: resolveSort(sort).key,
      p: num(last.selling_price),
    });
  }

  return {
    rows: pageRows,
    has_more: hasMore,
    next_cursor: nextCursor,
    queries_executed: scans,
    rows_fetched: totalFetched,
  };
}

module.exports = {
  PRODUCT_LIST_COLUMNS,
  normalizeLimit,
  resolveSort,
  encodeCursor,
  decodeCursor,
  buildProductListQuery,
  fetchProductListPage,
  fetchProductListPageWithPostFilters,
};
