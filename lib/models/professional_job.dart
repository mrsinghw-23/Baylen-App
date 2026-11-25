enum ProfessionalJobType { productDelivery, homeService }

enum ProfessionalJobPhase {
  offered,
  accepted,
  pickup,
  enRoute,
  arrived,
  otpVerified,
  inProgress,
  completed,
}

class ProfessionalDashboardData {
  const ProfessionalDashboardData({
    required this.greetingName,
    required this.isOnline,
    required this.isBusy,
    required this.canGoOffline,
    required this.deliveryOffersCount,
    required this.homeServiceOffersCount,
    required this.earningsToday,
    required this.completedToday,
    required this.rating,
    required this.upcomingJobs,
    this.profilePhotoUrl = '',
    this.profilePhotoFetchUrl = '',
    this.kycRequired = false,
    this.activeJobId,
    this.employeeId = '',
    this.verificationStatus = '',
    this.unreadNotifications = 0,
    this.activeHomeServices = 0,
    this.completedHomeServices = 0,
    this.completedOrders = 0,
    this.activeOrders = 0,
    this.earningsTotal = 0,
    this.state = '',
    this.district = '',
    this.pincode = '',
    this.city = '',
    this.phone = '',
    this.email = '',
    this.qualification = '',
    this.serviceZone = '',
    this.availabilitySchedule = '',
    this.availabilityScheduleConfigured = false,
    this.firstName = '',
    this.lastName = '',
    this.hasProfilePhoto = false,
  });

  final String greetingName;
  final String profilePhotoUrl;
  final String profilePhotoFetchUrl;
  final bool isOnline;
  final bool isBusy;
  final bool canGoOffline;
  final int deliveryOffersCount;
  final int homeServiceOffersCount;
  final double earningsToday;
  final int completedToday;
  final double rating;
  final List<ProfessionalJobSummary> upcomingJobs;
  final bool kycRequired;
  final String? activeJobId;
  final String employeeId;
  final String verificationStatus;
  final int unreadNotifications;
  final int activeHomeServices;
  final int completedHomeServices;
  final int completedOrders;
  final int activeOrders;
  final double earningsTotal;
  final String state;
  final String district;
  final String pincode;
  final String city;
  final String phone;
  final String email;
  final String qualification;
  final String serviceZone;
  final String availabilitySchedule;
  final bool availabilityScheduleConfigured;
  final String firstName;
  final String lastName;
  final bool hasProfilePhoto;

  String get displayName {
    final name = '${firstName.trim()} ${lastName.trim()}'.trim();
    return name.isNotEmpty ? name : greetingName;
  }

  String get serviceZoneLabel {
    if (serviceZone.trim().isNotEmpty) return serviceZone.trim();
    final parts = [
      if (district.trim().isNotEmpty) district.trim(),
      if (state.trim().isNotEmpty) state.trim(),
    ];
    return parts.join(', ');
  }
}

class ProfessionalJobSummary {
  const ProfessionalJobSummary({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.amount,
    required this.distanceKm,
    required this.etaMinutes,
    required this.phase,
    this.scheduledAt = '',
  });

  final String id;
  final ProfessionalJobType type;
  final String title;
  final String subtitle;
  final double amount;
  final double distanceKm;
  final int etaMinutes;
  final ProfessionalJobPhase phase;
  final String scheduledAt;
}

class ProfessionalJobOffer extends ProfessionalJobSummary {
  const ProfessionalJobOffer({
    required super.id,
    required super.type,
    required super.title,
    required super.subtitle,
    required super.amount,
    required super.distanceKm,
    required super.etaMinutes,
    super.scheduledAt = '',
    this.customerName = '',
    this.customerPhotoUrl = '',
  }) : super(phase: ProfessionalJobPhase.offered);

  final String customerName;
  final String customerPhotoUrl;
}

class ProfessionalJobDetail {
  const ProfessionalJobDetail({
    required this.id,
    required this.type,
    required this.title,
    required this.referenceLabel,
    required this.amount,
    required this.customerName,
    required this.customerPhone,
    required this.pickupTitle,
    required this.pickupAddress,
    required this.dropTitle,
    required this.dropAddress,
    required this.notes,
    required this.items,
    required this.checklist,
    required this.phase,
    this.distanceKm = 0,
    this.etaMinutes = 0,
    this.progressPercent = 0,
    this.canAccept = false,
    this.canReject = false,
    this.offerExpired = false,
    this.serviceStartedAt = '',
    this.durationMinutes = 0,
    this.canStartService = false,
    this.canCompleteService = false,
    this.canStartPickup = false,
    this.canConfirmPickupArrival = false,
    this.canVerifyPickup = false,
    this.canConfirmPickedUp = false,
    this.canStartDelivery = false,
    this.canConfirmDeliveryArrival = false,
    this.canVerifyDeliveryOtp = false,
    this.canConfirmDelivered = false,
    this.canCompleteDelivery = false,
    this.destinationLatitude,
    this.destinationLongitude,
  });

  final String id;
  final ProfessionalJobType type;
  final String title;
  final String referenceLabel;
  final double amount;
  final String customerName;
  final String customerPhone;
  final String pickupTitle;
  final String pickupAddress;
  final String dropTitle;
  final String dropAddress;
  final String notes;
  final List<ProfessionalJobItem> items;
  final List<ProfessionalChecklistItem> checklist;
  final ProfessionalJobPhase phase;
  final double distanceKm;
  final int etaMinutes;
  final int progressPercent;
  final bool canAccept;
  final bool canReject;
  final bool offerExpired;
  final String serviceStartedAt;
  final int durationMinutes;
  final bool canStartService;
  final bool canCompleteService;
  final bool canStartPickup;
  final bool canConfirmPickupArrival;
  final bool canVerifyPickup;
  final bool canConfirmPickedUp;
  final bool canStartDelivery;
  final bool canConfirmDeliveryArrival;
  final bool canVerifyDeliveryOtp;
  final bool canConfirmDelivered;
  final bool canCompleteDelivery;
  final double? destinationLatitude;
  final double? destinationLongitude;
}

class ProfessionalJobItem {
  const ProfessionalJobItem({required this.name, required this.quantity});

  final String name;
  final int quantity;
}

class ProfessionalChecklistItem {
  const ProfessionalChecklistItem({
    required this.id,
    required this.label,
    required this.done,
    this.completedAt,
  });

  final String id;
  final String label;
  final bool done;
  final String? completedAt;

  ProfessionalChecklistItem copyWith({bool? done, String? completedAt}) {
    return ProfessionalChecklistItem(
      id: id,
      label: label,
      done: done ?? this.done,
      completedAt: completedAt ?? this.completedAt,
    );
  }
}

class LivePosition {
  const LivePosition({
    required this.latitude,
    required this.longitude,
    required this.distanceKm,
    required this.etaMinutes,
    required this.routingSource,
    this.locationStatus = 'LIVE',
    this.capturedAt,
    this.ageSeconds,
  });

  final double latitude;
  final double longitude;
  final double distanceKm;
  final int etaMinutes;
  final String routingSource;
  final String locationStatus;
  final String? capturedAt;
  final int? ageSeconds;

  bool get isLive => locationStatus == 'LIVE';
  bool get isStale => locationStatus == 'STALE';
}

class ArrivalPreview {
  const ArrivalPreview({
    required this.distanceMeters,
    required this.arrivalRadiusMeters,
    required this.eligible,
    required this.jobStatus,
    this.locationStatus = 'LIVE',
    this.dropAddress = '',
  });

  final double distanceMeters;
  final double arrivalRadiusMeters;
  final bool eligible;
  final String jobStatus;
  final String locationStatus;
  final String dropAddress;
}

class CompletionResult {
  const CompletionResult({
    required this.serviceAmount,
    required this.tip,
    required this.total,
    required this.currency,
    this.reviewHint = '',
    this.paymentStatus = '',
    this.mocked = false,
  });

  final double serviceAmount;
  final double tip;
  final double total;
  final String currency;
  final String reviewHint;
  final String paymentStatus;
  final bool mocked;
}

class EarningsEntry {
  const EarningsEntry({
    required this.id,
    required this.jobTitle,
    required this.completedAt,
    required this.serviceAmount,
    required this.tip,
    required this.total,
    this.jobType = '',
    this.status = '',
  });

  final String id;
  final String jobTitle;
  final String completedAt;
  final double serviceAmount;
  final double tip;
  final double total;
  final String jobType;
  final String status;
}

class ProfessionalEarningsSummary {
  const ProfessionalEarningsSummary({
    this.totalEarnings = 0,
    this.earningsToday = 0,
    this.earningsWeek = 0,
    this.pendingEarnings = 0,
    this.availableEarnings = 0,
    this.completedJobs = 0,
    this.deliveryEarnings = 0,
    this.homeServiceEarnings = 0,
    this.commissionTotal = 0,
    this.deductionsTotal = 0,
    this.netEarnings = 0,
  });

  final double totalEarnings;
  final double earningsToday;
  final double earningsWeek;
  final double pendingEarnings;
  final double availableEarnings;
  final int completedJobs;
  final double deliveryEarnings;
  final double homeServiceEarnings;
  final double commissionTotal;
  final double deductionsTotal;
  final double netEarnings;
}

class MockActionResult {
  const MockActionResult({
    required this.mocked,
    this.message = '',
    this.success = true,
    this.code = '',
  });

  final bool mocked;
  final bool success;
  final String message;
  final String code;
}
