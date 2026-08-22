const { asId, rowsOf, rowOf, sendOk } = require("../lib/http");

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
    mrp: Number(row.mrp || 0),
    selling_price: Number(row.selling_price || 0),
    currency: row.currency || "INR",
    thumbnail_url: row.thumbnail_url || "",
    has_variants: row.has_variants === true || row.has_variants === "true",
    is_featured: row.is_featured === true || row.is_featured === "true",
    status: row.status,
  };
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

  app.get("/v1/catalog/products", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      let query =
        "SELECT ROWID, name, slug, sku, category_id, brand_id, product_type, short_description, description, mrp, selling_price, currency, thumbnail_url, has_variants, is_featured, status FROM Products WHERE status = 'ACTIVE'";
      if (req.query.category_id) {
        query += " AND category_id = " + asId(req.query.category_id, "category_id");
      }
      const rows = rowsOf(await zcql.executeZCQLQuery(query), "Products");
      sendOk(res, { products: rows.map(mapProduct) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/product", async (req, res, next) => {
    try {
      const id = asId(req.query.id, "id");
      const zcql = req.catalystApp.zcql();
      const row = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, sku, category_id, brand_id, product_type, short_description, description, mrp, selling_price, currency, thumbnail_url, has_variants, is_featured, status FROM Products WHERE ROWID = " +
            id +
            " AND status = 'ACTIVE'"
        ),
        "Products"
      );
      if (!row) {
        const error = new Error("Product not found");
        error.status = 404;
        throw error;
      }
      sendOk(res, { product: mapProduct(row) });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = catalogRoutes;
