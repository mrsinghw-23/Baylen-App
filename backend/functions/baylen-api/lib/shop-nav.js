const { activeRows } = require("./paged");
const { slugify } = require("../data/shop-taxonomy");

const PUBLIC_MENU_ROOTS = [
  "makeup",
  "skin",
  "hair",
  "appliances",
  "bath-and-body",
  "natural",
  "mom-and-baby",
  "health-and-wellness",
  "men",
  "fragrance",
  "fashion-selects",
  "offers",
];

function byParent(rows) {
  const map = {};
  rows.forEach((row) => {
    const parent = row.parent_category_id ? String(row.parent_category_id) : "";
    if (!map[parent]) map[parent] = [];
    map[parent].push(row);
  });
  Object.keys(map).forEach((key) => {
    map[key].sort(
      (a, b) =>
        Number(a.display_order || 0) - Number(b.display_order || 0) ||
        String(a.name || "").localeCompare(String(b.name || ""))
    );
  });
  return map;
}

function mapNavItem(row, extra = {}) {
  const type = String(row.category_type || "PRODUCT");
  return {
    id: String(row.ROWID),
    title: row.name,
    slug: row.slug,
    kind: type,
    target_type: extra.target_type || type,
    target_slug: extra.target_slug || row.slug,
    category_id: String(row.ROWID),
    brand_id: extra.brand_id || null,
    query: type === "TRENDING" || type === "QUICK_LINK" ? row.name : "",
    href: extra.href || String(row.description || ""),
    display_order: Number(row.display_order || 0),
  };
}

function buildNavigation(categoryRows, brandRows) {
  const rows = activeRows(categoryRows).filter((row) => String(row.category_type) !== "SYNONYM");
  const children = byParent(rows);
  const brands = activeRows(brandRows);
  const brandBySlug = {};
  const brandByName = {};
  brands.forEach((brand) => {
    brandBySlug[String(brand.slug || "").toLowerCase()] = brand;
    brandByName[String(brand.name || "").toLowerCase()] = brand;
  });

  const hubs = (children[""] || [])
    .filter((hub) => PUBLIC_MENU_ROOTS.includes(String(hub.slug || "")))
    .sort(
      (a, b) =>
        PUBLIC_MENU_ROOTS.indexOf(String(a.slug || "")) -
        PUBLIC_MENU_ROOTS.indexOf(String(b.slug || ""))
    )
    .map((hub, hubIndex) => {
    const sections = (children[String(hub.ROWID)] || []).map((section, sectionIndex) => {
      const seenItems = new Set();
      const items = (children[String(section.ROWID)] || []).filter((item) => {
        const key = `${String(item.category_type || "PRODUCT")}:${String(item.name || "").toLowerCase()}`;
        if (seenItems.has(key)) {
          return false;
        }
        seenItems.add(key);
        return true;
      }).map((item) => {
        const brand =
          brandBySlug[slugify(item.name)] || brandByName[String(item.name || "").toLowerCase()];
        return mapNavItem(item, {
          target_type: String(item.category_type || "PRODUCT"),
          target_slug: brand ? brand.slug : item.slug,
          brand_id: brand ? String(brand.ROWID) : null,
        });
      });
      return {
        id: String(section.ROWID),
        title: section.name,
        slug: section.slug,
        kind: String(section.category_type || "PRODUCT"),
        column_index: sectionIndex % 4,
        items: items.length ? items : [mapNavItem(section)],
      };
    });
    return {
      id: String(hub.ROWID),
      name: hub.name,
      slug: hub.slug,
      kind: String(hub.category_type || "PRODUCT"),
      display_order: hubIndex + 1,
      href: String(hub.description || `/${hub.slug}`),
      sections,
    };
  });

  return { menus: hubs, count: hubs.length };
}

module.exports = { buildNavigation, byParent, PUBLIC_MENU_ROOTS };
