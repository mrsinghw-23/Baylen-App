class SalonOutlet {
  const SalonOutlet({
    required this.id,
    required this.name,
    required this.addressLine1,
    required this.city,
    required this.phone,
    required this.openingTime,
    required this.closingTime,
    this.rating = 0.0,
    this.reviewCount = 0,
    this.imageUrl = '',
    this.salonCategory = '',
    this.state = '',
    this.area = '',
    this.latitude = 0.0,
    this.longitude = 0.0,
    this.distanceKm = 0.0,
    this.availability = '',
    this.relevantServices = const [],
    this.googleMapsUrl = '',
    this.isActive = true,
  });

  final String id;
  final String name;
  final String addressLine1;
  final String city;
  final String phone;
  final String openingTime;
  final String closingTime;
  final double rating;
  final int reviewCount;
  final String imageUrl;
  final String salonCategory;
  final String state;
  final String area;
  final double latitude;
  final double longitude;
  final double distanceKm;
  final String availability;
  final List<OutletServicePreview> relevantServices;
  final String googleMapsUrl;
  final bool isActive;

  factory SalonOutlet.fromJson(Map<String, dynamic> json) {
    return SalonOutlet(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      addressLine1: json['address_line1']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      openingTime: json['opening_time']?.toString() ?? '',
      closingTime: json['closing_time']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0.0,
      reviewCount: (json['review_count'] as num?)?.toInt() ?? 0,
      imageUrl: json['image_url']?.toString() ?? '',
      salonCategory: json['salon_category']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      area: json['area']?.toString() ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0.0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0.0,
      distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0.0,
      availability: json['availability']?.toString() ?? '',
      relevantServices: _services(json['relevant_services']),
      googleMapsUrl: json['google_maps_url']?.toString() ?? '',
      isActive: json['is_active'] != false,
    );
  }

  static List<OutletServicePreview> _services(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<Map<String, dynamic>>()
        .map(OutletServicePreview.fromJson)
        .toList();
  }

  String get subtitle {
    final parts = [addressLine1, city].where((part) => part.isNotEmpty);
    return parts.join(', ');
  }

  String get distanceLabel {
    if (distanceKm <= 0) return '';
    return '${distanceKm.toStringAsFixed(1)} km away';
  }

  String get ratingLabel => rating > 0 ? rating.toStringAsFixed(1) : '';

  String get locationLabel {
    final parts = [area, city].where((part) => part.isNotEmpty).toList();
    if (parts.isEmpty) return addressLine1;
    return parts.join(', ');
  }

  String get hoursLabel {
    if (openingTime.isEmpty || closingTime.isEmpty) return '';
    return '$openingTime - $closingTime';
  }

  String get mapsUrl {
    if (googleMapsUrl.trim().isNotEmpty) {
      return googleMapsUrl.trim();
    }
    if (latitude == 0 || longitude == 0) {
      return '';
    }
    return 'https://www.google.com/maps/search/?api=1&query=$latitude,$longitude';
  }

  String get directionsUrl {
    if (latitude != 0 && longitude != 0) {
      return 'https://www.google.com/maps/dir/?api=1&destination=$latitude,$longitude&travelmode=walking';
    }
    return mapsUrl;
  }
}

class OutletServicePreview {
  const OutletServicePreview({
    required this.id,
    required this.name,
    required this.durationMinutes,
    required this.sellingPrice,
    required this.currency,
  });

  final String id;
  final String name;
  final int durationMinutes;
  final double sellingPrice;
  final String currency;

  factory OutletServicePreview.fromJson(Map<String, dynamic> json) {
    return OutletServicePreview(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}

class SalonService {
  const SalonService({
    required this.id,
    required this.name,
    required this.description,
    required this.imageUrl,
    required this.durationMinutes,
    required this.mrp,
    required this.sellingPrice,
    required this.currency,
  });

  final String id;
  final String name;
  final String description;
  final String imageUrl;
  final int durationMinutes;
  final double mrp;
  final double sellingPrice;
  final String currency;

  factory SalonService.fromJson(Map<String, dynamic> json) {
    return SalonService(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,
      mrp: (json['mrp'] as num?)?.toDouble() ?? 0,
      sellingPrice: (json['selling_price'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get priceLabel {
    final price = sellingPrice.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  String get durationLabel => '$durationMinutes min';
}

class SalonStaff {
  const SalonStaff({
    required this.id,
    required this.name,
    required this.designation,
    required this.outletId,
  });

  final String id;
  final String name;
  final String designation;
  final String outletId;

  factory SalonStaff.fromJson(Map<String, dynamic> json) {
    return SalonStaff(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      designation: json['designation']?.toString() ?? '',
      outletId: json['outlet_id']?.toString() ?? '',
    );
  }
}

class SalonSlot {
  const SalonSlot({
    required this.id,
    required this.outletId,
    required this.staffId,
    required this.slotDate,
    required this.startTime,
    required this.endTime,
  });

  final String id;
  final String outletId;
  final String staffId;
  final String slotDate;
  final String startTime;
  final String endTime;

  factory SalonSlot.fromJson(Map<String, dynamic> json) {
    return SalonSlot(
      id: json['id']?.toString() ?? json['ROWID']?.toString() ?? '',
      outletId: json['outlet_id']?.toString() ?? '',
      staffId: json['staff_id']?.toString() ?? '',
      slotDate: json['slot_date']?.toString() ?? '',
      startTime: json['start_time']?.toString() ?? '',
      endTime: json['end_time']?.toString() ?? '',
    );
  }

  String get timeLabel => '$startTime - $endTime';
}

class SalonAppointment {
  const SalonAppointment({
    required this.id,
    required this.appointmentNumber,
    required this.appointmentDate,
    required this.startTime,
    required this.endTime,
    required this.status,
    required this.paymentStatus,
    required this.currency,
    required this.grandTotal,
    required this.items,
  });

  final String id;
  final String appointmentNumber;
  final String appointmentDate;
  final String startTime;
  final String endTime;
  final String status;
  final String paymentStatus;
  final String currency;
  final double grandTotal;
  final List<SalonAppointmentItem> items;

  factory SalonAppointment.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return SalonAppointment(
      id: json['id']?.toString() ?? '',
      appointmentNumber: json['appointment_number']?.toString() ?? '',
      appointmentDate: json['appointment_date']?.toString() ?? '',
      startTime: json['start_time']?.toString() ?? '',
      endTime: json['end_time']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      paymentStatus: json['payment_status']?.toString() ?? '',
      currency: json['currency']?.toString() ?? 'INR',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      items: rawItems is List
          ? rawItems
                .whereType<Map<String, dynamic>>()
                .map(SalonAppointmentItem.fromJson)
                .toList()
          : const [],
    );
  }

  String get totalLabel {
    final price = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  String get serviceLabel {
    if (items.isEmpty) {
      return 'Appointment';
    }
    return items.map((item) => item.name).join(', ');
  }
}

class SalonAppointmentItem {
  const SalonAppointmentItem({
    required this.id,
    required this.serviceId,
    required this.name,
    required this.durationMinutes,
  });

  final String id;
  final String serviceId;
  final String name;
  final int durationMinutes;

  factory SalonAppointmentItem.fromJson(Map<String, dynamic> json) {
    return SalonAppointmentItem(
      id: json['id']?.toString() ?? '',
      serviceId: json['service_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,
    );
  }
}
