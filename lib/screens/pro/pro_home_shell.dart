import 'dart:async';

import 'package:flutter/material.dart';

import '../../auth/professional_auth_exit.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../models/delivery_partner_kyc.dart';
import '../../models/professional_job.dart';
import '../../repositories/hybrid_professional_job_repository.dart';
import '../../repositories/professional_job_repository.dart';
import '../../repositories/professional_job_scope.dart';
import '../../state/professional_dashboard_store.dart';
import '../../widgets/pro/pro_components.dart';
import '../delivery_partner/delivery_partner_kyc_screen.dart';
import 'pro_dashboard_screen.dart';
import 'pro_map_tab_screen.dart';
import 'pro_orders_tab_screen.dart';
import 'pro_profile_screen.dart';

/// Professional Partner shell — Home / Orders / Service / Profile.
class ProHomeShell extends StatefulWidget {
  const ProHomeShell({
    super.key,
    this.repository,
    this.initialKyc,
    this.skipKycCheck = false,
    this.onSignedOut,
    this.enableLiveRefresh = true,
  });

  final ProfessionalJobRepository? repository;
  final DeliveryPartnerKyc? initialKyc;
  final bool skipKycCheck;
  final VoidCallback? onSignedOut;
  final bool enableLiveRefresh;

  @override
  State<ProHomeShell> createState() => _ProHomeShellState();
}

class _ProHomeShellState extends State<ProHomeShell> with WidgetsBindingObserver {
  int _index = 0;
  DeliveryPartnerKyc? _kyc;
  late final ProfessionalJobRepository _repository;
  late final ProfessionalDashboardStore _store;
  Timer? _refreshTimer;
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  int _lastHomeServiceOffers = 0;
  int _lastUnreadNotifications = 0;
  bool _alertsInitialized = false;
  bool _signingOut = false;
  bool _shellReady = false;

  static const _kycTimeout = Duration(seconds: 20);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _repository = widget.repository ?? HybridProfessionalJobRepository();
    _store = ProfessionalDashboardStore(_repository);
    if (!DeliveryPartnerAuthService.instance.isSignedIn) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onSignedOut?.call();
      });
      return;
    }
    _kyc = widget.initialKyc;
    if (!widget.skipKycCheck) {
      unawaited(_refreshKycQuiet());
    }
    if (widget.enableLiveRefresh) {
      _refreshTimer = Timer.periodic(const Duration(seconds: 8), (_) {
        if (!mounted || !_store.hasCachedDashboard) return;
        unawaited(_pollLiveUpdates());
      });
    }
    unawaited(_bootstrapShell());
  }

  Future<void> _bootstrapShell() async {
    try {
      await _store.ensureLoaded();
    } catch (_) {}
    if (!mounted) return;
    setState(() => _shellReady = true);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _store.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_pollLiveUpdates(forceServices: true));
    }
  }

  Future<void> _pollLiveUpdates({bool forceServices = false}) async {
    if (!mounted || !_store.hasCachedDashboard) return;
    final before = _store.dashboard;
    await _store.refreshQuiet(
      slices: {
        ProfessionalDataSlice.dashboard,
        if (_store.dashboard?.isOnline == true || forceServices)
          ProfessionalDataSlice.services,
      },
    );
    if (!mounted) return;
    final after = _store.dashboard;
    if (after == null) return;
    _maybeAlertNewWork(before, after);
  }

  void _maybeAlertNewWork(ProfessionalDashboardData? before, ProfessionalDashboardData after) {
    if (!_alertsInitialized) {
      _lastHomeServiceOffers = after.homeServiceOffersCount;
      _lastUnreadNotifications = after.unreadNotifications;
      _alertsInitialized = true;
      return;
    }
    final prevOffers = before?.homeServiceOffersCount ?? _lastHomeServiceOffers;
    final prevUnread = before?.unreadNotifications ?? _lastUnreadNotifications;
    _lastHomeServiceOffers = after.homeServiceOffersCount;
    _lastUnreadNotifications = after.unreadNotifications;
    if (after.homeServiceOffersCount > prevOffers && after.homeServiceOffersCount > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${after.homeServiceOffersCount - prevOffers} new home service job(s) — tap Service to view',
          ),
          action: SnackBarAction(
            label: 'Open',
            onPressed: () => _selectTab(2),
          ),
        ),
      );
    } else if (after.unreadNotifications > prevUnread && after.unreadNotifications > 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('New notification — check the bell icon on Home'),
        ),
      );
    }
  }

  Future<void> _refreshKycQuiet() async {
    if (!DeliveryPartnerAuthService.instance.isSignedIn) return;

    try {
      final kyc = await DeliveryPartnerAuthService.instance.api
          .fetchDeliveryPartnerKyc()
          .timeout(_kycTimeout);
      if (!mounted) return;
      setState(() => _kyc = kyc);
    } catch (_) {
      // Keep the dashboard usable even if KYC refresh fails or times out.
    }
  }

  Future<void> _openKyc() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => const DeliveryPartnerKycScreen()),
    );
    await _refreshKycQuiet();
  }

  Future<void> _openSupport() async {
    final controller = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: kProCard,
        title: const Text('Partner support', style: TextStyle(color: Colors.white)),
        content: TextField(
          controller: controller,
          maxLines: 4,
          style: const TextStyle(color: Colors.white),
          decoration: const InputDecoration(
            hintText: 'Describe your issue…',
            hintStyle: TextStyle(color: kProTextSecondary),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send')),
        ],
      ),
    );
    if (submitted != true || !mounted) return;
    final message = controller.text.trim();
    controller.dispose();
    if (message.length < 5) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please enter at least 5 characters.')),
      );
      return;
    }
    try {
      await _repository.createSupportTicket(
        category: 'general',
        message: message,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Support request sent. Our team will contact you.')),
      );
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not send support request: $err')),
      );
    }
  }

  bool get _operational => _kyc?.operational == true;

  void _openMap() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProfessionalJobScope(
          repository: _repository,
          store: _store,
          child: Scaffold(
            backgroundColor: kProCanvas,
            appBar: AppBar(backgroundColor: kProCanvas, title: const Text('Live map')),
            body: ProMapTabScreen(enabled: _operational),
          ),
        ),
      ),
    );
  }

  void _openEarnings() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProfessionalJobScope(
          repository: _repository,
          store: _store,
          child: Scaffold(
            backgroundColor: kProCanvas,
            appBar: AppBar(backgroundColor: kProCanvas, title: const Text('Earnings')),
            body: const ProEarningsTabScreen(),
          ),
        ),
      ),
    );
  }

  Future<void> _signOut() async {
    if (_signingOut) return;
    _signingOut = true;
    _scaffoldKey.currentState?.closeDrawer();
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _store.reset();
    if (mounted) {
      setState(() => _shellReady = false);
      widget.onSignedOut?.call();
    }
    await ProfessionalAuthExit.signOutDeliveryPartner();
  }

  @override
  Widget build(BuildContext context) {
    if (_signingOut) {
      return const SizedBox.shrink();
    }
    if (!DeliveryPartnerAuthService.instance.isSignedIn) {
      return const SizedBox.shrink();
    }
    return ProfessionalJobScope(
      repository: _repository,
      store: _store,
      child: Scaffold(
        key: _scaffoldKey,
        backgroundColor: kProCanvas,
        appBar: _index == 0
            ? null
            : AppBar(
                backgroundColor: kProCanvas,
                title: Text(_titleForIndex(_index)),
              ),
        drawer: Drawer(
          backgroundColor: kProCard,
          child: SafeArea(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Baylen Professional',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 16),
                ListTile(
                  leading: const Icon(Icons.person_outline, color: kProPink),
                  title: const Text('Profile', style: TextStyle(color: Colors.white)),
                  onTap: () {
                    Navigator.pop(context);
                    setState(() => _index = 3);
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.verified_user_outlined, color: kProPink),
                  title: const Text('KYC', style: TextStyle(color: Colors.white)),
                  onTap: () {
                    Navigator.pop(context);
                    _openKyc();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.map_outlined, color: kProPink),
                  title: const Text('Live map', style: TextStyle(color: Colors.white)),
                  onTap: () {
                    Navigator.pop(context);
                    _openMap();
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.payments_outlined, color: kProPink),
                  title: const Text('Earnings', style: TextStyle(color: Colors.white)),
                  onTap: () {
                    Navigator.pop(context);
                    _openEarnings();
                  },
                ),
              ],
            ),
          ),
        ),
        body: !_shellReady
            ? const Center(
                child: CircularProgressIndicator(color: kProPink, strokeWidth: 2.6),
              )
            : IndexedStack(
          index: _index,
          children: [
            ProDashboardScreen(
              onNavigateTab: _selectTab,
              onOpenMap: _openMap,
              onOpenEarnings: _openEarnings,
              onOpenDrawer: () => _scaffoldKey.currentState?.openDrawer(),
              onOpenKyc: _openKyc,
              onOpenSupport: _openSupport,
            ),
            const ProOrdersTabScreen(),
            ProServicesTabScreen(enabled: _operational),
            ProProfileScreen(
              onOpenEarnings: _openEarnings,
              onSignOut: _signOut,
              signingOut: _signingOut,
            ),
          ],
        ),
        bottomNavigationBar: NavigationBar(
          labelBehavior: NavigationDestinationLabelBehavior.onlyShowSelected,
          height: MediaQuery.sizeOf(context).width < 390 ? 64 : 72,
          selectedIndex: _index,
          onDestinationSelected: (value) {
            if (!_shellReady) return;
            if (!_operational && (value == 1 || value == 2)) {
              _openKyc();
              return;
            }
            setState(() => _index = value);
            if (value == 2) {
              unawaited(_pollLiveUpdates(forceServices: true));
            }
          },
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.home_outlined),
              selectedIcon: Icon(Icons.home),
              label: 'Home',
            ),
            NavigationDestination(
              icon: Icon(Icons.local_shipping_outlined),
              selectedIcon: Icon(Icons.local_shipping),
              label: 'Orders',
            ),
            NavigationDestination(
              icon: Icon(Icons.spa_outlined),
              selectedIcon: Icon(Icons.spa),
              label: 'Service',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Profile',
            ),
          ],
        ),
      ),
    );
  }

  void _selectTab(int index) {
    if (!_operational && (index == 1 || index == 2)) {
      _openKyc();
      return;
    }
    setState(() => _index = index);
    if (index == 2) {
      unawaited(_pollLiveUpdates(forceServices: true));
    }
  }

  String _titleForIndex(int index) {
    switch (index) {
      case 1:
        return 'Product Orders';
      case 2:
        return 'Service Jobs';
      case 3:
        return 'Profile';
      default:
        return 'Professional';
    }
  }
}
