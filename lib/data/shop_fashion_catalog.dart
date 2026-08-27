class FashionLink {
  const FashionLink(this.label, {this.featured = false});

  final String label;
  final bool featured;
}

class FashionGroup {
  const FashionGroup({
    required this.title,
    this.items = const [],
    this.titleOnly = false,
  });

  final String title;
  final List<FashionLink> items;
  final bool titleOnly;
}

class FashionPromoSlide {
  const FashionPromoSlide({
    required this.imageAsset,
    required this.kicker,
    required this.title,
    required this.subtitle,
    required this.query,
  });

  final String imageAsset;
  final String kicker;
  final String title;
  final String subtitle;
  final String query;
}

class ShopFashionCatalog {
  static const groups = [
    FashionGroup(
      title: "What's New",
      items: [FashionLink('Recently Added')],
    ),
    FashionGroup(
      title: 'Women',
      items: [
        FashionLink('Indianwear'),
        FashionLink('Westernwear'),
        FashionLink('Footwear'),
        FashionLink('Bags'),
        FashionLink('Lingerie'),
        FashionLink('Sportswear'),
        FashionLink('Sleep & Lounge'),
        FashionLink('Jewellery'),
        FashionLink('Watches'),
        FashionLink('Accessories'),
      ],
    ),
    FashionGroup(
      title: 'Global Store',
      titleOnly: true,
    ),
    FashionGroup(
      title: 'Revolve',
      titleOnly: true,
    ),
    FashionGroup(
      title: 'Luxe',
      titleOnly: true,
    ),
    FashionGroup(
      title: 'Hidden Gems',
      titleOnly: true,
    ),
    FashionGroup(
      title: 'Men',
      items: [
        FashionLink('Topwear'),
        FashionLink('Bottomwear'),
        FashionLink('Ethnicwear'),
        FashionLink('Footwear'),
        FashionLink('Athleisure'),
        FashionLink('Innerwear & Sleepwear'),
        FashionLink('Watches'),
        FashionLink('Accessories'),
        FashionLink('Bags'),
      ],
    ),
    FashionGroup(
      title: 'Style Files',
      titleOnly: true,
    ),
    FashionGroup(
      title: 'Kids',
      items: [
        FashionLink('Westernwear'),
        FashionLink('Indianwear'),
        FashionLink('Footwear'),
        FashionLink('Toys & Games'),
        FashionLink('Feeding'),
        FashionLink('Sportswear'),
        FashionLink('Sleep & Lounge'),
      ],
    ),
    FashionGroup(
      title: 'Home',
      items: [
        FashionLink('Kitchen & Dining'),
        FashionLink('Decor'),
        FashionLink('Bedding'),
        FashionLink('Bath'),
        FashionLink('Storage'),
        FashionLink('Floor Coverings', featured: true),
        FashionLink('Kitchen Appliances'),
      ],
    ),
    FashionGroup(
      title: 'House of Baylen',
      items: [
        FashionLink('Twenty Dresses By Baylen Fashion'),
        FashionLink('RSVP By Baylen Fashion'),
        FashionLink('Gajra Gang'),
        FashionLink('Nykd By Baylen'),
        FashionLink('Pipa Bella'),
        FashionLink('IYKYK By Baylen Fashion'),
        FashionLink('Kica'),
        FashionLink('Twig And Twine'),
        FashionLink('Likha By Baylen Fashion'),
        FashionLink('Gloot'),
        FashionLink('Nyri'),
        FashionLink('Azai By Baylen Fashion'),
        FashionLink('MIXT'),
        FashionLink('Pariditi'),
        FashionLink('Lehan'),
        FashionLink('Gahan'),
      ],
    ),
    FashionGroup(
      title: 'Top Brands',
      items: [
        FashionLink('Forever New'),
        FashionLink('Cider'),
        FashionLink('Na-Kd'),
        FashionLink('Vero Moda'),
        FashionLink('Autumnlane'),
        FashionLink('Puma'),
        FashionLink('Skechers'),
        FashionLink('FableStreet'),
        FashionLink('Biba'),
        FashionLink('W'),
        FashionLink('Shoetopia'),
        FashionLink("Levi's"),
      ],
    ),
  ];

  static const columns = [
    [
      FashionGroup(
        title: "What's New",
        items: [FashionLink('Recently Added')],
      ),
      FashionGroup(
        title: 'Women',
        items: [
          FashionLink('Indianwear'),
          FashionLink('Westernwear'),
          FashionLink('Footwear'),
          FashionLink('Bags'),
          FashionLink('Lingerie'),
          FashionLink('Sportswear'),
          FashionLink('Sleep & Lounge'),
          FashionLink('Jewellery'),
          FashionLink('Watches'),
          FashionLink('Accessories'),
        ],
      ),
      FashionGroup(title: 'Global Store', titleOnly: true),
      FashionGroup(title: 'Revolve', titleOnly: true),
      FashionGroup(title: 'Luxe', titleOnly: true),
      FashionGroup(title: 'Hidden Gems', titleOnly: true),
    ],
    [
      FashionGroup(
        title: 'Men',
        items: [
          FashionLink('Topwear'),
          FashionLink('Bottomwear'),
          FashionLink('Ethnicwear'),
          FashionLink('Footwear'),
          FashionLink('Athleisure'),
          FashionLink('Innerwear & Sleepwear'),
          FashionLink('Watches'),
          FashionLink('Accessories'),
          FashionLink('Bags'),
        ],
      ),
      FashionGroup(title: 'Style Files', titleOnly: true),
      FashionGroup(
        title: 'Kids',
        items: [
          FashionLink('Westernwear'),
          FashionLink('Indianwear'),
          FashionLink('Footwear'),
          FashionLink('Toys & Games'),
          FashionLink('Feeding'),
          FashionLink('Sportswear'),
          FashionLink('Sleep & Lounge'),
        ],
      ),
    ],
    [
      FashionGroup(
        title: 'Home',
        items: [
          FashionLink('Kitchen & Dining'),
          FashionLink('Decor'),
          FashionLink('Bedding'),
          FashionLink('Bath'),
          FashionLink('Storage'),
          FashionLink('Floor Coverings', featured: true),
          FashionLink('Kitchen Appliances'),
        ],
      ),
      FashionGroup(
        title: 'House of Baylen',
        items: [
          FashionLink('Twenty Dresses By Baylen Fashion'),
          FashionLink('RSVP By Baylen Fashion'),
          FashionLink('Gajra Gang'),
          FashionLink('Nykd By Baylen'),
          FashionLink('Pipa Bella'),
          FashionLink('IYKYK By Baylen Fashion'),
          FashionLink('Kica'),
          FashionLink('Twig And Twine'),
          FashionLink('Likha By Baylen Fashion'),
          FashionLink('Gloot'),
        ],
      ),
    ],
    [
      FashionGroup(
        title: '',
        items: [
          FashionLink('Nyri'),
          FashionLink('Azai By Baylen Fashion'),
          FashionLink('MIXT'),
          FashionLink('Pariditi'),
          FashionLink('Lehan'),
          FashionLink('Gahan'),
        ],
      ),
      FashionGroup(
        title: 'Top Brands',
        items: [
          FashionLink('Forever New'),
          FashionLink('Cider'),
          FashionLink('Na-Kd'),
          FashionLink('Vero Moda'),
          FashionLink('Autumnlane'),
          FashionLink('Puma'),
          FashionLink('Skechers'),
          FashionLink('FableStreet'),
          FashionLink('Biba'),
          FashionLink('W'),
          FashionLink('Shoetopia'),
          FashionLink("Levi's"),
        ],
      ),
    ],
  ];

  static const promos = [
    FashionPromoSlide(
      imageAsset: 'assets/gallery/2026/August/feel-like-yourself.jpg',
      kicker: 'BAYLEN FASHION',
      title: 'First In Fashion',
      subtitle: 'Our edit of the most stylish trends for spring/summer 2024',
      query: 'fashion',
    ),
    FashionPromoSlide(
      imageAsset: 'assets/gallery/2026/August/img 01.png',
      kicker: 'WOMEN',
      title: 'New Season Looks',
      subtitle: 'Indianwear, westernwear, and the bags to match',
      query: 'women',
    ),
    FashionPromoSlide(
      imageAsset: 'assets/gallery/2026/August/img2.png',
      kicker: 'HOUSE OF BAYLEN',
      title: 'Only At Baylen',
      subtitle: 'Twenty Dresses, RSVP, Nykd, and more house labels',
      query: 'Baylen Fashion',
    ),
    FashionPromoSlide(
      imageAsset: 'assets/gallery/2026/August/image 3.jpg',
      kicker: 'HOME',
      title: 'Floor Coverings',
      subtitle: 'Rugs, carpets, and finishes for a styled home',
      query: 'Floor Coverings',
    ),
    FashionPromoSlide(
      imageAsset: 'assets/branding/baylen-lady-logo.png',
      kicker: 'MEN & KIDS',
      title: 'Everyday Style',
      subtitle: 'Athleisure, ethnicwear, and kids essentials',
      query: 'men',
    ),
  ];
}
