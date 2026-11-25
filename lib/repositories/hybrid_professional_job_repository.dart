import 'dart:typed_data';

import 'package:geolocator/geolocator.dart';

import '../api/catalyst_api.dart';
import '../auth/delivery_partner_auth_service.dart';

import '../models/delivery_partner_dashboard.dart';

import '../models/professional_job.dart';

import '../services/professional_tracking_service.dart';

import 'professional_job_repository.dart';

class HybridProfessionalJobRepository implements ProfessionalJobRepository {

  HybridProfessionalJobRepository({
    CatalystApi? api,
  }) : _api = api ?? DeliveryPartnerAuthService.instance.api;

  final CatalystApi _api;

  CatalystApi get apiForTracking => _api;

  @override
  Future<ProfessionalDashboardData> fetchDashboard() async {
    final dashboard = await _api.fetchPartnerDashboard();
    return _mapDashboard(dashboard);
  }

  ProfessionalDashboardData _mapDashboard(DeliveryPartnerDashboard real) {

    final partner = real.partner;

    final stats = real.stats;

    final upcoming = <ProfessionalJobSummary>[];

    final active = real.activeJob;

    if (active != null) {

      upcoming.add(

        ProfessionalJobSummary(

          id: active.id,

          type: active.serviceName.toLowerCase().contains('order') ||

                  active.bookingNumber.startsWith('PJ')

              ? ProfessionalJobType.productDelivery

              : ProfessionalJobType.homeService,

          title: active.serviceName,

          subtitle: '${active.bookingNumber} • ${active.visitCity}',

          amount: active.grandTotal,

          distanceKm: 0,

          etaMinutes: 0,

          phase: ProfessionalJobPhase.inProgress,

          scheduledAt: active.scheduledAt,

        ),

      );

    }



    final greeting = partner.firstName.trim().isNotEmpty
        ? 'Hi, ${partner.firstName.trim()}'
        : partner.displayName;

    return ProfessionalDashboardData(
      greetingName: greeting,
      profilePhotoUrl: partner.profilePhotoUrl,
      profilePhotoFetchUrl: partner.profilePhotoFetchUrl,
      isOnline: partner.isOnline,
      isBusy: partner.isBusy,
      canGoOffline: real.canGoOffline,
      deliveryOffersCount: stats.deliveryOffersCount,
      homeServiceOffersCount: stats.homeServiceOffersCount,
      earningsToday: stats.earningsToday,
      completedToday: stats.completedToday > 0 ? stats.completedToday : stats.jobsToday,
      rating: partner.rating ?? 0,
      upcomingJobs: upcoming,
      kycRequired: real.kycRequired,
      activeJobId: active?.id,
      employeeId: '',
      verificationStatus: partner.status,
      unreadNotifications: stats.unreadNotifications,
      activeHomeServices: stats.homeServiceActiveCount,
      completedHomeServices: stats.homeServiceCompletedCount,
      completedOrders: stats.deliveryCompletedCount,
      activeOrders: stats.deliveryActiveCount,
      earningsTotal: stats.availableEarnings,
      state: partner.state,
      district: partner.district,
      pincode: partner.pincode,
      city: partner.city,
      phone: partner.phone,
      email: partner.email,
      qualification: partner.qualification,
      serviceZone: partner.serviceZone,
      availabilitySchedule: partner.availabilitySchedule,
      availabilityScheduleConfigured: partner.availabilitySchedule.isNotEmpty,
      firstName: partner.firstName,
      lastName: partner.lastName,
      hasProfilePhoto: partner.hasProfilePhoto,
    );

  }



  @override

  Future<void> setOnlineStatus({required bool online}) async {
    if (online) {
      final position =
          await ProfessionalTrackingService.instance.currentPositionForGoOnline();
      await _api.setPartnerOnlineStatus(
        onlineStatus: 'ONLINE_AVAILABLE',
        latitude: position?.latitude,
        longitude: position?.longitude,
        accuracyM: position?.accuracy,
        capturedAt: position != null ? DateTime.now().toUtc() : null,
      );
      return;
    }
    await _api.setPartnerOnlineStatus(onlineStatus: 'OFFLINE');
  }

  Future<ProfessionalDashboardData> saveAvailabilitySchedule(
    Map<String, dynamic> schedule,
  ) async {
    final dashboard = await _api.savePartnerAvailabilitySchedule(schedule);
    return _mapDashboard(dashboard);
  }



  @override

  Future<List<ProfessionalJobOffer>> fetchOfferedJobs({

    required ProfessionalJobType type,

  }) async {

    final jobType = type == ProfessionalJobType.productDelivery

        ? 'PRODUCT_DELIVERY'

        : 'HOME_SERVICE';

    final rows = await _api.fetchPartnerJobs(view: 'offered', jobType: jobType);

    return rows.map(_mapOffer).toList(growable: false);

  }



  ProfessionalJobOffer _mapOffer(Map<String, dynamic> json) {

    final jobType = json['job_type']?.toString() ?? '';

    return ProfessionalJobOffer(

      id: json['professional_job_id']?.toString() ?? '',

      type: jobType == 'HOME_SERVICE'

          ? ProfessionalJobType.homeService

          : ProfessionalJobType.productDelivery,

      title: json['title']?.toString() ?? 'Professional job',

      subtitle: json['subtitle']?.toString() ?? '',

      amount: (json['amount'] as num?)?.toDouble() ?? 0,

      distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0,

      etaMinutes: (json['eta_minutes'] as num?)?.toInt() ?? 0,

      scheduledAt: json['scheduled_at']?.toString() ?? '',

      customerName: json['customer_name']?.toString() ?? '',

    );

  }



  @override

  Future<List<ProfessionalJobSummary>> fetchActiveJobs({

    required ProfessionalJobType type,

  }) async {

    final jobType = type == ProfessionalJobType.productDelivery

        ? 'PRODUCT_DELIVERY'

        : 'HOME_SERVICE';

    final rows = await _api.fetchPartnerJobs(view: 'active', jobType: jobType);

    return rows

        .map(

          (json) => ProfessionalJobSummary(

            id: json['professional_job_id']?.toString() ?? '',

            type: type,

            title: json['title']?.toString() ?? '',

            subtitle: json['subtitle']?.toString() ?? '',

            amount: (json['amount'] as num?)?.toDouble() ?? 0,

            distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0,

            etaMinutes: (json['eta_minutes'] as num?)?.toInt() ?? 0,

            phase: ProfessionalJobPhase.inProgress,

            scheduledAt: json['scheduled_at']?.toString() ?? '',

          ),

        )

        .toList(growable: false);

  }

  @override
  Future<List<ProfessionalJobSummary>> fetchCompletedJobs({
    required ProfessionalJobType type,
  }) async {
    final jobType = type == ProfessionalJobType.productDelivery
        ? 'PRODUCT_DELIVERY'
        : 'HOME_SERVICE';
    final rows = await _api.fetchPartnerJobs(view: 'completed', jobType: jobType);
    return rows
        .map(
          (json) => ProfessionalJobSummary(
            id: json['professional_job_id']?.toString() ?? '',
            type: type,
            title: json['title']?.toString() ?? '',
            subtitle: json['subtitle']?.toString() ?? '',
            amount: (json['amount'] as num?)?.toDouble() ?? 0,
            distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0,
            etaMinutes: (json['eta_minutes'] as num?)?.toInt() ?? 0,
            phase: ProfessionalJobPhase.completed,
            scheduledAt: json['scheduled_at']?.toString() ?? '',
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<List<ProfessionalJobSummary>> fetchCancelledJobs({
    required ProfessionalJobType type,
  }) async {
    final jobType = type == ProfessionalJobType.productDelivery
        ? 'PRODUCT_DELIVERY'
        : 'HOME_SERVICE';
    final rows = await _api.fetchPartnerJobs(view: 'cancelled', jobType: jobType);
    return rows
        .map(
          (json) => ProfessionalJobSummary(
            id: json['professional_job_id']?.toString() ?? '',
            type: type,
            title: json['title']?.toString() ?? '',
            subtitle: json['subtitle']?.toString() ?? '',
            amount: (json['amount'] as num?)?.toDouble() ?? 0,
            distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0,
            etaMinutes: (json['eta_minutes'] as num?)?.toInt() ?? 0,
            phase: ProfessionalJobPhase.completed,
            scheduledAt: json['scheduled_at']?.toString() ?? '',
          ),
        )
        .toList(growable: false);
  }

  @override

  Future<ProfessionalJobDetail> fetchJobDetail(String jobId) async {

    final json = await _api.fetchPartnerJobDetail(jobId);

    final jobType = json['job_type']?.toString() ?? '';

    final itemsRaw = json['items'];

    final items = itemsRaw is List

        ? itemsRaw

            .whereType<Map<String, dynamic>>()

            .map(

              (item) => ProfessionalJobItem(

                name: item['name']?.toString() ?? 'Item',

                quantity: (item['quantity'] as num?)?.toInt() ?? 1,

              ),

            )

            .toList(growable: false)

        : <ProfessionalJobItem>[];

    final checklistRaw = json['checklist'];
    final checklist = checklistRaw is List
        ? checklistRaw
            .whereType<Map<String, dynamic>>()
            .map(
              (item) => ProfessionalChecklistItem(
                id: item['id']?.toString() ?? '',
                label: item['label']?.toString() ?? '',
                done: item['done'] == true,
                completedAt: item['completed_at']?.toString(),
              ),
            )
            .toList(growable: false)
        : <ProfessionalChecklistItem>[];

    return ProfessionalJobDetail(

      id: json['professional_job_id']?.toString() ?? jobId,

      type: jobType == 'HOME_SERVICE'

          ? ProfessionalJobType.homeService

          : ProfessionalJobType.productDelivery,

      title: json['title']?.toString() ?? '',

      referenceLabel: json['job_number']?.toString() ?? '',

      amount: (json['amount'] as num?)?.toDouble() ?? 0,

      customerName: json['customer_name']?.toString() ?? '',

      customerPhone: json['customer_phone_masked']?.toString() ?? '',

      pickupTitle: json['pickup_title']?.toString() ?? '',

      pickupAddress: json['pickup_address']?.toString() ?? '',

      dropTitle: json['drop_title']?.toString() ?? '',

      dropAddress: json['drop_address']?.toString() ?? '',

      notes: json['notes']?.toString() ?? '',

      items: items,

      checklist: checklist,

      phase: _phaseFromApi(json['phase']?.toString()),

      distanceKm: (json['distance_km'] as num?)?.toDouble() ?? 0,

      etaMinutes: (json['eta_minutes'] as num?)?.toInt() ?? 0,

      progressPercent: (json['progress_percent'] as num?)?.toInt() ?? 0,

      canAccept: json['can_accept'] == true,

      canReject: json['can_reject'] == true,

      offerExpired: json['offer_expired'] == true,

      serviceStartedAt: json['service_started_at']?.toString() ?? '',

      durationMinutes: (json['duration_minutes'] as num?)?.toInt() ?? 0,

      canStartService: json['can_start_service'] == true,

      canCompleteService: json['can_complete_service'] == true,

      canStartPickup: json['can_start_pickup'] == true,

      canConfirmPickupArrival: json['can_confirm_pickup_arrival'] == true,

      canVerifyPickup: json['can_verify_pickup'] == true,

      canConfirmPickedUp: json['can_confirm_picked_up'] == true,

      canStartDelivery: json['can_start_delivery'] == true,

      canConfirmDeliveryArrival: json['can_confirm_delivery_arrival'] == true,

      canVerifyDeliveryOtp: json['can_verify_delivery_otp'] == true,

      canConfirmDelivered: json['can_confirm_delivered'] == true,

      canCompleteDelivery: json['can_complete_delivery'] == true,

      destinationLatitude: (json['destination_latitude'] as num?)?.toDouble(),

      destinationLongitude: (json['destination_longitude'] as num?)?.toDouble(),

    );

  }

  ProfessionalJobPhase _phaseFromApi(String? phase) {
    switch (phase) {
      case 'accepted':
        return ProfessionalJobPhase.accepted;
      case 'offered':
        return ProfessionalJobPhase.offered;
      case 'pickup':
        return ProfessionalJobPhase.pickup;
      case 'picked_up':
        return ProfessionalJobPhase.pickup;
      case 'delivered':
        return ProfessionalJobPhase.arrived;
      case 'en_route':
        return ProfessionalJobPhase.enRoute;
      case 'arrived':
        return ProfessionalJobPhase.arrived;
      case 'otp_verified':
        return ProfessionalJobPhase.otpVerified;
      case 'in_progress':
        return ProfessionalJobPhase.inProgress;
      case 'completed':
        return ProfessionalJobPhase.completed;
      default:
        return ProfessionalJobPhase.offered;
    }
  }



  @override

  Future<MockActionResult> acceptJob(String jobId) async {
    try {
      final data = await _api.acceptPartnerJob(jobId);
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Job ${data['job_number'] ?? jobId} accepted',
        code: data['new_status']?.toString() ?? 'ACCEPTED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }

  @override

  Future<MockActionResult> rejectJob(String jobId, {required String reason}) async {
    try {
      await _api.rejectPartnerJob(jobId: jobId, reason: reason);
      return const MockActionResult(
        mocked: false,
        success: true,
        message: 'Offer declined',
        code: 'REJECTED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }

  Future<MockActionResult> _postAction(
    Future<Map<String, dynamic>> Function() call, {
    String okMessage = 'Updated',
    String okCode = 'OK',
  }) async {
    try {
      final data = await call();
      return MockActionResult(
        mocked: false,
        success: true,
        message: okMessage,
        code: data['status']?.toString() ?? okCode,
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }

  Future<MockActionResult> _startTracking(String jobId) async {
    try {
      await ProfessionalTrackingService.instance.startTracking(
        api: _api,
        jobId: jobId,
      );
      return const MockActionResult(
        mocked: false,
        success: true,
        message: 'Live location active',
        code: 'TRACKING',
      );
    } on TrackingException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: ProfessionalTrackingService.permissionMessage(error.permissionState),
        code: 'LOCATION_PERMISSION_REQUIRED',
      );
    }
  }

  @override
  Future<MockActionResult> startPickup(String jobId) async {
    final result = await _postAction(
      () => _api.startPartnerJobPickup(jobId),
      okMessage: 'Heading to pickup',
      okCode: 'GOING_TO_PICKUP',
    );
    if (result.success) {
      final tracking = await _startTracking(jobId);
      if (!tracking.success) return tracking;
    }
    return result;
  }

  @override
  Future<MockActionResult> confirmPickupArrival(String jobId) => _postAction(
        () => _api.confirmPartnerJobPickupArrival(jobId),
        okMessage: 'Arrived at pickup',
        okCode: 'ARRIVED_PICKUP',
      );

  @override
  Future<MockActionResult> verifyPickupOtp(String jobId, String otp) => _postAction(
        () => _api.verifyPartnerJobPickup(jobId: jobId, otp: otp),
        okMessage: 'Pickup verified',
        okCode: 'PICKUP_VERIFIED',
      );

  @override
  Future<MockActionResult> confirmPickedUp(String jobId) => _postAction(
        () => _api.confirmPartnerJobPickedUp(jobId),
        okMessage: 'Order picked up',
        okCode: 'PICKED_UP',
      );

  @override
  Future<MockActionResult> startDelivery(String jobId) async {
    final result = await _postAction(
      () => _api.startPartnerJobDelivery(jobId),
      okMessage: 'Out for delivery',
      okCode: 'EN_ROUTE',
    );
    if (result.success) {
      final tracking = await _startTracking(jobId);
      if (!tracking.success) return tracking;
    }
    return result;
  }

  @override
  Future<MockActionResult> confirmDeliveryArrival(String jobId) => _postAction(
        () => _api.confirmPartnerJobDeliveryArrival(jobId),
        okMessage: 'Arrived at customer',
        okCode: 'ARRIVED',
      );

  @override
  Future<MockActionResult> verifyDeliveryOtp(String jobId, String otp) => _postAction(
        () => _api.verifyPartnerJobDeliveryOtp(jobId: jobId, otp: otp),
        okMessage: 'Delivery verified',
        okCode: 'DELIVERY_VERIFIED',
      );

  @override
  Future<MockActionResult> confirmDelivered(String jobId) => _postAction(
        () => _api.confirmPartnerJobDelivered(jobId),
        okMessage: 'Order delivered',
        okCode: 'DELIVERED',
      );

  @override

  Future<MockActionResult> startTravel(String jobId) async {
    try {
      final data = await _api.startPartnerJobTravel(jobId);
      await ProfessionalTrackingService.instance.startTracking(
        api: _api,
        jobId: jobId,
      );
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Live location active',
        code: data['new_status']?.toString() ?? 'EN_ROUTE',
      );
    } on TrackingException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: ProfessionalTrackingService.permissionMessage(error.permissionState),
        code: 'LOCATION_PERMISSION_REQUIRED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<LivePosition> fetchLivePosition(String jobId) async {
    final permission = await ProfessionalTrackingService.instance.ensurePermission();
    if (permission != TrackingPermissionState.granted) {
      throw StateError(ProfessionalTrackingService.permissionMessage(permission));
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
    final detail = await fetchJobDetail(jobId);
    return LivePosition(
      latitude: position.latitude,
      longitude: position.longitude,
      distanceKm: detail.distanceKm,
      etaMinutes: detail.etaMinutes,
      routingSource: 'device_gps',
      locationStatus: 'LIVE',
    );
  }



  @override

  Future<ArrivalPreview> fetchArrivalPreview(String jobId) async {
    final data = await _api.fetchPartnerJobArrivalPreview(jobId);
    return ArrivalPreview(
      distanceMeters: (data['distance_meters'] as num?)?.toDouble() ?? 0,
      arrivalRadiusMeters: (data['arrival_radius_meters'] as num?)?.toDouble() ?? 100,
      eligible: data['eligible'] == true,
      jobStatus: data['job_status']?.toString() ?? '',
      locationStatus: data['location_status']?.toString() ?? 'UNAVAILABLE',
      dropAddress: data['drop_address']?.toString() ?? '',
    );
  }



  @override

  Future<MockActionResult> confirmArrival(String jobId) async {
    try {
      final data = await _api.confirmPartnerJobArrival(jobId);
      await ProfessionalTrackingService.instance.stopTracking();
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Arrival confirmed',
        code: data['status']?.toString() ?? 'ARRIVED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<MockActionResult> verifyArrivalOtp(String jobId, String otp) async {
    try {
      final data = await _api.verifyPartnerJobOtp(jobId: jobId, otp: otp);
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Customer verified',
        code: data['status']?.toString() ?? 'OTP_VERIFIED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<MockActionResult> resendArrivalOtp(String jobId) async {
    try {
      await _api.resendPartnerJobOtp(jobId);
      return const MockActionResult(
        mocked: false,
        success: true,
        message: 'OTP resent to customer',
        code: 'OTP_RESENT',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<MockActionResult> startService(String jobId) async {
    try {
      final data = await _api.startPartnerJobService(jobId);
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Service started',
        code: data['status']?.toString() ?? 'IN_PROGRESS',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<MockActionResult> updateChecklistItem(

    String jobId,

    String itemId,

    bool done,

  ) async {
    try {
      await _api.updatePartnerJobChecklistItem(jobId: jobId, itemId: itemId, done: done);
      return MockActionResult(
        mocked: false,
        success: true,
        message: 'Checklist updated',
        code: 'CHECKLIST_UPDATED',
      );
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }



  @override

  Future<CompletionResult> completeJob(String jobId) async {
    try {
      final detail = await fetchJobDetail(jobId);
      final data = detail.type == ProfessionalJobType.productDelivery
          ? await _api.completePartnerJobDelivery(jobId)
          : await _api.completePartnerJobService(jobId);
      final total = (data['grand_total'] as num?)?.toDouble() ?? 0;
      return CompletionResult(
        serviceAmount: total,
        tip: 0,
        total: total,
        currency: 'INR',
        paymentStatus: data['payment_status']?.toString() ?? '',
        reviewHint: data['review_pending'] == true
            ? 'Customer can leave a review from their booking.'
            : 'Earnings will be calculated by the existing earnings system.',
        mocked: false,
      );
    } on ApiException catch (error) {
      throw StateError(error.message);
    }
  }



  @override
  Future<List<EarningsEntry>> fetchEarningsHistory() async {
    try {
      final data = await _api.fetchPartnerEarnings();
      final history = data['history'];
      if (history is! List) return const [];
      return history
          .whereType<Map<String, dynamic>>()
          .map(
            (row) => EarningsEntry(
              id: row['earning_id']?.toString() ?? '',
              jobTitle: row['job_title']?.toString() ?? 'Job',
              completedAt: row['completed_at']?.toString() ?? '',
              serviceAmount: (row['gross_amount'] as num?)?.toDouble() ?? 0,
              tip: (row['tip_amount'] as num?)?.toDouble() ?? 0,
              total: (row['net_amount'] as num?)?.toDouble() ?? 0,
              jobType: row['job_type']?.toString() ?? '',
              status: row['status']?.toString() ?? '',
            ),
          )
          .toList(growable: false);
    } on ApiException {
      return const [];
    }
  }

  @override
  Future<ProfessionalEarningsSummary> fetchEarningsSummary() async {
    try {
      final data = await _api.fetchPartnerEarnings();
      final summary = data['summary'];
      if (summary is! Map<String, dynamic>) {
        return const ProfessionalEarningsSummary();
      }
      return ProfessionalEarningsSummary(
        totalEarnings: (summary['total_earnings'] as num?)?.toDouble() ?? 0,
        earningsToday: (summary['earnings_today'] as num?)?.toDouble() ?? 0,
        earningsWeek: (summary['earnings_week'] as num?)?.toDouble() ?? 0,
        pendingEarnings: (summary['pending_earnings'] as num?)?.toDouble() ?? 0,
        availableEarnings: (summary['available_earnings'] as num?)?.toDouble() ?? 0,
        completedJobs: (summary['completed_jobs'] as num?)?.toInt() ?? 0,
        deliveryEarnings: (summary['delivery_earnings'] as num?)?.toDouble() ?? 0,
        homeServiceEarnings: (summary['home_service_earnings'] as num?)?.toDouble() ?? 0,
        commissionTotal: (summary['commission_total'] as num?)?.toDouble() ?? 0,
        deductionsTotal: (summary['deductions_total'] as num?)?.toDouble() ?? 0,
        netEarnings: (summary['net_earnings'] as num?)?.toDouble() ??
            (summary['available_earnings'] as num?)?.toDouble() ??
            0,
      );
    } on ApiException {
      final dashboard = await _api.fetchPartnerDashboard();
      return ProfessionalEarningsSummary(
        earningsToday: dashboard.stats.earningsToday,
        earningsWeek: dashboard.stats.earningsWeek,
        pendingEarnings: dashboard.stats.pendingEarnings,
        availableEarnings: dashboard.stats.availableEarnings,
        completedJobs: dashboard.stats.completedToday,
      );
    }
  }

  @override
  Future<List<Map<String, dynamic>>> fetchNotifications({int limit = 20}) =>
      _api.fetchPartnerNotifications(limit: limit);

  @override
  Future<void> markNotificationsRead(List<String> notificationIds) =>
      _api.markPartnerNotificationsRead(notificationIds);

  @override
  Future<MockActionResult> cancelJob(
    String jobId, {
    required String reasonCode,
    String? note,
  }) async {
    try {
      await _api.cancelPartnerJob(jobId, reasonCode: reasonCode, note: note);
      return const MockActionResult(mocked: false, success: true, message: 'Job cancelled');
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }

  @override
  Future<MockActionResult> reportNoShow(String jobId, {String? note}) async {
    try {
      await _api.reportPartnerNoShow(jobId, note: note);
      return const MockActionResult(mocked: false, success: true, message: 'No-show recorded');
    } on ApiException catch (error) {
      return MockActionResult(
        mocked: false,
        success: false,
        message: error.message,
        code: error.code ?? '',
      );
    }
  }

  @override
  Future<Map<String, dynamic>> fetchNoShowEligibility(String jobId) =>
      _api.fetchPartnerNoShowEligibility(jobId);

  @override
  Future<Map<String, dynamic>> createSupportTicket({
    required String category,
    required String message,
    String? jobId,
  }) =>
      _api.createPartnerSupportTicket(category: category, message: message, jobId: jobId);

  @override
  Future<Uint8List?> fetchProfilePhotoBytes() => _api.fetchPartnerProfilePhotoBytes();

}

