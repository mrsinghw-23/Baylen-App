import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../models/professional_job.dart';
import '../services/professional_tracking_service.dart';
import '../repositories/hybrid_professional_job_repository.dart';
import '../repositories/professional_job_repository.dart';

enum ProfessionalDataSlice { dashboard, services, earnings }

/// Shared live cache for the Professional Partner dashboard.
/// Employee profile fields come only from GET /v1/delivery-partner/dashboard.
class ProfessionalDashboardStore extends ChangeNotifier {
  ProfessionalDashboardStore(this.repository);

  final ProfessionalJobRepository repository;

  ProfessionalDashboardData? dashboard;
  Uint8List? profilePhotoBytes;
  List<ProfessionalJobOffer> offeredHome = const [];
  List<ProfessionalJobSummary> activeHome = const [];
  List<ProfessionalJobSummary> completedHome = const [];
  List<ProfessionalJobSummary> cancelledHome = const [];
  ProfessionalEarningsSummary? earnings;
  List<EarningsEntry> earningsHistory = const [];

  bool initialLoading = false;
  bool quietRefreshing = false;
  bool availabilityBusy = false;
  String? error;
  String? availabilityError;
  String? busyJobId;
  String? busyAction;

  final Set<ProfessionalDataSlice> _inFlight = {};
  Future<void>? _bootstrap;
  DateTime? _dashboardAt;
  DateTime? _servicesAt;
  DateTime? _earningsAt;
  bool _disposed = false;

  static const _dashboardTtl = Duration(seconds: 20);
  static const _servicesTtl = Duration(seconds: 8);
  static const _earningsTtl = Duration(seconds: 30);
  static const _loadTimeout = Duration(seconds: 25);

  bool get hasCachedDashboard => dashboard != null;

  /// Clears cached dashboard data on sign out so stale employee data cannot reappear.
  void reset() {
    dashboard = null;
    profilePhotoBytes = null;
    offeredHome = const [];
    activeHome = const [];
    completedHome = const [];
    cancelledHome = const [];
    earnings = null;
    earningsHistory = const [];
    initialLoading = false;
    quietRefreshing = false;
    availabilityBusy = false;
    error = null;
    availabilityError = null;
    busyJobId = null;
    busyAction = null;
    _bootstrap = null;
    _dashboardAt = null;
    _servicesAt = null;
    _earningsAt = null;
    _inFlight.clear();
    _notify();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }

  void _notify() {
    if (_disposed) return;
    notifyListeners();
  }

  Future<void> ensureLoaded() async {
    if (_disposed) return;
    if (hasCachedDashboard) {
      unawaited(_refreshStaleSlices());
      return;
    }
    _bootstrap ??= _bootstrapLoad();
    try {
      await _bootstrap!.timeout(_loadTimeout);
    } on TimeoutException {
      if (_disposed) return;
      if (dashboard == null) {
        error = 'Dashboard load timed out. Pull to retry.';
      }
      initialLoading = false;
      _bootstrap = null;
      _notify();
    }
  }

  Future<void> _refreshStaleSlices() async {
    final slices = <ProfessionalDataSlice>{};
    if (_isStale(_dashboardAt, _dashboardTtl)) {
      slices.add(ProfessionalDataSlice.dashboard);
    }
    if (_isStale(_servicesAt, _servicesTtl)) {
      slices.add(ProfessionalDataSlice.services);
    }
    if (slices.isEmpty) return;
    await refreshQuiet(slices: slices);
  }

  Future<void> _bootstrapLoad() async {
    initialLoading = true;
    error = null;
    _notify();
    try {
      await _loadDashboard(force: true).timeout(_loadTimeout);
      if (_disposed) return;
      if (dashboard != null) {
        initialLoading = false;
        _notify();
        if (dashboard!.isOnline) {
          await _startAvailabilityPingIfNeeded();
        }
      }
      await _loadServices(force: true).timeout(_loadTimeout);
      if (_disposed) return;
      error = null;
    } catch (err) {
      if (_disposed) return;
      error = err.toString();
    } finally {
      if (!_disposed) {
        initialLoading = false;
        _notify();
        _bootstrap = null;
      }
    }
  }

  Future<void> refreshQuiet({
    Set<ProfessionalDataSlice> slices = const {
      ProfessionalDataSlice.dashboard,
      ProfessionalDataSlice.services,
    },
  }) async {
    if (_disposed) return;
    quietRefreshing = true;
    _notify();
    try {
      final tasks = <Future<void>>[];
      if (slices.contains(ProfessionalDataSlice.dashboard)) {
        tasks.add(_loadDashboard(force: true));
      }
      if (slices.contains(ProfessionalDataSlice.services)) {
        tasks.add(_loadServices(force: true));
      }
      if (slices.contains(ProfessionalDataSlice.earnings)) {
        tasks.add(_loadEarnings(force: true));
      }
      await Future.wait(tasks);
      if (_disposed) return;
      error = null;
    } catch (err) {
      if (_disposed) return;
      error = err.toString();
    } finally {
      if (!_disposed) {
        quietRefreshing = false;
        _notify();
      }
    }
  }

  Future<void> _startAvailabilityPingIfNeeded() async {
    if (_disposed) return;
    if (repository is! HybridProfessionalJobRepository) return;
    try {
      await ProfessionalTrackingService.instance.startAvailabilityTracking(
        api: (repository as HybridProfessionalJobRepository).apiForTracking,
      );
    } catch (_) {}
  }

  Future<void> setOnline(bool online) async {
    if (_disposed) return;
    final current = dashboard;
    if (current == null) return;
    if (online && current.kycRequired) {
      availabilityError = 'Complete KYC before going online.';
      _notify();
      return;
    }
    if (online) {
      final permission = await ProfessionalTrackingService.instance.ensurePermission();
      if (permission != TrackingPermissionState.granted) {
        availabilityError = ProfessionalTrackingService.permissionMessage(permission);
        _notify();
        return;
      }
    }
    availabilityError = null;
    final previous = current;
    if (!online || !current.kycRequired) {
      dashboard = _copyDashboard(
        current,
        isOnline: online,
        isBusy: online ? current.isBusy : false,
      );
      _notify();
    }
    availabilityBusy = true;
    _notify();
    try {
      await repository.setOnlineStatus(online: online);
      if (_disposed) return;
      availabilityError = null;
      if (online) {
        await _startAvailabilityPingIfNeeded();
      } else {
        await ProfessionalTrackingService.instance.stopAvailabilityTracking();
      }
      await _loadDashboard(force: true);
      if (_disposed) return;
      if (online) {
        await _loadServices(force: true);
      }
    } catch (err) {
      if (_disposed) return;
      final apiMessage = err is ApiException ? err.message : err.toString();
      final kycBlocked = err is ApiException && err.code == 'KYC_REQUIRED';
      availabilityError = kycBlocked || apiMessage.toLowerCase().contains('kyc')
          ? 'Complete KYC approval before going online.'
          : apiMessage;
      error = availabilityError;
      dashboard = previous;
    } finally {
      if (!_disposed) {
        availabilityBusy = false;
        _notify();
      }
    }
  }

  Future<bool> saveAvailabilitySchedule(Map<String, dynamic> schedule) async {
    if (_disposed) return false;
    final repo = repository;
    if (repo is! HybridProfessionalJobRepository) {
      return false;
    }
    availabilityBusy = true;
    availabilityError = null;
    _notify();
    try {
      dashboard = await repo.saveAvailabilitySchedule(schedule);
      if (_disposed) return false;
      _dashboardAt = DateTime.now();
      return true;
    } catch (err) {
      if (_disposed) return false;
      availabilityError = err is ApiException
          ? err.message
          : err.toString().replaceFirst('Exception: ', '');
      return false;
    } finally {
      if (!_disposed) {
        availabilityBusy = false;
        _notify();
      }
    }
  }

  Future<MockActionResult> acceptHomeService(ProfessionalJobOffer offer) async {
    if (_disposed) {
      return const MockActionResult(mocked: false, success: false, message: 'Store disposed');
    }
    busyJobId = offer.id;
    busyAction = 'accept';
    _notify();
    final result = await repository.acceptJob(offer.id);
    if (_disposed) return result;
    if (result.success) {
      offeredHome = offeredHome.where((item) => item.id != offer.id).toList(growable: false);
      activeHome = [
        ProfessionalJobSummary(
          id: offer.id,
          type: offer.type,
          title: offer.title,
          subtitle: offer.subtitle,
          amount: offer.amount,
          distanceKm: offer.distanceKm,
          etaMinutes: offer.etaMinutes,
          phase: ProfessionalJobPhase.accepted,
          scheduledAt: offer.scheduledAt,
        ),
        ...activeHome,
      ];
      final data = dashboard;
      if (data != null) {
        dashboard = _copyDashboard(
          data,
          homeServiceOffersCount: (data.homeServiceOffersCount - 1).clamp(0, 9999),
          activeHomeServices: data.activeHomeServices + 1,
          isBusy: true,
          isOnline: true,
          canGoOffline: false,
          activeJobId: offer.id,
          upcomingJobs: [
            ProfessionalJobSummary(
              id: offer.id,
              type: offer.type,
              title: offer.title,
              subtitle: offer.subtitle,
              amount: offer.amount,
              distanceKm: offer.distanceKm,
              etaMinutes: offer.etaMinutes,
              phase: ProfessionalJobPhase.accepted,
              scheduledAt: offer.scheduledAt,
            ),
          ],
        );
      }
    }
    busyJobId = null;
    busyAction = null;
    _notify();
    if (result.success && !_disposed) {
      unawaited(refreshQuiet(slices: {
        ProfessionalDataSlice.dashboard,
        ProfessionalDataSlice.services,
      }));
    }
    return result;
  }

  Future<MockActionResult> rejectHomeService(
    ProfessionalJobOffer offer, {
    required String reason,
  }) async {
    if (_disposed) {
      return const MockActionResult(mocked: false, success: false, message: 'Store disposed');
    }
    busyJobId = offer.id;
    busyAction = 'reject';
    _notify();
    final result = await repository.rejectJob(offer.id, reason: reason);
    if (_disposed) return result;
    if (result.success) {
      offeredHome = offeredHome.where((item) => item.id != offer.id).toList(growable: false);
      final data = dashboard;
      if (data != null) {
        dashboard = _copyDashboard(
          data,
          homeServiceOffersCount: (data.homeServiceOffersCount - 1).clamp(0, 9999),
        );
      }
    }
    busyJobId = null;
    busyAction = null;
    _notify();
    if (result.success && !_disposed) {
      unawaited(refreshQuiet(slices: {
        ProfessionalDataSlice.dashboard,
        ProfessionalDataSlice.services,
      }));
    }
    return result;
  }

  Future<void> onJobAccepted(String jobId) {
    if (_disposed) return Future<void>.value();
    return refreshQuiet(slices: {
      ProfessionalDataSlice.dashboard,
      ProfessionalDataSlice.services,
    });
  }

  Future<void> onJobCompleted(String jobId) async {
    if (_disposed) return;
    activeHome = activeHome.where((item) => item.id != jobId).toList(growable: false);
    final data = dashboard;
    if (data != null) {
      dashboard = _copyDashboard(
        data,
        completedToday: data.completedToday + 1,
        completedHomeServices: data.completedHomeServices + 1,
        activeHomeServices: (data.activeHomeServices - 1).clamp(0, 9999),
        canGoOffline: true,
        isBusy: false,
        clearActiveJobId: data.activeJobId == jobId,
        upcomingJobs: data.upcomingJobs.where((job) => job.id != jobId).toList(),
      );
    }
    _notify();
    if (_disposed) return;
    await refreshQuiet(slices: {
      ProfessionalDataSlice.dashboard,
      ProfessionalDataSlice.services,
      ProfessionalDataSlice.earnings,
    });
  }

  Future<void> ensureEarnings() async {
    if (_disposed) return;
    if (earnings != null && !_isStale(_earningsAt, _earningsTtl)) return;
    final showSpinner = earnings == null;
    if (showSpinner) {
      quietRefreshing = true;
      _notify();
    }
    try {
      await _loadEarnings(force: earnings == null || _isStale(_earningsAt, _earningsTtl));
      if (_disposed) return;
    } catch (err) {
      if (_disposed) return;
      error = err.toString();
    } finally {
      if (!_disposed) {
        if (showSpinner) quietRefreshing = false;
        _notify();
      }
    }
  }

  Future<void> _loadProfilePhotoIfNeeded() async {
    final data = dashboard;
    if (data == null || !data.hasProfilePhoto) {
      profilePhotoBytes = null;
      return;
    }
    if (data.profilePhotoUrl.startsWith('http') &&
        data.profilePhotoFetchUrl.isEmpty) {
      profilePhotoBytes = null;
      return;
    }
    Uint8List? loaded;
    for (var attempt = 0; attempt < 2; attempt++) {
      try {
        loaded = await repository.fetchProfilePhotoBytes();
        if (loaded != null && loaded.isNotEmpty) {
          break;
        }
      } catch (_) {
        loaded = null;
      }
      if (attempt == 0) {
        await Future<void>.delayed(const Duration(milliseconds: 400));
      }
    }
    profilePhotoBytes = loaded;
    _notify();
  }

  Future<void> _loadDashboard({required bool force}) async {
    if (_disposed) return;
    if (!force && !_isStale(_dashboardAt, _dashboardTtl)) return;
    if (!_inFlight.add(ProfessionalDataSlice.dashboard)) return;
    try {
      dashboard = await repository.fetchDashboard();
      if (_disposed) return;
      await _loadProfilePhotoIfNeeded();
      if (_disposed) return;
      _dashboardAt = DateTime.now();
    } finally {
      _inFlight.remove(ProfessionalDataSlice.dashboard);
    }
  }

  Future<void> _loadServices({required bool force}) async {
    if (_disposed) return;
    if (!force && !_isStale(_servicesAt, _servicesTtl)) return;
    if (!_inFlight.add(ProfessionalDataSlice.services)) return;
    try {
      final offered = await repository.fetchOfferedJobs(type: ProfessionalJobType.homeService);
      final active = await repository.fetchActiveJobs(type: ProfessionalJobType.homeService);
      final completed = await repository.fetchCompletedJobs(type: ProfessionalJobType.homeService);
      final cancelled = await repository.fetchCancelledJobs(type: ProfessionalJobType.homeService);
      if (_disposed) return;
      offeredHome = offered;
      activeHome = active;
      completedHome = completed;
      cancelledHome = cancelled;
      _servicesAt = DateTime.now();
    } finally {
      _inFlight.remove(ProfessionalDataSlice.services);
    }
  }

  Future<void> _loadEarnings({required bool force}) async {
    if (_disposed) return;
    if (!force && !_isStale(_earningsAt, _earningsTtl)) return;
    if (!_inFlight.add(ProfessionalDataSlice.earnings)) return;
    try {
      final results = await Future.wait([
        repository.fetchEarningsSummary(),
        repository.fetchEarningsHistory(),
      ]);
      if (_disposed) return;
      earnings = results[0] as ProfessionalEarningsSummary;
      earningsHistory = results[1] as List<EarningsEntry>;
      _earningsAt = DateTime.now();
    } finally {
      _inFlight.remove(ProfessionalDataSlice.earnings);
    }
  }

  bool _isStale(DateTime? loadedAt, Duration ttl) {
    if (loadedAt == null) return true;
    return DateTime.now().difference(loadedAt) > ttl;
  }

  ProfessionalDashboardData _copyDashboard(
    ProfessionalDashboardData current, {
    bool? isOnline,
    bool? isBusy,
    bool? canGoOffline,
    int? homeServiceOffersCount,
    int? activeHomeServices,
    int? completedHomeServices,
    int? completedToday,
    String? activeJobId,
    bool clearActiveJobId = false,
    List<ProfessionalJobSummary>? upcomingJobs,
  }) {
    return ProfessionalDashboardData(
      greetingName: current.greetingName,
      profilePhotoUrl: current.profilePhotoUrl,
      profilePhotoFetchUrl: current.profilePhotoFetchUrl,
      isOnline: isOnline ?? current.isOnline,
      isBusy: isBusy ?? current.isBusy,
      canGoOffline: canGoOffline ?? current.canGoOffline,
      deliveryOffersCount: current.deliveryOffersCount,
      homeServiceOffersCount: homeServiceOffersCount ?? current.homeServiceOffersCount,
      earningsToday: current.earningsToday,
      completedToday: completedToday ?? current.completedToday,
      rating: current.rating,
      upcomingJobs: upcomingJobs ?? current.upcomingJobs,
      kycRequired: current.kycRequired,
      activeJobId: clearActiveJobId ? null : (activeJobId ?? current.activeJobId),
      employeeId: current.employeeId,
      verificationStatus: current.verificationStatus,
      unreadNotifications: current.unreadNotifications,
      hasProfilePhoto: current.hasProfilePhoto,
      activeHomeServices: activeHomeServices ?? current.activeHomeServices,
      completedHomeServices: completedHomeServices ?? current.completedHomeServices,
      completedOrders: current.completedOrders,
      activeOrders: current.activeOrders,
      earningsTotal: current.earningsTotal,
      state: current.state,
      district: current.district,
      pincode: current.pincode,
      city: current.city,
      phone: current.phone,
      email: current.email,
      qualification: current.qualification,
      serviceZone: current.serviceZone,
      availabilitySchedule: current.availabilitySchedule,
      availabilityScheduleConfigured: current.availabilityScheduleConfigured,
      firstName: current.firstName,
      lastName: current.lastName,
    );
  }
}
