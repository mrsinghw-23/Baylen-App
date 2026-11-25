import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import '../../state/professional_dashboard_store.dart';
import '../../widgets/pro/pro_components.dart';
import 'pro_job_flow.dart';
import 'pro_notifications_screen.dart';

class ProDashboardScreen extends StatefulWidget {
  const ProDashboardScreen({
    super.key,
    this.onNavigateTab,
    this.onOpenMap,
    this.onOpenEarnings,
    this.onOpenDrawer,
    this.onOpenKyc,
    this.onOpenSupport,
  });

  final ValueChanged<int>? onNavigateTab;
  final VoidCallback? onOpenMap;
  final VoidCallback? onOpenEarnings;
  final VoidCallback? onOpenDrawer;
  final VoidCallback? onOpenKyc;
  final VoidCallback? onOpenSupport;

  @override
  State<ProDashboardScreen> createState() => _ProDashboardScreenState();
}

class _ProDashboardScreenState extends State<ProDashboardScreen>
    with WidgetsBindingObserver {
  String _gpsStatus = 'Checking GPS…';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ProfessionalJobScope.scheduleLoad(() {
      ProfessionalJobScope.storeOf(context).ensureLoaded();
    });
    _refreshGps();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshGps();
    }
  }

  Future<void> _refreshGps() async {
    try {
      final service = await Geolocator.isLocationServiceEnabled();
      if (!service) {
        if (mounted) setState(() => _gpsStatus = 'GPS unavailable');
        return;
      }
      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) setState(() => _gpsStatus = 'GPS unavailable');
        return;
      }
      if (mounted) setState(() => _gpsStatus = 'GPS active');
    } catch (_) {
      if (mounted) setState(() => _gpsStatus = 'GPS unavailable');
    }
  }

  Future<void> _toggleOnline(bool value) async {
    await ProfessionalJobScope.storeOf(context).setOnline(value);
    if (!mounted) return;
    await _refreshGps();
  }

  @override
  Widget build(BuildContext context) {
    final store = ProfessionalJobScope.storeOf(context);
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        if (store.initialLoading && store.dashboard == null) {
          return const ProScreenState.loading();
        }
        final data = store.dashboard;
        if (data == null) {
          return ProScreenState.error(
            message: store.error ?? 'Unable to load dashboard',
            onRetry: store.ensureLoaded,
          );
        }

        return _buildDashboard(context, store, data);
      },
    );
  }

  Widget _buildDashboard(
    BuildContext context,
    ProfessionalDashboardStore store,
    ProfessionalDashboardData data,
  ) {
    final media = MediaQuery.of(context);
    final width = media.size.width;
    final compact = width < 390;
    final narrow = width < 360;
    final horizontalPad = compact ? 12.0 : 16.0;
    final sectionGap = compact ? 10.0 : 14.0;
    final stackTaskCards = narrow;

    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        color: kProPink,
        onRefresh: () => store.refreshQuiet(),
        child: ListView(
          padding: EdgeInsets.fromLTRB(horizontalPad, compact ? 4 : 8, horizontalPad, 24),
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            _DashboardHeader(
              compact: compact,
              unread: data.unreadNotifications,
              onMenu: widget.onOpenDrawer,
              onNotifications: () async {
                await store.refreshQuiet(
                  slices: {ProfessionalDataSlice.dashboard},
                );
                if (!context.mounted) return;
                await Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (ctx) => ProfessionalJobScope.wrapRoute(
                      context,
                      const ProNotificationsScreen(),
                    ),
                  ),
                );
                if (!context.mounted) return;
                await store.refreshQuiet(
                  slices: {
                    ProfessionalDataSlice.dashboard,
                    ProfessionalDataSlice.services,
                  },
                );
              },
            ),
            SizedBox(height: sectionGap),
            _ProfileAvailabilityCard(
              compact: compact,
              data: data,
              photoBytes: store.profilePhotoBytes,
              gpsStatus: _gpsStatus,
              updating: store.availabilityBusy,
              availabilityError: store.availabilityError,
              onToggle: _toggleOnline,
              onOpenKyc: widget.onOpenKyc,
            ),
            SizedBox(height: sectionGap),
            if (stackTaskCards)
              Column(
                children: [
                  _TaskCountCard(
                    compact: compact,
                    label: 'Delivery',
                    countLabel: '${data.deliveryOffersCount} new orders',
                    icon: Icons.shopping_bag_outlined,
                    accent: kProPink,
                    onTap: () => widget.onNavigateTab?.call(1),
                  ),
                  SizedBox(height: compact ? 8 : 10),
                  _TaskCountCard(
                    compact: compact,
                    label: 'Home Service',
                    countLabel: '${data.homeServiceOffersCount} new jobs',
                    icon: Icons.home_outlined,
                    accent: const Color(0xFF4EA1FF),
                    onTap: () => widget.onNavigateTab?.call(2),
                  ),
                ],
              )
            else
              Row(
                children: [
                  Expanded(
                    child: _TaskCountCard(
                      compact: compact,
                      label: 'Delivery',
                      countLabel: '${data.deliveryOffersCount} new orders',
                      icon: Icons.shopping_bag_outlined,
                      accent: kProPink,
                      onTap: () => widget.onNavigateTab?.call(1),
                    ),
                  ),
                  SizedBox(width: compact ? 8 : 12),
                  Expanded(
                    child: _TaskCountCard(
                      compact: compact,
                      label: 'Home Service',
                      countLabel: '${data.homeServiceOffersCount} new jobs',
                      icon: Icons.home_outlined,
                      accent: const Color(0xFF4EA1FF),
                      onTap: () => widget.onNavigateTab?.call(2),
                    ),
                  ),
                ],
              ),
            SizedBox(height: sectionGap),
            Row(
              children: [
                Expanded(
                  child: _MiniStat(
                    compact: compact,
                    label: compact ? 'Earnings' : "Today's Earnings",
                    value: '₹${data.earningsToday.toStringAsFixed(0)}',
                    icon: Icons.currency_rupee,
                    iconColor: const Color(0xFF8B7CFF),
                  ),
                ),
                SizedBox(width: compact ? 6 : 8),
                Expanded(
                  child: _MiniStat(
                    compact: compact,
                    label: 'Completed',
                    value: '${data.completedToday}',
                    icon: Icons.assignment_turned_in_outlined,
                    iconColor: const Color(0xFFFF5A6A),
                  ),
                ),
                SizedBox(width: compact ? 6 : 8),
                Expanded(
                  child: _MiniStat(
                    compact: compact,
                    label: 'Rating',
                    value: data.rating.toStringAsFixed(1),
                    icon: Icons.star,
                    iconColor: const Color(0xFFFFC24A),
                  ),
                ),
              ],
            ),
            SizedBox(height: compact ? 14 : 18),
            const Text(
              'Quick actions',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
            ),
            SizedBox(height: compact ? 8 : 10),
            GridView.count(
              crossAxisCount: narrow ? 1 : 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: compact ? 8 : 10,
              crossAxisSpacing: compact ? 8 : 10,
              childAspectRatio: narrow ? 3.2 : (compact ? 1.85 : 1.7),
              children: [
                _QuickAction(
                  compact: compact,
                  icon: Icons.my_location_outlined,
                  label: 'Update Location',
                  onTap: widget.onOpenMap,
                ),
                _QuickAction(
                  compact: compact,
                  icon: Icons.payments_outlined,
                  label: 'Earnings',
                  onTap: widget.onOpenEarnings,
                ),
                _QuickAction(
                  compact: compact,
                  icon: Icons.spa_outlined,
                  label: 'Services',
                  onTap: () => widget.onNavigateTab?.call(2),
                ),
                _QuickAction(
                  compact: compact,
                  icon: Icons.support_agent_outlined,
                  label: 'Support',
                  onTap: widget.onOpenSupport,
                ),
              ],
            ),
            SizedBox(height: compact ? 14 : 18),
            if (data.isOnline && _gpsStatus != 'GPS active')
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  'Turn on GPS so Baylen can match you to nearby home service jobs.',
                  style: TextStyle(color: Colors.orangeAccent, fontSize: compact ? 11 : 12),
                ),
              ),
            Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Active service',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
              ),
              TextButton(
                onPressed: () => widget.onNavigateTab?.call(2),
                child: const Text('See all'),
              ),
            ],
          ),
          if (data.upcomingJobs.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text(
                'No upcoming service assignments.',
                style: TextStyle(color: kProTextSecondary),
              ),
            )
          else
            ...data.upcomingJobs.take(3).map(
              (job) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: ProCard(
                  onTap: () => ProJobFlow.openJobDetail(context, job.id, job.type),
                  child: Row(
                    children: [
                      Icon(
                        job.type == ProfessionalJobType.homeService
                            ? Icons.home_outlined
                            : Icons.local_shipping_outlined,
                        color: kProPink,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(job.title, style: const TextStyle(color: Colors.white)),
                            Text(
                              job.subtitle,
                              style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                            ),
                          ],
                        ),
                      ),
                      Text('₹${job.amount.toStringAsFixed(0)}'),
                    ],
                  ),
                ),
              ),
            ),
          if (store.error != null && store.dashboard != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(store.error!, style: const TextStyle(color: Colors.redAccent)),
            ),
        ],
      ),
      ),
    );
  }
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({
    required this.unread,
    this.compact = false,
    this.onMenu,
    this.onNotifications,
  });

  final int unread;
  final bool compact;
  final VoidCallback? onMenu;
  final VoidCallback? onNotifications;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        IconButton(
          visualDensity: compact ? VisualDensity.compact : VisualDensity.standard,
          padding: compact ? EdgeInsets.zero : null,
          constraints: compact ? const BoxConstraints(minWidth: 40, minHeight: 40) : null,
          onPressed: onMenu,
          icon: const Icon(Icons.menu, color: Colors.white),
        ),
        Expanded(
          child: Image.asset(
            'assets/branding/baylen-de-louis-logo.png',
            height: compact ? 24 : 28,
            fit: BoxFit.contain,
            errorBuilder: (context, error, stackTrace) => Text(
              'BAYLEN DE LOUIS',
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                letterSpacing: compact ? 0.8 : 1,
                fontSize: compact ? 13 : 14,
              ),
            ),
          ),
        ),
        Stack(
          clipBehavior: Clip.none,
          children: [
            IconButton(
              visualDensity: compact ? VisualDensity.compact : VisualDensity.standard,
              padding: compact ? EdgeInsets.zero : null,
              constraints: compact ? const BoxConstraints(minWidth: 40, minHeight: 40) : null,
              onPressed: onNotifications,
              icon: const Icon(Icons.notifications_outlined, color: Colors.white),
            ),
            if (unread > 0)
              Positioned(
                right: compact ? 6 : 10,
                top: compact ? 6 : 10,
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: const BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _ProfileAvailabilityCard extends StatelessWidget {
  const _ProfileAvailabilityCard({
    required this.data,
    this.compact = false,
    this.photoBytes,
    required this.gpsStatus,
    required this.updating,
    this.availabilityError,
    required this.onToggle,
    this.onOpenKyc,
  });

  final ProfessionalDashboardData data;
  final bool compact;
  final Uint8List? photoBytes;
  final String gpsStatus;
  final bool updating;
  final String? availabilityError;
  final ValueChanged<bool> onToggle;
  final VoidCallback? onOpenKyc;

  bool get _toggleEnabled =>
      !updating &&
      !data.kycRequired &&
      (data.isOnline ? data.canGoOffline : true);

  @override
  Widget build(BuildContext context) {
    final avatarRadius = compact ? 24.0 : 28.0;
    final statusLabel = data.isOnline ? (data.isBusy ? 'Busy' : 'Online') : 'Offline';

    return ProCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ProPartnerAvatar(
                name: data.displayName,
                photoUrl: data.profilePhotoUrl,
                photoBytes: photoBytes,
                radius: avatarRadius,
              ),
              SizedBox(width: compact ? 10 : 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            data.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: compact ? 16 : 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        _StatusPill(label: statusLabel, online: data.isOnline, compact: compact),
                      ],
                    ),
                    Text(
                      data.greetingName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: kProTextSecondary, fontSize: compact ? 12 : 13),
                    ),
                    if (!data.kycRequired && data.phone.isNotEmpty)
                      Text(
                        data.phone,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: kProTextSecondary, fontSize: compact ? 10 : 11),
                      ),
                    Text(
                      gpsStatus,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: gpsStatus == 'GPS active'
                            ? const Color(0xFF3DDC84)
                            : kProTextSecondary,
                        fontSize: compact ? 10 : 11,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: compact ? 10 : 14),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Available for jobs',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: compact ? 13 : 14,
                  ),
                ),
              ),
              Transform.scale(
                scale: compact ? 0.9 : 1,
                child: Switch(
                  value: data.isOnline,
                  onChanged: _toggleEnabled ? onToggle : null,
                  activeThumbColor: Colors.white,
                  activeTrackColor: kProPink,
                ),
              ),
            ],
          ),
          if (data.kycRequired)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: onOpenKyc,
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Text(
                  compact
                      ? 'Complete KYC to go online'
                      : 'Complete KYC and enable location to go online',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: kProPink, fontSize: compact ? 11 : 12),
                ),
              ),
            ),
          if (!data.canGoOffline)
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Finish the active job before going offline',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: kProTextSecondary, fontSize: compact ? 11 : 12),
              ),
            ),
          if (availabilityError != null && availabilityError!.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  availabilityError!,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.redAccent, fontSize: compact ? 11 : 12),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.online,
    this.compact = false,
  });

  final String label;
  final bool online;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 10,
        vertical: compact ? 4 : 6,
      ),
      decoration: BoxDecoration(
        color: online ? const Color(0xFF1F3D2C) : kProSurface,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: online ? const Color(0xFF3DDC84) : kProTextSecondary,
          fontWeight: FontWeight.w700,
          fontSize: compact ? 11 : 12,
        ),
      ),
    );
  }
}

class _TaskCountCard extends StatelessWidget {
  const _TaskCountCard({
    required this.label,
    required this.countLabel,
    required this.icon,
    required this.accent,
    this.compact = false,
    this.onTap,
  });

  final String label;
  final String countLabel;
  final IconData icon;
  final Color accent;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: accent, size: compact ? 22 : 26),
          SizedBox(height: compact ? 8 : 10),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
              fontSize: compact ? 13 : 14,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            countLabel,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: kProTextSecondary, fontSize: compact ? 11 : 12),
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  const _QuickAction({
    required this.icon,
    required this.label,
    this.compact = false,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      onTap: onTap,
      child: Row(
        children: [
          Icon(icon, color: kProPink, size: compact ? 20 : 24),
          SizedBox(width: compact ? 8 : 10),
          Expanded(
            child: Text(
              label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: compact ? 12 : 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({
    required this.label,
    required this.value,
    required this.icon,
    required this.iconColor,
    this.compact = false,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color iconColor;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      child: Column(
        children: [
          Icon(icon, color: iconColor, size: compact ? 18 : 20),
          SizedBox(height: compact ? 6 : 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              value,
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: compact ? 14 : 16,
              ),
            ),
          ),
          Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: kProTextSecondary, fontSize: compact ? 9 : 10),
          ),
        ],
      ),
    );
  }
}
