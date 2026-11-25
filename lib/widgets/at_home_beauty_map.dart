import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/salon.dart';

class AtHomeBeautyMap extends StatelessWidget {
  const AtHomeBeautyMap({
    super.key,
    required this.customerLat,
    required this.customerLng,
    required this.outlets,
    this.providerLat,
    this.providerLng,
    this.showProvider = false,
    this.height = 240,
  });

  final double? customerLat;
  final double? customerLng;
  final List<SalonOutlet> outlets;
  final double? providerLat;
  final double? providerLng;
  final bool showProvider;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.45),
        ),
        color: const Color(0xFF0E0E14),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _GeoMapPainter(
                customerLat: customerLat,
                customerLng: customerLng,
                outlets: outlets,
                providerLat: showProvider ? providerLat : null,
                providerLng: showProvider ? providerLng : null,
                accent: Theme.of(context).colorScheme.primary,
              ),
            ),
          ),
          Positioned(
            left: 12,
            top: 12,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0xCC101018),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.my_location,
                      size: 14,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      customerLat == null
                          ? 'Location required'
                          : '${outlets.length} nearby salon${outlets.length == 1 ? '' : 's'}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GeoMapPainter extends CustomPainter {
  _GeoMapPainter({
    required this.customerLat,
    required this.customerLng,
    required this.outlets,
    required this.providerLat,
    required this.providerLng,
    required this.accent,
  });

  final double? customerLat;
  final double? customerLng;
  final List<SalonOutlet> outlets;
  final double? providerLat;
  final double? providerLng;
  final Color accent;

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = const Color(0xFF2A2A34)
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += 36) {
      canvas.drawLine(Offset(x, 0), Offset(x + 50, size.height), grid);
    }
    for (var y = 0.0; y < size.height; y += 36) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y - 30), grid);
    }

    final points = <({double lat, double lng, Color color, double radius})>[];
    if (customerLat != null && customerLng != null) {
      points.add((lat: customerLat!, lng: customerLng!, color: accent, radius: 9));
    }
    for (final outlet in outlets) {
      if (outlet.latitude == 0 && outlet.longitude == 0) continue;
      points.add((
        lat: outlet.latitude,
        lng: outlet.longitude,
        color: Colors.white70,
        radius: 6,
      ));
    }
    if (providerLat != null && providerLng != null) {
      points.add((
        lat: providerLat!,
        lng: providerLng!,
        color: Colors.greenAccent,
        radius: 8,
      ));
    }
    if (points.isEmpty) return;

    final lats = points.map((p) => p.lat);
    final lngs = points.map((p) => p.lng);
    final minLat = lats.reduce(math.min) - 0.01;
    final maxLat = lats.reduce(math.max) + 0.01;
    final minLng = lngs.reduce(math.min) - 0.01;
    final maxLng = lngs.reduce(math.max) + 0.01;

    Offset project(double lat, double lng) {
      final x = (lng - minLng) / (maxLng - minLng);
      final y = 1 - (lat - minLat) / (maxLat - minLat);
      return Offset(16 + x * (size.width - 32), 16 + y * (size.height - 32));
    }

    if (customerLat != null &&
        customerLng != null &&
        providerLat != null &&
        providerLng != null) {
      final from = project(customerLat!, customerLng!);
      final to = project(providerLat!, providerLng!);
      canvas.drawLine(
        from,
        to,
        Paint()
          ..color = accent.withValues(alpha: 0.85)
          ..strokeWidth = 3
          ..strokeCap = StrokeCap.round,
      );
    }

    for (final point in points) {
      final center = project(point.lat, point.lng);
      canvas.drawCircle(center, point.radius, Paint()..color = point.color);
    }
  }

  @override
  bool shouldRepaint(covariant _GeoMapPainter oldDelegate) {
    return oldDelegate.customerLat != customerLat ||
        oldDelegate.customerLng != customerLng ||
        oldDelegate.outlets.length != outlets.length ||
        oldDelegate.providerLat != providerLat ||
        oldDelegate.providerLng != providerLng;
  }
}
