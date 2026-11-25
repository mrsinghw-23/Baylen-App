import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import '../../state/professional_dashboard_store.dart';
import '../../services/professional_tracking_service.dart';
import '../../widgets/at_home_beauty_map.dart';
import '../../widgets/pro/pro_components.dart';

class ProMapTabScreen extends StatefulWidget {
  const ProMapTabScreen({super.key, required this.enabled});

  final bool enabled;

  @override
  State<ProMapTabScreen> createState() => _ProMapTabScreenState();
}

class _ProMapTabScreenState extends State<ProMapTabScreen> {
  LivePosition? _position;
  double? _destinationLat;
  double? _destinationLng;
  String _destinationLabel = '';
  String _gpsStatus = 'Checking…';
  String? _capturedAt;
  bool _loading = true;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
    if (widget.enabled) {
      _pollTimer = Timer.periodic(const Duration(seconds: 15), (_) => _load());
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (!widget.enabled) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    final firstLoad = _position == null;
    if (firstLoad && mounted) setState(() => _loading = true);
    try {
      final repo = ProfessionalJobScope.of(context);
      final store = ProfessionalJobScope.maybeStoreOf(context);
      final dashboard = store?.dashboard ?? await repo.fetchDashboard();
      final permission = await ProfessionalTrackingService.instance.ensurePermission();
      if (permission != TrackingPermissionState.granted) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _gpsStatus = ProfessionalTrackingService.permissionMessage(permission);
        });
        return;
      }

      final devicePosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      double? destLat;
      double? destLng;
      String destLabel = '';
      double distanceKm = 0;
      int etaMinutes = 0;
      String routingSource = 'device_gps';

      if (dashboard.activeJobId != null && dashboard.activeJobId!.isNotEmpty) {
        final pos = await repo.fetchLivePosition(dashboard.activeJobId!);
        distanceKm = pos.distanceKm;
        etaMinutes = pos.etaMinutes;
        routingSource = pos.routingSource;
        final detail = await repo.fetchJobDetail(dashboard.activeJobId!);
        destLabel = detail.dropAddress.isNotEmpty ? detail.dropAddress : detail.referenceLabel;
        destLat = detail.destinationLatitude;
        destLng = detail.destinationLongitude;
      }

      if (!mounted) return;
      setState(() {
        _position = LivePosition(
          latitude: devicePosition.latitude,
          longitude: devicePosition.longitude,
          distanceKm: distanceKm,
          etaMinutes: etaMinutes,
          routingSource: routingSource,
          locationStatus: 'LIVE',
          capturedAt: DateTime.now().toIso8601String(),
        );
        _destinationLat = destLat;
        _destinationLng = destLng;
        _destinationLabel = destLabel;
        _gpsStatus = 'GPS live • ${devicePosition.latitude.toStringAsFixed(5)}, ${devicePosition.longitude.toStringAsFixed(5)}';
        _capturedAt = DateTime.now().toLocal().toString().split('.').first;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _gpsStatus = error.toString();
      });
    }
  }

  Future<void> _openExternalMaps() async {
    final pos = _position;
    if (pos == null) return;
    final destLat = _destinationLat;
    final destLng = _destinationLng;
    final uri = destLat != null && destLng != null
        ? Uri.parse(
            'https://www.google.com/maps/dir/?api=1&origin=${pos.latitude},${pos.longitude}&destination=$destLat,$destLng&travelmode=driving',
          )
        : Uri.parse(
            'https://www.google.com/maps/search/?api=1&query=${pos.latitude},${pos.longitude}',
          );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) {
      return const ProScreenState.empty(message: 'Map unlocks after KYC approval');
    }
    if (_loading && _position == null) return const ProScreenState.loading();
    final pos = _position;
    return RefreshIndicator(
      color: kProPink,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Text(
                      'Live map',
                      style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                    const Spacer(),
                    if (pos?.isLive == true)
                      const ProStatusBadge(label: 'LIVE', highlight: true),
                  ],
                ),
                const SizedBox(height: 8),
                if (pos != null)
                  AtHomeBeautyMap(
                    customerLat: _destinationLat ?? pos.latitude,
                    customerLng: _destinationLng ?? pos.longitude,
                    outlets: const [],
                    providerLat: pos.latitude,
                    providerLng: pos.longitude,
                    showProvider: true,
                    height: 240,
                  )
                else
                  Container(
                    height: 240,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: kProSurface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      'Enable location to view the map',
                      style: TextStyle(color: kProTextSecondary),
                    ),
                  ),
                const SizedBox(height: 12),
                if (pos != null) ...[
                  Text(
                    pos.distanceKm > 0
                        ? '${pos.distanceKm.toStringAsFixed(1)} km • ${pos.etaMinutes} min ETA'
                        : 'Your current location',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                  ),
                  if (_destinationLabel.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Destination: $_destinationLabel',
                      style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                    ),
                  ],
                  const SizedBox(height: 4),
                  Text(_gpsStatus, style: const TextStyle(color: kProTextSecondary, fontSize: 11)),
                  if (_capturedAt != null)
                    Text(
                      'Updated $_capturedAt',
                      style: const TextStyle(color: kProTextSecondary, fontSize: 11),
                    ),
                ],
                const SizedBox(height: 12),
                ProPrimaryButton(label: 'Open in Maps', onPressed: _openExternalMaps),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ProEarningsTabScreen extends StatefulWidget {
  const ProEarningsTabScreen({super.key});

  @override
  State<ProEarningsTabScreen> createState() => _ProEarningsTabScreenState();
}

class _ProEarningsTabScreenState extends State<ProEarningsTabScreen> {
  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(() {
      ProfessionalJobScope.storeOf(context).ensureEarnings();
    });
  }

  @override
  Widget build(BuildContext context) {
    final store = ProfessionalJobScope.storeOf(context);
    if (store.earnings == null && store.quietRefreshing) {
      return const ProScreenState.loading();
    }
    final summary = store.earnings ?? const ProfessionalEarningsSummary();
    final entries = store.earningsHistory;
    return RefreshIndicator(
      color: kProPink,
      onRefresh: () => store.refreshQuiet(
        slices: {ProfessionalDataSlice.earnings},
      ),
      child: ListView(
        padding: const EdgeInsets.all(16),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.6,
            children: [
              _EarningsStatCard(label: 'Total', value: '₹${summary.totalEarnings.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Today', value: '₹${summary.earningsToday.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'This week', value: '₹${summary.earningsWeek.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Completed jobs', value: '${summary.completedJobs}'),
              _EarningsStatCard(label: 'Delivery', value: '₹${summary.deliveryEarnings.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Home service', value: '₹${summary.homeServiceEarnings.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Commission', value: '₹${summary.commissionTotal.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Deductions', value: '₹${summary.deductionsTotal.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Pending', value: '₹${summary.pendingEarnings.toStringAsFixed(0)}'),
              _EarningsStatCard(label: 'Net', value: '₹${summary.netEarnings.toStringAsFixed(0)}'),
            ],
          ),
          const SizedBox(height: 20),
          const Text(
            'Earnings history',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 12),
          if (entries.isEmpty)
            const ProScreenState.empty(message: 'No settled earnings yet')
          else
            ...entries.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: ProCard(
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              entry.jobTitle,
                              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                            ),
                            Text(
                              entry.completedAt,
                              style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                            ),
                            if (entry.status.isNotEmpty)
                              Text(
                                entry.status,
                                style: const TextStyle(color: kProTextSecondary, fontSize: 11),
                              ),
                          ],
                        ),
                      ),
                      Text(
                        '₹${entry.total.toStringAsFixed(0)}',
                        style: const TextStyle(color: kProPink, fontWeight: FontWeight.w800),
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

class _EarningsStatCard extends StatelessWidget {
  const _EarningsStatCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 18)),
          Text(label, style: const TextStyle(color: kProTextSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}
