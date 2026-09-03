// Customer-facing QC order tracking payload from GET /v1/orders/:id/tracking
import 'order.dart';

class OrderTrackingStep {
  const OrderTrackingStep({
    required this.key,
    required this.label,
    required this.done,
  });

  final String key;
  final String label;
  final bool done;

  factory OrderTrackingStep.fromJson(Map<String, dynamic> json) {
    return OrderTrackingStep(
      key: json['key']?.toString() ?? '',
      label: json['label']?.toString() ?? '',
      done: json['done'] == true,
    );
  }
}

class OrderTrackingRider {
  const OrderTrackingRider({
    required this.id,
    required this.name,
    required this.phoneMasked,
    this.latitude,
    this.longitude,
  });

  final String id;
  final String name;
  final String phoneMasked;
  final double? latitude;
  final double? longitude;

  bool get hasIdentity => name.isNotEmpty || phoneMasked.isNotEmpty;

  factory OrderTrackingRider.fromJson(Map<String, dynamic> json) {
    return OrderTrackingRider(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      phoneMasked: json['phone_masked']?.toString() ?? '',
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
    );
  }
}

class OrderTrackPoint {
  const OrderTrackPoint({
    required this.latitude,
    required this.longitude,
    required this.status,
    required this.recordedAt,
  });

  final double latitude;
  final double longitude;
  final String status;
  final String recordedAt;

  factory OrderTrackPoint.fromJson(Map<String, dynamic> json) {
    return OrderTrackPoint(
      latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
      longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
      status: json['status']?.toString() ?? '',
      recordedAt: json['recorded_at']?.toString() ?? '',
    );
  }
}

class OrderTracking {
  const OrderTracking({
    required this.steps,
    required this.rider,
    required this.trackPoints,
    required this.timeline,
    this.liveLatitude,
    this.liveLongitude,
    this.orderStatus = '',
    this.orderNumber = '',
    this.fulfillmentMode = '',
  });

  final List<OrderTrackingStep> steps;
  final OrderTrackingRider rider;
  final List<OrderTrackPoint> trackPoints;
  final List<OrderTimelineEntry> timeline;
  final double? liveLatitude;
  final double? liveLongitude;
  final String orderStatus;
  final String orderNumber;
  final String fulfillmentMode;

  bool get hasLiveLocation =>
      liveLatitude != null && liveLongitude != null;

  bool get isActive {
    final status = orderStatus.toUpperCase();
    return status.isNotEmpty &&
        !const {
          'DELIVERED',
          'CANCELLED',
          'COMPLETED',
          'REFUNDED',
        }.contains(status);
  }

  String get statusHeadline {
    if (steps.isEmpty) {
      return orderStatus.isEmpty ? 'Tracking' : orderStatus;
    }
    final current = steps.lastWhere(
      (step) => step.done,
      orElse: () => steps.first,
    );
    return current.label;
  }

  factory OrderTracking.fromJson(Map<String, dynamic> json) {
    final steps = (json['steps'] is List)
        ? (json['steps'] as List)
            .whereType<Map>()
            .map((e) => OrderTrackingStep.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <OrderTrackingStep>[];
    final riderJson = json['rider'];
    final rider = riderJson is Map
        ? OrderTrackingRider.fromJson(Map<String, dynamic>.from(riderJson))
        : const OrderTrackingRider(id: '', name: '', phoneMasked: '');
    final points = (json['track_points'] is List)
        ? (json['track_points'] as List)
            .whereType<Map>()
            .map((e) => OrderTrackPoint.fromJson(Map<String, dynamic>.from(e)))
            .toList()
        : <OrderTrackPoint>[];
    final timeline = (json['timeline'] is List)
        ? (json['timeline'] as List)
            .whereType<Map>()
            .map(
              (e) => OrderTimelineEntry.fromJson(Map<String, dynamic>.from(e)),
            )
            .toList()
        : <OrderTimelineEntry>[];
    final live = json['live'];
    final order = json['order'];
    return OrderTracking(
      steps: steps,
      rider: rider,
      trackPoints: points,
      timeline: timeline,
      liveLatitude: live is Map ? (live['latitude'] as num?)?.toDouble() : null,
      liveLongitude: live is Map ? (live['longitude'] as num?)?.toDouble() : null,
      orderStatus: order is Map
          ? (order['status']?.toString() ?? '')
          : (json['status']?.toString() ?? ''),
      orderNumber: order is Map
          ? (order['order_number']?.toString() ?? '')
          : '',
      fulfillmentMode: order is Map
          ? (order['fulfillment_mode']?.toString() ?? '')
          : '',
    );
  }
}
