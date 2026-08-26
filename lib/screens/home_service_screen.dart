import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/service_job.dart';
import 'login_screen.dart';
import 'provider_screen.dart';
import 'service_tracking_screen.dart';

class HomeServiceScreen extends StatefulWidget {
  const HomeServiceScreen({super.key});

  @override
  State<HomeServiceScreen> createState() => _HomeServiceScreenState();
}

class _HomeServiceScreenState extends State<HomeServiceScreen> {
  List<ServiceJob> _jobs = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() {
        _loading = false;
        _jobs = [];
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final jobs = await AuthService.instance.api.serviceJobs();
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
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
    return Scaffold(
      appBar: AppBar(
        title: const Text('At-Home Services'),
        actions: [
          TextButton.icon(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const ProviderScreen()),
              );
            },
            icon: const Icon(Icons.engineering_outlined, size: 18),
            label: const Text('Technician Portal'),
          ),
          const SizedBox(width: 8),
        ],
      ),

      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const _TrackingPreview(),
            const SizedBox(height: 16),
            _MyJobsPanel(
              loading: _loading,
              error: _error,
              jobs: _jobs,
              onRetry: _load,
            ),
            const SizedBox(height: 16),
            const _ServiceStep(
              number: '1',
              title: 'Book at-home service',
              subtitle: 'Customer chooses address, service, date, time, and preferred provider.',
              icon: Icons.home_repair_service_outlined,
            ),
            const _ServiceStep(
              number: '2',
              title: 'Provider assigned',
              subtitle: 'Catalyst creates the service job and dispatch record after booking confirmation.',
              icon: Icons.assignment_ind_outlined,
            ),
            const _ServiceStep(
              number: '3',
              title: 'Live tracking',
              subtitle: 'Provider location updates flow into Live_Locations for map and ETA screens.',
              icon: Icons.near_me_outlined,
            ),
            const _ServiceStep(
              number: '4',
              title: 'Completion proof',
              subtitle: 'Photos, notes, customer confirmation, review, and service history are stored.',
              icon: Icons.verified_outlined,
            ),
          ],
        ),
      ),
    );
  }
}

class _MyJobsPanel extends StatelessWidget {
  const _MyJobsPanel({
    required this.loading,
    required this.error,
    required this.jobs,
    required this.onRetry,
  });

  final bool loading;
  final String? error;
  final List<ServiceJob> jobs;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (!AuthService.instance.isSignedIn) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'My active services',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              const Text(
                'Login is required to view service jobs and live tracking.',
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<bool>(
                      builder: (_) => const LoginScreen(),
                    ),
                  );
                },
                child: const Text('Login / Register'),
              ),
            ],
          ),
        ),
      );
    }
    if (loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (error != null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(error!),
              const SizedBox(height: 12),
              FilledButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (jobs.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text(
            'No at-home service jobs yet. Book an eligible service to start tracking.',
          ),
        ),
      );
    }
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
            child: Text(
              'My active services',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          for (final job in jobs.take(5))
            ListTile(
              leading: Icon(
                Icons.near_me_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              title: Text(job.status.isEmpty ? 'Service job' : job.status),
              subtitle: Text(
                [
                  job.visitLine1,
                  job.visitCity,
                  job.scheduledAt,
                ].where((part) => part.isNotEmpty).join('\n'),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => ServiceTrackingScreen(job: job),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

class _TrackingPreview extends StatelessWidget {
  const _TrackingPreview();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 250,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.55),
        ),
        color: const Color(0xFF111116),
      ),
      clipBehavior: Clip.antiAlias,
      child: Stack(
        children: [
          Positioned.fill(
            child: CustomPaint(
              painter: _MapPreviewPainter(
                lineColor: Theme.of(context).colorScheme.primary,
                gridColor: const Color(0xFF2B2B34),
              ),
            ),
          ),
          Positioned(
            left: 16,
            top: 16,
            right: 16,
            child: Row(
              children: [
                CircleAvatar(
                  backgroundColor: Theme.of(context).colorScheme.primary,
                  child: const Icon(Icons.person, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Live service tracking',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'FSM workflow ready for provider status updates',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
              ],
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
                      Icons.route_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(width: 10),
                    const Expanded(
                      child: Text('En route status, route, distance, and ETA'),
                    ),
                    Text(
                      '04:10',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.secondary,
                        fontWeight: FontWeight.w900,
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

class _ServiceStep extends StatelessWidget {
  const _ServiceStep({
    required this.number,
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String number;
  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primary
                      .withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Center(
                  child: Text(
                    number,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          icon,
                          color: Theme.of(context).colorScheme.primary,
                          size: 18,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            title,
                            style: Theme.of(context).textTheme.titleSmall
                                ?.copyWith(fontWeight: FontWeight.w900),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(subtitle),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MapPreviewPainter extends CustomPainter {
  const _MapPreviewPainter({required this.lineColor, required this.gridColor});

  final Color lineColor;
  final Color gridColor;

  @override
  void paint(Canvas canvas, Size size) {
    final gridPaint = Paint()
      ..color = gridColor
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += 42) {
      canvas.drawLine(Offset(x, 0), Offset(x + 80, size.height), gridPaint);
    }
    for (var y = 20.0; y < size.height; y += 42) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y - 40), gridPaint);
    }

    final route = Path()
      ..moveTo(size.width * 0.18, size.height * 0.72)
      ..cubicTo(
        size.width * 0.30,
        size.height * 0.54,
        size.width * 0.44,
        size.height * 0.70,
        size.width * 0.56,
        size.height * 0.48,
      )
      ..cubicTo(
        size.width * 0.68,
        size.height * 0.28,
        size.width * 0.78,
        size.height * 0.38,
        size.width * 0.86,
        size.height * 0.22,
      );
    final routePaint = Paint()
      ..color = lineColor
      ..strokeWidth = 4
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;
    canvas.drawPath(route, routePaint);

    final pinPaint = Paint()..color = lineColor;
    canvas.drawCircle(
      Offset(size.width * 0.18, size.height * 0.72),
      8,
      pinPaint,
    );
    canvas.drawCircle(
      Offset(size.width * 0.86, size.height * 0.22),
      10,
      pinPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _MapPreviewPainter oldDelegate) {
    return oldDelegate.lineColor != lineColor ||
        oldDelegate.gridColor != gridColor;
  }
}
