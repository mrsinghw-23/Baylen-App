class FulfillmentOptionMode {
  static const quickCommerce = 'QUICK_COMMERCE';
  static const ecommerce = 'E_COMMERCE';
  static const split = 'SPLIT';
}

class DeliveryAvailability {
  const DeliveryAvailability({
    required this.available,
    required this.reason,
    required this.label,
    required this.etaLabel,
    this.storeName = '',
    this.distanceKm,
    this.availableQuantity = 0,
  });

  final bool available;
  final String reason;
  final String label;
  final String etaLabel;
  final String storeName;
  final double? distanceKm;
  final int availableQuantity;

  factory DeliveryAvailability.fromJson(Map<String, dynamic>? json) {
    final map = json ?? const <String, dynamic>{};
    final store = map['store'];
    String storeName = '';
    double? distance;
    if (store is Map) {
      storeName = store['store_name']?.toString() ?? '';
      distance = (store['distance_km'] as num?)?.toDouble();
    }
    return DeliveryAvailability(
      available: map['available'] == true,
      reason: map['reason']?.toString() ?? '',
      label: map['label']?.toString() ?? '',
      etaLabel: map['eta_label']?.toString() ?? '',
      storeName: storeName,
      distanceKm: distance,
      availableQuantity: (map['available_quantity'] as num?)?.toInt() ?? 0,
    );
  }
}

class ProductFulfillmentAvailability {
  const ProductFulfillmentAvailability({
    required this.productId,
    required this.quickCommerce,
    required this.standardEcommerce,
    required this.warnings,
  });

  final String productId;
  final DeliveryAvailability quickCommerce;
  final DeliveryAvailability standardEcommerce;
  final List<String> warnings;

  factory ProductFulfillmentAvailability.fromJson(Map<String, dynamic> json) {
    final availability = json['availability'] is Map<String, dynamic>
        ? json['availability'] as Map<String, dynamic>
        : json;
    final warningsRaw = availability['warnings'];
    return ProductFulfillmentAvailability(
      productId: availability['product_id']?.toString() ?? '',
      quickCommerce: DeliveryAvailability.fromJson(
        availability['quick_commerce'] is Map<String, dynamic>
            ? availability['quick_commerce'] as Map<String, dynamic>
            : null,
      ),
      standardEcommerce: DeliveryAvailability.fromJson(
        availability['standard_ecommerce'] is Map<String, dynamic>
            ? availability['standard_ecommerce'] as Map<String, dynamic>
            : null,
      ),
      warnings: warningsRaw is List
          ? warningsRaw.map((e) => e.toString()).toList()
          : const [],
    );
  }
}

class FulfillmentOption {
  const FulfillmentOption({
    required this.mode,
    required this.available,
    required this.label,
    required this.etaLabel,
    required this.itemCount,
    this.description = '',
    this.groups = const [],
  });

  final String mode;
  final bool available;
  final String label;
  final String etaLabel;
  final int itemCount;
  final String description;
  final List<FulfillmentOption> groups;

  factory FulfillmentOption.fromJson(Map<String, dynamic> json) {
    final groupsRaw = json['groups'];
    return FulfillmentOption(
      mode: json['mode']?.toString() ?? '',
      available: json['available'] == true,
      label: json['label']?.toString() ?? '',
      etaLabel: json['eta_label']?.toString() ?? '',
      itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
      description: json['description']?.toString() ?? '',
      groups: groupsRaw is List
          ? groupsRaw
                .whereType<Map>()
                .map(
                  (e) => FulfillmentOption.fromJson(
                    Map<String, dynamic>.from(e),
                  ),
                )
                .toList()
          : const [],
    );
  }
}

class CartFulfillmentResult {
  const CartFulfillmentResult({
    required this.options,
    required this.quickCommerceAvailable,
    required this.standardEcommerceAvailable,
    required this.splitAvailable,
    required this.warnings,
    this.codBlockedReason,
  });

  final List<FulfillmentOption> options;
  final bool quickCommerceAvailable;
  final bool standardEcommerceAvailable;
  final bool splitAvailable;
  final List<String> warnings;
  final String? codBlockedReason;

  factory CartFulfillmentResult.fromJson(Map<String, dynamic> json) {
    final fulfillment = json['fulfillment'] is Map<String, dynamic>
        ? json['fulfillment'] as Map<String, dynamic>
        : json;
    final summary = fulfillment['summary'] is Map<String, dynamic>
        ? fulfillment['summary'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final payment = fulfillment['payment_hints'] is Map<String, dynamic>
        ? fulfillment['payment_hints'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final optionsRaw = fulfillment['options'];
    final warningsRaw = fulfillment['warnings'];
    return CartFulfillmentResult(
      options: optionsRaw is List
          ? optionsRaw
                .whereType<Map>()
                .map(
                  (e) => FulfillmentOption.fromJson(
                    Map<String, dynamic>.from(e),
                  ),
                )
                .toList()
          : const [],
      quickCommerceAvailable: summary['quick_commerce_available'] == true,
      standardEcommerceAvailable:
          summary['standard_ecommerce_available'] == true,
      splitAvailable: summary['split_available'] == true,
      warnings: warningsRaw is List
          ? warningsRaw.map((e) => e.toString()).toList()
          : const [],
      codBlockedReason: payment['cod_blocked_reason']?.toString(),
    );
  }
}
