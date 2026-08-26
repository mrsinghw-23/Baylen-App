const { asId, optionalText, rowOf, rowsOf, num, sendOk, sqlString } = require("../lib/http");

function currentMonthYear() {
  const date = new Date();
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function mapGalleryItem(row) {
  return {
    id: String(row.ROWID),
    title: row.title || "Baylen Beauty Picks",
    subtitle: row.subtitle || row.description || "Featured products for daily glow",
    image_url: row.image_url || "",
    video_url: row.video_url || "",
    month: row.month || currentMonthYear(),
    action_type: row.action_type || "TAB",
    action_value: row.action_value || "0",
    cta_label: row.cta_label || "Book Now",
    display_order: num(row.display_order),
    is_active: row.is_active === true || row.is_active === "true" || row.is_active === 1,
    created_at: row.CREATEDTIME || "",
  };
}

function galleryRoutes(app) {
  // Public: Get active gallery/banner items for current or specified month
  app.get("/v1/gallery", async (req, res, next) => {
    try {
      const zcql = req.catalystApp.zcql();
      const monthFilter = optionalText(req.query.month, "month", 50);

      let query = "SELECT ROWID, title, subtitle, image_url, video_url, action_type, action_value, display_order, is_active, CREATEDTIME FROM Home_Banners WHERE is_active = true";

      let rows = [];
      try {
        const result = await zcql.executeZCQLQuery(query);
        rows = rowsOf(result, "Home_Banners");
      } catch (err) {
        // Return empty array if table not yet populated
        rows = [];
      }

      let items = rows.map(mapGalleryItem);

      if (items.length === 0) {
        items = [
          {
            id: "gallery_aug_1",
            title: "STRAIGHTENING DAY",
            subtitle: "Flat 30% OFF â€¢ Every 24th of the Month",
            image_url: "assets/gallery/2026/August/straightening-day.png",
            month: "August 2026",
            action_type: "SALON",
            action_value: "0",
            cta_label: "Book Straightening",
            display_order: 1,
            is_active: true,
            created_at: new Date().toISOString(),
          },
          {
            id: "gallery_aug_2",
            title: "HAIR SPA DAY",
            subtitle: "30% OFF â€¢ Nourish, Repair & Revive",
            image_url: "assets/gallery/2026/August/hair-spa-day.png",
            month: "August 2026",
            action_type: "SALON",
            action_value: "0",
            cta_label: "Book Hair Spa",
            display_order: 2,
            is_active: true,
            created_at: new Date().toISOString(),
          },
          {
            id: "gallery_aug_3",
            title: "FEEL LIKE YOURSELF",
            subtitle: "Premium Hair, Beauty, Makeup & Nails",
            image_url: "assets/gallery/2026/August/feel-like-yourself.jpg",
            month: "August 2026",
            action_type: "SERVICE",
            action_value: "0",
            cta_label: "Explore Services",
            display_order: 3,
            is_active: true,
            created_at: new Date().toISOString(),
          },
        ];
      }

      if (monthFilter) {
        items = items.filter(item => item.month.toLowerCase() === monthFilter.toLowerCase());
      }

      items.sort((a, b) => a.display_order - b.display_order);

      sendOk(res, {
        current_month: currentMonthYear(),
        gallery_items: items,
      });
    } catch (error) {
      next(error);
    }
  });

  // Admin / Backend: Add or Update Gallery Item with Folder path metadata
  app.post("/v1/gallery", async (req, res, next) => {
    try {
      const {
        title,
        subtitle,
        image_url,
        month,
        action_type,
        action_value,
        cta_label,
        display_order,
        is_active,
      } = req.body;

      const targetMonth = month || currentMonthYear();
      const folderPath = `Gallery/${new Date().getFullYear()}/${targetMonth.split(" ")[0] || "General"}`;

      const table = req.catalystApp.datastore().table("Home_Banners");
      const inserted = await table.insertRow({
        title: title || "Baylen Beauty Picks",
        subtitle: subtitle || "Featured products for daily glow",
        image_url: image_url || "",
        video_url: "",
        action_type: action_type || "TAB",
        action_value: String(action_value || "0"),
        display_order: num(display_order) || 1,
        is_active: is_active !== false,
      });

      sendOk(res, {
        success: true,
        gallery_item: mapGalleryItem(inserted),
        storage_folder: folderPath,
      }, 201);
    } catch (error) {
      next(error);
    }
  });
}

module.exports = galleryRoutes;
module.exports.mapGalleryItem = mapGalleryItem;
