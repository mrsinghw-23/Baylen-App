class UserProfile {
  const UserProfile({
    required this.userId,
    required this.fullName,
    required this.mobile,
    required this.email,
    required this.gender,
    required this.dateOfBirth,
    required this.profilePhotoUrl,
    required this.loyaltyTier,
    required this.loyaltyPoints,
    this.createdAt = '',
  });

  final String userId;
  final String fullName;
  final String mobile;
  final String email;
  final String gender;
  final String dateOfBirth;
  final String profilePhotoUrl;
  final String loyaltyTier;
  final int loyaltyPoints;
  final String createdAt;

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      userId: json['user_id']?.toString() ?? '',
      fullName: json['full_name']?.toString() ?? '',
      mobile: json['mobile']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      gender: json['gender']?.toString() ?? '',
      dateOfBirth: json['date_of_birth']?.toString() ?? '',
      profilePhotoUrl: json['profile_photo_url']?.toString() ?? '',
      loyaltyTier: json['loyalty_tier']?.toString() ?? 'Base',
      loyaltyPoints: (json['loyalty_points'] as num?)?.toInt() ?? 0,
      createdAt: json['created_at']?.toString() ?? '',
    );
  }
}

class Address {
  const Address({
    required this.id,
    required this.label,
    required this.fullName,
    required this.phone,
    required this.line1,
    required this.line2,
    required this.city,
    required this.state,
    required this.postalCode,
    required this.country,
    required this.isDefault,
    this.landmark = '',
    this.latitude,
    this.longitude,
  });

  final String id;
  final String label;
  final String fullName;
  final String phone;
  final String line1;
  final String line2;
  final String landmark;
  final String city;
  final String state;
  final String postalCode;
  final String country;
  final bool isDefault;
  final double? latitude;
  final double? longitude;

  factory Address.fromJson(Map<String, dynamic> json) {
    double? parseCoord(dynamic value) {
      if (value == null) return null;
      if (value is num) return value.toDouble();
      return double.tryParse(value.toString());
    }

    return Address(
      id: json['id']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      fullName: json['full_name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      line1: json['line1']?.toString() ?? '',
      line2: json['line2']?.toString() ?? '',
      landmark: json['landmark']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      postalCode: json['postal_code']?.toString() ?? '',
      country: json['country']?.toString() ?? 'India',
      isDefault: json['is_default'] == true,
      latitude: parseCoord(json['latitude']),
      longitude: parseCoord(json['longitude']),
    );
  }

  String get summary {
    return [
      line1,
      line2,
      if (landmark.isNotEmpty) landmark,
      city,
      state,
      postalCode,
    ].where((part) => part.isNotEmpty).join(', ');
  }
}

class WishlistItem {
  const WishlistItem({
    required this.id,
    required this.productId,
    required this.variantId,
    required this.name,
    required this.thumbnailUrl,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
  });

  final String id;
  final String productId;
  final String variantId;
  final String name;
  final String thumbnailUrl;
  final double mrp;
  final double sellingPrice;
  final String currency;

  factory WishlistItem.fromJson(Map<String, dynamic> json) {
    return WishlistItem(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      variantId: json['variant_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
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

class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.referenceType,
    required this.referenceId,
    required this.provider,
    required this.providerOrderId,
    required this.providerPaymentId,
    required this.amount,
    required this.currency,
    required this.status,
    required this.metadata,
    this.fulfillmentReady = false,
    this.canResume = false,
    this.canRequestRefund = false,
  });

  final String id;
  final String referenceType;
  final String referenceId;
  final String provider;
  final String providerOrderId;
  final String providerPaymentId;
  final double amount;
  final String currency;
  final String status;
  final String metadata;
  final bool fulfillmentReady;
  final bool canResume;
  final bool canRequestRefund;
  bool get isConfirmed => status == 'SUCCESS' && fulfillmentReady;

  factory PaymentRecord.fromJson(Map<String, dynamic> json) {
    return PaymentRecord(
      id: json['id']?.toString() ?? '',
      referenceType: json['reference_type']?.toString() ?? '',
      referenceId: json['reference_id']?.toString() ?? '',
      provider: json['provider']?.toString() ?? '',
      providerOrderId: json['provider_order_id']?.toString() ?? '',
      providerPaymentId: json['provider_payment_id']?.toString() ?? '',
      amount: (json['amount'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      status: json['status']?.toString() ?? '',
      metadata: json['metadata']?.toString() ?? '',
      fulfillmentReady: json['fulfillment_ready'] == true,
      canResume: json['can_resume'] == true,
      canRequestRefund: json['can_request_refund'] == true,
    );
  }

  String get amountLabel {
    final price = amount.toStringAsFixed(2);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}
