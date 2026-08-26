class CatalogCategory {
  const CatalogCategory({
    required this.id,
    required this.name,
    required this.slug,
    required this.description,
  });

  final String id;
  final String name;
  final String slug;
  final String description;

  factory CatalogCategory.fromJson(Map<String, dynamic> json) {
    return CatalogCategory(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
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
  });

  final String id;
  final String name;
  final String slug;
  final String logoUrl;
  final String bannerUrl;
  final String description;
  final double rating;
  final int reviewCount;

  factory CatalogBrand.fromJson(Map<String, dynamic> json) {
    return CatalogBrand(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      logoUrl: json['logo_url']?.toString() ?? '',
      bannerUrl: json['banner_url']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      reviewCount: (json['review_count'] as num?)?.toInt() ?? 0,
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
    this.externalSource = '',
    this.externalId = '',
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
  final String externalSource;
  final String externalId;

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
      externalSource: json['external_source']?.toString() ?? '',
      externalId: json['external_id']?.toString() ?? '',
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
    );
  }

  String get label {
    return [
      variantName,
      variantValue,
    ].where((part) => part.isNotEmpty).join(' ');
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}

class CatalogProductMedia {
  const CatalogProductMedia({
    required this.id,
    required this.mediaType,
    required this.fileUrl,
  });

  final String id;
  final String mediaType;
  final String fileUrl;

  factory CatalogProductMedia.fromJson(Map<String, dynamic> json) {
    return CatalogProductMedia(
      id: json['id']?.toString() ?? '',
      mediaType: json['media_type']?.toString() ?? 'IMAGE',
      fileUrl: json['file_url']?.toString() ?? '',
    );
  }
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
