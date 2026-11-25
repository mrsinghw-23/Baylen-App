import 'dart:math' as math;

import 'package:url_launcher/url_launcher.dart';

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

class MapsService {
  const MapsService._();

  static const _earthRadiusKm = 6371.0;

  static double haversineKm(
    double lat1,
    double lng1,
    double lat2,
    double lng2,
  ) {
    final dLat = _degToRad(lat2 - lat1);
    final dLng = _degToRad(lng2 - lng1);
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_degToRad(lat1)) *
            math.cos(_degToRad(lat2)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return _earthRadiusKm * c;
  }

  static int estimateTravelMinutes(double distanceKm, {double speedKmh = 22}) {
    if (distanceKm <= 0) return 0;
    return math.max(1, (distanceKm / speedKmh * 60).round());
  }

  static double _degToRad(double deg) => deg * math.pi / 180;

  static Future<bool> openOutletLocation(String mapsUrl) async {
    final trimmedUrl = mapsUrl.trim();
    if (trimmedUrl.isEmpty) {
      return false;
    }

    final uri = Uri.tryParse(trimmedUrl);
    if (uri == null) {
      return false;
    }

    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
