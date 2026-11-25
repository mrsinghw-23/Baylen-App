import 'catalog.dart';

String cartMoney(String currency, double amount, {bool minus = false}) {
  final price = amount.toStringAsFixed(0);
  final value = currency == 'INR' ? '₹$price' : '$currency $price';
  return minus ? '-$value' : value;
}

class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.variantId,
    required this.name,
    required this.variantLabel,
    required this.thumbnailUrl,
    required this.quantity,
    required this.unitPrice,
    required this.unitMrp,
    required this.lineTotal,
    required this.lineMrp,
    required this.taxPercent,
    required this.availableQuantity,
    required this.inStock,
    required this.unavailable,
    required this.currency,
  });

  final String id;
  final String productId;
  final String variantId;
  final String name;
  final String variantLabel;
  final String thumbnailUrl;
  final int quantity;
  final double unitPrice;
  final double unitMrp;
  final double lineTotal;
  final double lineMrp;
  final double taxPercent;
  final int availableQuantity;
  final bool inStock;
  final bool unavailable;
  final String currency;

  int get lineSavings => (lineMrp - lineTotal).round();

  factory CartItem.fromJson(Map<String, dynamic> json) {
    final quantity = (json['quantity'] as num?)?.toInt() ?? 0;
    final unitPrice = (json['unit_price'] as num?)?.toDouble() ?? 0;
    final unitMrp = (json['unit_mrp'] as num?)?.toDouble() ?? 0;
    final lineTotal =
        (json['line_total'] as num?)?.toDouble() ?? unitPrice * quantity;
    final lineMrp = (json['line_mrp'] as num?)?.toDouble() ?? unitMrp * quantity;
    return CartItem(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      variantId: json['variant_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      variantLabel: json['variant_label']?.toString() ?? '',
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      quantity: quantity,
      unitPrice: unitPrice,
      unitMrp: unitMrp,
      lineTotal: lineTotal,
      lineMrp: lineMrp,
      taxPercent: (json['tax_percent'] as num?)?.toDouble() ?? 0,
      availableQuantity: (json['available_quantity'] as num?)?.toInt() ?? 0,
      inStock: json['in_stock'] != false,
      unavailable: json['unavailable'] == true,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get priceLabel => cartMoney(currency, unitPrice);

  String get lineLabel => cartMoney(currency, lineTotal);

  String get mrpLabel => cartMoney(currency, unitMrp);
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
    required this.isGuest,
    required this.items,
    required this.itemCount,
    required this.mrpTotal,
    required this.subtotal,
    required this.itemSavings,
    required this.discountAmount,
    required this.taxAmount,
    required this.taxIncluded,
    required this.shippingAmount,
    required this.shippingLabel,
    required this.total,
    required this.coupon,
    required this.couponError,
    required this.lastMinuteAdditions,
    required this.youMayAlsoLike,
    required this.frequentlyBoughtTogether,
    required this.offers,
  });

  final String id;
  final String currency;
  final bool isGuest;
  final List<CartItem> items;
  final int itemCount;
  final double mrpTotal;
  final double subtotal;
  final double itemSavings;
  final double discountAmount;
  final double taxAmount;
  final bool taxIncluded;
  final double shippingAmount;
  final String shippingLabel;
  final double total;
  final CartCoupon? coupon;
  final String couponError;
  final List<CatalogProduct> lastMinuteAdditions;
  final List<CatalogProduct> youMayAlsoLike;
  final List<CatalogProduct> frequentlyBoughtTogether;
  final List<ShopHomeOffer> offers;

  bool get isEmpty => items.isEmpty;

  double get totalSavings => itemSavings + discountAmount;

  String get subtotalLabel => cartMoney(currency, subtotal);

  String get discountLabel => cartMoney(currency, discountAmount, minus: true);

  String get totalLabel => cartMoney(currency, total);

  String get taxLabel => cartMoney(currency, taxAmount);

  String get shippingValueLabel =>
      shippingAmount <= 0 ? 'Free' : cartMoney(currency, shippingAmount);

  factory Cart.fromPayload(Map<String, dynamic> data) {
    final cart = data['cart'];
    if (cart is Map<String, dynamic>) {
      return Cart.fromJson(cart, data);
    }
    return Cart.empty();
  }

  factory Cart.fromJson(
    Map<String, dynamic> json, [
    Map<String, dynamic>? payload,
  ]) {
    final rawItems = json['items'];
    final rawCoupon = json['coupon'];
    final subtotal = (json['subtotal'] as num?)?.toDouble() ?? 0;
    final recs = payload?['recommendations'];
    final recMap = recs is Map<String, dynamic> ? recs : const <String, dynamic>{};
    final offers = payload?['offers'];
    List<CatalogProduct> products(String key) {
      final value = recMap[key];
      if (value is! List) {
        return const [];
      }
      return value
          .whereType<Map<String, dynamic>>()
          .map(CatalogProduct.fromJson)
          .toList();
    }

    return Cart(
      id: json['id']?.toString() ?? '',
      currency: json['currency']?.toString() ?? 'INR',
      isGuest: json['is_guest'] == true,
      items: rawItems is List
          ? rawItems
                .whereType<Map<String, dynamic>>()
                .map(CartItem.fromJson)
                .toList()
          : const [],
      itemCount: (json['item_count'] as num?)?.toInt() ?? 0,
      mrpTotal: (json['mrp_total'] as num?)?.toDouble() ?? subtotal,
      subtotal: subtotal,
      itemSavings: (json['item_savings'] as num?)?.toDouble() ?? 0,
      discountAmount: (json['discount_amount'] as num?)?.toDouble() ?? 0,
      taxAmount: (json['tax_amount'] as num?)?.toDouble() ?? 0,
      taxIncluded: json['tax_included'] != false,
      shippingAmount: (json['shipping_amount'] as num?)?.toDouble() ?? 0,
      shippingLabel: json['shipping_label']?.toString() ?? 'Free delivery',
      total: (json['total'] as num?)?.toDouble() ?? subtotal,
      coupon: rawCoupon is Map<String, dynamic>
          ? CartCoupon.fromJson(rawCoupon)
          : null,
      couponError: json['coupon_error']?.toString() ?? '',
      lastMinuteAdditions: products('last_minute_additions'),
      youMayAlsoLike: products('you_may_also_like'),
      frequentlyBoughtTogether: products('frequently_bought_together'),
      offers: offers is List
          ? offers
                .whereType<Map<String, dynamic>>()
                .map(ShopHomeOffer.fromJson)
                .toList()
          : const [],
    );
  }

  static Cart empty() {
    return const Cart(
      id: '',
      currency: 'INR',
      isGuest: true,
      items: [],
      itemCount: 0,
      mrpTotal: 0,
      subtotal: 0,
      itemSavings: 0,
      discountAmount: 0,
      taxAmount: 0,
      taxIncluded: true,
      shippingAmount: 0,
      shippingLabel: 'Free delivery',
      total: 0,
      coupon: null,
      couponError: '',
      lastMinuteAdditions: [],
      youMayAlsoLike: [],
      frequentlyBoughtTogether: [],
      offers: [],
    );
  }
}
