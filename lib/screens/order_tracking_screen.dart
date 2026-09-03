import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../auth/auth_service.dart';
import '../models/order.dart';
import '../models/order_tracking.dart';

class OrderTrackingScreen extends StatefulWidget {
  const OrderTrackingScreen({
    super.key,
    required this.orderId,
    this.orderNumber = '',
  });

  final String orderId;
  final String orderNumber;

  @override
  State<OrderTrackingScreen> createState() => _OrderTrackingScreenState();
}

class _OrderTrackingScreenState extends State<OrderTrackingScreen> {
  OrderTracking? _tracking;
  bool _loading = true;
  String? _error;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  void _schedulePoll(OrderTracking tracking) {
    _poll?.cancel();
    if (!tracking.isActive) {
      return;
    }
    _poll = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted) return;
      _load(silent: true);
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final tracking = await AuthService.instance.api.orderTracking(
        widget.orderId,
      );
      if (!mounted) return;
      setState(() {
        _tracking = tracking;
        _loading = false;
        _error = null;
      });
      _schedulePoll(tracking);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (!silent) {
          _error = error.toString();
          _loading = false;
        }
      });
    }
  }

  Future<void> _openLiveMaps() async {
    final tracking = _tracking;
    if (tracking == null || !tracking.hasLiveLocation) {
      return;
    }
    final uri = Uri.parse(
      'https://www.google.com/maps/search/?api=1&query=${tracking.liveLatitude},${tracking.liveLongitude}',
    );
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    final tracking = _tracking;
    final title = tracking?.orderNumber.isNotEmpty == true
        ? tracking!.orderNumber
        : (widget.orderNumber.isNotEmpty ? widget.orderNumber : 'Track order');

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => _load(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading && tracking == null)
              const Padding(
                padding: EdgeInsets.only(top: 64),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null && tracking == null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Text(_error!),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: () => _load(),
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              )
            else if (tracking != null) ...[
              _LiveMapCard(
                tracking: tracking,
                onOpenMaps: tracking.hasLiveLocation ? _openLiveMaps : null,
              ),
              const SizedBox(height: 14),
              _StatusHeader(tracking: tracking),
              const SizedBox(height: 14),
              _RiderCard(rider: tracking.rider),
              const SizedBox(height: 14),
              _StepsCard(steps: tracking.steps),
              if (tracking.timeline.isNotEmpty) ...[
                const SizedBox(height: 14),
                _TimelineCard(entries: tracking.timeline),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusHeader extends StatelessWidget {
  const _StatusHeader({required this.tracking});

  final OrderTracking tracking;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: primary.withValues(alpha: 0.16),
              child: Icon(
                tracking.orderStatus.toUpperCase() == 'DELIVERED'
                    ? Icons.check_circle_outline
                    : Icons.local_shipping_outlined,
                color: primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tracking.statusHeadline,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    tracking.orderStatus.isEmpty
                        ? 'Updating…'
                        : tracking.orderStatus,
                    style: const TextStyle(color: Color(0xFFAAA4B6)),
                  ),
                  if (tracking.fulfillmentMode.isNotEmpty)
                    Text(
                      tracking.fulfillmentMode.replaceAll('_', ' '),
                      style: const TextStyle(
                        color: Color(0xFF8E8A98),
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            if (tracking.isActive)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: primary.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  'LIVE',
                  style: TextStyle(
                    color: primary,
                    fontWeight: FontWeight.w800,
                    fontSize: 11,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LiveMapCard extends StatelessWidget {
  const _LiveMapCard({required this.tracking, this.onOpenMaps});

  final OrderTracking tracking;
  final VoidCallback? onOpenMaps;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final lat = tracking.liveLatitude;
    final lng = tracking.liveLongitude;
    return Container(
      height: 240,
      decoration: BoxDecoration(
        color: const Color(0xFF101015),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: primary.withValues(alpha: 0.45)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _RoutePainter(
                routeColor: primary,
                gridColor: const Color(0xFF2B2B34),
                hasLive: tracking.hasLiveLocation,
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: Card(
              color: const Color(0xDD121216),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(Icons.delivery_dining, color: primary),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        lat == null || lng == null
                            ? 'Waiting for rider location'
                            : '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}',
                      ),
                    ),
                    if (onOpenMaps != null)
                      TextButton(
                        onPressed: onOpenMaps,
                        child: const Text('Maps'),
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

class _RiderCard extends StatelessWidget {
  const _RiderCard({required this.rider});

  final OrderTrackingRider rider;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: primary.withValues(alpha: 0.16),
              child: Icon(Icons.two_wheeler, color: primary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rider.hasIdentity
                        ? (rider.name.isNotEmpty ? rider.name : 'Rider')
                        : 'Rider assignment pending',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    rider.phoneMasked.isNotEmpty
                        ? rider.phoneMasked
                        : 'Phone shared after assignment',
                    style: const TextStyle(color: Color(0xFFAAA4B6)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepsCard extends StatelessWidget {
  const _StepsCard({required this.steps});

  final List<OrderTrackingStep> steps;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final list = steps.isEmpty
        ? const [
            OrderTrackingStep(key: 'CONFIRMED', label: 'Order Confirmed', done: true),
          ]
        : steps;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Delivery progress',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            for (var i = 0; i < list.length; i++) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    children: [
                      Icon(
                        list[i].done
                            ? Icons.check_circle
                            : Icons.radio_button_unchecked,
                        color: list[i].done ? primary : const Color(0xFFAAA4B6),
                        size: 22,
                      ),
                      if (i < list.length - 1)
                        Container(
                          width: 2,
                          height: 22,
                          margin: const EdgeInsets.symmetric(vertical: 2),
                          color: list[i].done
                              ? primary.withValues(alpha: 0.55)
                              : const Color(0xFF2B2B34),
                        ),
                    ],
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                        bottom: i < list.length - 1 ? 10 : 0,
                        top: 2,
                      ),
                      child: Text(
                        list[i].label,
                        style: TextStyle(
                          fontWeight: list[i].done
                              ? FontWeight.w700
                              : FontWeight.w500,
                          color: list[i].done
                              ? null
                              : const Color(0xFFAAA4B6),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TimelineCard extends StatelessWidget {
  const _TimelineCard({required this.entries});

  final List<OrderTimelineEntry> entries;

  @override
  Widget build(BuildContext context) {
    final sorted = [...entries]
      ..sort((a, b) => b.happenedAt.compareTo(a.happenedAt));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Updates', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final entry in sorted.take(12))
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                leading: const Icon(Icons.history, size: 20),
                title: Text(entry.status),
                subtitle: Text(
                  [
                    entry.note,
                    if (entry.happenedAt.isNotEmpty) entry.happenedAt,
                  ].where((part) => part.isNotEmpty).join('\n'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  const _RoutePainter({
    required this.routeColor,
    required this.gridColor,
    required this.hasLive,
  });

  final Color routeColor;
  final Color gridColor;
  final bool hasLive;

  @override
  void paint(Canvas canvas, Size size) {
    final grid = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var x = -40.0; x < size.width; x += 44) {
      canvas.drawLine(Offset(x, 0), Offset(x + 100, size.height), grid);
    }
    for (var y = 8.0; y < size.height; y += 44) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y - 60), grid);
    }

    final path = Path()
      ..moveTo(size.width * 0.18, size.height * 0.72)
      ..quadraticBezierTo(
        size.width * 0.40,
        size.height * 0.46,
        size.width * 0.55,
        size.height * 0.56,
      )
      ..quadraticBezierTo(
        size.width * 0.72,
        size.height * 0.68,
        size.width * 0.82,
        size.height * 0.28,
      );
    canvas.drawPath(
      path,
      Paint()
        ..color = routeColor
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(
      Offset(size.width * 0.18, size.height * 0.72),
      8,
      Paint()..color = routeColor,
    );
    final end = Offset(size.width * 0.82, size.height * 0.28);
    canvas.drawCircle(end, hasLive ? 12 : 9, Paint()..color = routeColor);
    if (hasLive) {
      canvas.drawCircle(
        end,
        18,
        Paint()
          ..color = routeColor.withValues(alpha: 0.25)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _RoutePainter oldDelegate) {
    return oldDelegate.routeColor != routeColor ||
        oldDelegate.gridColor != gridColor ||
        oldDelegate.hasLive != hasLive;
  }
}
