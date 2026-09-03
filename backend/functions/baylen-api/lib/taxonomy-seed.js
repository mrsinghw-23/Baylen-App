const { TAXONOMY, slugify, brandName } = require("../data/shop-taxonomy");
const { fetchAllTableRows } = require("./paged");
const { insertedRowId, isTruthy } = require("./http");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bulkInsert(table, rows, existing) {
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const inserted = await table.insertRows(batch);
    const list = Array.isArray(inserted) ? inserted : [inserted];
    list.forEach((row) => {
      const nested = row && typeof row === "object" && !row.ROWID ? Object.values(row)[0] : row;
      if (nested && nested.ROWID) {
        existing.push(nested);
      }
    });
    await sleep(50);
  }
}

function findBySlug(existing, slug) {
  return existing.find((item) => String(item.slug || "").toLowerCase() === String(slug).toLowerCase());
}

function duplicateKey(row) {
  return [
    String(row.parent_category_id || ""),
    String(row.category_type || "PRODUCT"),
    String(row.name || "").trim().toLowerCase(),
  ].join("|");
}

async function seedTaxonomy(app) {
  const categoryTable = app.datastore().table("Categories");
  const brandTable = app.datastore().table("Brands");
  const couponTable = app.datastore().table("Coupons");
  const categories = await fetchAllTableRows(app, "Categories");
  const brands = await fetchAllTableRows(app, "Brands");
  const coupons = await fetchAllTableRows(app, "Coupons");
  const stats = {
    hubs: 0,
    sections: 0,
    items: 0,
    brands: 0,
    coupons: 0,
    synonyms: 0,
    updated: 0,
    duplicates_disabled: 0,
  };

  async function ensure(payload) {
    const found = findBySlug(categories, payload.slug);
    if (found) {
      await categoryTable.updateRow({
        ROWID: found.ROWID,
        name: payload.name,
        description: payload.description,
        category_type: payload.category_type,
        parent_category_id: payload.parent_category_id || null,
        display_order: payload.display_order,
        is_active: "true",
      });
      found.name = payload.name;
      found.category_type = payload.category_type;
      found.parent_category_id = payload.parent_category_id;
      stats.updated += 1;
      return found;
    }
    const inserted = await categoryTable.insertRow(payload);
    const created = {
      ...payload,
      ROWID: insertedRowId(inserted),
    };
    categories.push(created);
    return created;
  }

  for (let hubIndex = 0; hubIndex < TAXONOMY.hubs.length; hubIndex += 1) {
    const hub = TAXONOMY.hubs[hubIndex];
    const hubRow = await ensure({
      name: hub.name,
      slug: hub.slug,
      description: `/${hub.slug}`,
      category_type: hub.kind === "OFFERS" ? "OFFER" : "PRODUCT",
      parent_category_id: null,
      image_url: "",
      display_order: hubIndex + 1,
      is_active: "true",
    });
    stats.hubs += 1;

    const sectionCreates = [];
    for (let sectionIndex = 0; sectionIndex < (hub.sections || []).length; sectionIndex += 1) {
      const section = hub.sections[sectionIndex];
      const sectionSlug = `${hub.slug}-${slugify(section.title)}`;
      const sectionType =
        section.kind === "BRAND" || section.kind === "CATEGORY" || section.kind === "COLLECTION"
          ? "PRODUCT"
          : section.kind;
      const existingSection = findBySlug(categories, sectionSlug);
      if (existingSection) {
        await ensure({
          name: section.title,
          slug: sectionSlug,
          description: `/${hub.slug}/${slugify(section.title)}`,
          category_type: sectionType,
          parent_category_id: hubRow.ROWID,
          display_order: sectionIndex + 1,
          is_active: "true",
        });
      } else {
        sectionCreates.push({
          name: section.title,
          slug: sectionSlug,
          description: `/${hub.slug}/${slugify(section.title)}`,
          category_type: sectionType,
          parent_category_id: hubRow.ROWID,
          image_url: "",
          display_order: sectionIndex + 1,
          is_active: "true",
        });
      }
      stats.sections += 1;
    }
    if (sectionCreates.length) {
      await bulkInsert(categoryTable, sectionCreates, categories);
    }
  }

  for (const hub of TAXONOMY.hubs) {
    const hubRow = findBySlug(categories, hub.slug);
    if (!hubRow) continue;
    const itemCreates = [];
    for (const section of hub.sections || []) {
      const sectionSlug = `${hub.slug}-${slugify(section.title)}`;
      const sectionRow = findBySlug(categories, sectionSlug);
      if (!sectionRow) continue;
      const items = section.items && section.items.length ? section.items : [section.title];
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const label = brandName(items[itemIndex]);
        const itemSlug = `${sectionSlug}-${slugify(label)}`;
        let itemType = "PRODUCT";
        if (section.kind === "BRAND") itemType = "BRAND_LINK";
        else if (section.kind === "CONCERN") itemType = "CONCERN";
        else if (section.kind === "SKIN_TYPE") itemType = "SKIN_TYPE";
        else if (section.kind === "HAIR_TYPE") itemType = "HAIR_TYPE";
        else if (section.kind === "FRAGRANCE_FAMILY") itemType = "FRAGRANCE";
        else if (section.kind === "TRENDING") itemType = "TRENDING";
        else if (section.kind === "QUICK_LINK") itemType = "QUICK_LINK";
        else if (section.kind === "COLLECTION") itemType = "COLLECTION";
        else if (section.kind === "OFFER") itemType = "OFFER";
        const payload = {
          name: label,
          slug: itemSlug,
          description: `/${hub.slug}/${slugify(section.title)}/${slugify(label)}`,
          category_type: itemType,
          parent_category_id: sectionRow.ROWID,
          image_url: "",
          display_order: itemIndex + 1,
          is_active: "true",
        };
        if (findBySlug(categories, itemSlug)) {
          await ensure(payload);
        } else {
          itemCreates.push(payload);
        }
        stats.items += 1;

        if (
          section.kind === "BRAND" &&
          !["Explore All", "Professional Brands", "Luxury Brand"].includes(label)
        ) {
          const brandSlug = slugify(label);
          const existingBrand = brands.find(
            (item) =>
              String(item.slug || "").toLowerCase() === brandSlug ||
              String(item.name || "").toLowerCase() === label.toLowerCase()
          );
          if (!existingBrand) {
            const inserted = await brandTable.insertRow({
              name: label,
              slug: brandSlug,
              description: label,
              logo_url: "",
              banner_url: "",
              website_url: "",
              display_order: brands.length + 1,
              is_active: "true",
              rating: 0,
              review_count: 0,
            });
            brands.push({ name: label, slug: brandSlug, ROWID: insertedRowId(inserted) });
            stats.brands += 1;
          }
        }

        if (section.kind === "OFFER") {
          const existingCoupon = coupons.find(
            (item) => String(item.title || "").toLowerCase() === label.toLowerCase()
          );
          if (!existingCoupon) {
            const inserted = await couponTable.insertRow({
              code: slugify(label).replace(/-/g, "_").slice(0, 40).toUpperCase(),
              title: label,
              description: label,
              discount_type: /percent/i.test(label)
                ? "PERCENT"
                : /flat/i.test(label)
                  ? "FLAT"
                  : "CAMPAIGN",
              discount_value: /bogo|buy/i.test(label) ? 100 : 0,
              min_order_value: 0,
              usage_limit: 0,
              is_active: "true",
            });
            coupons.push({ title: label, ROWID: insertedRowId(inserted) });
            stats.coupons += 1;
          }
        }
      }
    }
    if (itemCreates.length) {
      await bulkInsert(categoryTable, itemCreates, categories);
    }
  }

  const synonymCreates = [];
  for (const group of TAXONOMY.synonyms) {
    const canonical = group[1] || group[0];
    for (const term of group) {
      const slug = `syn-${slugify(term)}`;
      if (findBySlug(categories, slug)) continue;
      synonymCreates.push({
        name: term,
        slug,
        description: slugify(canonical),
        category_type: "SYNONYM",
        parent_category_id: null,
        image_url: "",
        display_order: 0,
        is_active: "true",
      });
      stats.synonyms += 1;
    }
  }
  if (synonymCreates.length) {
    await bulkInsert(categoryTable, synonymCreates, categories);
  }

  const groups = new Map();
  categories
    .filter((row) => isTruthy(row.is_active) || row.is_active === undefined)
    .forEach((row) => {
      const key = duplicateKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const orderDiff = Number(a.display_order || 0) - Number(b.display_order || 0);
      if (orderDiff) return orderDiff;
      return String(a.slug || "").length - String(b.slug || "").length;
    });
    for (const duplicate of group.slice(1)) {
      await categoryTable.updateRow({
        ROWID: duplicate.ROWID,
        is_active: "false",
      });
      duplicate.is_active = "false";
      stats.duplicates_disabled += 1;
    }
  }

  return {
    stats,
    counts: {
      categories: categories.filter((row) => isTruthy(row.is_active) || row.is_active === undefined).length,
      brands: brands.length,
      coupons: coupons.length,
    },
  };
}

module.exports = { seedTaxonomy };
