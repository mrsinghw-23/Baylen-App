import 'dart:async';

import 'package:flutter/material.dart';

import '../api/provider_api.dart';
import '../models/provider.dart';

class ProviderScreen extends StatefulWidget {
  const ProviderScreen({super.key});

  @override
  State<ProviderScreen> createState() => _ProviderScreenState();
}

class _ProviderScreenState extends State<ProviderScreen> {
  final _providerIdController = TextEditingController(
    text: '36851000000295001',
  );
  final _providerKeyController = TextEditingController(
    text: 'baylen-provider-secret-2026',
  );
  bool _hideKey = true;

  ProviderApi? _api;
  List<ProviderJob> _jobs = [];
  bool _loading = false;
  String? _error;
  int _selectedTab = 0; // 0: Active, 1: All, 2: Completed

  // Simulated GPS Broadcast state
  Timer? _gpsTimer;
  String? _activeBroadcastingJobId;
  int _gpsStep = 0;

  @override
  void initState() {
    super.initState();
    _connect();
  }

  @override
  void dispose() {
    _gpsTimer?.cancel();
    _providerIdController.dispose();
    _providerKeyController.dispose();
    super.dispose();
  }

  void _connect() {
    final key = _providerKeyController.text.trim();
    if (key.isNotEmpty) {
      _api = ProviderApi(providerKey: key);
      _loadJobs();
    }
  }

  Future<void> _loadJobs() async {
    final api = _api;
    final providerId = _providerIdController.text.trim();
    if (api == null || providerId.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final jobs = await api.assignedJobs(providerId);
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _updateStatus(
    ProviderJob job,
    String newStatus, {
    String? note,
  }) async {
    final api = _api;
    final providerId = _providerIdController.text.trim();
    if (api == null) return;

    try {
      await api.updateJobStatus(
        jobId: job.id,
        providerId: providerId,
        status: newStatus,
        note: note,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Job #${job.id} marked as $newStatus')),
      );
      _loadJobs();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to update status: $e'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  void _startGpsBroadcast(ProviderJob job) {
    _gpsTimer?.cancel();
    _gpsStep = 0;
    _activeBroadcastingJobId = job.id;

    // Simulated coordinates moving towards Bandra / Mumbai coordinates
    final points = [
      (19.0596, 72.8295),
      (19.0610, 72.8310),
      (19.0625, 72.8330),
      (19.0640, 72.8350),
      (19.0655, 72.8370),
      (19.0670, 72.8390),
    ];

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Simulated live GPS broadcast started (sending pings)...',
        ),
      ),
    );
    setState(() {});

    _gpsTimer = Timer.periodic(const Duration(seconds: 4), (timer) async {
      if (_gpsStep >= points.length) {
        timer.cancel();
        if (!mounted) return;
        setState(() {
          _activeBroadcastingJobId = null;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'GPS Simulation finished: Provider reached destination.',
            ),
          ),
        );
        return;
      }

      final (lat, lng) = points[_gpsStep];
      _gpsStep++;

      try {
        await _api?.sendLocationPing(
          jobId: job.id,
          providerId: _providerIdController.text.trim(),
          latitude: lat,
          longitude: lng,
          heading: 45.0,
          speed: 25.0,
          status: 'EN_ROUTE',
        );
      } catch (_) {}
    });
  }

  void _stopGpsBroadcast() {
    _gpsTimer?.cancel();
    setState(() {
      _activeBroadcastingJobId = null;
    });
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('GPS broadcast stopped')));
  }

  void _showProofDialog(ProviderJob job) {
    final fileUrlController = TextEditingController(
      text: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=600&q=80',
    );
    final notesController = TextEditingController(
      text: 'Service completed successfully as per customer request.',
    );

    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Complete Job #${job.id}'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Provide completion photo proof & service notes:'),
              const SizedBox(height: 12),
              TextField(
                controller: fileUrlController,
                decoration: const InputDecoration(
                  labelText: 'Proof Photo URL',
                  hintText: 'https://... image URL',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.image_outlined),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: notesController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Service Notes',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.notes_outlined),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.of(ctx).pop();
              final api = _api;
              final providerId = _providerIdController.text.trim();
              if (api == null) return;

              try {
                // 1. Submit proof
                await api.submitJobProof(
                  jobId: job.id,
                  providerId: providerId,
                  fileUrl: fileUrlController.text.trim(),
                  proofType: 'PHOTO',
                  notes: notesController.text.trim(),
                );
                // 2. Complete job status
                await api.updateJobStatus(
                  jobId: job.id,
                  providerId: providerId,
                  status: 'COMPLETED',
                  note: notesController.text.trim(),
                );
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Job #${job.id} completed with proof.'),
                  ),
                );
                _loadJobs();
              } catch (e) {
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('Failed: $e'),
                    backgroundColor: Colors.red,
                  ),
                );
              }
            },
            child: const Text('Submit & Finish'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final activeJobs = _jobs.where((j) => j.isActive).toList();
    final completedJobs = _jobs.where((j) => j.isCompleted).toList();

    final displayedJobs = _selectedTab == 0
        ? activeJobs
        : _selectedTab == 2
        ? completedJobs
        : _jobs;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Technician Portal'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Reload jobs',
            onPressed: _loadJobs,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildCredentialsCard(),
          const SizedBox(height: 14),
          _buildStatsBar(activeJobs.length, completedJobs.length),
          const SizedBox(height: 16),
          _buildTabBar(),
          const SizedBox(height: 14),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Card(
              color: const Color(0xFF2A1515),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Text(
                      _error!,
                      style: const TextStyle(color: Colors.redAccent),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: _loadJobs,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            )
          else if (displayedJobs.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Icon(
                      Icons.assignment_turned_in_outlined,
                      size: 48,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      _selectedTab == 0
                          ? 'No active jobs assigned'
                          : 'No service jobs found',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Dispatched jobs from customer bookings will appear here.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              ),
            )
          else
            ...displayedJobs.map(_buildJobCard),
        ],
      ),
    );
  }

  Widget _buildCredentialsCard() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: Theme.of(context).colorScheme.primary
                      .withValues(alpha: 0.2),
                  child: Icon(
                    Icons.badge_outlined,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Provider Duty Profile',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                      Text(
                        'Authenticate with Catalyst Provider API',
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: const Color(0xFFAAA4B6)),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: Colors.green),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.circle, color: Colors.green, size: 8),
                      SizedBox(width: 4),
                      Text(
                        'AVAILABLE',
                        style: TextStyle(
                          color: Colors.green,
                          fontSize: 11,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 20),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _providerIdController,
                    decoration: const InputDecoration(
                      labelText: 'Provider ID',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 4,
                  child: TextField(
                    controller: _providerKeyController,
                    obscureText: _hideKey,
                    decoration: InputDecoration(
                      labelText: 'Provider Key',
                      isDense: true,
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _hideKey ? Icons.visibility : Icons.visibility_off,
                          size: 18,
                        ),
                        onPressed: () => setState(() => _hideKey = !_hideKey),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _connect, child: const Text('Connect')),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsBar(int activeCount, int completedCount) {
    return Row(
      children: [
        Expanded(
          child: Card(
            color: const Color(0xFF16161E),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(
                    '$activeCount',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const Text(
                    'Active Jobs',
                    style: TextStyle(fontSize: 12, color: Color(0xFFAAA4B6)),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Card(
            color: const Color(0xFF16161E),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(
                    '$completedCount',
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.greenAccent,
                    ),
                  ),
                  const Text(
                    'Completed',
                    style: TextStyle(fontSize: 12, color: Color(0xFFAAA4B6)),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        const Expanded(
          child: Card(
            color: Color(0xFF16161E),
            child: Padding(
              padding: EdgeInsets.all(12),
              child: Column(
                children: [
                  Text(
                    '4.9 ★',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.amber,
                    ),
                  ),
                  Text(
                    'Rating',
                    style: TextStyle(fontSize: 12, color: Color(0xFFAAA4B6)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildTabBar() {
    return SegmentedButton<int>(
      segments: const [
        ButtonSegment(value: 0, label: Text('Active Jobs')),
        ButtonSegment(value: 1, label: Text('All Jobs')),
        ButtonSegment(value: 2, label: Text('Completed')),
      ],
      selected: {_selectedTab},
      onSelectionChanged: (set) => setState(() => _selectedTab = set.first),
    );
  }

  Widget _buildJobCard(ProviderJob job) {
    final isBroadcasting = _activeBroadcastingJobId == job.id;

    Color statusColor;
    switch (job.status) {
      case 'EN_ROUTE':
        statusColor = Colors.indigoAccent;
        break;
      case 'ARRIVED':
        statusColor = Colors.purpleAccent;
        break;
      case 'STARTED':
        statusColor = Colors.cyanAccent;
        break;
      case 'COMPLETED':
        statusColor = Colors.greenAccent;
        break;
      case 'ACCEPTED':
        statusColor = Colors.blueAccent;
        break;
      default:
        statusColor = Colors.orangeAccent;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(color: statusColor),
                      ),
                      child: Text(
                        job.status.isEmpty ? 'REQUESTED' : job.status,
                        style: TextStyle(
                          color: statusColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      'Job #${job.id}',
                      style: const TextStyle(fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Text(
                  job.amountLabel,
                  style: TextStyle(
                    fontWeight: FontWeight.w900,
                    color: Theme.of(context).colorScheme.primary,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.location_on_outlined,
                  size: 18,
                  color: Color(0xFFAAA4B6),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    job.fullAddress.isNotEmpty
                        ? job.fullAddress
                        : 'Customer Destination Address',
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
              ],
            ),
            if (job.scheduledAt.isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(
                    Icons.schedule_outlined,
                    size: 18,
                    color: Color(0xFFAAA4B6),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Scheduled: ${job.scheduledAt}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFFAAA4B6),
                    ),
                  ),
                ],
              ),
            ],
            const Divider(height: 20),
            _buildActionButtons(job, isBroadcasting),
          ],
        ),
      ),
    );
  }

  Widget _buildActionButtons(ProviderJob job, bool isBroadcasting) {
    if (job.isCompleted) {
      return const Row(
        children: [
          Icon(Icons.check_circle, color: Colors.greenAccent, size: 18),
          SizedBox(width: 6),
          Text(
            'Service finalized and completed.',
            style: TextStyle(color: Colors.greenAccent, fontSize: 13),
          ),
        ],
      );
    }

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        if (job.status == 'ASSIGNED')
          FilledButton.icon(
            onPressed: () => _updateStatus(job, 'ACCEPTED'),
            icon: const Icon(Icons.check, size: 16),
            label: const Text('Accept Job'),
          ),
        if (job.status == 'ACCEPTED')
          FilledButton.icon(
            onPressed: () => _updateStatus(job, 'EN_ROUTE'),
            icon: const Icon(Icons.directions_car_outlined, size: 16),
            label: const Text('Start Travel (En Route)'),
          ),
        if (job.status == 'EN_ROUTE') ...[
          FilledButton.icon(
            onPressed: () => _updateStatus(job, 'ARRIVED'),
            icon: const Icon(Icons.pin_drop_outlined, size: 16),
            label: const Text('Mark Arrived'),
          ),
          OutlinedButton.icon(
            onPressed: () =>
                isBroadcasting ? _stopGpsBroadcast() : _startGpsBroadcast(job),
            icon: Icon(
              isBroadcasting ? Icons.stop : Icons.satellite_alt_outlined,
              size: 16,
            ),
            label: Text(
              isBroadcasting ? 'Stop GPS Broadcast' : 'Broadcast Live GPS',
            ),
            style: isBroadcasting
                ? OutlinedButton.styleFrom(
                    side: const BorderSide(color: Colors.redAccent),
                  )
                : null,
          ),
        ],
        if (job.status == 'ARRIVED')
          FilledButton.icon(
            onPressed: () => _updateStatus(job, 'STARTED'),
            icon: const Icon(Icons.play_arrow_outlined, size: 16),
            label: const Text('Start Service'),
          ),
        if (job.status == 'STARTED')
          FilledButton.icon(
            onPressed: () => _showProofDialog(job),
            icon: const Icon(Icons.verified_outlined, size: 16),
            label: const Text('Complete & Upload Proof'),
          ),
      ],
    );
  }
}
