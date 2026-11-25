class CatalogFulfillmentSnapshot {
  const CatalogFulfillmentSnapshot({
    this.quickAvailable = false,
    this.standardAvailable = false,
    this.quickAvailableQuantity = 0,
    this.standardAvailableQuantity = 0,
    this.quickEta = '',
    this.standardEta = '',
    this.quickCommerceEnabled = true,
    this.ecommerceEnabled = true,
    this.quickCommerceRestrictionReason = '',
  });

  final bool quickAvailable;
  final bool standardAvailable;
  final int quickAvailableQuantity;
  final int standardAvailableQuantity;
  final String quickEta;
  final String standardEta;
  final bool quickCommerceEnabled;
  final bool ecommerceEnabled;
  final String quickCommerceRestrictionReason;

  factory CatalogFulfillmentSnapshot.fromJson(Map<String, dynamic> json) {
    return CatalogFulfillmentSnapshot(
      quickAvailable: json['quick_available'] == true,
      standardAvailable: json['standard_available'] == true,
      quickAvailableQuantity:
          (json['quick_available_quantity'] as num?)?.toInt() ?? 0,
      standardAvailableQuantity:
          (json['standard_available_quantity'] as num?)?.toInt() ?? 0,
      quickEta: json['quick_eta']?.toString() ?? '',
      standardEta: json['standard_eta']?.toString() ?? '',
      quickCommerceEnabled: json['quick_commerce_enabled'] != false,
      ecommerceEnabled: json['ecommerce_enabled'] != false,
      quickCommerceRestrictionReason:
          json['quick_commerce_restriction_reason']?.toString() ?? '',
    );
  }
}

class CatalogCategory {
  const CatalogCategory({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
    this.parentId,
  });

  final String id;
  final String name;
  final String slug;
  final String description;
  final String? parentId;

  factory CatalogCategory.fromJson(Map<String, dynamic> json) {
    return CatalogCategory(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      parentId: json['parent_id']?.toString(),
    );
  }
}

class CatalogCategoryNode {
  const CatalogCategoryNode({
    required this.id,
    required this.name,
    required this.slug,
    required this.parentId,
    required this.imageUrl,
    required this.displayOrder,
    required this.subCategories,
  });

  final String id;
  final String name;
  final String slug;
  final String parentId;
  final String imageUrl;
  final int displayOrder;
  final List<CatalogCategoryNode> subCategories;

  factory CatalogCategoryNode.fromJson(Map<String, dynamic> json) {
    final children = json['sub_categories'];
    return CatalogCategoryNode(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      parentId: json['parent_id']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      displayOrder: (json['display_order'] as num?)?.toInt() ?? 0,
      subCategories: children is List
          ? children
                .whereType<Map<String, dynamic>>()
                .map(CatalogCategoryNode.fromJson)
                .toList()
          : const [],
    );
  }
}

class CatalogBrand {
  const CatalogBrand({
    required this.id,
    required this.name,
    required this.slug,
    required this.logoUrl,
    required this.bannerUrl,
    required this.description,
    required this.rating,
    required this.reviewCount,
    this.url = '',
  });

  final String id;
  final String name;
  final String slug;
  final String logoUrl;
  final String bannerUrl;
  final String description;
  final double rating;
  final int reviewCount;
  final String url;

  factory CatalogBrand.fromJson(Map<String, dynamic> json) {
    final slug = json['slug']?.toString() ?? '';
    return CatalogBrand(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: slug,
      logoUrl: json['logo_url']?.toString() ?? '',
      bannerUrl: json['banner_url']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      reviewCount: (json['review_count'] as num?)?.toInt() ?? 0,
      url: json['url']?.toString() ?? (slug.isEmpty ? '' : '/brand/$slug'),
    );
  }
}

class CatalogBrandFacetCategory {
  const CatalogBrandFacetCategory({
    required this.id,
    required this.name,
    required this.slug,
    required this.count,
  });

  final String id;
  final String name;
  final String slug;
  final int count;

  factory CatalogBrandFacetCategory.fromJson(Map<String, dynamic> json) {
    return CatalogBrandFacetCategory(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
    );
  }
}

class CatalogBrandPage {
  const CatalogBrandPage({
    required this.brand,
    required this.url,
    required this.seoTitle,
    required this.seoDescription,
    required this.productCount,
    required this.categories,
    required this.minPrice,
    required this.maxPrice,
    required this.genders,
    required this.ageGroups,
  });

  final CatalogBrand brand;
  final String url;
  final String seoTitle;
  final String seoDescription;
  final int productCount;
  final List<CatalogBrandFacetCategory> categories;
  final double minPrice;
  final double maxPrice;
  final List<String> genders;
  final List<String> ageGroups;

  factory CatalogBrandPage.fromJson(Map<String, dynamic> json) {
    final brandJson = json['brand'];
    final brand = CatalogBrand.fromJson(
      brandJson is Map<String, dynamic> ? brandJson : json,
    );
    final seo = json['seo'];
    final facets = json['facets'];
    final price = facets is Map ? facets['price'] : null;
    final attributes = facets is Map ? facets['attributes'] : null;
    final categories = facets is Map ? facets['categories'] : null;
    return CatalogBrandPage(
      brand: brand,
      url: json['url']?.toString() ?? brand.url,
      seoTitle: seo is Map
          ? seo['title']?.toString() ?? '${brand.name} | Baylen'
          : '${brand.name} | Baylen',
      seoDescription: seo is Map
          ? seo['description']?.toString() ?? brand.description
          : brand.description,
      productCount: (json['product_count'] as num?)?.toInt() ?? 0,
      categories: categories is List
          ? categories
                .whereType<Map<String, dynamic>>()
                .map(CatalogBrandFacetCategory.fromJson)
                .toList()
          : const [],
      minPrice: price is Map ? (price['min'] as num?)?.toDouble() ?? 0 : 0,
      maxPrice: price is Map ? (price['max'] as num?)?.toDouble() ?? 0 : 0,
      genders: attributes is Map && attributes['gender'] is List
          ? (attributes['gender'] as List).map((item) => item.toString()).toList()
          : const [],
      ageGroups: attributes is Map && attributes['age_group'] is List
          ? (attributes['age_group'] as List)
                .map((item) => item.toString())
                .toList()
          : const [],
    );
  }
}

class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.name,
    required this.slug,
    required this.sku,
    required this.categoryId,
    required this.brandId,
    required this.brandName,
    required this.shortDescription,
    required this.description,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
    required this.taxPercent,
    required this.thumbnailUrl,
    required this.hasVariants,
    required this.isFeatured,
    required this.availableQuantity,
    this.fulfillment = const CatalogFulfillmentSnapshot(),
    this.externalSource = '',
    this.externalId = '',
    this.gender = '',
    this.ageGroup = '',
    this.rating = 0,
  });

  final String id;
  final String name;
  final String slug;
  final String sku;
  final String categoryId;
  final String brandId;
  final String brandName;
  final String shortDescription;
  final String description;
  final double mrp;
  final double sellingPrice;
  final String currency;
  final double taxPercent;
  final String thumbnailUrl;
  final bool hasVariants;
  final bool isFeatured;
  final int availableQuantity;
  final CatalogFulfillmentSnapshot fulfillment;
  final String externalSource;
  final String externalId;
  final String gender;
  final String ageGroup;
  final double rating;

  factory CatalogProduct.fromJson(Map<String, dynamic> json) {
    return CatalogProduct(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      categoryId: json['category_id']?.toString() ?? '',
      brandId: json['brand_id']?.toString() ?? '',
      brandName: json['brand_name']?.toString() ?? '',
      shortDescription: json['short_description']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      taxPercent: (json['tax_percent'] as num?)?.toDouble() ?? 0,
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      hasVariants: json['has_variants'] == true,
      isFeatured: json['is_featured'] == true,
      availableQuantity: (json['available_quantity'] as num?)?.toInt() ?? 0,
      fulfillment: CatalogFulfillmentSnapshot.fromJson(json),
      externalSource: json['external_source']?.toString() ?? '',
      externalId: json['external_id']?.toString() ?? '',
      gender: json['gender']?.toString() ?? '',
      ageGroup: json['age_group']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
    );
  }

  bool get isZohoCommerceProduct => externalSource == 'ZOHO_COMMERCE';

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  String get mrpLabel {
    final price = mrp.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  int get discountPercent {
    if (mrp <= 0 || sellingPrice >= mrp) {
      return 0;
    }
    return (((mrp - sellingPrice) / mrp) * 100).round();
  }
}

class CatalogProductVariant {
  const CatalogProductVariant({
    required this.id,
    required this.productId,
    required this.sku,
    required this.variantName,
    required this.variantValue,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
    required this.availableQuantity,
    this.fulfillment = const CatalogFulfillmentSnapshot(),
  });

  final String id;
  final String productId;
  final String sku;
  final String variantName;
  final String variantValue;
  final double mrp;
  final double sellingPrice;
  final String currency;
  final int availableQuantity;
  final CatalogFulfillmentSnapshot fulfillment;

  factory CatalogProductVariant.fromJson(Map<String, dynamic> json) {
    return CatalogProductVariant(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      variantName: json['variant_name']?.toString() ?? '',
      variantValue: json['variant_value']?.toString() ?? '',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      availableQuantity: (json['available_quantity'] as num?)?.toInt() ?? 0,
      fulfillment: CatalogFulfillmentSnapshot.fromJson(json),
    );
  }

  String get label {
    return optionLabel;
  }

  String get optionLabel {
    final name = variantName.trim();
    final value = variantValue.trim();
    if (name.isNotEmpty && value.isNotEmpty) {
      final numericValue = RegExp(r'^\d+(\.0+)?$').hasMatch(value);
      if (numericValue || name.contains(value.replaceAll('.00', ''))) {
        return name;
      }
      final groupLike = !RegExp(r'\d').hasMatch(name) && name.length <= 24;
      if (groupLike) {
        return value;
      }
      return name;
    }
    if (name.isNotEmpty) {
      return name;
    }
    if (value.isNotEmpty) {
      return value;
    }
    return sku;
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  String get mrpLabel {
    final price = mrp.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  int get discountPercent {
    if (mrp <= 0 || sellingPrice >= mrp) {
      return 0;
    }
    return (((mrp - sellingPrice) / mrp) * 100).round();
  }
}

class CatalogProductMedia {
  const CatalogProductMedia({
    required this.id,
    required this.mediaType,
    required this.fileUrl,
    this.variantId = '',
    this.displayOrder = 0,
    this.isPrimary = false,
  });

  final String id;
  final String mediaType;
  final String fileUrl;
  final String variantId;
  final int displayOrder;
  final bool isPrimary;

  factory CatalogProductMedia.fromJson(Map<String, dynamic> json) {
    return CatalogProductMedia(
      id: json['id']?.toString() ?? '',
      mediaType: json['media_type']?.toString() ?? 'IMAGE',
      fileUrl: json['file_url']?.toString() ?? '',
      variantId: json['variant_id']?.toString() ?? '',
      displayOrder: (json['display_order'] as num?)?.toInt() ?? 0,
      isPrimary:
          json['is_primary'] == true || json['is_primary']?.toString() == 'true',
    );
  }

  bool get isVideo => mediaType.toUpperCase() == 'VIDEO';
}

List<CatalogProductMedia> mediaForSelectedVariant(
  List<CatalogProductMedia> media, {
  String? variantId,
  String fallbackImageUrl = '',
}) {
  final usable = media.where((item) => item.fileUrl.trim().isNotEmpty).toList()
    ..sort((a, b) {
      final primary = (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      if (primary != 0) {
        return primary;
      }
      return a.displayOrder.compareTo(b.displayOrder);
    });
  List<CatalogProductMedia> selected;
  if (variantId != null && variantId.isNotEmpty) {
    final forVariant = usable
        .where((item) => item.variantId == variantId)
        .toList();
    final shared = usable.where((item) => item.variantId.isEmpty).toList();
    selected = forVariant.isNotEmpty ? [...forVariant, ...shared] : shared;
    if (selected.isEmpty) {
      selected = usable;
    }
  } else {
    selected = usable;
  }
  if (selected.isEmpty && fallbackImageUrl.trim().isNotEmpty) {
    return [
      CatalogProductMedia(
        id: 'fallback',
        mediaType: 'IMAGE',
        fileUrl: fallbackImageUrl,
      ),
    ];
  }
  final seen = <String>{};
  return selected
      .where((item) => seen.add('${item.mediaType}:${item.fileUrl}'))
      .toList();
}

CatalogProductVariant? preferredCatalogVariant(
  List<CatalogProductVariant> variants,
) {
  for (final variant in variants) {
    if (variant.availableQuantity > 0) {
      return variant;
    }
  }
  return variants.isEmpty ? null : variants.first;
}

class CatalogProductDetail {
  const CatalogProductDetail({
    required this.product,
    required this.brand,
    required this.variants,
    required this.media,
  });

  final CatalogProduct product;
  final CatalogBrand? brand;
  final List<CatalogProductVariant> variants;
  final List<CatalogProductMedia> media;

  factory CatalogProductDetail.fromJson(Map<String, dynamic> json) {
    final product = json['product'];
    final brand = json['brand'];
    final variants = json['variants'];
    final media = json['media'];
    return CatalogProductDetail(
      product: CatalogProduct.fromJson(
        product is Map<String, dynamic> ? product : const <String, dynamic>{},
      ),
      brand: brand is Map<String, dynamic>
          ? CatalogBrand.fromJson(brand)
          : null,
      variants: variants is List
          ? variants
                .whereType<Map<String, dynamic>>()
                .map(CatalogProductVariant.fromJson)
                .toList()
          : const [],
      media: media is List
          ? media
                .whereType<Map<String, dynamic>>()
                .map(CatalogProductMedia.fromJson)
                .toList()
          : const [],
    );
  }
}

class ShopHomeTile {
  const ShopHomeTile({
    required this.id,
    required this.name,
    required this.slug,
    required this.imageUrl,
    this.parentId = '',
  });

  final String id;
  final String name;
  final String slug;
  final String imageUrl;
  final String parentId;

  factory ShopHomeTile.fromJson(Map<String, dynamic> json) {
    return ShopHomeTile(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      parentId: json['parent_id']?.toString() ?? '',
    );
  }
}

class ShopHomeBanner {
  const ShopHomeBanner({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.imageUrl,
    required this.actionType,
    required this.actionValue,
    required this.ctaLabel,
  });

  final String id;
  final String title;
  final String subtitle;
  final String imageUrl;
  final String actionType;
  final String actionValue;
  final String ctaLabel;

  factory ShopHomeBanner.fromJson(Map<String, dynamic> json) {
    return ShopHomeBanner(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      subtitle: json['subtitle']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      actionType: json['action_type']?.toString() ?? 'SHOP',
      actionValue: json['action_value']?.toString() ?? '',
      ctaLabel: json['cta_label']?.toString() ?? 'Shop Now',
    );
  }
}

class ShopHomeOffer {
  const ShopHomeOffer({
    required this.id,
    required this.title,
    required this.code,
    required this.description,
    required this.discountType,
    required this.discountValue,
  });

  final String id;
  final String title;
  final String code;
  final String description;
  final String discountType;
  final double discountValue;

  factory ShopHomeOffer.fromJson(Map<String, dynamic> json) {
    return ShopHomeOffer(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      code: json['code']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      discountType: json['discount_type']?.toString() ?? '',
      discountValue: (json['discount_value'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ShopHome {
  const ShopHome({
    required this.hubs,
    required this.quickCategories,
    required this.searchHints,
    required this.banners,
    required this.glowProducts,
    required this.brands,
    required this.offers,
  });

  final List<ShopHomeTile> hubs;
  final List<ShopHomeTile> quickCategories;
  final List<String> searchHints;
  final List<ShopHomeBanner> banners;
  final List<CatalogProduct> glowProducts;
  final List<CatalogBrand> brands;
  final List<ShopHomeOffer> offers;

  factory ShopHome.fromJson(Map<String, dynamic> json) {
    List<Map<String, dynamic>> maps(String key) {
      final value = json[key];
      if (value is! List) {
        return const [];
      }
      return value.whereType<Map<String, dynamic>>().toList();
    }

    return ShopHome(
      hubs: maps('hubs').map(ShopHomeTile.fromJson).toList(),
      quickCategories: maps(
        'quick_categories',
      ).map(ShopHomeTile.fromJson).toList(),
      searchHints: (json['search_hints'] is List)
          ? (json['search_hints'] as List)
                .map((item) => item.toString())
                .where((item) => item.isNotEmpty)
                .toList()
          : const [],
      banners: maps('banners').map(ShopHomeBanner.fromJson).toList(),
      glowProducts: maps('glow_products').map(CatalogProduct.fromJson).toList(),
      brands: maps('brands').map(CatalogBrand.fromJson).toList(),
      offers: maps('offers').map(ShopHomeOffer.fromJson).toList(),
    );
  }
}

class ShopNavItem {
  const ShopNavItem({
    required this.id,
    required this.title,
    required this.slug,
    required this.kind,
    required this.categoryId,
    required this.brandId,
    required this.query,
  });

  final String id;
  final String title;
  final String slug;
  final String kind;
  final String categoryId;
  final String brandId;
  final String query;

  factory ShopNavItem.fromJson(Map<String, dynamic> json) {
    return ShopNavItem(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      kind: json['kind']?.toString() ?? 'PRODUCT',
      categoryId: json['category_id']?.toString() ?? json['id']?.toString() ?? '',
      brandId: json['brand_id']?.toString() ?? '',
      query: json['query']?.toString() ?? '',
    );
  }
}

class ShopNavSection {
  const ShopNavSection({
    required this.id,
    required this.title,
    required this.slug,
    required this.kind,
    required this.items,
  });

  final String id;
  final String title;
  final String slug;
  final String kind;
  final List<ShopNavItem> items;

  factory ShopNavSection.fromJson(Map<String, dynamic> json) {
    final items = json['items'];
    return ShopNavSection(
      id: json['id']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      kind: json['kind']?.toString() ?? 'PRODUCT',
      items: items is List
          ? items.whereType<Map<String, dynamic>>().map(ShopNavItem.fromJson).toList()
          : const [],
    );
  }
}

class ShopNavMenu {
  const ShopNavMenu({
    required this.id,
    required this.name,
    required this.slug,
    required this.kind,
    required this.sections,
  });

  final String id;
  final String name;
  final String slug;
  final String kind;
  final List<ShopNavSection> sections;

  factory ShopNavMenu.fromJson(Map<String, dynamic> json) {
    final sections = json['sections'];
    return ShopNavMenu(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      kind: json['kind']?.toString() ?? 'PRODUCT',
      sections: sections is List
          ? sections
                .whereType<Map<String, dynamic>>()
                .map(ShopNavSection.fromJson)
                .toList()
          : const [],
    );
  }

  CatalogCategoryNode toCategoryNode() {
    return CatalogCategoryNode(
      id: id,
      name: name,
      slug: slug,
      parentId: '',
      imageUrl: '',
      displayOrder: 0,
      subCategories: sections
          .map(
            (section) => CatalogCategoryNode(
              id: section.id,
              name: section.title,
              slug: section.slug,
              parentId: id,
              imageUrl: '',
              displayOrder: 0,
              subCategories: section.items
                  .map(
                    (item) => CatalogCategoryNode(
                      id: item.categoryId.isEmpty ? item.id : item.categoryId,
                      name: item.title,
                      slug: item.slug,
                      parentId: section.id,
                      imageUrl: '',
                      displayOrder: 0,
                      subCategories: const [],
                    ),
                  )
                  .toList(),
            ),
          )
          .toList(),
    );
  }
}
