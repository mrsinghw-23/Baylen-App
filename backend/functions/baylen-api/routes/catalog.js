const { asId, optionalText, sqlString, rowsOf, rowOf, sendOk, num, isTruthy } = require("../lib/http");
const {
  buildCatalogAvailability,
  buildCatalogAvailabilityBatch,
  mapProductModeFlags,
} = require("../lib/product-availability");
const {
  commerceProductId,
  getCommerceProductDetail,
} = require("../lib/zoho-commerce");
const { fetchAllTableRows, activeRows } = require("../lib/paged");
const { buildNavigation, byParent, SHOP_FILTER_ROOTS } = require("../lib/shop-nav");
const {
  normalizeQuery,
  expandWithSynonyms,
  detectIntent,
  rankProducts,
  suggestionsFor,
} = require("../lib/search-engine");
const { searchIndexed } = require("../lib/search-index");
const {
  normalizeLimit,
  fetchProductListPageWithPostFilters,
  decodeCursor,
} = require("../lib/catalog-pagination");

function mapCategory(row) {
  return {
    id: String(row.ROWID),
    name: row.name,
    slug: row.slug,
    description: row.description || "",
    category_type: row.category_type,
    parent_id: row.parent_category_id ? String(row.parent_category_id) : null,
    image_url: row.image_url || "",
    display_order: Number(row.display_order || 0),
  };
}

function categorySelect() {
  return "SELECT ROWID, name, slug, description, category_type, parent_category_id, image_url, display_order FROM Categories WHERE is_active = true";
}

function buildCategoryTree(rows) {
  const categoryHashMap = {};
  const roots = [];
  rows.forEach((row) => {
    const id = String(row.ROWID);
    categoryHashMap[id] = {
      id,
      name: row.name,
      slug: row.slug,
      description: row.description || "",
      parent_id: row.parent_category_id ? String(row.parent_category_id) : null,
      image_url: row.image_url || "",
      display_order: Number(row.display_order || 0),
      sub_categories: [],
    };
  });
  Object.keys(categoryHashMap).forEach((id) => {
    const current = categoryHashMap[id];
    const parent = current.parent_id ? categoryHashMap[current.parent_id] : null;
    if (parent) {
      parent.sub_categories.push(current);
    } else {
      roots.push(current);
    }
  });
  const sortNodes = (nodes) => {
    nodes.sort(
      (a, b) =>
        Number(a.display_order || 0) - Number(b.display_order || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
    nodes.forEach((node) => sortNodes(node.sub_categories));
  };
  sortNodes(roots);
  return roots;
}

function descendantIdSet(rows, rootId) {
  const childrenByParent = {};
  rows.forEach((row) => {
    const parent = row.parent_category_id ? String(row.parent_category_id) : "";
    if (!childrenByParent[parent]) {
      childrenByParent[parent] = [];
    }
    childrenByParent[parent].push(String(row.ROWID));
  });
  const ids = new Set([String(rootId)]);
  const stack = [String(rootId)];
  while (stack.length) {
    const current = stack.pop();
    const children = childrenByParent[current] || [];
    children.forEach((childId) => {
      if (!ids.has(childId)) {
        ids.add(childId);
        stack.push(childId);
      }
    });
  }
  return ids;
}

async function linkedProductIdsForCategories(app, categoryIds) {
  const wanted = new Set(Array.from(categoryIds || []).map(String));
  const productIds = new Set();
  if (!wanted.size) {
    return productIds;
  }
  try {
    const links = activeRows(await fetchAllTableRows(app, "Product_Categories"));
    links.forEach((link) => {
      if (wanted.has(String(link.category_id || ""))) {
        const productId = String(link.product_id || "");
        if (productId) {
          productIds.add(productId);
        }
      }
    });
  } catch (_) {
    // Product_Categories is optional for listing; primary category_id still applies.
  }
  return productIds;
}

async function fetchActiveProductsByIds(zcql, ids, brandQuery) {
  const list = Array.from(ids || []).filter(Boolean);
  const rows = [];
  const chunkSize = 50;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const extra = rowsOf(
      await zcql.executeZCQLQuery(
        productSelect() + brandQuery + " AND ROWID IN (" + chunk.join(",") + ")"
      ),
      "Products"
    );
    extra.forEach((row) => rows.push(row));
  }
  return rows;
}

function textHaystack(row, brandName, categoryName) {
  return [
    row.name,
    row.slug,
    row.sku,
    row.short_description,
    row.description,
    brandName,
    categoryName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function usableImage(url) {
  const value = String(url || "").trim();
  if (!value) {
    return "";
  }
  if (
    value.indexOf("placehold.co") !== -1 ||
    value.indexOf("placeholder") !== -1 ||
    value.indexOf("books-image") !== -1
  ) {
    return "";
  }
  return value;
}

function mapBrand(row) {
  const slug = String(row.slug || "").trim();
  return {
    id: String(row.ROWID),
    name: row.name || "",
    slug,
    logo_url: usableImage(row.logo_url),
    banner_url: usableImage(row.banner_url),
    description: row.description || "",
    rating: num(row.rating),
    review_count: num(row.review_count),
    url: slug ? "/brand/" + slug : "",
  };
}

function discountPercent(row) {
  const mrp = num(row.mrp);
  const selling = num(row.selling_price);
  if (mrp <= 0 || selling >= mrp) {
    return 0;
  }
  return Math.round(((mrp - selling) / mrp) * 100);
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
    thumbnail_url: usableImage(row.thumbnail_url),
    has_variants: row.has_variants === true || row.has_variants === "true",
    is_featured: row.is_featured === true || row.is_featured === "true",
    available_quantity: num(row.available_quantity),
    quick_available: row.quick_available === true,
    standard_available: row.standard_available === true,
    quick_available_quantity: num(row.quick_available_quantity),
    quick_eta: row.quick_eta || "",
    standard_available_quantity: num(row.standard_available_quantity),
    standard_eta: row.standard_eta || "",
    quick_commerce_enabled: row.quick_commerce_enabled !== false,
    ecommerce_enabled: row.ecommerce_enabled !== false,
    quick_commerce_restriction_reason: row.quick_commerce_restriction_reason || "",
    gender: row.gender || "",
    age_group: row.age_group || "",
    discount_percent: discountPercent(row),
    rating: num(row.rating),
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
    quick_available: row.quick_available === true,
    standard_available: row.standard_available === true,
    quick_available_quantity: num(row.quick_available_quantity),
    quick_eta: row.quick_eta || "",
    standard_available_quantity: num(row.standard_available_quantity),
    standard_eta: row.standard_eta || "",
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

function catalogLocationOptions(req) {
  return {
    latitude: req.query.latitude,
    longitude: req.query.longitude,
  };
}

async function attachAvailability(app, product, options = {}) {
  const productId = asId(product.ROWID, "product_id");
  const availability = await buildCatalogAvailability(app, {
    productId,
    variantId: options.variantId || null,
    latitude: options.latitude,
    longitude: options.longitude,
    quantity: options.quantity || 1,
  });
  return {
    ...product,
    ...availability,
    ...mapProductModeFlags(product),
  };
}

async function attachAvailabilityBatch(app, products, options = {}) {
  if (!Array.isArray(products) || !products.length) {
    return [];
  }
  const batch = await buildCatalogAvailabilityBatch(app, {
    items: products.map((product) => ({
      product_id: String(product.ROWID),
      variant_id: options.variantId || null,
      quantity: options.quantity || 1,
    })),
    latitude: options.latitude,
    longitude: options.longitude,
  });
  const byKey = new Map(
    batch.items.map((item) => [
      item.product_id + "|" + (item.variant_id || ""),
      item,
    ])
  );
  return products.map((product) => {
    const key = String(product.ROWID) + "|" + (options.variantId || "");
    const availability = byKey.get(key) || {};
    return {
      ...product,
      ...availability,
      ...mapProductModeFlags(product),
    };
  });
}

function productSelect() {
  return "SELECT ROWID, name, slug, sku, category_id, brand_id, product_type, short_description, description, mrp, selling_price, currency, tax_percent, thumbnail_url, has_variants, is_featured, status, gender, age_group, quick_commerce_enabled, ecommerce_enabled, quick_commerce_restriction_reason FROM Products WHERE status = 'ACTIVE'";
}

async function productRatingMap(zcql) {
  const map = {};
  try {
    const rows = rowsOf(
      await zcql.executeZCQLQuery(
        "SELECT target_id, rating FROM Reviews WHERE target_type = 'PRODUCT' AND is_active = true"
      ),
      "Reviews"
    );
    const sums = {};
    rows.forEach((row) => {
      const id = String(row.target_id || "");
      if (!id) {
        return;
      }
      if (!sums[id]) {
        sums[id] = { sum: 0, count: 0 };
      }
      sums[id].sum += num(row.rating);
      sums[id].count += 1;
    });
    Object.keys(sums).forEach((id) => {
      map[id] = sums[id].count ? sums[id].sum / sums[id].count : 0;
    });
  } catch (_) {
    // Reviews are optional for catalog listing.
  }
  return map;
}

async function loadCatalogGraph(app) {
  const [categoryRows, brandRows, productRows] = await Promise.all([
    fetchAllTableRows(app, "Categories"),
    fetchAllTableRows(app, "Brands"),
    fetchAllTableRows(app, "Products"),
  ]);
  const categories = activeRows(categoryRows).filter(
    (row) => String(row.category_type || "PRODUCT") !== "SYNONYM"
  );
  const synonyms = activeRows(categoryRows).filter(
    (row) => String(row.category_type) === "SYNONYM"
  );
  const brands = activeRows(brandRows);
  const products = productRows.filter(
    (row) => String(row.status || "").toUpperCase() === "ACTIVE"
  );
  return { categories, synonyms, brands, products, allCategories: categoryRows };
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
        await zcql.executeZCQLQuery(categorySelect() + " AND category_type = '" + type + "'"),
        "Categories"
      );
      rows.sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
      sendOk(res, { categories: rows.map(mapCategory) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/mega-menu", async (req, res, next) => {
    try {
      const graph = await loadCatalogGraph(req.catalystApp);
      const productCategories = graph.categories.filter((row) =>
        ["PRODUCT", "COLLECTION", "OFFER"].includes(String(row.category_type || "PRODUCT"))
      );
      const menu = buildCategoryTree(productCategories);
      sendOk(res, { count: menu.length, menu });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/navigation", async (req, res, next) => {
    try {
      const graph = await loadCatalogGraph(req.catalystApp);
      sendOk(res, buildNavigation(graph.allCategories, graph.brands));
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/concerns", async (req, res, next) => {
    try {
      const graph = await loadCatalogGraph(req.catalystApp);
      const children = byParent(graph.categories);
      const leafRows = graph.categories.filter((row) => (children[String(row.ROWID)] || []).length === 0);
      sendOk(res, {
        concerns: leafRows
          .filter((row) => String(row.category_type) === "CONCERN")
          .map(mapCategory),
        skin_types: leafRows
          .filter((row) => String(row.category_type) === "SKIN_TYPE")
          .map(mapCategory),
        hair_types: leafRows
          .filter((row) => String(row.category_type) === "HAIR_TYPE")
          .map(mapCategory),
        fragrance_families: leafRows
          .filter((row) => String(row.category_type) === "FRAGRANCE")
          .map(mapCategory),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/search/trending", async (req, res, next) => {
    try {
      const graph = await loadCatalogGraph(req.catalystApp);
      const children = byParent(graph.categories);
      sendOk(res, {
        trending: graph.categories
          .filter((row) => String(row.category_type) === "TRENDING")
          .filter((row) => (children[String(row.ROWID)] || []).length === 0)
          .map((row) => ({
            id: String(row.ROWID),
            query: row.name,
            slug: row.slug,
          })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/search/suggestions", async (req, res, next) => {
    try {
      const q = optionalText(req.query.q || req.query.search, "q", 80);
      const graph = await loadCatalogGraph(req.catalystApp);
      sendOk(res, {
        query: q,
        suggestions: suggestionsFor(q, graph),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/shop-home", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const [categoryRows, productRows, bannerRows, brandRows, couponRows] = await Promise.all([
        fetchAllTableRows(req.catalystApp, "Categories"),
        fetchAllTableRows(req.catalystApp, "Products"),
        zcql.executeZCQLQuery(
          "SELECT ROWID, title, subtitle, image_url, video_url, action_type, action_value, display_order FROM Home_Banners WHERE is_active = true"
        ),
        fetchAllTableRows(req.catalystApp, "Brands"),
        zcql.executeZCQLQuery(
          "SELECT ROWID, title, code, description, discount_type, discount_value FROM Coupons WHERE is_active = true"
        ),
      ]);

      const categories = activeRows(categoryRows).filter((row) =>
        !["SYNONYM", "SALON_SERVICE", "HOME_SERVICE"].includes(
          String(row.category_type || "PRODUCT")
        )
      );
      const tree = buildCategoryTree(categories);
      const treeBySlug = {};
      tree.forEach((node) => {
        treeBySlug[String(node.slug || "")] = node;
      });
      const menu = SHOP_FILTER_ROOTS.map((slug) => treeBySlug[slug]).filter(Boolean);
      const products = productRows.filter((row) => String(row.status || "").toUpperCase() === "ACTIVE");
      const banners = rowsOf(bannerRows, "Home_Banners");
      const brands = activeRows(brandRows);
      const coupons = rowsOf(couponRows, "Coupons");

      const productsByCategory = {};
      products.forEach((product) => {
        const categoryId = product.category_id ? String(product.category_id) : "";
        if (!categoryId) {
          return;
        }
        if (!productsByCategory[categoryId]) {
          productsByCategory[categoryId] = [];
        }
        productsByCategory[categoryId].push(product);
      });

      function imageForCategory(categoryId) {
        const ids = Array.from(descendantIdSet(categories, categoryId));
        for (let i = 0; i < ids.length; i += 1) {
          const matches = productsByCategory[ids[i]] || [];
          for (let j = 0; j < matches.length; j += 1) {
            const image = usableImage(matches[j].thumbnail_url);
            if (image) {
              return image;
            }
          }
        }
        return "";
      }

      const hubs = menu.map((hub) => ({
        id: hub.id,
        name: hub.name,
        slug: hub.slug,
        image_url: usableImage(hub.image_url) || imageForCategory(hub.id),
      }));

      const quickCategories = hubs.map((hub) => ({
        id: hub.id,
        name: hub.name,
        slug: hub.slug,
        parent_id: null,
        image_url: hub.image_url,
      }));

      const searchHints = [];
      function collectHints(nodes) {
        nodes.forEach((node) => {
          if (!node.sub_categories || node.sub_categories.length === 0) {
            searchHints.push(node.name);
          } else {
            collectHints(node.sub_categories);
          }
        });
      }
      collectHints(tree);

      const shopBanners = banners
        .filter((row) => {
          const type = String(row.action_type || "").toUpperCase();
          return type === "SHOP" || type === "PRODUCT" || type === "CATALOG";
        })
        .sort((a, b) => num(a.display_order) - num(b.display_order))
        .map((row) => ({
          id: String(row.ROWID),
          title: row.title || "",
          subtitle: row.subtitle || "",
          image_url: usableImage(row.image_url),
          action_type: row.action_type || "SHOP",
          action_value: row.action_value || "",
          cta_label: "Shop Now",
        }));

      const featuredSource = products.filter(
        (row) => row.is_featured === true || row.is_featured === "true"
      );
      const catalogSource = (featuredSource.length > 0 ? featuredSource : products).slice(0, 12);

      const locOpts = catalogLocationOptions(req);
      const withAvail = await attachAvailabilityBatch(req.catalystApp, catalogSource, locOpts);
      const glowProducts = withAvail.map((row) => mapProduct(row));

      sendOk(res, {
        hubs,
        quick_categories: quickCategories,
        search_hints: searchHints.slice(0, 12),
        banners: shopBanners.filter((banner) => banner.title),
        glow_products: glowProducts,
        brands: brands
          .map(mapBrand)
          .filter((brand) => usableImage(brand.logo_url) || usableImage(brand.banner_url) || brand.name),
        offers: coupons.map((row) => ({
          id: String(row.ROWID),
          title: row.title || row.code || "",
          code: row.code || "",
          description: row.description || "",
          discount_type: row.discount_type || "",
          discount_value: num(row.discount_value),
        })),
      });
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

  app.get("/v1/catalog/brand", async (req, res, next) => {
    try {
      const slug = optionalText(req.query.slug || req.query.brand_slug, "slug", 180);
      if (!slug) {
        const error = new Error("slug is required");
        error.status = 400;
        throw error;
      }
      const zcql = req.catalystApp.zcql();
      let row = null;
      if (/^\d+$/.test(slug)) {
        row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, name, slug, logo_url, banner_url, description, rating, review_count FROM Brands WHERE is_active = true AND ROWID = " +
              slug
          ),
          "Brands"
        );
      }
      if (!row) {
        row = rowOf(
          await zcql.executeZCQLQuery(
            "SELECT ROWID, name, slug, logo_url, banner_url, description, rating, review_count FROM Brands WHERE is_active = true AND slug = " +
              sqlString(String(slug).toLowerCase())
          ),
          "Brands"
        );
      }
      if (!row) {
        const error = new Error("Brand not found");
        error.status = 404;
        throw error;
      }

      const brandId = String(row.ROWID);
      const products = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, category_id, mrp, selling_price, gender, age_group FROM Products WHERE status = 'ACTIVE' AND brand_id = " +
            brandId
        ),
        "Products"
      );
      const categoryIds = Array.from(
        new Set(products.map((product) => String(product.category_id || "")).filter(Boolean))
      );
      const categoryById = {};
      if (categoryIds.length) {
        const categoryRows = rowsOf(await zcql.executeZCQLQuery(categorySelect()), "Categories");
        categoryRows.forEach((category) => {
          categoryById[String(category.ROWID)] = category;
        });
      }

      const categoryCounts = {};
      const genders = new Set();
      const ageGroups = new Set();
      let minPrice = 0;
      let maxPrice = 0;
      products.forEach((product) => {
        const categoryId = String(product.category_id || "");
        if (categoryId) {
          categoryCounts[categoryId] = (categoryCounts[categoryId] || 0) + 1;
        }
        const price = num(product.selling_price);
        if (price > 0) {
          minPrice = minPrice === 0 ? price : Math.min(minPrice, price);
          maxPrice = Math.max(maxPrice, price);
        }
        const gender = String(product.gender || "").trim();
        if (gender) {
          genders.add(gender);
        }
        const ageGroup = String(product.age_group || "").trim();
        if (ageGroup) {
          ageGroups.add(ageGroup);
        }
      });

      const brand = mapBrand(row);
      const seoTitle = brand.name ? brand.name + " | Baylen" : "Brand | Baylen";
      const seoDescription =
        brand.description ||
        "Shop " + (brand.name || "this brand") + " products at Baylen.";

      sendOk(res, {
        brand,
        url: brand.url || "/brand/" + (brand.slug || slug),
        seo: {
          title: seoTitle,
          description: seoDescription,
          canonical: brand.url || "/brand/" + (brand.slug || slug),
        },
        product_count: products.length,
        facets: {
          categories: categoryIds.map((id) => ({
            id,
            name: (categoryById[id] && categoryById[id].name) || "",
            slug: (categoryById[id] && categoryById[id].slug) || "",
            count: categoryCounts[id] || 0,
          })).filter((item) => item.name),
          price: { min: minPrice, max: maxPrice },
          attributes: {
            gender: Array.from(genders).sort(),
            age_group: Array.from(ageGroups).sort(),
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/offers", async (req, res, next) => {
    try {
      const graph = await loadCatalogGraph(req.catalystApp);
      const zcql = req.catalystApp.zcql();
      const coupons = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, title, code, description, discount_type, discount_value FROM Coupons WHERE is_active = true"
        ),
        "Coupons"
      );
      sendOk(res, {
        offers: coupons.map((row) => ({
          id: String(row.ROWID),
          name: row.title || row.code || "",
          slug: String(row.code || "").toLowerCase(),
          offer_kind: row.discount_type || "CAMPAIGN",
          discount_type: row.discount_type || "",
          discount_value: num(row.discount_value),
          description: row.description || "",
        })),
        offer_categories: graph.categories
          .filter((row) => String(row.category_type) === "OFFER")
          .map(mapCategory),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/products", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const pageSize = normalizeLimit(req.query.limit || req.query.page_size || 24);
      const cursor = optionalText(req.query.cursor, "cursor", 512) || null;
      const legacyPage = Math.max(1, Number(req.query.page || 1));
      if (!cursor && legacyPage > 1) {
        const error = new Error(
          "Offset pagination is deprecated. Pass cursor from the previous response pagination.next_cursor."
        );
        error.status = 400;
        error.code = "CURSOR_REQUIRED";
        throw error;
      }

      const brandRows = rowsOf(
        await zcql.executeZCQLQuery(
          "SELECT ROWID, name, slug, logo_url, banner_url, description, rating, review_count FROM Brands WHERE is_active = true"
        ),
        "Brands"
      );
      const brandById = {};
      brandRows.forEach((brand) => {
        brandById[String(brand.ROWID)] = brand;
      });

      let categoryFilterIds = null;
      let linkedProductIds = null;
      if (req.query.category_id) {
        const allCategoryRows = rowsOf(
          await zcql.executeZCQLQuery(categorySelect()),
          "Categories"
        );
        categoryFilterIds = Array.from(
          descendantIdSet(allCategoryRows, asId(req.query.category_id, "category_id"))
        );
        linkedProductIds = Array.from(
          await linkedProductIdsForCategories(req.catalystApp, categoryFilterIds)
        );
      }

      const filters = {
        brandId: req.query.brand_id ? asId(req.query.brand_id, "brand_id") : null,
        categoryIds: categoryFilterIds,
        linkedProductIds: linkedProductIds && linkedProductIds.length ? linkedProductIds : null,
        search: optionalText(req.query.search, "search", 80) || null,
        minPrice: Number(req.query.min_price),
        maxPrice: Number(req.query.max_price),
        gender: String(req.query.gender || "").trim().slice(0, 40) || null,
        ageGroup: String(req.query.age_group || "").trim().slice(0, 40) || null,
      };

      const sort = String(req.query.sort || "").trim() || "featured";
      const minDiscount = Number(req.query.min_discount);
      const minRating = Number(req.query.min_rating);
      const inStockOnly = isTruthy(req.query.in_stock);
      const needsRatings = sort === "popularity" || minRating > 0;
      const ratingMap = needsRatings ? await productRatingMap(zcql) : {};

      async function applyPostFilters(rows) {
        let working = rows.slice();
        working.forEach((row) => {
          const brand = row.brand_id ? brandById[String(row.brand_id)] : null;
          if (brand) {
            row.brand_name = brand.name;
          }
          row.rating = ratingMap[String(row.ROWID)] || 0;
        });
        working = await attachAvailabilityBatch(
          req.catalystApp,
          working,
          catalogLocationOptions(req)
        );
        if (Number.isFinite(minDiscount) && minDiscount > 0) {
          working = working.filter((row) => discountPercent(row) >= minDiscount);
        }
        if (Number.isFinite(minRating) && minRating > 0) {
          working = working.filter((row) => num(row.rating) >= minRating);
        }
        if (inStockOnly) {
          working = working.filter((row) => num(row.available_quantity) > 0);
        }
        if (sort === "popularity") {
          working.sort(
            (a, b) =>
              num(b.rating) - num(a.rating) ||
              Number(b.is_featured === true) - Number(a.is_featured === true)
          );
        }
        return working;
      }

      const pageResult = await fetchProductListPageWithPostFilters(
        zcql,
        filters,
        { limit: pageSize, cursor, sort: sort === "popularity" ? "featured" : sort },
        { applyPostFilters, maxScans: 30 }
      );

      sendOk(res, {
        products: pageResult.rows.map(mapProduct),
        pagination: {
          page_size: pageSize,
          limit: pageSize,
          has_more: pageResult.has_more,
          next_cursor: pageResult.next_cursor,
          cursor: cursor || null,
          queries_executed: pageResult.queries_executed,
          rows_fetched: pageResult.rows_fetched,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/v1/catalog/search", async (req, res, next) => {
    try {
      const q = optionalText(req.query.q || req.query.search, "q", 80);
      if (!q || q.length < 2) {
        const error = new Error("Search phrase must be at least 2 characters long");
        error.status = 400;
        throw error;
      }

      // Prefer Search_Documents index when populated; fall back to in-memory graph.
      try {
        const indexed = await searchIndexed(req.catalystApp, q, {
          page: Number(req.query.page || 1),
          limit: Number(req.query.page_size || req.query.limit || 24),
          filters: {
            brand_id: req.query.brand_id || "",
            category: req.query.category || "",
            min_price: req.query.min_price,
            max_price: req.query.max_price,
            in_stock: req.query.in_stock,
          },
        });
        const syntheticRows = indexed.products.map((item) => ({
          ROWID: item.id,
          name: item.name,
          slug: item.slug,
          sku: item.sku,
          category_id: "",
          brand_id: item.brand_id,
          product_type: item.product_type,
          short_description: "",
          description: "",
          brand_name: item.brand_name,
          mrp: item.mrp,
          selling_price: item.selling_price,
          currency: "INR",
          tax_percent: 0,
          thumbnail_url: "",
          has_variants: true,
          is_featured: item.is_featured,
          status: "ACTIVE",
        }));
        const withAvail = await attachAvailabilityBatch(
          req.catalystApp,
          syntheticRows,
          catalogLocationOptions(req)
        );
        const products = withAvail.map((row) => mapProduct(row));
        sendOk(res, {
          query: q,
          normalized_query: indexed.query,
          suggestions: indexed.suggestions,
          did_you_mean: indexed.did_you_mean,
          categories: indexed.related_categories,
          brands: [],
          products,
          related_searches: indexed.trending,
          filters: {},
          pagination: {
            page: indexed.page,
            page_size: indexed.limit,
            total: indexed.total,
          },
          results_count: indexed.total,
          source: "search_documents",
        });
        return;
      } catch (_) {
        // Bounded ZCQL fallback — never load full catalog into memory.
      }

      const zcql = req.catalystApp.zcql();
      const pageSize = normalizeLimit(req.query.page_size || req.query.limit || 24);
      const cursor = optionalText(req.query.cursor, "cursor", 512) || null;
      const legacyPage = Math.max(1, Number(req.query.page || 1));
      if (!cursor && legacyPage > 1) {
        const error = new Error(
          "Offset pagination is deprecated. Pass cursor from the previous response pagination.next_cursor."
        );
        error.status = 400;
        error.code = "CURSOR_REQUIRED";
        throw error;
      }

      let categoryFilterIds = null;
      if (req.query.category_id) {
        const allCategoryRows = rowsOf(
          await zcql.executeZCQLQuery(categorySelect()),
          "Categories"
        );
        categoryFilterIds = Array.from(
          descendantIdSet(allCategoryRows, asId(req.query.category_id, "category_id"))
        );
      }

      const filters = {
        brandId: req.query.brand_id ? asId(req.query.brand_id, "brand_id") : null,
        categoryIds: categoryFilterIds,
        search: q,
        minPrice: Number(req.query.min_price),
        maxPrice: Number(req.query.max_price),
      };

      const pageResult = await fetchProductListPageWithPostFilters(
        zcql,
        filters,
        { limit: pageSize, cursor, sort: "featured" },
        {
          applyPostFilters: async (rows) =>
            attachAvailabilityBatch(req.catalystApp, rows, catalogLocationOptions(req)),
          maxScans: 15,
        }
      );

      sendOk(res, {
        query: q,
        normalized_query: normalizeQuery(q),
        suggestions: [],
        did_you_mean: [],
        categories: [],
        brands: [],
        products: pageResult.rows.map(mapProduct),
        related_searches: [],
        filters: {},
        pagination: {
          page_size: pageSize,
          has_more: pageResult.has_more,
          next_cursor: pageResult.next_cursor,
          queries_executed: pageResult.queries_executed,
          rows_fetched: pageResult.rows_fetched,
        },
        results_count: pageResult.rows.length,
        source: "products_zcql",
      });
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
      const locationOpts = catalogLocationOptions(req);
      const product = await attachAvailability(req.catalystApp, row, locationOpts);
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
      let variantsWithAvailability = [];
      if (variants.length) {
        const variantBatch = await buildCatalogAvailabilityBatch(req.catalystApp, {
          items: variants.map((variant) => ({
            product_id: id,
            variant_id: asId(variant.ROWID, "variant_id"),
            quantity: 1,
          })),
          latitude: locationOpts.latitude,
          longitude: locationOpts.longitude,
        });
        const availabilityByVariant = new Map(
          variantBatch.items.map((item) => [String(item.variant_id || ""), item])
        );
        variantsWithAvailability = variants.map((variant) => {
          const availability =
            availabilityByVariant.get(String(variant.ROWID)) || {};
          return {
            ...variant,
            ...availability,
          };
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

  app.get("/v1/catalog/sync/zoho-books/status", async (req, res, next) => {
    try {
      sendOk(res, {
        service: "Zoho Books Product Sync",
        is_configured: false,
        shop_source: "CATALYST_DATASTORE",
        disconnected: true,
        instructions:
          "Zoho Books is disconnected from Shop. Add products and images manually in Catalyst Data Store.",
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/v1/catalog/sync/zoho-books", async (req, res, next) => {
    const error = new Error(
      "Zoho Books is disconnected from Shop. Add catalog data manually."
    );
    error.status = 409;
    next(error);
  });

  app.post("/v1/webhooks/zoho-books", async (req, res, next) => {
    try {
      sendOk(res, {
        received: true,
        ignored: true,
        reason: "Zoho Books is disconnected from Shop",
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = catalogRoutes;
module.exports.discountPercent = discountPercent;
