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

class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.name,
    required this.slug,
    required this.sku,
    required this.categoryId,
    required this.shortDescription,
    required this.description,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
    required this.thumbnailUrl,
    required this.isFeatured,
  });

  final String id;
  final String name;
  final String slug;
  final String sku;
  final String categoryId;
  final String shortDescription;
  final String description;
  final double mrp;
  final double sellingPrice;
  final String currency;
  final String thumbnailUrl;
  final bool isFeatured;

  factory CatalogProduct.fromJson(Map<String, dynamic> json) {
    return CatalogProduct(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      slug: json['slug']?.toString() ?? '',
      sku: json['sku']?.toString() ?? '',
      categoryId: json['category_id']?.toString() ?? '',
      shortDescription: json['short_description']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      isFeatured: json['is_featured'] == true,
    );
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  String get mrpLabel {
    final price = mrp.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }
}
