const { slugify } = require("../data/shop-taxonomy");

const STOP_WORDS = new Set(["for", "and", "the", "with", "a", "an", "of", "to", "in", "on"]);

const BUILTIN_ALIASES = {
  facewash: "face wash",
  "face-wash": "face wash",
  moisturiser: "moisturizer",
  hairfall: "hair fall",
  "hair-fall": "hair fall",
  lipstick: "lipstick",
  "lip stick": "lipstick",
  bodywash: "body wash",
  "body-wash": "body wash",
  "anti aging": "anti ageing",
  "anti-aging": "anti ageing",
  "anti-ageing": "anti ageing",
  deodorant: "deodorant",
  deo: "deodorant",
  perfume: "fragrance",
  scent: "fragrance",
  shampoo: "shampoo",
  conditioner: "conditioner",
  serum: "serum",
  kajal: "kajal",
  kohl: "kajal",
  sunscreen: "sunscreen",
  "sun screen": "sunscreen",
  eyeliner: "eyeliner",
  "eye liner": "eyeliner",
};

function normalizeQuery(value) {
  let text = String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (BUILTIN_ALIASES[text]) {
    text = BUILTIN_ALIASES[text];
  }
  return text;
}

function tokenize(value) {
  return normalizeQuery(value)
    .split(" ")
    .filter((token) => token && !STOP_WORDS.has(token));
}

function expandWithSynonyms(query, synonymRows) {
  const normalized = normalizeQuery(query);
  const aliases = new Set([normalized, ...tokenize(query)]);
  (synonymRows || []).forEach((row) => {
    const term = normalizeQuery(row.name || row.term);
    const mapsTo = normalizeQuery(row.slug || row.maps_to || row.description);
    if (!term || !mapsTo) {
      return;
    }
    if (normalized.includes(term) || term.includes(normalized)) {
      aliases.add(mapsTo.replace(/-/g, " "));
      aliases.add(term);
    }
  });
  Object.keys(BUILTIN_ALIASES).forEach((alias) => {
    if (normalized.includes(alias) || alias.includes(normalized)) {
      aliases.add(BUILTIN_ALIASES[alias]);
    }
  });
  return Array.from(aliases).filter(Boolean);
}

function scoreMatch(haystack, needles) {
  const text = String(haystack || "").toLowerCase();
  let score = 0;
  needles.forEach((needle) => {
    if (!needle) return;
    if (text === needle) score += 100;
    else if (text.startsWith(needle)) score += 60;
    else if (text.includes(needle)) score += 30;
  });
  return score;
}

function detectIntent(needles, categories, brands) {
  const intent = {
    categories: [],
    brands: [],
    concerns: [],
    skinTypes: [],
    hairTypes: [],
    fragranceFamilies: [],
    priceMax: null,
  };
  needles.forEach((needle) => {
    const under = needle.match(/under\s+(\d{3,6})/);
    if (under) {
      intent.priceMax = Number(under[1]);
    }
  });
  const joined = needles.join(" ");
  (categories || []).forEach((category) => {
    const name = String(category.name || "").toLowerCase();
    const slug = String(category.slug || "").replace(/-/g, " ");
    const type = String(category.category_type || "PRODUCT");
    if (!needles.some((needle) => name.includes(needle) || slug.includes(needle) || needle.includes(name))) {
      if (!(joined.includes(name) || joined.includes(slug))) {
        return;
      }
    }
    if (type === "CONCERN") intent.concerns.push(category);
    else if (type === "SKIN_TYPE") intent.skinTypes.push(category);
    else if (type === "HAIR_TYPE") intent.hairTypes.push(category);
    else if (type === "FRAGRANCE") intent.fragranceFamilies.push(category);
    else if (type !== "SYNONYM") intent.categories.push(category);
  });
  (brands || []).forEach((brand) => {
    const name = String(brand.name || "").toLowerCase();
    if (needles.some((needle) => name.includes(needle) || needle.includes(name))) {
      intent.brands.push(brand);
    }
  });
  return intent;
}

function rankProducts({ products, categories, brands, needles, intent, descendantIds }) {
  const brandById = {};
  (brands || []).forEach((brand) => {
    brandById[String(brand.ROWID)] = brand;
  });
  const categoryById = {};
  (categories || []).forEach((category) => {
    categoryById[String(category.ROWID)] = category;
  });
  return products
    .map((product) => {
      const brand = product.brand_id ? brandById[String(product.brand_id)] : null;
      const category = product.category_id ? categoryById[String(product.category_id)] : null;
      const name = String(product.name || "").toLowerCase();
      let score = scoreMatch(name, needles);
      if (category) {
        score += Math.round(scoreMatch(category.name, needles) * 0.8);
      }
      if (brand) {
        score += Math.round(scoreMatch(brand.name, needles) * 0.7);
      }
      score += Math.round(
        scoreMatch(
          [product.short_description, product.description, product.sku].filter(Boolean).join(" "),
          needles
        ) * 0.15
      );
      if (intent.categories.some((item) => descendantIds(item.ROWID).has(String(product.category_id)))) {
        score += 50;
      }
      if (intent.brands.some((item) => String(item.ROWID) === String(product.brand_id))) {
        score += 45;
      }
      if (intent.priceMax && Number(product.selling_price) > intent.priceMax) {
        score -= 40;
      }
      return { product, brand, category, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.product.name).localeCompare(String(b.product.name)));
}

function suggestionsFor(query, { categories, brands, products }) {
  const needle = normalizeQuery(query);
  if (needle.length < 2) {
    return [];
  }
  const out = [];
  (categories || []).forEach((row) => {
    const name = String(row.name || "");
    if (name.toLowerCase().includes(needle) && String(row.category_type) !== "SYNONYM") {
      out.push({ type: "category", id: String(row.ROWID), name, slug: row.slug });
    }
  });
  (brands || []).forEach((row) => {
    const name = String(row.name || "");
    if (name.toLowerCase().includes(needle)) {
      out.push({ type: "brand", id: String(row.ROWID), name, slug: row.slug });
    }
  });
  (products || []).slice(0, 200).forEach((row) => {
    const name = String(row.name || "");
    if (name.toLowerCase().includes(needle)) {
      out.push({ type: "product", id: String(row.ROWID), name, slug: row.slug });
    }
  });
  return out.slice(0, 12);
}

function slugFromName(name) {
  return slugify(name);
}

module.exports = {
  normalizeQuery,
  tokenize,
  expandWithSynonyms,
  detectIntent,
  rankProducts,
  suggestionsFor,
  slugFromName,
};
