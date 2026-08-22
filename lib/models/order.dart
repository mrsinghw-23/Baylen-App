class OrderItem {
  const OrderItem({
    required this.id,
    required this.productId,
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.lineTotal,
  });

  final String id;
  final String productId;
  final String name;
  final int quantity;
  final double unitPrice;
  final double lineTotal;

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    return OrderItem(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      quantity: (json['quantity'] as num?)?.toInt() ?? 0,
      unitPrice: (json['unit_price'] as num?)?.toDouble() ?? 0,
      lineTotal: (json['line_total'] as num?)?.toDouble() ?? 0,
    );
  }
}

class ShopOrder {
  const ShopOrder({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.subtotal,
    required this.grandTotal,
    required this.shippingName,
    required this.shippingLine1,
    required this.shippingCity,
    required this.items,
  });

  final String id;
  final String orderNumber;
  final String status;
  final String paymentStatus;
  final String currency;
  final double subtotal;
  final double grandTotal;
  final String shippingName;
  final String shippingLine1;
  final String shippingCity;
  final List<OrderItem> items;

  String get totalLabel {
    final price = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? '₹$price' : '$currency $price';
  }

  factory ShopOrder.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return ShopOrder(
      id: json['id']?.toString() ?? '',
      orderNumber: json['order_number']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      paymentStatus: json['payment_status']?.toString() ?? '',
      currency: json['currency']?.toString() ?? 'INR',
      subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0,
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      shippingName: json['shipping_name']?.toString() ?? '',
      shippingLine1: json['shipping_line1']?.toString() ?? '',
      shippingCity: json['shipping_city']?.toString() ?? '',
      items: rawItems is List
          ? rawItems.whereType<Map<String, dynamic>>().map(OrderItem.fromJson).toList()
          : const [],
    );
  }
}
