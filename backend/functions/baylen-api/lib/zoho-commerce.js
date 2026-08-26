const { num } = require("./http");

const DEFAULT_API_BASE = "https://commerce.zoho.com";
const DEFAULT_ACCOUNTS_URL = "https://accounts.zoho.com/oauth/v2/token";

function commerceConfig() {
  const enabled = String(process.env.ZOHO_COMMERCE_ENABLED || "")
    .trim()
    .toLowerCase();
  return {
    enabled: enabled === "true" || enabled === "1" || enabled === "yes",
    connectionLinkName:
      process.env.ZOHO_COMMERCE_CONNECTION_LINK_NAME ||
      "zoho_commerce_connection",
    connectorName: process.env.ZOHO_COMMERCE_CONNECTOR_NAME || "ZOHO_COMMERCE",
    organizationId: process.env.ZOHO_COMMERCE_ORGANIZATION_ID || "",
    clientId: process.env.ZOHO_COMMERCE_CLIENT_ID || "",
    clientSecret: process.env.ZOHO_COMMERCE_CLIENT_SECRET || "",
    refreshToken: process.env.ZOHO_COMMERCE_REFRESH_TOKEN || "",
    authUrl: process.env.ZOHO_COMMERCE_AUTH_URL || DEFAULT_ACCOUNTS_URL,
    refreshUrl: process.env.ZOHO_COMMERCE_REFRESH_URL || DEFAULT_ACCOUNTS_URL,
    apiBase: (process.env.ZOHO_COMMERCE_API_BASE || DEFAULT_API_BASE).replace(
      /\/$/,
      ""
    ),
    storefrontDomain:
      process.env.ZOHO_COMMERCE_STOREFRONT_DOMAIN ||
      process.env.ZOHO_COMMERCE_DOMAIN ||
      process.env.ZOHO_COMMERCE_STORE_DOMAIN ||
      "www.baylende.com",
    maxPages: Math.min(
      Math.max(parseInt(process.env.ZOHO_COMMERCE_MAX_PAGES || "5", 10), 1),
      25
    ),
  };
}

function isCommerceConfigured(config) {
  return Boolean(
    config.enabled &&
      config.organizationId &&
      (config.connectionLinkName ||
        (config.clientId && config.clientSecret && config.refreshToken))
  );
}

async function commerceAccessToken(req, config) {
  if (config.connectionLinkName) {
    const credentials = await req.catalystApp
      .connections()
      .getConnectionCredentials(config.connectionLinkName);
    const headers = credentials.headers || {};
    const authorization =
      headers.Authorization || headers.authorization || headers.AUTHORIZATION || "";
    const token = String(authorization)
      .replace(/^Zoho-oauthtoken\s+/i, "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (token) {
      return token;
    }
    if (credentials.parameters && credentials.parameters.access_token) {
      return credentials.parameters.access_token;
    }
    const error = new Error("Zoho Commerce connection did not return an access token");
    error.status = 503;
    throw error;
  }

  const connector = req.catalystApp
    .connection({
      [config.connectorName]: {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        auth_url: config.authUrl,
        refresh_url: config.refreshUrl,
        refresh_token: config.refreshToken,
      },
    })
    .getConnector(config.connectorName);
  return connector.getAccessToken();
}

async function commerceGet(req, path, query = {}) {
  const config = commerceConfig();
  if (!isCommerceConfigured(config)) {
    const error = new Error("Zoho Commerce is not configured");
    error.status = 503;
    throw error;
  }

  const token = await commerceAccessToken(req, config);
  const url = new URL(`${config.apiBase}${path}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "X-com-zoho-store-organizationid": config.organizationId,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (body.code !== undefined && Number(body.code) !== 0)) {
    const error = new Error(body.message || "Zoho Commerce request failed");
    error.status = response.status || 502;
    throw error;
  }
  return body;
}

function commerceProductId(id) {
  const raw = String(id || "").trim();
  return raw.startsWith("commerce:") ? raw.slice("commerce:".length) : raw;
}

function firstVariant(product) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return variants[0] || {};
}

function storefrontBaseUrl() {
  const config = commerceConfig();
  const domain = String(config.storefrontDomain || "").trim();
  if (!domain) {
    return "";
  }
  return domain.startsWith("http://") || domain.startsWith("https://")
    ? domain.replace(/\/$/, "")
    : `https://${domain.replace(/\/$/, "")}`;
}

function absoluteCommerceImageUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  const baseUrl = storefrontBaseUrl();
  if (!baseUrl) {
    return "";
  }
  return `${baseUrl}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function imageDocumentUrl(item) {
  const documentId = String(
    (item && (item.document_id || item.image_id || item.id)) || ""
  ).trim();
  if (!documentId || documentId === "-1") {
    return "";
  }
  return absoluteCommerceImageUrl(`/product-images/${documentId}`);
}

function imageCandidates(product) {
  const docs = Array.isArray(product.documents) ? product.documents : [];
  const images = Array.isArray(product.images) ? product.images : [];
  const variant = firstVariant(product);
  const variantDocs = Array.isArray(variant.documents) ? variant.documents : [];
  const variantImages = Array.isArray(variant.images) ? variant.images : [];

  return [
    product.image_url,
    product.thumbnail_url,
    product.product_image_url,
    ...images.map((item) => item && item.url),
    ...variantImages.map((item) => item && item.url),
    ...docs.map(imageDocumentUrl),
    ...variantDocs.map(imageDocumentUrl),
    imageDocumentUrl(product),
  ];
}

function firstImage(product) {
  for (const candidate of imageCandidates(product)) {
    const url = absoluteCommerceImageUrl(candidate);
    if (url) {
      return url;
    }
  }
  return "";
}

function mapCommerceProduct(product) {
  const variant = firstVariant(product);
  const productId = String(product.product_id || product.id || "");
  const sellingPrice = num(
    product.selling_price ||
      product.min_rate ||
      product.rate ||
      variant.selling_price ||
      variant.rate
  );
  const mrp =
    num(product.label_price || product.max_rate || variant.label_rate) ||
    sellingPrice;
  const availableQuantity = num(
    product.overall_stock ||
      product.stock_available ||
      variant.available_stock ||
      variant.available_sale_stock ||
      variant.stock_on_hand
  );

  return {
    id: `commerce:${productId}`,
    external_source: "ZOHO_COMMERCE",
    external_id: productId,
    name: product.name || "",
    slug: product.url || productId,
    sku: variant.sku || product.sku || "",
    category_id: product.category_id ? String(product.category_id) : "",
    brand_id: product.brand_id ? String(product.brand_id) : "",
    product_type: product.product_type || "goods",
    short_description:
      product.product_short_description || product.short_description || "",
    description:
      product.product_description || product.description || product.short_description || "",
    brand_name: product.brand || product.manufacturer || "",
    mrp,
    selling_price: sellingPrice,
    currency: product.currency || "INR",
    tax_percent: num(product.tax_percentage || product.tax_percent),
    thumbnail_url: firstImage(product),
    has_variants:
      product.has_variant === true ||
      product.has_variant === "true" ||
      num(product.variant_count) > 1,
    is_featured: product.is_featured === true || product.is_featured === "true",
    available_quantity: availableQuantity,
    status: String(product.status || "active").toUpperCase(),
  };
}

function mapCommerceVariant(product, variant) {
  const productId = String(product.product_id || product.id || "");
  const variantId = String(variant.variant_id || variant.id || productId);
  const sellingPrice = num(variant.selling_price || variant.rate);
  return {
    id: `commerce:${variantId}`,
    product_id: `commerce:${productId}`,
    sku: variant.sku || "",
    variant_name:
      variant.attribute_option_name1 ||
      variant.attribute_name1 ||
      variant.name ||
      "",
    variant_value:
      variant.attribute_option_data1 ||
      variant.attribute_option_name1 ||
      "",
    mrp: num(variant.label_rate) || sellingPrice,
    selling_price: sellingPrice,
    currency: product.currency || "INR",
    available_quantity: num(
      variant.available_stock ||
        variant.available_sale_stock ||
        variant.stock_on_hand
    ),
  };
}

function mapCommerceMedia(product) {
  const docs = Array.isArray(product.documents) ? product.documents : [];
  const images = Array.isArray(product.images) ? product.images : [];
  const media = [
    ...images.map((item, index) => ({
      source: item,
      url: absoluteCommerceImageUrl(item && item.url),
      order: item && (item.order || item.attachment_order || index),
    })),
    ...docs.map((item, index) => ({
      source: item,
      url: imageDocumentUrl(item),
      order: item && (item.attachment_order || item.order || index),
    })),
  ];

  return media
    .filter((item) => item.url)
    .map((item, index) => ({
      id: String(item.source.document_id || item.source.image_id || item.source.id || index),
      product_id: `commerce:${product.product_id || product.id || ""}`,
      variant_id: "",
      media_type: "IMAGE",
      file_url: item.url,
      display_order: num(item.order || index),
    }));
}

function sortCommerceProducts(products, sort) {
  const sorted = [...products];
  if (sort === "price_low") {
    sorted.sort((a, b) => num(a.selling_price) - num(b.selling_price));
  } else if (sort === "price_high") {
    sorted.sort((a, b) => num(b.selling_price) - num(a.selling_price));
  } else if (sort === "newest") {
    sorted.sort((a, b) => String(b.external_id).localeCompare(String(a.external_id)));
  } else {
    sorted.sort((a, b) => Number(b.is_featured) - Number(a.is_featured));
  }
  return sorted;
}

async function listCommerceProducts(req, options = {}) {
  const config = commerceConfig();
  if (!isCommerceConfigured(config)) {
    return null;
  }

  const allProducts = [];
  for (let page = 1; page <= config.maxPages; page += 1) {
    const body = await commerceGet(req, "/store/api/v1/products", {
      filter_by: "Status.Active",
      per_page: 200,
      page_start_from: page,
      sort_column: "last_modified_time",
      sort_order: "D",
    });
    const products = Array.isArray(body.products) ? body.products : [];
    allProducts.push(...products);
    if (!body.page_context || body.page_context.has_more_page === false) {
      break;
    }
  }

  const search = String(options.search || "").trim().toLowerCase();
  let mapped = allProducts.map(mapCommerceProduct).filter((product) => product.external_id);
  if (search) {
    mapped = mapped.filter((product) =>
      [
        product.name,
        product.sku,
        product.short_description,
        product.description,
        product.brand_name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }
  if (options.brandId) {
    mapped = mapped.filter((product) => product.brand_id === String(options.brandId));
  }
  if (options.categoryId) {
    mapped = mapped.filter((product) => product.category_id === String(options.categoryId));
  }
  return sortCommerceProducts(mapped, options.sort);
}

async function getCommerceProductDetail(req, id) {
  const productId = commerceProductId(id);
  const body = await commerceGet(req, "/store/api/v1/products/editpage", {
    product_id: productId,
  });
  const product = body.product || {};
  const variants = Array.isArray(product.variants)
    ? product.variants
    : Array.isArray(product.items)
      ? product.items
      : [];

  return {
    product: mapCommerceProduct({ ...product, product_id: productId }),
    brand:
      product.brand || product.manufacturer
        ? {
            id: product.brand_id ? String(product.brand_id) : "",
            name: product.brand || product.manufacturer || "",
            slug: "",
            logo_url: "",
            banner_url: "",
            description: "",
            rating: 0,
            review_count: 0,
          }
        : null,
    variants: variants.map((variant) => mapCommerceVariant(product, variant)),
    media: mapCommerceMedia(product),
  };
}

function commerceEnabled() {
  return isCommerceConfigured(commerceConfig());
}

module.exports = {
  commerceEnabled,
  commerceProductId,
  getCommerceProductDetail,
  listCommerceProducts,
};
