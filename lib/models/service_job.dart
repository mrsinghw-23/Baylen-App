class ServiceJob {
  const ServiceJob({
    required this.id,
    required this.appointmentId,
    required this.providerId,
    required this.status,
    required this.visitLine1,
    required this.visitCity,
    required this.scheduledAt,
    required this.grandTotal,
    required this.currency,
  });

  final String id;
  final String appointmentId;
  final String providerId;
  final String status;
  final String visitLine1;
  final String visitCity;
  final String scheduledAt;
  final double grandTotal;
  final String currency;

  factory ServiceJob.fromJson(Map<String, dynamic> json) {
    return ServiceJob(
      id: json['id']?.toString() ?? '',
      appointmentId: json['appointment_id']?.toString() ?? '',
      providerId: json['provider_id']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      visitLine1: json['visit_line1']?.toString() ?? '',
      visitCity: json['visit_city']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }

  String get amountLabel {
    final price = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }
}

class ServiceProviderSummary {
  const ServiceProviderSummary({
    required this.id,
    required this.name,
    required this.phone,
    required this.rating,
  });

  final String id;
  final String name;
  final String phone;
  final double rating;

  factory ServiceProviderSummary.fromJson(Map<String, dynamic> json) {
    return ServiceProviderSummary(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
    );
  }
}

class LiveLocation {
  const LiveLocation({
    required this.id,
    required this.latitude,
    required this.longitude,
    required this.heading,
    required this.speed,
    required this.status,
    required this.recordedAt,
  });

  final String id;
  final double latitude;
  final double longitude;
  final double heading;
  final double speed;
  final String status;
  final String recordedAt;

  factory LiveLocation.fromJson(Map<String, dynamic> json) {
    return LiveLocation(
      id: json['id']?.toString() ?? '',
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      heading: (json['heading'] as num?)?.toDouble() ?? 0,
      speed: (json['speed'] as num?)?.toDouble() ?? 0,
      status: json['status']?.toString() ?? '',
      recordedAt: json['recorded_at']?.toString() ?? '',
    );
  }
}

class ServiceJobTracking {
  const ServiceJobTracking({
    required this.job,
    required this.provider,
    required this.latestLocation,
    required this.locations,
  });

  final ServiceJob job;
  final ServiceProviderSummary? provider;
  final LiveLocation? latestLocation;
  final List<LiveLocation> locations;

  factory ServiceJobTracking.fromJson(Map<String, dynamic> json) {
    final provider = json['provider'];
    final latestLocation = json['latest_location'];
    final locations = json['locations'];
    return ServiceJobTracking(
      job: ServiceJob.fromJson(
        (json['job'] as Map<String, dynamic>?) ?? <String, dynamic>{},
      ),
      provider: provider is Map<String, dynamic>
          ? ServiceProviderSummary.fromJson(provider)
          : null,
      latestLocation: latestLocation is Map<String, dynamic>
          ? LiveLocation.fromJson(latestLocation)
          : null,
      locations: locations is List
          ? locations
                .whereType<Map<String, dynamic>>()
                .map(LiveLocation.fromJson)
                .toList()
          : const [],
    );
  }
}
