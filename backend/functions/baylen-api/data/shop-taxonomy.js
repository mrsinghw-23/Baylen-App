function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/@/g, "at")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function brandName(name) {
  return String(name || "").replace(/Nykaa/gi, "Baylen").replace(/Nykd By Baylen/g, "Nykd By Baylen");
}

function section(title, kind, items, extra = {}) {
  return { title, kind, items, ...extra };
}

const TAXONOMY = {
  hubs: [
    {
      name: "Makeup",
      slug: "makeup",
      kind: "CATEGORY",
      sections: [
        section("Face", "CATEGORY", [
          "Face Primer", "Concealer", "Foundation", "Compact", "Contour", "Loose Powder",
          "Tinted Moisturizer", "Blush", "Bronzer", "BB & CC Cream", "Highlighters",
          "Setting Spray", "Makeup Remover", "Sindoor",
        ]),
        section("Eyes", "CATEGORY", [
          "Kajal", "Eyeliner", "Mascara", "Eye Shadow", "Eye Brow Enhancers", "Eye Primer",
          "False Eyelashes", "Eye Makeup Remover", "Under Eye Concealer", "Contact Lenses",
        ]),
        section("Lips", "CATEGORY", [
          "Lipstick", "Liquid Lipstick", "Lip Crayon", "Lip Gloss", "Lip Liner", "Lip Plumper", "Lip Tint",
        ]),
        section("Nails", "CATEGORY", [
          "Nail Polish", "Nail Art Kits", "Nail Care", "Nail Polish Remover",
        ]),
        section("Tools & Brushes", "CATEGORY", [
          "Face Brush", "Eye Brush", "Lip Brush", "Brush Sets", "Brush Cleaners",
          "Sponges & Applicators", "Eyelash Curlers", "Tweezers", "Sharpeners", "Mirrors", "Makeup Pouches",
        ]),
        section("Makeup Kits & Combos", "COLLECTION", ["Makeup Kits", "Makeup Combos"]),
        section("Multi-Functional Makeup Palettes", "CATEGORY", ["Multi-Functional Makeup Palettes"]),
        section("Top Brands", "BRAND", [
          "Kay Beauty", "Huda Beauty", "Charlotte Tilbury", "M.A.C", "Maybelline New York",
          "L'Oreal Paris", "Lakme", "Baylen Cosmetics", "Nyx Pro.Makeup",
        ]),
        section("Quick Links", "QUICK_LINK", [
          "Combos @ Baylen", "New Launches", "Gifts @ Baylen", "The Gift Store",
        ]),
        section("Trending Searches", "TRENDING", [
          "Nude Lipstick", "Matte Lipstick", "Red Lipstick", "Pink Lipstick",
        ]),
      ],
    },
    {
      name: "Skin",
      slug: "skin",
      kind: "CATEGORY",
      sections: [
        section("Moisturizers", "CATEGORY", [
          "Face Moisturizer & Day Cream", "Night Cream", "Face Oils", "All Purpose Gels/Creams",
        ]),
        section("Serums", "CATEGORY", ["Serums & Essence"]),
        section("Cleansers", "CATEGORY", [
          "Face Wash", "Cleanser", "Micellar Water", "Face Wipes", "Makeup Remover", "Scrubs & Exfoliators",
        ]),
        section("Trending Searches", "TRENDING", [
          "Toners Under 1000", "Face Wash For Oily Skin", "Oil Free Face Moisturizers",
          "Lip Balm Under 500", "Vitamin C Serum",
        ]),
        section("Masks", "CATEGORY", [
          "Sheet Masks", "Sleeping Masks", "Masks & Peels", "Face Packs", "Face Bleach",
        ]),
        section("Toners", "CATEGORY", ["Toners & Mists", "Rose Water"]),
        section("Body Care", "CATEGORY", [
          "Lotions & Creams", "Body Butter", "Massage Oils", "Shower Gels & Body Wash",
          "Soaps", "Scrubs & Loofahs", "Bath Salts",
        ]),
        section("Hands & Feet", "CATEGORY", ["Hand Creams", "Foot Creams", "Hand & Foot Masks"]),
        section("CSMS By Baylen", "COLLECTION", ["CSMS By Baylen"]),
        section("Specialised Skincare", "CATEGORY", [
          "Acne Spot Correctors", "Nose Strips", "Facial Peels",
        ]),
        section("Eye Care", "CATEGORY", ["Under Eye Cream & Serums", "Eye Masks"]),
        section("Lip Care", "CATEGORY", ["Lip Balm", "Lip Scrubs", "Lip Masks"]),
        section("Sun Care", "CATEGORY", ["Face Sunscreen", "Body Sunscreen"]),
        section("Kits & Combos", "COLLECTION", ["Facial Kits", "Combos @ Baylen", "Gift Sets"]),
        section("Skin Tools", "CATEGORY", [
          "Face Massagers", "Cleansing Brushes", "Blackhead Remover", "Dermarollers",
        ]),
        section("Skin Supplements", "CATEGORY", ["Vitamins & Minerals", "Ayurvedic Herbs"]),
        section("Neck Creams", "CATEGORY", ["Neck Creams"]),
        section("Korean Beauty", "COLLECTION", ["Korean Beauty"]),
        section("Shop By Concern", "CONCERN", [
          "Acne", "Dull Skin", "Pigmentation", "Wrinkles & Fine Lines", "Pores",
          "Dark Spots", "Face Tan", "Oil Control",
        ]),
        section("New Launches", "COLLECTION", ["New Launches"]),
        section("Quick Links", "QUICK_LINK", ["The Gift Store"]),
      ],
    },
    {
      name: "Hair",
      slug: "hair",
      kind: "CATEGORY",
      sections: [
        section("Hair Care", "CATEGORY", [
          "Shampoo", "Dry Shampoo", "Conditioner", "Hair Oil", "Hair Serum",
          "Hair Creams & Masks", "Hair Supplements", "Leave-In Conditioner",
        ]),
        section("Tools & Accessories", "CATEGORY", [
          "Hair Brushes", "Hair Combs", "Dryers & Stylers", "Straighteners",
          "Rollers & Curlers", "Hair Extensions", "Hair Accessories",
        ]),
        section("Hair Styling", "CATEGORY", ["Hair Color", "Hair Spray", "Gels & Waxes"]),
        section("Shop By Hair Type", "HAIR_TYPE", ["Straight", "Curly & Wavy"]),
        section("Professional Brands", "BRAND", ["Professional Brands"]),
        section("Luxury Brand", "BRAND", ["Luxury Brand"]),
        section("Shop By Concern", "CONCERN", [
          "Hairfall & Thinning", "Dandruff", "Dry & Frizzy Hair", "Split Ends",
          "Color Protection", "Damaged Hair", "Hair Growth", "Curl Enhancing",
          "Volume", "Length & Shine", "Bond Building",
        ]),
        section("Hair Kits & Combos", "COLLECTION", ["Hair Kits", "Hair Combos"]),
        section("Top Brands", "BRAND", [
          "Baylen Naturals", "L'Oreal Paris", "Wella Professionals", "L'Oreal Professionnel",
          "BBlunt", "Herbal Essences", "Schwarzkopf Professional",
        ]),
        section("Trending Searches", "TRENDING", [
          "Hair Growth Oil", "Dandruff Shampoo", "Castor Oil For Hair",
          "Sulphate Free Shampoo", "Hair Straightener Brush",
        ]),
        section("Quick Links", "QUICK_LINK", [
          "Hair Combos", "New Launches", "NFBA Nominees 2022", "Herbal Hair Care", "The Gift Store",
        ]),
      ],
    },
    {
      name: "Appliances",
      slug: "appliances",
      kind: "CATEGORY",
      sections: [
        section("Hair Styling Tools", "CATEGORY", [
          "Hair Dryers", "Straighteners", "Straightening Brushes", "Curling Iron/Stylers",
          "Multi Stylers", "Blow Brushes",
        ]),
        section("Pro Hair Styling", "CATEGORY", [
          "Pro Hair Dryers", "Pro Straighteners", "Pro Curling Irons/Stylers", "Pro Multi Stylers",
        ]),
        section("Hair Removal Tools", "CATEGORY", ["Epilators", "Body Groomers", "Bikini Trimmers"]),
        section("Shaving Tools", "CATEGORY", ["Shavers For Men", "Trimmers For Men"]),
        section("Oral Care", "CATEGORY", ["Electric Toothbrushes", "Electric Flossers"]),
        section("Face/Skin Tools", "CATEGORY", [
          "Anti Ageing", "Face Epilator", "Dermarollers", "Cleansing Brushes", "Acne Removal",
        ]),
        section("Massage Tools", "CATEGORY", ["Massagers"]),
        section("Foot Care", "CATEGORY", ["Callus Removers"]),
        section("Top Brands", "BRAND", [
          "FOREO", "Philips", "Alan Truman", "Dyson", "VEGA", "Braun",
          "Ikonic Professional", "Nova", "Flawless",
        ]),
        section("Quick Links", "QUICK_LINK", [
          "Combos @ Baylen", "New Launches", "NFBA Nominees 2022", "Gifts @ Baylen", "Herbal Hair Care",
        ]),
      ],
    },
    {
      name: "Bath & Body",
      slug: "bath-and-body",
      kind: "CATEGORY",
      sections: [
        section("Bath & Shower", "CATEGORY", [
          "Shower Gels & Body Wash", "Body Scrubs & Exfoliants", "Soaps", "Bath Salts",
        ]),
        section("Body Care", "CATEGORY", [
          "Body Lotions & Moisturizers", "Body Butters", "Talcum Powder", "Massage Oils", "Essential Oils",
        ]),
        section("Hands & Feet", "CATEGORY", ["Hand Wash", "Hand Creams & Masks", "Foot Care"]),
        section("Feminine Hygiene", "CATEGORY", [
          "Sanitary Napkins & Period Panties", "Menstrual Cups", "Tampons", "Pantyliners",
          "Intimate Care", "Cotton Buds & Balls", "Other Period Essentials",
        ]),
        section("Female Grooming", "CATEGORY", [
          "Body Razors & Cartridges", "Face & Eyebrow Razors", "Wax & Wax Strips",
          "Hair Removal Creams", "Epilators & Bikini Trimmers",
        ]),
        section("Pre & Post Wax Essentials", "CATEGORY", ["Deodorants/Roll-Ons", "Body Mist/Spray"]),
        section("Male Grooming", "CATEGORY", [
          "Razors & Cartridges", "Shaving Cream, Foams & Gels", "Pre & Post Shaves",
          "Shaving Brush", "Shavers & Trimmers", "Beard & Moustache Care", "Intimate Care",
          "Deodorants/Roll-Ons", "Body Mist/Spray", "Colognes",
        ]),
        section("Hygiene Essentials", "CATEGORY", ["Hygiene Essentials"]),
        section("Oral Care", "CATEGORY", [
          "Toothpaste", "Electric Toothbrush", "Manual Toothbrush", "Mouthwash", "Floss & Tongue Cleaners",
        ]),
        section("Tools & Accessories", "CATEGORY", [
          "Manicure Pedicure Kits", "Loofahs", "Bath Accessories", "Others",
        ]),
        section("Kits & Combos", "COLLECTION", ["Bath & Body Kits", "Bath & Body Combos"]),
        section("Top Brands", "BRAND", [
          "Bath & Body Works", "Mcaffeine", "NIVEA", "The Body Shop", "Vaseline", "Dove",
          "Wanderlust", "Gillette Venus", "Be Bodywise", "Plum BodyLovin", "Chemist At Play",
          "Lux", "Carmesi",
        ]),
        section("Quick Links", "QUICK_LINK", ["New Launches", "The Gift Store", "Daily Essentials"]),
        section("Trending Searches", "TRENDING", [
          "Body Wash", "Body Lotions", "Face Razors For Women", "Sanitary Napkins", "Body Scrubs", "Deodorants",
        ]),
      ],
    },
    {
      name: "Natural",
      slug: "natural",
      kind: "CATEGORY",
      sections: [
        section("Skin", "CATEGORY", [
          "Face Wash", "Cleanser", "Moisturizer", "Face Cream", "Face Mist", "Facial Kits",
          "Toner", "Face Oils", "Sunscreen", "Night Cream", "Day Cream", "Under Eye Care",
          "Face Bleach", "Serums",
        ]),
        section("Skin Treatments", "CATEGORY", [
          "Sheet Masks", "Masks & Peels", "Scrubs & Exfoliators", "Face Tools", "Face Gel", "Lip Scrub",
        ]),
        section("Body Care", "CATEGORY", [
          "Shower Gels & Body Wash", "Soaps", "Body Lotions", "Body Scrubs",
          "Bath Salts & Bath Bombs", "Hands & Feet Care", "Bath Tools & Accessories", "Oral Care",
        ]),
        section("Hair", "CATEGORY", [
          "Shampoo & Cleanser", "Conditioner", "Hair Masks", "Hair Oil", "Hair Serum",
          "Hair Color", "Tools & Accessories",
        ]),
        section("Aromatherapy", "CATEGORY", [
          "Massage Oils", "Carrier Oils", "Essential Oils", "Candles", "Diffuser", "Incense Sticks",
        ]),
        section("Makeup", "CATEGORY", [
          "Lipstick", "Kajal", "Eyeliner", "Mascara", "Nail Polish", "Lip Balm & Gloss",
          "Foundation & Concealer", "Blush & Highlighter", "Makeup Remover", "Tools & Brushes",
        ]),
        section("Trending Search", "TRENDING", [
          "Tea Tree Oil", "Eucalyptus Oil", "Rosemary Oil", "Jojoba Oil", "Peppermint Oil",
        ]),
        section("Top Brands", "BRAND", [
          "Biotique", "Lotus Herbals", "The Body Shop", "Baylen Naturals", "Kama Ayurveda",
          "Forest Essentials", "Khadi Natural", "Himalaya", "VLCC",
        ]),
        section("Baby Care", "CATEGORY", ["Baby Care"]),
        section("Types Of Skin", "SKIN_TYPE", ["Dry Skin", "Normal Skin", "Oily Skin", "Combination Skin"]),
        section("Shop By Concern", "CONCERN", [
          "Tan Removal", "Pigmentation", "Acne Treatment", "Skin Lightening", "Anti Aging",
          "Dark Circles", "Hairfall", "Dandruff", "Dry & Frizzy Hair",
        ]),
        section("Quick Links", "QUICK_LINK", ["New Launches", "Combos @ Baylen", "Gifts @ Baylen"]),
      ],
    },
    {
      name: "Mom & Baby",
      slug: "mom-and-baby",
      kind: "CATEGORY",
      sections: [
        section("Skin, Body & Hair Care", "CATEGORY", [
          "Shampoo & Conditioner", "Lotions & Creams", "Baby Powder", "Baby Oil",
          "Body Wash & Soaps", "Sunscreen", "Tummy Roll On", "Mosquito Repellent", "Lip Care",
        ]),
        section("Diaper Essentials", "CATEGORY", ["Diapers", "Baby Wipes", "Diaper Cream/Rash Cream"]),
        section("Baby Accessories", "CATEGORY", [
          "Hair Brush & Comb", "Nail Cutters", "Kids Makeup", "Baby Bedding", "Baby Toys",
        ]),
        section("Baby Hygiene", "CATEGORY", ["Oral Care", "Detergents & Cleansers", "Cotton Buds & Balls"]),
        section("Nursing & Feeding", "CATEGORY", [
          "Feeding Bottle & Nipples", "Teethers & Soothers", "Breast Pumps",
          "Cleaning & Feeding Accessories", "Sippers & Cups",
        ]),
        section("For Moms", "CATEGORY", [
          "Maternity Pads", "Nipple & Breast Care", "Stretch Mark Creams & Oils",
          "Swollen Foot Cream", "Pregnancy Test Kit", "Maternity Bra",
        ]),
        section("Gifting", "COLLECTION", ["Mom & Baby Kits", "Mom & Baby Combos"]),
      ],
    },
    {
      name: "Health & Wellness",
      slug: "health-and-wellness",
      kind: "CATEGORY",
      extensible: true,
      sections: [
        section("Shop All", "CATEGORY", ["Health & Wellness"]),
      ],
    },
    {
      name: "Men",
      slug: "men",
      kind: "CATEGORY",
      sections: [
        section("Shaving", "CATEGORY", [
          "Razors & Cartridges", "Shavers", "Trimmers", "Shaving Creams", "Shaving Foams",
          "Shaving Gels", "Pre & Post Shaves", "Aftershave Lotion", "Shaving Brushes",
        ]),
        section("Beard Care", "CATEGORY", [
          "Beard Oil", "Beard Butter", "Beard Softener", "Beard Wash", "Beard Wax",
          "Moustache Oil", "Beard Comb", "Moustache Wax", "Beard Kits", "Beard Gel",
          "Beard Balm", "Beard Cream", "Beard Serum", "Beard Mist", "Beard Colour", "Beard Shampoo",
        ]),
        section("Hair Care", "CATEGORY", [
          "Shampoo", "Conditioner", "Hair Styling", "Hair Color", "Hair Oils", "Professional Products",
        ]),
        section("Skin Care", "CATEGORY", [
          "Face Wash", "Moisturizers", "Sunscreen", "Masks & Peels", "Scrubs & Exfoliators", "Fairness",
        ]),
        section("Bath & Body", "CATEGORY", [
          "Bath/Shower Gels", "Soaps", "Body Scrubs", "Talc", "Dental Care", "Body Lotions", "Intimate Care",
        ]),
        section("Grooming Kits", "COLLECTION", ["Grooming Kits"]),
        section("Fragrance", "CATEGORY", [
          "Deodorants/Roll Ons", "Colognes & Perfumes (EDT & EDP)", "Luxe Fragrances",
        ]),
        section("Shop By Concern", "CONCERN", [
          "Anti Dandruff", "Anti Hairfall", "Scalp Treatment", "Anti Acne", "Anti Ageing",
        ]),
        section("Wellness", "CATEGORY", [
          "Sexual Wellness", "Health Supplements", "Weight Management", "Sports Nutrition",
        ]),
        section("Top Brands", "BRAND", ["Beardo", "Gillette", "Livon", "Nivea", "Park Avenue"]),
        section("Quick Links", "QUICK_LINK", [
          "Combos @ Baylen", "New Launches", "Gifts @ Baylen", "The Gift Store",
        ]),
      ],
    },
    {
      name: "Fragrance",
      slug: "fragrance",
      kind: "CATEGORY",
      sections: [
        section("Womens Fragrance", "CATEGORY", ["Perfumes (EDT / EDP)", "Body Mists / Sprays"]),
        section("Mens Fragrance", "CATEGORY", ["Perfumes (EDT / EDP)"]),
        section("Shop By Fragrance Family", "FRAGRANCE_FAMILY", [
          "Earthy & Woody", "Floral", "Fresh & Aquatic", "Spicy & Warm", "Oud Collection", "Fruity",
        ]),
        section("Aromatherapy", "CATEGORY", ["Candles", "Diffuser", "Incense Sticks"]),
        section("Fragrance Kits & Combos", "COLLECTION", ["Fragrance Combos", "Fragrance Kits"]),
        section("Top Brands", "BRAND", [
          "Dior", "Gucci", "Yves Saint Laurent", "BVLGARI", "Davidoff", "Versace",
          "Giorgio Armani", "Bella Vita Organic", "Plum", "Victoria Secret", "Bath And Body Works",
          "Baylen Perfumery", "Renee", "Carlton London Perfume", "Engage",
        ]),
        section("Premium And Designer Brands", "BRAND", [
          "Explore All", "Dior", "Hermes", "Jo Malone London", "Guerlain", "BVLGARI",
          "Salvatore Ferragamo", "Calvin Klein", "Giorgio Armani", "Davidoff", "Paco Rabanne",
          "Carolina Herrera", "Yves Saint Laurent", "Elie Saab", "Dolce&Gabbana",
          "Narciso Rodriguez", "Hugo Boss", "Montblanc",
        ]),
        section("Quick Links", "QUICK_LINK", ["New Launches", "The Gift Store"]),
      ],
    },
    {
      name: "Fashion Selects",
      slug: "fashion-selects",
      kind: "FASHION",
      sections: [
        section("Lingerie", "CATEGORY", [
          "Bras", "Underwear", "Sleep & Lounge", "Shapewear", "Swimwear", "Maternity Wear", "Activewear",
        ]),
        section("Watches", "CATEGORY", ["Smart Watches & Activity Tracker"]),
        section("Sunglasses", "CATEGORY", ["Sunglasses"]),
        section("Bags", "CATEGORY", [
          "Sling Bags", "Handbags", "Wallets & Card Cases", "Tote Bags", "Backpacks & Duffel Bags",
          "Satchels", "Clutches", "Laptop Bags", "Vanity Bags & Pouches", "Bataas & Potlis",
        ]),
        section("Footwear", "CATEGORY", [
          "Sports Shoes & Sneakers", "Sandals", "Heels", "Flats", "Flip Flops", "Wedges",
          "Boots", "Juttis", "Kolhapuris", "Stilettos", "Loafers",
        ]),
        section("Jewellery", "CATEGORY", [
          "Earrings", "Necklaces", "Jewellery Sets", "Maang Tikka", "Bracelets & Bangles",
          "Rings", "Mangalsutra", "Anklets",
        ]),
        section("Home", "CATEGORY", [
          "Decor", "Bedding", "Bathroom Storage", "Home Essentials", "Drinkware",
        ]),
        section("Featured Brands", "BRAND", [
          "H&M", "Nykd By Baylen", "Aldo", "Puma", "Palmonas", "Nike", "MIRAGGIO",
          "Underneat", "Carlton London", "Zivame", "Victorias Secret", "Guess",
        ]),
        section("What's New", "CATEGORY", ["Recently Added"]),
        section("Women", "CATEGORY", [
          "Indianwear", "Westernwear", "Footwear", "Bags", "Lingerie", "Sportswear",
          "Sleep & Lounge", "Jewellery", "Watches", "Accessories",
        ]),
        section("Men", "CATEGORY", [
          "Topwear", "Bottomwear", "Ethnicwear", "Footwear", "Athleisure", "Innerwear", "Accessories",
        ]),
        section("Kids", "CATEGORY", ["Girls", "Boys", "Baby", "Toys"]),
      ],
    },
    {
      name: "Offers",
      slug: "offers",
      kind: "OFFERS",
      sections: [
        section("Offers", "OFFER", [
          "Active Offers", "Flash Deals", "Discount Percentage", "Flat Discount",
          "Buy One Get One", "Buy X Get Y", "Combo Offers", "Category Offers",
          "Brand Offers", "Product Offers", "Coupon Offers", "Limited Time Offers",
          "New Customer Offers", "Festival Offers", "Clearance Offers",
        ]),
      ],
    },
  ],
  synonyms: [
    ["facewash", "face wash", "cleanser"],
    ["moisturiser", "moisturizer"],
    ["hairfall", "hair fall", "hair loss"],
    ["lipstick", "lip stick"],
    ["perfume", "fragrance", "scent"],
    ["deodorant", "deo"],
    ["foundation", "base makeup"],
    ["compact", "pressed powder"],
    ["serum", "essence"],
    ["shampoo", "hair cleanser"],
    ["conditioner", "hair conditioner"],
    ["bodywash", "body wash"],
    ["anti aging", "anti-ageing", "anti ageing"],
    ["kajal", "kohl"],
    ["eyeliner", "eye liner"],
    ["sunscreen", "sun screen", "spf"],
  ],
};

module.exports = { TAXONOMY, slugify, brandName };
