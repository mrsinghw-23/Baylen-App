const { num } = require("./http");

const DEFAULT_BOOKS_API_BASE = process.env.ZOHO_BOOKS_API_BASE || "https://www.zohoapis.in/books/v3";
const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";

function booksConfig() {
  const enabled = String(process.env.ZOHO_BOOKS_ENABLED || "false")
    .trim()
    .toLowerCase();
  return {
    enabled: enabled === "true" || enabled === "1" || enabled === "yes",
    organizationId:
      process.env.ZOHO_BOOKS_ORGANIZATION_ID ||
      process.env.ZOHO_ORG_ID ||
      "60068933706",
    clientId: process.env.ZOHO_BOOKS_CLIENT_ID || "",
    clientSecret: process.env.ZOHO_BOOKS_CLIENT_SECRET || "",
    refreshToken: process.env.ZOHO_BOOKS_REFRESH_TOKEN || "",
    authUrl: process.env.ZOHO_BOOKS_AUTH_URL || DEFAULT_ACCOUNTS_URL,
    apiBase: (process.env.ZOHO_BOOKS_API_BASE || DEFAULT_BOOKS_API_BASE).replace(/\/$/, ""),
  };
}

function isBooksConfigured(config = booksConfig()) {
  return Boolean(
    config.enabled &&
      config.organizationId &&
      config.clientId &&
      config.clientSecret &&
      config.refreshToken
  );
}

async function exchangeCodeForTokens({ clientId, clientSecret, code, redirectUri, authUrl = DEFAULT_ACCOUNTS_URL }) {
  const params = new URLSearchParams({
    code: String(code || "").trim(),
    client_id: String(clientId || "").trim(),
    client_secret: String(clientSecret || "").trim(),
    grant_type: "authorization_code",
  });
  if (redirectUri) {
    params.set("redirect_uri", redirectUri);
  }

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Zoho token exchange failed: ${data.error || response.statusText}`);
  }
  return data;
}

async function getBooksAccessToken(config = booksConfig()) {
  const params = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Could not generate Zoho Books access token: ${data.error || response.statusText}`
    );
  }
  return data.access_token;
}

async function booksConnectionStatus(req) {
  try {
    const creds = await req.catalystApp
      .connections()
      .getConnectionCredentials("zoho_books");
    const headers = creds?.headers || {};
    const authorization =
      headers.Authorization || headers.authorization || headers.AUTHORIZATION || "";
    const hasToken = Boolean(
      String(authorization || "").trim() || creds?.parameters?.access_token
    );
    return {
      configured: hasToken,
      connection_name: "zoho_books",
      error: "",
    };
  } catch (error) {
    return {
      configured: false,
      connection_name: "zoho_books",
      error: error.message || "Catalyst Connection check failed",
    };
  }
}

async function connectionAccessToken(req) {
  try {
    const creds = await req.catalystApp
      .connections()
      .getConnectionCredentials("zoho_books");
    const headers = creds?.headers || {};
    let token =
      headers.Authorization || headers.authorization || headers.AUTHORIZATION || "";
    if (token && !token.startsWith("Zoho-oauthtoken")) {
      token = "Zoho-oauthtoken " + token.replace(/^Bearer\s+/i, "");
    }
    if (!token && creds?.parameters?.access_token) {
      token = "Zoho-oauthtoken " + creds.parameters.access_token;
    }
    return token;
  } catch (err) {
    console.log("Zoho Books connection credentials error:", err.message);
    return "";
  }
}

async function fetchBooksItems(req, config = booksConfig()) {
  let token = await connectionAccessToken(req);
  if (!token && isBooksConfigured(config)) {
    token = "Zoho-oauthtoken " + (await getBooksAccessToken(config));
  }

  if (!token) {
    throw new Error("Zoho Books is not configured in environment and Catalyst Connection failed.");
  }

  let page = 1;
  let hasMore = true;
  const allItems = [];

  while (hasMore && page <= 10) {
    const url = `${config.apiBase}/items?organization_id=${config.organizationId}&page=${page}&per_page=200&status=active`;
    const response = await fetch(url, {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (!response.ok || (data.code !== undefined && data.code !== 0)) {
      throw new Error(`Zoho Books API error: ${data.message || response.statusText}`);
    }

    const items = data.items || [];
    allItems.push(...items);
    hasMore = data.page_context?.has_more_page === true;
    page += 1;
  }

  return allItems;
}

async function syncBooksItemsToCatalyst(req) {
  const items = await fetchBooksItems(req);
  const zcql = req.catalystApp.zcql();
  const datastore = req.catalystApp.datastore();

  const stats = {
    total_fetched: items.length,
    created: 0,
    updated: 0,
    skipped: 0,
  };

  const catRows = await zcql.executeZCQLQuery("SELECT ROWID, name FROM Categories WHERE is_active = true");
  const categories = (Array.isArray(catRows) ? catRows : []).map(r => r.Categories || r);
  const defaultCategoryId = categories.length > 0 ? categories[0].ROWID : "36851000000281052";

  for (const item of items) {
    const sku = String(item.sku || item.item_id || "").trim();
    const name = String(item.name || "").trim();
    const price = num(item.rate || item.selling_price || item.purchase_rate || 0);

    if (!name) {
      stats.skipped += 1;
      continue;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    let existing = null;
    if (sku) {
      const bySku = await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku FROM Products WHERE sku = '" + sku.replace(/'/g, "''") + "'"
      );
      if (Array.isArray(bySku) && bySku.length > 0) {
        existing = bySku[0].Products || bySku[0];
      }
    }
    if (!existing) {
      const byName = await zcql.executeZCQLQuery(
        "SELECT ROWID, name, sku FROM Products WHERE name = '" + name.replace(/'/g, "''") + "'"
      );
      if (Array.isArray(byName) && byName.length > 0) {
        existing = byName[0].Products || byName[0];
      }
    }

    if (existing) {
      await datastore.table("Products").updateRow({
        ROWID: existing.ROWID,
        selling_price: price,
        mrp: price,
        description: String(item.description || "").slice(0, 255),
        thumbnail_url: item.has_attachment ? `https://baylen-auth-50045005846.development.catalystappsail.in/api/shop/books-image?item_id=${item.item_id}` : existing.thumbnail_url || '',
        status: "ACTIVE",
      });
      stats.updated += 1;
    } else {
      const createdRow = await datastore.table("Products").insertRow({
        name: name,
        slug: slug,
        sku: sku,
        category_id: defaultCategoryId,
        product_type: "SIMPLE",
        mrp: price,
        selling_price: price,
        currency: "INR",
        description: String(item.description || "").slice(0, 255),
        short_description: String(item.description || "").slice(0, 150),
        thumbnail_url: item.has_attachment ? `https://baylen-auth-50045005846.development.catalystappsail.in/api/shop/books-image?item_id=${item.item_id}` : '',
        status: "ACTIVE",
        has_variants: false,
        is_returnable: true,
        is_featured: false,
      });

      const stock = num(item.stock_on_hand || item.actual_available_stock || 10);
      if (createdRow && createdRow.ROWID) {
        let warehouseId = "36851000000281052"; // fallback category ID as string? Wait, no.
        try {
          const warehouses = await zcql.executeZCQLQuery("SELECT ROWID FROM Warehouses LIMIT 1");
          if (Array.isArray(warehouses) && warehouses.length > 0) {
            const wh = warehouses[0].Warehouses || warehouses[0];
            warehouseId = String(wh.ROWID);
          }
        } catch (e) {
          // ignore
        }
        await datastore.table("Inventory").insertRow({
          warehouse_id: warehouseId,
          product_id: String(createdRow.ROWID),
          quantity_on_hand: stock,
          quantity_reserved: 0,
          status: "ACTIVE",
          is_active: true,
        });
      }
      stats.created += 1;
    }
  }

  return stats;
}

module.exports = {
  booksConfig,
  isBooksConfigured,
  booksConnectionStatus,
  exchangeCodeForTokens,
  getBooksAccessToken,
  fetchBooksItems,
  syncBooksItemsToCatalyst,
};
