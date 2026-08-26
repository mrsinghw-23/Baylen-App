class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.name,
    required this.thumbnailUrl,
    required this.quantity,
    required this.unitPrice,
    required this.unitMrp,
    required this.lineTotal,
    required this.currency,
  });

  final String id;
  final String productId;
  final String name;
  final String thumbnailUrl;
  final int quantity;
  final double unitPrice;
  final double unitMrp;
  final double lineTotal;
  final String currency;

  factory CartItem.fromJson(Map<String, dynamic> json) {
    return CartItem(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      unitPrice: (json['unit_price'] as num?)?.toDouble() ?? 0,
      unitMrp: (json['unit_mrp'] as num?)?.toDouble() ?? 0,
      lineTotal: (json['line_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get priceLabel {
    final price = unitPrice.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  String get lineLabel {
    final price = lineTotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}

class CartCoupon {
  const CartCoupon({
    required this.id,
    required this.code,
    required this.title,
    required this.description,
    required this.discountAmount,
  });

  final String id;
  final String code;
  final String title;
  final String description;
  final double discountAmount;

  factory CartCoupon.fromJson(Map<String, dynamic> json) {
    return CartCoupon(
      id: json['id']?.toString() ?? '',
      code: json['code']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0,
    );
  }
}

class Cart {
  const Cart({
    required this.id,
    required this.currency,
    required this.items,
    required this.itemCount,
    required this.subtotal,
    required this.discountAmount,
    required this.total,
    required this.coupon,
    required this.couponError,
  });

  final String id;
  final String currency;
  final List<CartItem> items;
  final int itemCount;
  final double subtotal;
  final double discountAmount;
  final double total;
  final CartCoupon? coupon;
  final String couponError;

  bool get isEmpty => items.isEmpty;

  String get subtotalLabel {
    final price = subtotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  String get discountLabel {
    final price = discountAmount.toStringAsFixed(0);
    return currency == 'INR' ? '-INR $price' : '-$currency $price';
  }

  String get totalLabel {
    final price = total.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  factory Cart.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    final rawCoupon = json['coupon'];
    final subtotal = (json['subtotal'] as num?)?.toDouble() ?? 0;
    return Cart(
      id: json['id']?.toString() ?? '',
      currency: json['currency']?.toString() ?? 'INR',
      items: rawItems is List
          ? rawItems
                .whereType<Map<String, dynamic>>()
                .map(CartItem.fromJson)
                .toList()
          : const [],
      itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
      subtotal: subtotal,
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0,
      total: (json['total'] as num?)?.toDouble() ?? subtotal,
      coupon: rawCoupon is Map<String, dynamic>
          ? CartCoupon.fromJson(rawCoupon)
          : null,
      couponError: json['coupon_error']?.toString() ?? '',
    );
  }

  static Cart empty() {
    return const Cart(
      id: '',
      currency: 'INR',
      items: [],
      itemCount: 0,
      subtotal: 0,
      discountAmount: 0,
      total: 0,
      coupon: null,
      couponError: '',
    );
  }
}
