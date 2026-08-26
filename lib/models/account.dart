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
  });

  final String id;
  final String label;
  final String fullName;
  final String phone;
  final String line1;
  final String line2;
  final String city;
  final String state;
  final String postalCode;
  final String country;
  final bool isDefault;

  factory Address.fromJson(Map<String, dynamic> json) {
    return Address(
      id: json['id']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      fullName: json['full_name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      line1: json['line1']?.toString() ?? '',
      line2: json['line2']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      postalCode: json['postal_code']?.toString() ?? '',
      country: json['country']?.toString() ?? 'India',
      isDefault: json['is_default'] == true,
    );
  }

  String get summary {
    return [
      line1,
      line2,
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
    required this.name,
    required this.thumbnailUrl,
    required this.sellingPrice,
    required this.currency,
  });

  final String id;
  final String productId;
  final String name;
  final String thumbnailUrl;
  final double sellingPrice;
  final String currency;

  factory WishlistItem.fromJson(Map<String, dynamic> json) {
    return WishlistItem(
      id: json['id']?.toString() ?? '',
      productId: json['product_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      thumbnailUrl: json['thumbnail_url']?.toString() ?? '',
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
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
    );
  }

  String get amountLabel {
    final price = amount.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}
