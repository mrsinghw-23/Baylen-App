import 'dart:typed_data';

import '../models/professional_job.dart';
import 'professional_job_repository.dart';

/// In-memory mock backing all Professional screens until PP-003+ land.
class MockProfessionalJobRepository implements ProfessionalJobRepository {
  MockProfessionalJobRepository();

  bool _online = true;
  final Set<String> _accepted = {};
  final Set<String> _started = {};
  final Set<String> _arrived = {};
  final Map<String, Map<String, bool>> _checklist = {};
  final Set<String> _completed = {};

  static final _deliveryOffers = [
    ProfessionalJobOffer(
      id: 'pj-del-001',
      type: ProfessionalJobType.productDelivery,
      title: 'Quick Commerce Order',
      subtitle: 'BLN-2026-000002 • Ranchi',
      amount: 1299,
      distanceKm: 3.2,
      etaMinutes: 18,
      customerName: 'Ananya Mehta',
    ),
    ProfessionalJobOffer(
      id: 'pj-del-002',
      type: ProfessionalJobType.productDelivery,
      title: 'Standard Delivery',
      subtitle: 'BLN-2026-000014 • Doranda',
      amount: 849,
      distanceKm: 5.8,
      etaMinutes: 32,
      customerName: 'Rahul Verma',
    ),
  ];

  static final _homeOffers = [
    ProfessionalJobOffer(
      id: 'pj-hs-001',
      type: ProfessionalJobType.homeService,
      title: 'Hair Spa at home',
      subtitle: 'PP001-SEED-JOB-1 • Bariatu',
      amount: 1299,
      distanceKm: 4.1,
      etaMinutes: 22,
      customerName: 'Priya Singh',
    ),
  ];

  @override
  Future<ProfessionalDashboardData> fetchDashboard() async {
    await Future<void>.delayed(const Duration(milliseconds: 120));
    return ProfessionalDashboardData(
      greetingName: 'Neha',
      firstName: 'Neha',
      lastName: 'Sharma',
      phone: '+91 98765 43210',
      email: 'neha@baylen.example',
      employeeId: 'dp_1001',
      state: 'Jharkhand',
      district: 'Ranchi',
      pincode: '834001',
      isOnline: _online,
      isBusy: _accepted.isNotEmpty,
      canGoOffline: _accepted.isEmpty,
      deliveryOffersCount: _deliveryOffers.length,
      homeServiceOffersCount: _homeOffers.length,
      earningsToday: 2450,
      completedToday: 3,
      rating: 4.7,
      upcomingJobs: [
        ..._deliveryOffers,
        ..._homeOffers,
      ],
    );
  }

  @override
  Future<void> setOnlineStatus({required bool online}) async {
    _online = online;
  }

  @override
  Future<List<ProfessionalJobOffer>> fetchOfferedJobs({
    required ProfessionalJobType type,
  }) async {
    await Future<void>.delayed(const Duration(milliseconds: 80));
    final source = type == ProfessionalJobType.productDelivery
        ? _deliveryOffers
        : _homeOffers;
    return source.where((job) => !_accepted.contains(job.id)).toList();
  }

  @override
  Future<List<ProfessionalJobSummary>> fetchActiveJobs({
    required ProfessionalJobType type,
  }) async {
    final source = type == ProfessionalJobType.productDelivery
        ? _deliveryOffers
        : _homeOffers;
    return source
        .where((job) => _accepted.contains(job.id) && !_completed.contains(job.id))
        .map(
          (job) => ProfessionalJobSummary(
            id: job.id,
            type: job.type,
            title: job.title,
            subtitle: job.subtitle,
            amount: job.amount,
            distanceKm: job.distanceKm,
            etaMinutes: job.etaMinutes,
            phase: _phaseFor(job.id),
          ),
        )
        .toList();
  }

  @override
  Future<List<ProfessionalJobSummary>> fetchCompletedJobs({
    required ProfessionalJobType type,
  }) async {
    final source = type == ProfessionalJobType.productDelivery
        ? _deliveryOffers
        : _homeOffers;
    return source
        .where((job) => _completed.contains(job.id))
        .map(
          (job) => ProfessionalJobSummary(
            id: job.id,
            type: job.type,
            title: job.title,
            subtitle: job.subtitle,
            amount: job.amount,
            distanceKm: job.distanceKm,
            etaMinutes: job.etaMinutes,
            phase: ProfessionalJobPhase.completed,
          ),
        )
        .toList();
  }

  @override
  Future<List<ProfessionalJobSummary>> fetchCancelledJobs({
    required ProfessionalJobType type,
  }) async {
    return const [];
  }

  ProfessionalJobPhase _phaseFor(String id) {
    if (_completed.contains(id)) return ProfessionalJobPhase.completed;
    if (_arrived.contains(id)) return ProfessionalJobPhase.arrived;
    if (_started.contains(id)) return ProfessionalJobPhase.enRoute;
    if (_accepted.contains(id)) return ProfessionalJobPhase.accepted;
    return ProfessionalJobPhase.offered;
  }

  @override
  Future<ProfessionalJobDetail> fetchJobDetail(String jobId) async {
    final offer = [..._deliveryOffers, ..._homeOffers].firstWhere(
      (job) => job.id == jobId,
      orElse: () => _deliveryOffers.first,
    );
    final isDelivery = offer.type == ProfessionalJobType.productDelivery;
    _checklist.putIfAbsent(jobId, () => {
      'prep-address': false,
      'prep-items': false,
      'prep-tools': false,
      'prep-navigate': false,
      'svc-shampoo': false,
      'svc-massage': false,
      'svc-finish': false,
    });

    return ProfessionalJobDetail(
      id: jobId,
      type: offer.type,
      title: offer.title,
      referenceLabel: offer.subtitle,
      amount: offer.amount,
      customerName: offer.customerName,
      customerPhone: '+919876543210',
      pickupTitle: isDelivery ? 'Pickup from' : 'Service outlet',
      pickupAddress: isDelivery
          ? 'Baylen Style Hub, MG Road, Ranchi'
          : 'Baylen Style Hub Bariatu',
      dropTitle: isDelivery ? 'Deliver to' : 'Customer location',
      dropAddress: isDelivery
          ? '12 Circular Road, Ranchi 834001'
          : '12 MG Road, Bariatu, Ranchi',
      notes: isDelivery
          ? 'Call on arrival. Leave at door if no answer.'
          : 'Customer prefers female professional. Bring steamer.',
      items: isDelivery
          ? const [
              ProfessionalJobItem(name: 'Minimalist Niacinamide 10%', quantity: 1),
              ProfessionalJobItem(name: 'L\'Oréal Hair Serum', quantity: 1),
            ]
          : const [ProfessionalJobItem(name: 'Hair Spa (90 min)', quantity: 1)],
      checklist: _checklist[jobId]!
          .entries
          .map(
            (e) => ProfessionalChecklistItem(
              id: e.key,
              label: _checklistLabel(e.key),
              done: e.value,
            ),
          )
          .toList(),
      phase: _phaseFor(jobId),
      distanceKm: offer.distanceKm,
      etaMinutes: offer.etaMinutes,
      progressPercent: _progressFor(jobId),
      canAccept: _phaseFor(jobId) == ProfessionalJobPhase.offered,
      canReject: _phaseFor(jobId) == ProfessionalJobPhase.offered,
    );
  }

  int _progressFor(String id) {
    if (_completed.contains(id)) return 100;
    if (_arrived.contains(id)) return 75;
    if (_started.contains(id)) return 45;
    if (_accepted.contains(id)) return 15;
    return 0;
  }

  String _checklistLabel(String id) {
    switch (id) {
      case 'prep-address':
        return 'Confirm address & contact';
      case 'prep-items':
        return 'Check service items';
      case 'prep-tools':
        return 'Bring required tools';
      case 'prep-navigate':
        return 'Navigate to customer';
      case 'svc-shampoo':
        return 'Shampoo & conditioning';
      case 'svc-massage':
        return 'Scalp massage';
      case 'svc-finish':
        return 'Blow dry & finish';
      default:
        return id;
    }
  }

  @override
  Future<MockActionResult> acceptJob(String jobId) async {
    _accepted.add(jobId);
    return const MockActionResult(
      mocked: true,
      message: 'PP-004 accept not wired — optimistic mock only',
    );
  }

  @override
  Future<MockActionResult> rejectJob(String jobId, {required String reason}) async {
    return MockActionResult(
      mocked: true,
      success: true,
      message: 'Mock reject recorded ($reason)',
      code: 'REJECTED',
    );
  }

  @override
  Future<MockActionResult> startTravel(String jobId) async {
    _started.add(jobId);
    return const MockActionResult(mocked: true, message: 'Mock travel started', code: 'EN_ROUTE');
  }

  @override
  Future<MockActionResult> startPickup(String jobId) async {
    _started.add(jobId);
    return const MockActionResult(mocked: true, message: 'Mock pickup started', code: 'GOING_TO_PICKUP');
  }

  @override
  Future<MockActionResult> confirmPickupArrival(String jobId) async =>
      const MockActionResult(mocked: true, message: 'Mock pickup arrival', code: 'ARRIVED_PICKUP');

  @override
  Future<MockActionResult> verifyPickupOtp(String jobId, String otp) async =>
      MockActionResult(mocked: true, success: otp == '123456', message: 'Mock pickup OTP', code: 'PICKUP_VERIFIED');

  @override
  Future<MockActionResult> confirmPickedUp(String jobId) async =>
      const MockActionResult(mocked: true, message: 'Mock picked up', code: 'PICKED_UP');

  @override
  Future<MockActionResult> startDelivery(String jobId) async =>
      const MockActionResult(mocked: true, message: 'Mock delivery started', code: 'EN_ROUTE');

  @override
  Future<MockActionResult> confirmDeliveryArrival(String jobId) async =>
      const MockActionResult(mocked: true, message: 'Mock delivery arrival', code: 'ARRIVED');

  @override
  Future<MockActionResult> verifyDeliveryOtp(String jobId, String otp) async =>
      MockActionResult(mocked: true, success: otp == '123456', message: 'Mock delivery OTP', code: 'DELIVERY_VERIFIED');

  @override
  Future<MockActionResult> confirmDelivered(String jobId) async =>
      const MockActionResult(mocked: true, message: 'Mock delivered', code: 'DELIVERED');

  @override
  Future<ArrivalPreview> fetchArrivalPreview(String jobId) async {
    return const ArrivalPreview(
      distanceMeters: 72,
      arrivalRadiusMeters: 100,
      eligible: true,
      jobStatus: 'EN_ROUTE',
    );
  }

  @override
  Future<MockActionResult> confirmArrival(String jobId) async {
    _arrived.add(jobId);
    return const MockActionResult(mocked: true, message: 'Mock arrival confirmed', code: 'ARRIVED');
  }

  @override
  Future<MockActionResult> verifyArrivalOtp(String jobId, String otp) async {
    if (otp == '123456') {
      return const MockActionResult(mocked: true, success: true, message: 'Verified', code: 'OTP_VERIFIED');
    }
    return const MockActionResult(mocked: true, success: false, message: 'Invalid OTP', code: 'OTP_INVALID');
  }

  @override
  Future<MockActionResult> resendArrivalOtp(String jobId) async {
    return const MockActionResult(mocked: true, success: true, message: 'OTP resent', code: 'OTP_RESENT');
  }

  @override
  Future<LivePosition> fetchLivePosition(String jobId) async {
    return const LivePosition(
      latitude: 23.3441,
      longitude: 85.3096,
      distanceKm: 2.4,
      etaMinutes: 11,
      routingSource: 'mock_static_route',
    );
  }

  @override
  Future<MockActionResult> startService(String jobId) async {
    return const MockActionResult(mocked: true, success: true, message: 'Service started', code: 'IN_PROGRESS');
  }

  @override
  Future<MockActionResult> updateChecklistItem(
    String jobId,
    String itemId,
    bool done,
  ) async {
    _checklist.putIfAbsent(jobId, () => {});
    _checklist[jobId]![itemId] = done;
    return const MockActionResult(mocked: true, message: 'PP-007 execution not wired');
  }

  @override
  Future<CompletionResult> completeJob(String jobId) async {
    _completed.add(jobId);
    return CompletionResult(
      serviceAmount: 1299,
      tip: 100,
      total: 1399,
      currency: 'INR',
      reviewHint: 'Customer may leave a review within 24 hours.',
      mocked: true,
    );
  }

  @override
  Future<ProfessionalEarningsSummary> fetchEarningsSummary() async {
    return const ProfessionalEarningsSummary(
      totalEarnings: 3249,
      earningsToday: 2248,
      earningsWeek: 3249,
      completedJobs: 2,
      deliveryEarnings: 849,
      homeServiceEarnings: 1399,
      pendingEarnings: 500,
      availableEarnings: 2749,
    );
  }

  @override
  Future<List<EarningsEntry>> fetchEarningsHistory() async {
    return const [
      EarningsEntry(
        id: 'earn-1',
        jobTitle: 'Hair Spa at home',
        completedAt: 'Today, 11:30 AM',
        serviceAmount: 1299,
        tip: 100,
        total: 1399,
      ),
      EarningsEntry(
        id: 'earn-2',
        jobTitle: 'Quick Commerce delivery',
        completedAt: 'Today, 9:15 AM',
        serviceAmount: 849,
        tip: 0,
        total: 849,
      ),
    ];
  }

  @override
  Future<List<Map<String, dynamic>>> fetchNotifications({int limit = 20}) async => [];

  @override
  Future<void> markNotificationsRead(List<String> notificationIds) async {}

  @override
  Future<MockActionResult> cancelJob(
    String jobId, {
    required String reasonCode,
    String? note,
  }) async =>
      const MockActionResult(mocked: true, message: 'PP-010 cancel not wired in mock');

  @override
  Future<MockActionResult> reportNoShow(String jobId, {String? note}) async =>
      const MockActionResult(mocked: true, message: 'PP-010 no-show not wired in mock');

  @override
  Future<Map<String, dynamic>> fetchNoShowEligibility(String jobId) async =>
      {'eligible': false, 'remaining_seconds': 900};

  @override
  Future<Map<String, dynamic>> createSupportTicket({
    required String category,
    required String message,
    String? jobId,
  }) async =>
      {'ticket_number': 'MOCK-001', 'status': 'OPEN'};

  @override
  Future<Uint8List?> fetchProfilePhotoBytes() async => null;
}
