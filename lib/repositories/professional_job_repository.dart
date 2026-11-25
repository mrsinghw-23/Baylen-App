import 'dart:typed_data';

import '../models/professional_job.dart';

/// Repository abstraction for Professional Partner job flows.
/// Screens depend only on this interface — swap mock/real per PP ticket.
abstract class ProfessionalJobRepository {
  Future<ProfessionalDashboardData> fetchDashboard();

  Future<void> setOnlineStatus({required bool online});

  Future<List<ProfessionalJobOffer>> fetchOfferedJobs({
    required ProfessionalJobType type,
  });

  Future<List<ProfessionalJobSummary>> fetchActiveJobs({
    required ProfessionalJobType type,
  });

  Future<List<ProfessionalJobSummary>> fetchCompletedJobs({
    required ProfessionalJobType type,
  });

  Future<List<ProfessionalJobSummary>> fetchCancelledJobs({
    required ProfessionalJobType type,
  });

  Future<ProfessionalJobDetail> fetchJobDetail(String jobId);

  /// Real PP-004 accept/reject; later PP-005+ actions remain mocked.
  Future<MockActionResult> acceptJob(String jobId);

  Future<MockActionResult> rejectJob(String jobId, {required String reason});

  /// PP-005 home travel / PP-008 product pickup start.
  Future<MockActionResult> startTravel(String jobId);

  Future<MockActionResult> startPickup(String jobId);

  Future<MockActionResult> confirmPickupArrival(String jobId);

  Future<MockActionResult> verifyPickupOtp(String jobId, String otp);

  Future<MockActionResult> confirmPickedUp(String jobId);

  Future<MockActionResult> startDelivery(String jobId);

  Future<MockActionResult> confirmDeliveryArrival(String jobId);

  Future<MockActionResult> verifyDeliveryOtp(String jobId, String otp);

  Future<MockActionResult> confirmDelivered(String jobId);

  Future<LivePosition> fetchLivePosition(String jobId);

  Future<ArrivalPreview> fetchArrivalPreview(String jobId);

  Future<MockActionResult> confirmArrival(String jobId);

  Future<MockActionResult> verifyArrivalOtp(String jobId, String otp);

  Future<MockActionResult> resendArrivalOtp(String jobId);

  /// PP-007 service execution actions.
  Future<MockActionResult> startService(String jobId);

  Future<MockActionResult> updateChecklistItem(
    String jobId,
    String itemId,
    bool done,
  );

  Future<CompletionResult> completeJob(String jobId);

  Future<List<EarningsEntry>> fetchEarningsHistory();

  Future<ProfessionalEarningsSummary> fetchEarningsSummary();

  Future<List<Map<String, dynamic>>> fetchNotifications({int limit = 20});

  Future<void> markNotificationsRead(List<String> notificationIds);

  Future<MockActionResult> cancelJob(
    String jobId, {
    required String reasonCode,
    String? note,
  });

  Future<MockActionResult> reportNoShow(String jobId, {String? note});

  Future<Map<String, dynamic>> fetchNoShowEligibility(String jobId);

  Future<Map<String, dynamic>> createSupportTicket({
    required String category,
    required String message,
    String? jobId,
  });

  Future<Uint8List?> fetchProfilePhotoBytes();
}
