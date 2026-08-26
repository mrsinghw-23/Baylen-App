const { asId, optionalText, rowsOf, rowOf, sendOk, sqlString, num } = require("../lib/http");
const {
  commerceEnabled,
  commerceProductId,
  getCommerceProductDetail,
  listCommerceProducts,
} = require("../lib/zoho-commerce");
const {
  booksConfig,
  isBooksConfigured,
  syncBooksItemsToCatalyst,
} = require("../lib/zoho-books");

function mapCategory(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    category_type: row.category_type,
    image_url: row.image_url || "",
    display_order: Number(row.display_order || 0),
  };
}

function mapBrand(row) {
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug: row.slug || "",
    logo_url: row.logo_url || "",
    banner_url: row.banner_url || "",
    description: row.description || "",
    rating: num(row.rating),
    review_count: num(row.review_count),
  };
}

function mapProduct(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug,
    sku: row.sku || "",
    category_id: row.category_id ? String(row.category_id) : "",
    brand_id: row.brand_id ? String(row.brand_id) : "",
    product_type: row.product_type,
    short_description: row.short_description || "",
    description: row.description || "",
    brand_name: row.brand_name || "",
    mrp: num(row.mrp),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
    tax_percent: num(row.tax_percent),
    thumbnail_url: row.thumbnail_url || "",
    has_variants: row.has_variants === true || row.has_variants === "true",
    is_featured: row.is_featured === true || row.is_featured === "true",
    available_quantity: num(row.available_quantity),
    status: row.status,
  };
}

function mapVariant(row) {
  return {
    id: String(row.ROWID),
    product_id: row.product_id ? String(row.product_id) : "",
    sku: row.sku || "",
    variant_name: row.variant_name || "",
    variant_value: row.variant_value || "",
    mrp: num(row.mrp),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
    available_quantity: num(row.available_quantity),
  };
}

function mapMedia(row) {
  return {
    id: String(row.ROWID),
    product_id: row.product_id ? String(row.product_id) : "",
    variant_id: row.variant_id ? String(row.variant_id) : "",
    media_type: row.media_type || "IMAGE",
    file_url: row.file_url || "",
    display_order: num(row.display_order),
  };
}

async function productAvailability(zcql, productId, variantId) {
  let query =
    "SELECT quantity_on_hand, quantity_reserved FROM Inventory WHERE product_id = " +
    productId +
    " AND is_active = true AND status = 'ACTIVE'";
  query += variantId ? " AND variant_id = " + variantId : "";
  const rows = rowsOf(await zcql.executeZCQLQuery(query), "Inventory");
  return rows.reduce(
    (sum, row) => sum + Math.max(0, num(row.quantity_on_hand) - num(row.quantity_reserved)),
    0
  );
}

async function attachAvailability(zcql, product) {
  return {
    ...product,
    available_quantity: await productAvailability(zcql, asId(product.ROWID, "product_id")),
  };
}

function productSelect() {
  return "SELECT ROWID, name, slug, sku, category_id, brand_id, product_type, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status FROM Products WHERE status = 'ACTIVE'";
}

function catalogRoutes(app) {
  app.get("/v1/catalog/categories", async (req, res, next) => {
    try {
      const type = String(req.query.type || "PRODUCT").trim();
      const allowed = ["PRODUCT", "SALON_SERVICE", "HOME_SERVICE"];
      if (!allowed.includes(type)) {
        const error = new Error("type must be PRODUCT, SALON_SERVICE, or HOME_SERVICE");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, description, category_type, image_url, display_order FROM Categories WHERE is_active = true AND category_type = '" +
            type +
            "'"
        ),
        "Categories"
      );
      rows.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
      sendOk(res, { categories: rows.map(mapCategory) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/brands", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, logo_url, banner_url, description, rating, review_count FROM Brands WHERE is_active = true"
        ),
        "Brands"
      );
      rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      sendOk(res, { brands: rows.map(mapBrand) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/products", async (req, res, next) => {
    try {
      if (commerceEnabled()) {
        try {
          const products = await listCommerceProducts(req, {
            categoryId: req.query.category_id,
            brandId: req.query.brand_id,
            search: req.query.search,
            sort: req.query.sort,
          });
          if (products) {
            return sendOk(res, {
              source: "ZOHO_COMMERCE",
              products,
            });
          }
        } catch (commerceError) {
          // Keep Shop usable while Commerce credentials/org ID are being configured.
          console.warn("Zoho Commerce catalog fallback:", commerceError.message);
        }
      }

      const zcql = req.catalystApp.zcql();
      let query = productSelect();
      if (req.query.category_id) {
        query += " AND category_id = " + asId(req.query.category_id, "category_id");
      }
      if (req.query.brand_id) {
        query += " AND brand_id = " + asId(req.query.brand_id, "brand_id");
      }
      const search = optionalText(req.query.search, "search", 80);
      if (search) {
        const term = sqlString("%" + search + "%");
        query += " AND (name LIKE " + term + " OR short_description LIKE " + term + ")";
      }
      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
      const withAvailability = [];
      for (const row of rows) {
        withAvailability.push(await attachAvailability(zcql, row));
      }
      const sort = String(req.query.sort || "").trim();
      if (sort === "price_low") {
        withAvailability.sort((a, b) => num(a.selling_price) - num(b.selling_price));
      } else if (sort === "price_high") {
        withAvailability.sort((a, b) => num(b.selling_price) - num(a.selling_price));
      } else if (sort === "newest") {
        withAvailability.sort((a, b) => String(b.ROWID).localeCompare(String(a.ROWID)));
      } else {
        withAvailability.sort((a, b) => Number(b.is_featured === true) - Number(a.is_featured === true));
      }
      sendOk(res, { products: withAvailability.map(mapProduct) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/product", async (req, res, next) => {
    try {
      const requestedId = String(req.query.id || "").trim();
      if (requestedId.startsWith("commerce:")) {
        const detail = await getCommerceProductDetail(
          req,
          commerceProductId(requestedId)
        );
        return sendOk(res, detail);
      }

      const id = asId(req.query.id, "id");
      const zcql = req.catalystApp.zcql();
      const row = rowOf(
        await zcql.executeZCQLQuery(productSelect() + " AND ROWID = " + id),
        "Products"
      );
      if (!row) {
        const error = new Error("Product not found");
        error.status = 404;
        throw error;
      }
      const product = await attachAvailability(zcql, row);
      const brand = product.brand_id
        ? rowOf(
            await zcql.executeZCQLQuery(
              "SELECT ROWID, name, slug, logo_url, banner_url, description, rating, review_count FROM Brands WHERE ROWID = " +
                asId(product.brand_id, "brand_id")
            ),
            "Brands"
          )
        : null;
      const variants = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, product_id, sku, variant_name, variant_value, mrp, selling_price, currency FROM Product_Variants WHERE product_id = " +
            id +
            " AND is_active = true"
        ),
        "Product_Variants"
      );
      const variantsWithAvailability = [];
      for (const variant of variants) {
        variantsWithAvailability.push({
          ...variant,
          available_quantity: await productAvailability(
            zcql,
            id,
            asId(variant.ROWID, "variant_id")
          ),
        });
      }
      const media = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, product_id, variant_id, media_type, file_url, display_order FROM Product_Media WHERE product_id = " +
            id +
            " AND is_active = true"
        ),
        "Product_Media"
      );
      media.sort((a, b) => num(a.display_order) - num(b.display_order));
      sendOk(res, {
        product: mapProduct(product),
        brand: brand ? mapBrand(brand) : null,
        variants: variantsWithAvailability.map(mapVariant),
        media: media.map(mapMedia),
      });
    } catch (error) {
      next(error);
    }
  });

  // Zoho Books Integration Status
  app.get("/v1/catalog/sync/zoho-books/status", async (req, res, next) => {
    try {
      const cfg = booksConfig();
      sendOk(res, {
        service: "Zoho Books Product Sync",
        is_configured: isBooksConfigured(cfg),
        organization_id_configured: Boolean(cfg.organizationId),
        client_id_configured: Boolean(cfg.clientId),
        refresh_token_configured: Boolean(cfg.refreshToken),
        api_base: cfg.apiBase,
        instructions: isBooksConfigured(cfg)
          ? "Zoho Books is connected. You can trigger sync anytime via POST /v1/catalog/sync/zoho-books"
          : "Configure ZOHO_BOOKS_ORGANIZATION_ID, ZOHO_BOOKS_CLIENT_ID, ZOHO_BOOKS_CLIENT_SECRET, and ZOHO_BOOKS_REFRESH_TOKEN in Catalyst Environment Variables to sync items.",
      });
    } catch (error) {
      next(error);
    }
  });

  // Zoho Books Manual Sync
  app.post("/v1/catalog/sync/zoho-books", async (req, res, next) => {
    try {
      const cfg = booksConfig();
      // Allow syncing via Catalyst Connection or Environment Variables
      const result = await syncBooksItemsToCatalyst(req);
      sendOk(res, {
        success: true,
        message: "Zoho Books items synced successfully",
        stats: result,
      });
    } catch (error) {
      next(error);
    }
  });

  // Zoho Books Real-time Webhook Receiver
  app.post("/v1/webhooks/zoho-books", async (req, res, next) => {
    try {
      const payload = req.body || {};
      const item = payload.item || payload;
      const zcql = req.catalystApp.zcql();
      const datastore = req.catalystApp.datastore();

      if (item && (item.item_id || item.name)) {
        const name = String(item.name || "").trim();
        const sku = String(item.sku || item.item_id || "").trim();
        const price = num(item.rate || item.selling_price || item.purchase_rate || 0);
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

        let existing = null;
        if (sku) {
          const bySku = await zcql.executeZCQLQuery(
            "SELECT ROWID FROM Products WHERE sku = '" + sku.replace(/'/g, "''") + "'"
          );
          if (Array.isArray(bySku) && bySku.length > 0) existing = bySku[0].Products || bySku[0];
        }
        if (!existing && name) {
          const byName = await zcql.executeZCQLQuery(
            "SELECT ROWID FROM Products WHERE name = '" + name.replace(/'/g, "''") + "'"
          );
          if (Array.isArray(byName) && byName.length > 0) existing = byName[0].Products || byName[0];
        }

        if (existing) {
          await datastore.table("Products").updateRow({
            ROWID: existing.ROWID,
            selling_price: price,
            mrp: price,
            status: item.status === "inactive" ? "INACTIVE" : "ACTIVE",
          });
        } else if (name) {
          await datastore.table("Products").insertRow({
            name,
            slug,
            sku,
            category_id: "36851000000281052",
            product_type: "SIMPLE",
            mrp: price,
            selling_price: price,
            currency: "INR",
            status: "ACTIVE",
            has_variants: false,
            is_returnable: true,
            is_featured: false,
          });
        }
      }

      sendOk(res, { received: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = catalogRoutes;
