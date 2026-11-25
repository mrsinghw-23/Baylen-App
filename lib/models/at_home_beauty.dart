class BeautyCategory {  const BeautyCategory({
    required this.slug,
    required this.name,
    required this.iconKey,
  });

  final String slug;
  final String name;
  final String iconKey;

  factory BeautyCategory.fromJson(Map<String, dynamic> json) {
    return BeautyCategory(
      slug: json['slug']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      iconKey: json['icon_key']?.toString() ?? 'more',
    );
  }
}

class AtHomeOutlet {
  const AtHomeOutlet({
    required this.id,
    required this.name,
    required this.city,
    required this.state,
    required this.latitude,
    required this.longitude,
    required this.distanceKm,
    required this.rating,
    required this.imageUrl,
  });

  final String id;
  final String name;
  final String city;
  final String state;
  final double latitude;
  final double longitude;
  final double? distanceKm;
  final double rating;
  final String imageUrl;

  factory AtHomeOutlet.fromJson(Map<String, dynamic> json) {
    return AtHomeOutlet(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      distanceKm: (json['distance_km'] as num?)?.toDouble(),
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      imageUrl: json['image_url']?.toString() ?? '',
    );
  }
}

class AtHomeService {
  const AtHomeService({
    required this.id,
    required this.name,
    required this.description,
    required this.serviceType,
    required this.durationMinutes,
    required this.sellingPrice,
    required this.currency,
    required this.imageUrl,
  });

  final String id;
  final String name;
  final String description;
  final String serviceType;
  final int durationMinutes;
  final double sellingPrice;
  final String currency;
  final String imageUrl;

  factory AtHomeService.fromJson(Map<String, dynamic> json) {
    return AtHomeService(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      serviceType: json['service_type']?.toString() ?? '',
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 45,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      imageUrl: json['image_url']?.toString() ?? '',
    );
  }

  String get priceLabel {
    final amount = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? '₹$amount' : '$currency $amount';
  }
}

class AtHomeServiceSlot {
  const AtHomeServiceSlot({
    required this.id,
    required this.slotDate,
    required this.startTime,
    required this.endTime,
    required this.available,
  });

  final String id;
  final String slotDate;
  final String startTime;
  final String endTime;
  final bool available;

  factory AtHomeServiceSlot.fromJson(Map<String, dynamic> json) {
    return AtHomeServiceSlot(
      id: json['id']?.toString() ?? '',
      slotDate: json['slot_date']?.toString() ?? '',
      startTime: json['start_time']?.toString() ?? '',
      endTime: json['end_time']?.toString() ?? '',
      available: json['available'] == true || json['available'] == 'true',
    );
  }
}

class HomeServiceProfessional {
  const HomeServiceProfessional({
    required this.id,
    required this.name,
    required this.rating,
    required this.designation,
    required this.profilePhotoUrl,
    required this.experienceYears,
    required this.status,
  });

  final String id;
  final String name;
  final double rating;
  final String designation;
  final String profilePhotoUrl;
  final double experienceYears;
  final String status;

  factory HomeServiceProfessional.fromJson(Map<String, dynamic> json) {
    final first = json['first_name']?.toString() ?? '';
    final last = json['last_name']?.toString() ?? '';
    final combined = json['name']?.toString() ?? '$first $last'.trim();
    return HomeServiceProfessional(
      id: json['id']?.toString() ?? '',
      name: combined,
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      designation: json['designation']?.toString() ?? 'Beauty Professional',
      profilePhotoUrl:
          json['profile_photo_url']?.toString() ??
          json['profile_image']?.toString() ??
          '',
      experienceYears: (json['experience_years'] as num?)?.toDouble() ?? 0,
      status: json['status']?.toString() ?? 'AVAILABLE',
    );
  }

  String get ratingLabel => rating > 0 ? rating.toStringAsFixed(1) : '';
}

class AtHomeServiceability {
  const AtHomeServiceability({
    required this.serviceable,
    required this.city,
    required this.state,
    required this.pincode,
    required this.message,
    required this.eligibleOutletCount,
    this.eligibleOutletIds = const [],
  });

  final bool serviceable;
  final String city;
  final String state;
  final String pincode;
  final String message;
  final int eligibleOutletCount;
  final List<String> eligibleOutletIds;

  factory AtHomeServiceability.fromJson(Map<String, dynamic> json) {
    final outlets = json['eligible_outlets'];
    final ids = outlets is List
        ? outlets
            .whereType<Map<String, dynamic>>()
            .map((item) => item['outlet_id']?.toString() ?? '')
            .where((id) => id.isNotEmpty)
            .toList()
        : <String>[];
    return AtHomeServiceability(
      serviceable: json['serviceable'] == true,
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      pincode: json['pincode']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
      eligibleOutletCount: outlets is List ? outlets.length : 0,
      eligibleOutletIds: ids,
    );
  }
}

class AtHomeBooking {
  const AtHomeBooking({
    required this.id,
    required this.bookingNumber,
    required this.status,
    required this.customerStatus,
    required this.visitLine1,
    required this.visitCity,
    required this.scheduledAt,
    required this.grandTotal,
    required this.currency,
    required this.paymentStatus,
    required this.canCancel,
    required this.liveTracking,
    required this.providerId,
    this.serviceName = '',
    this.genderPreference = '',
    this.outletId = '',
  });

  final String id;
  final String bookingNumber;
  final String status;
  final String customerStatus;
  final String visitLine1;
  final String visitCity;
  final String scheduledAt;
  final double grandTotal;
  final String currency;
  final String paymentStatus;
  final bool canCancel;
  final bool liveTracking;
  final String providerId;
  final String serviceName;
  final String genderPreference;
  final String outletId;

  factory AtHomeBooking.fromJson(Map<String, dynamic> json) {
    return AtHomeBooking(
      id: json['id']?.toString() ?? '',
      bookingNumber: json['booking_number']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      customerStatus: json['customer_status']?.toString() ?? '',
      visitLine1: json['visit_line1']?.toString() ?? '',
      visitCity: json['visit_city']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      paymentStatus: json['payment_status']?.toString() ?? '',
      canCancel: json['can_cancel'] == true,
      liveTracking: json['live_tracking'] == true,
      providerId: json['provider_id']?.toString() ?? '',
      serviceName: json['service_name']?.toString() ?? '',
      genderPreference: json['gender_preference']?.toString() ?? '',
      outletId: json['outlet_id']?.toString() ?? '',
    );
  }

  String get amountLabel {
    final amount = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? '₹$amount' : '$currency $amount';
  }

  String get displayStatus =>
      customerStatus.isNotEmpty ? customerStatus : status;
}

class AtHomeBookingsPage {
  const AtHomeBookingsPage({
    required this.bookings,
    required this.total,
    required this.hasMore,
  });

  final List<AtHomeBooking> bookings;
  final int total;
  final bool hasMore;
}

class RouteEstimate {
  const RouteEstimate({
    required this.distanceKm,
    required this.etaMinutes,
    required this.etaLabel,
  });

  final double? distanceKm;
  final int? etaMinutes;
  final String? etaLabel;

  factory RouteEstimate.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const RouteEstimate(
        distanceKm: null,
        etaMinutes: null,
        etaLabel: null,
      );
    }
    return RouteEstimate(
      distanceKm: (json['distance_km'] as num?)?.toDouble(),
      etaMinutes: (json['eta_minutes'] as num?)?.toInt(),
      etaLabel: json['eta_label']?.toString(),
    );
  }
}

class AtHomeBookingTracking {
  const AtHomeBookingTracking({
    required this.booking,
    required this.customerStatus,
    required this.liveTracking,
    required this.visitLat,
    required this.visitLng,
    required this.visitLine1,
    required this.visitCity,
    required this.providerName,
    required this.providerPhone,
    required this.providerRating,
    this.providerPhotoUrl = '',
    this.providerPhotoFetchUrl = '',
    this.providerHasPhoto = false,
    required this.providerLat,
    required this.providerLng,
    required this.route,
    required this.arrivalOtpCode,
    required this.arrivalOtpRequired,
    required this.arrivalOtpMessage,
    required this.extraServiceName,
    required this.extraServicePrice,
  });

  final AtHomeBooking booking;
  final String customerStatus;
  final bool liveTracking;
  final double? visitLat;
  final double? visitLng;
  final String visitLine1;
  final String visitCity;
  final String providerName;
  final String providerPhone;
  final double providerRating;
  final String providerPhotoUrl;
  final String providerPhotoFetchUrl;
  final bool providerHasPhoto;
  final double? providerLat;
  final double? providerLng;
  final RouteEstimate route;
  final String? arrivalOtpCode;
  final bool arrivalOtpRequired;
  final String arrivalOtpMessage;
  final String? extraServiceName;
  final double? extraServicePrice;

  factory AtHomeBookingTracking.fromJson(Map<String, dynamic> json) {
    final bookingJson = json['booking'];
    final provider = json['provider'];
    final visit = json['visit'];
    final location = json['provider_location'];
    final otp = json['arrival_otp'];
    final extra = json['extra_service_request'];
    return AtHomeBookingTracking(
      booking: AtHomeBooking.fromJson(
        bookingJson is Map<String, dynamic> ? bookingJson : json,
      ),
      customerStatus: json['customer_status']?.toString() ?? '',
      liveTracking: json['live_tracking'] == true,
      visitLat: visit is Map
          ? (visit['latitude'] as num?)?.toDouble()
          : null,
      visitLng: visit is Map
          ? (visit['longitude'] as num?)?.toDouble()
          : null,
      visitLine1: visit is Map ? visit['line1']?.toString() ?? '' : '',
      visitCity: visit is Map ? visit['city']?.toString() ?? '' : '',
      providerName: provider is Map ? provider['name']?.toString() ?? '' : '',
      providerPhone: provider is Map ? provider['phone']?.toString() ?? '' : '',
      providerRating: provider is Map
          ? (provider['rating'] as num?)?.toDouble() ?? 0
          : 0,
      providerPhotoUrl: provider is Map
          ? provider['profile_photo_url']?.toString() ?? ''
          : '',
      providerPhotoFetchUrl: provider is Map
          ? provider['profile_photo_fetch_url']?.toString() ?? ''
          : '',
      providerHasPhoto: provider is Map && provider['has_profile_photo'] == true,
      providerLat: location is Map
          ? (location['latitude'] as num?)?.toDouble()
          : null,
      providerLng: location is Map
          ? (location['longitude'] as num?)?.toDouble()
          : null,
      route: RouteEstimate.fromJson(
        json['route'] is Map<String, dynamic> ? json['route'] as Map<String, dynamic> : null,
      ),
      arrivalOtpCode: otp is Map ? otp['code']?.toString() : null,
      arrivalOtpRequired: otp is Map && otp['required'] == true,
      arrivalOtpMessage: otp is Map ? otp['message']?.toString() ?? '' : '',
      extraServiceName: extra is Map ? extra['name']?.toString() : null,
      extraServicePrice: extra is Map
          ? (extra['price'] as num?)?.toDouble()
          : null,
    );
  }
}

class AtHomeBookingQuote {
  const AtHomeBookingQuote({
    required this.grandTotal,
    required this.currency,
    required this.serviceName,
    this.subtotal = 0,
    this.convenienceFee = 0,
    this.addonsTotal = 0,
  });

  final double grandTotal;
  final String currency;
  final String serviceName;
  final double subtotal;
  final double convenienceFee;
  final double addonsTotal;

  factory AtHomeBookingQuote.fromJson(Map<String, dynamic> json) {
    return AtHomeBookingQuote(
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
      serviceName: (json['service'] is Map
              ? json['service']['name']
              : null)
          ?.toString() ??
          '',
      subtotal: (json['subtotal'] as num?)?.toDouble() ?? 0,
      convenienceFee: (json['convenience_fee'] as num?)?.toDouble() ?? 0,
      addonsTotal: (json['addons'] is List)
          ? (json['addons'] as List)
              .fold<double>(0, (sum, item) {
                if (item is Map && item['price'] is num) {
                  return sum + (item['price'] as num).toDouble();
                }
                return sum;
              })
          : 0,
    );
  }
}
