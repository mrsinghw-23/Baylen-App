const { asId, optionalText, rowOf, rowsOf, num, sendOk, sqlString } = require("../lib/http");
const { requireUser } = require("../lib/session");

function mapWishlist(row) {
  return {
    id: String(row.ROWID),
    product_id: row.product_id ? String(row.product_id) : "",
    variant_id: row.variant_id ? String(row.variant_id) : "",
    name: row.name || "",
    thumbnail_url: row.thumbnail_url || "",
    mrp: num(row.mrp),
    selling_price: num(row.selling_price),
    currency: row.currency || "INR",
  };
}

function mapReview(row) {
  return {
    id: String(row.ROWID),
    user_id: row.user_id ? String(row.user_id) : "",
    target_type: row.target_type || "",
    target_id: row.target_id ? String(row.target_id) : "",
    rating: num(row.rating),
    review: row.review || "",
    status: row.status || "PUBLISHED",
  };
}

function engagementRoutes(app) {
  app.get("/v1/wishlist", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, product_id, variant_id FROM Wishlist WHERE user_id = " +
            user.user_id +
            " AND is_active = true"
        ),
        "Wishlist"
      );
      const wishlist = [];
      for (const row of rows) {
        const product = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, name, thumbnail_url, mrp, selling_price, currency FROM Products WHERE ROWID = " +
              asId(row.product_id, "product_id") +
              " AND status = 'ACTIVE'"
          ),
          "Products"
        );
        wishlist.push(
          mapWishlist({
            ...row,
            name: product ? product.name : "",
            thumbnail_url: product ? product.thumbnail_url || "" : "",
            mrp: product ? product.mrp : 0,
            selling_price: product ? product.selling_price : 0,
            currency: product ? product.currency || "INR" : "INR",
          })
        );
      }
      sendOk(res, { wishlist });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/wishlist/toggle", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const productId = asId(req.body.product_id, "product_id");
      const variantId = req.body.variant_id ? asId(req.body.variant_id, "variant_id") : null;
      const zcql = req.catalystApp.zcql();

      const product = rowOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID FROM Products WHERE ROWID = " + productId + " AND status = 'ACTIVE'"
        ),
        "Products"
      );
      if (!product) {
        const error = new Error("Product not found");
        error.status = 404;
        throw error;
      }

      let query =
        "SELECT ROWID, is_active FROM Wishlist WHERE user_id = " +
        user.user_id +
        " AND product_id = " +
        productId;
      query += variantId ? " AND variant_id = " + variantId : " AND variant_id IS NULL";
      const existing = rowOf(await zcql.executeZCQLQuery(query), "Wishlist");

      if (existing) {
        const nextActive = !(existing.is_active === true || existing.is_active === "true");
        await req.catalystApp.datastore().table("Wishlist").updateRow({
          ROWID: existing.ROWID,
          is_active: nextActive,
        });
        sendOk(res, { wished: nextActive });
        return;
      }

      await req.catalystApp.datastore().table("Wishlist").insertRow({
        user_id: user.user_id,
        product_id: productId,
        variant_id: variantId,
        is_active: true,
      });
      sendOk(res, { wished: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/reviews", async (req, res, next) => {
    try {
      const targetType = optionalText(req.query.target_type, "target_type", 40);
      const targetId = req.query.target_id ? asId(req.query.target_id, "target_id") : "";
      if (!targetType || !targetId) {
        const error = new Error("target_type and target_id are required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      const rows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, user_id, target_type, target_id, rating, review, status FROM Reviews WHERE target_type = " +
            sqlString(targetType) +
            " AND target_id = " +
            targetId +
            " AND is_active = true AND status = 'PUBLISHED'"
        ),
        "Reviews"
      );
      sendOk(res, { reviews: rows.map(mapReview) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/reviews", async (req, res, next) => {
    try {
      const user = requireUser(req);
      const targetType = optionalText(req.body.target_type, "target_type", 40);
      const targetId = asId(req.body.target_id, "target_id");
      const rating = Number(req.body.rating);
      const review = optionalText(req.body.review, "review", 255);
      if (!targetType || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        const error = new Error("target_type and rating from 1 to 5 are required");
        error.status = 400;
        throw error;
      }
      await req.catalystApp.datastore().table("Reviews").insertRow({
        user_id: user.user_id,
        target_type: targetType,
        target_id: targetId,
        rating,
        review: review || null,
        status: "PUBLISHED",
        is_active: true,
      });
      sendOk(res, { submitted: true });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = engagementRoutes;
