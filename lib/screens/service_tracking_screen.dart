import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/service_job.dart';

class ServiceTrackingScreen extends StatefulWidget {
  const ServiceTrackingScreen({super.key, required this.job});

  final ServiceJob job;

  @override
  State<ServiceTrackingScreen> createState() => _ServiceTrackingScreenState();
}

class _ServiceTrackingScreenState extends State<ServiceTrackingScreen> {
  ServiceJobTracking? _tracking;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final tracking = await AuthService.instance.api.serviceJobTracking(
        widget.job.id,
      );
      if (!mounted) return;
      setState(() {
        _tracking = tracking;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final tracking = _tracking;
    final job = tracking?.job ?? widget.job;
    return Scaffold(
      appBar: AppBar(title: const Text('Live tracking')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 64),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!),
                ),
              )
            else ...[
              _TrackingMap(location: tracking?.latestLocation),
              const SizedBox(height: 14),
              _ProviderPanel(provider: tracking?.provider, job: job),
              const SizedBox(height: 14),
              _StatusTimeline(
                status: job.status,
                locations: tracking?.locations ?? const [],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _TrackingMap extends StatelessWidget {
  const _TrackingMap({required this.location});

  final LiveLocation? location;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 260,
      decoration: BoxDecoration(
        color: const Color(0xFF101015),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.5),
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _RoutePainter(
                routeColor: Theme.of(context).colorScheme.primary,
                gridColor: const Color(0xFF2B2B34),
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
                    Icon(
                      Icons.location_on_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        location == null
                            ? 'Waiting for provider location'
                            : '${location!.latitude.toStringAsFixed(5)}, ${location!.longitude.toStringAsFixed(5)}',
                      ),
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

class _ProviderPanel extends StatelessWidget {
  const _ProviderPanel({required this.provider, required this.job});

  final ServiceProviderSummary? provider;
  final ServiceJob job;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primary
                  .withValues(alpha: 0.16),
              child: Icon(
                Icons.person_outline,
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    provider?.name.isNotEmpty == true
                        ? provider!.name
                        : 'Provider assignment pending',
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Status: ${job.status.isEmpty ? 'REQUESTED' : job.status}',
                  ),
                  if (provider != null && provider!.rating > 0)
                    Text('Rating: ${provider!.rating.toStringAsFixed(1)}'),
                ],
              ),
            ),
            Text(
              job.amountLabel,
              style: TextStyle(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatusTimeline extends StatelessWidget {
  const _StatusTimeline({required this.status, required this.locations});

  final String status;
  final List<LiveLocation> locations;

  @override
  Widget build(BuildContext context) {
    final steps = [
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ARRIVED',
      'STARTED',
      'COMPLETED',
    ];
    final active = steps.indexOf(status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('FSM status', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            for (var i = 0; i < steps.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    Icon(
                      i <= active
                          ? Icons.check_circle
                          : Icons.radio_button_unchecked,
                      color: i <= active
                          ? Theme.of(context).colorScheme.primary
                          : const Color(0xFFAAA4B6),
                      size: 20,
                    ),
                    const SizedBox(width: 10),
                    Text(steps[i]),
                  ],
                ),
              ),
            const Divider(),
            Text('Location pings: ${locations.length}'),
          ],
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  const _RoutePainter({required this.routeColor, required this.gridColor});

  final Color routeColor;
  final Color gridColor;

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
      ..moveTo(size.width * 0.17, size.height * 0.75)
      ..quadraticBezierTo(
        size.width * 0.38,
        size.height * 0.48,
        size.width * 0.52,
        size.height * 0.58,
      )
      ..quadraticBezierTo(
        size.width * 0.72,
        size.height * 0.70,
        size.width * 0.84,
        size.height * 0.25,
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
      Offset(size.width * 0.17, size.height * 0.75),
      8,
      Paint()..color = routeColor,
    );
    canvas.drawCircle(
      Offset(size.width * 0.84, size.height * 0.25),
      10,
      Paint()..color = routeColor,
    );
  }

  @override
  bool shouldRepaint(covariant _RoutePainter oldDelegate) {
    return oldDelegate.routeColor != routeColor ||
        oldDelegate.gridColor != gridColor;
  }
}
