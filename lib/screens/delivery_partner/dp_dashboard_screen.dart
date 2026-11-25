import 'package:flutter/material.dart';

import '../../api/catalyst_api.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/role_switch_dialog.dart';
import '../../models/delivery_partner_dashboard.dart';
import '../../widgets/home/_home_constants.dart';

class DpDashboardScreen extends StatefulWidget {
  const DpDashboardScreen({super.key});

  @override
  State<DpDashboardScreen> createState() => _DpDashboardScreenState();
}

class _DpDashboardScreenState extends State<DpDashboardScreen> {
  DeliveryPartnerDashboard? _dashboard;
  bool _loading = true;
  bool _updatingStatus = false;
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
      final dashboard =
          await DeliveryPartnerAuthService.instance.api.fetchPartnerDashboard();
      if (!mounted) return;
      setState(() {
        _dashboard = dashboard;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isForbiddenRole) {
        await showRoleSwitchDialog(context, error: error);
      }
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _setOnlineStatus(String onlineStatus) async {
    setState(() {
      _updatingStatus = true;
      _error = null;
    });
    try {
      final dashboard = await DeliveryPartnerAuthService.instance.api
          .setPartnerOnlineStatus(onlineStatus: onlineStatus);
      if (!mounted) return;
      setState(() {
        _dashboard = dashboard;
        _updatingStatus = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _updatingStatus = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _updatingStatus = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: kHomePink));
    }

    final dashboard = _dashboard;
    if (dashboard == null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _error ?? 'Could not load dashboard',
              style: const TextStyle(color: Colors.redAccent),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }

    final partner = dashboard.partner;
    final stats = dashboard.stats;
    final activeJob = dashboard.activeJob;

    return RefreshIndicator(
      color: kHomePink,
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _HeaderCard(partner: partner),
          const SizedBox(height: 12),
          if (partner.operational)
            _OnlineStatusCard(
              partner: partner,
              canGoOffline: dashboard.canGoOffline,
              updating: _updatingStatus,
              onChanged: _setOnlineStatus,
            ),
          if (dashboard.kycRequired)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: MaterialBanner(
                content: const Text(
                  'Complete KYC to unlock leads, jobs, and online availability.',
                ),
                actions: [
                  SizedBox.shrink(),
                ],
              ),
            ),
          _StatsGrid(stats: stats),
          const SizedBox(height: 12),
          if (activeJob != null) _ActiveJobCard(job: activeJob),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.redAccent)),
          ],
        ],
      ),
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.partner});

  final DeliveryPartnerDashboardPartner partner;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: kHomeCard,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              partner.displayName,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 20,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Outlet ${partner.outletId.isEmpty ? 'not assigned' : partner.outletId}',
              style: const TextStyle(color: kHomeTextSecondary),
            ),
            if (partner.age != null || partner.qualification.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                [
                  if (partner.age != null) 'Age ${partner.age}',
                  if (partner.qualification.isNotEmpty) partner.qualification,
                ].join(' • '),
                style: const TextStyle(color: kHomeTextSecondary),
              ),
            ],
            if (partner.rating != null && partner.rating! > 0) ...[
              const SizedBox(height: 6),
              Text(
                'Rating ${partner.rating!.toStringAsFixed(1)}',
                style: const TextStyle(color: kHomeTextSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OnlineStatusCard extends StatelessWidget {
  const _OnlineStatusCard({
    required this.partner,
    required this.canGoOffline,
    required this.updating,
    required this.onChanged,
  });

  final DeliveryPartnerDashboardPartner partner;
  final bool canGoOffline;
  final bool updating;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final busy = partner.isBusy;
    final online = partner.isOnline;
    return Card(
      color: kHomeCard,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    busy
                        ? 'Online (busy with active job)'
                        : online
                        ? 'Online and available'
                        : 'Offline',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                if (updating)
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'Available for jobs',
                style: TextStyle(color: Colors.white),
              ),
              subtitle: Text(
                canGoOffline
                    ? 'Your availability is saved on the server.'
                    : 'Finish your active job before going offline.',
                style: const TextStyle(color: kHomeTextSecondary),
              ),
              value: online,
              onChanged: updating || busy
                  ? null
                  : (value) => onChanged(
                      value ? 'ONLINE_AVAILABLE' : 'OFFLINE',
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.stats});

  final DeliveryPartnerDashboardStats stats;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.35,
      children: [
        _StatTile(label: 'Jobs today', value: '${stats.jobsToday}'),
        _StatTile(
          label: 'Earnings today',
          value: '₹${stats.earningsToday.toStringAsFixed(0)}',
        ),
        _StatTile(
          label: 'Earnings this week',
          value: '₹${stats.earningsWeek.toStringAsFixed(0)}',
        ),
        _StatTile(
          label: 'Unread alerts',
          value: '${stats.unreadNotifications}',
        ),
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: kHomeCard,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Text(label, style: const TextStyle(color: kHomeTextSecondary)),
          ],
        ),
      ),
    );
  }
}

class _ActiveJobCard extends StatelessWidget {
  const _ActiveJobCard({required this.job});

  final DeliveryPartnerDashboardJob job;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: kHomeCard,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Active job',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(job.serviceName, style: const TextStyle(color: Colors.white)),
            Text(
              '${job.visitLine1}, ${job.visitCity}',
              style: const TextStyle(color: kHomeTextSecondary),
            ),
            Text(
              '${job.bookingNumber} • ${job.status}',
              style: const TextStyle(color: kHomeTextSecondary),
            ),
          ],
        ),
      ),
    );
  }
}
