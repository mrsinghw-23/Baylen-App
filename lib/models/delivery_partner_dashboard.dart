class DeliveryPartnerDashboard {
  const DeliveryPartnerDashboard({
    required this.partner,
    required this.stats,
    required this.canGoOffline,
    required this.kycRequired,
    this.activeJob,
  });

  final DeliveryPartnerDashboardPartner partner;
  final DeliveryPartnerDashboardStats stats;
  final DeliveryPartnerDashboardJob? activeJob;
  final bool canGoOffline;
  final bool kycRequired;

  factory DeliveryPartnerDashboard.fromJson(Map<String, dynamic> json) {
    final partner = json['partner'];
    final stats = json['stats'];
    final activeJob = json['active_job'];
    return DeliveryPartnerDashboard(
      partner: partner is Map<String, dynamic>
          ? DeliveryPartnerDashboardPartner.fromJson(partner)
          : const DeliveryPartnerDashboardPartner(),
      stats: stats is Map<String, dynamic>
          ? DeliveryPartnerDashboardStats.fromJson(stats)
          : const DeliveryPartnerDashboardStats(),
      activeJob: activeJob is Map<String, dynamic>
          ? DeliveryPartnerDashboardJob.fromJson(activeJob)
          : null,
      canGoOffline: json['can_go_offline'] == true,
      kycRequired: json['kyc_required'] == true,
    );
  }
}

class DeliveryPartnerDashboardPartner {
  const DeliveryPartnerDashboardPartner({
    this.deliveryPartnerId = '',
    this.firstName = '',
    this.lastName = '',
    this.status = '',
    this.onlineStatus = 'OFFLINE',
    this.effectiveOnlineStatus = 'OFFLINE',
    this.outletId = '',
    this.age,
    this.qualification = '',
    this.serviceZone = '',
    this.availabilitySchedule = '',
    this.rating,
    this.operational = false,
    this.profilePhotoUrl = '',
    this.profilePhotoFetchUrl = '',
    this.state = '',
    this.district = '',
    this.pincode = '',
    this.city = '',
    this.phone = '',
    this.email = '',
    this.country = 'India',
    this.kycApprovedAt = '',
    this.availabilityUpdatedAt = '',
    this.hasProfilePhoto = false,
  });

  final String deliveryPartnerId;
  final String firstName;
  final String lastName;
  final String status;
  final String onlineStatus;
  final String effectiveOnlineStatus;
  final String outletId;
  final int? age;
  final String qualification;
  final String serviceZone;
  final String availabilitySchedule;
  final double? rating;
  final bool operational;
  final String profilePhotoUrl;
  final String profilePhotoFetchUrl;
  final String state;
  final String district;
  final String pincode;
  final String city;
  final String phone;
  final String email;
  final String country;
  final String kycApprovedAt;
  final String availabilityUpdatedAt;
  final bool hasProfilePhoto;

  String get displayName {
    final name = '${firstName.trim()} ${lastName.trim()}'.trim();
    return name.isEmpty ? 'Professional' : name;
  }

  bool get isOnline =>
      effectiveOnlineStatus == 'ONLINE_AVAILABLE' ||
      effectiveOnlineStatus == 'ONLINE_BUSY';

  bool get isBusy => effectiveOnlineStatus == 'ONLINE_BUSY';

  factory DeliveryPartnerDashboardPartner.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerDashboardPartner(
      deliveryPartnerId: json['delivery_partner_id']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      onlineStatus: json['online_status']?.toString() ?? 'OFFLINE',
      effectiveOnlineStatus:
          json['effective_online_status']?.toString() ??
          json['online_status']?.toString() ??
          'OFFLINE',
      outletId: json['outlet_id']?.toString() ?? '',
      age: (json['age'] as num?)?.toInt(),
      qualification: json['qualification']?.toString() ?? '',
      serviceZone: json['service_zone']?.toString() ?? '',
      availabilitySchedule: json['availability_schedule']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble(),
      operational: json['operational'] == true,
      profilePhotoUrl: json['profile_photo_url']?.toString() ?? '',
      profilePhotoFetchUrl: json['profile_photo_fetch_url']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      pincode: json['pincode']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      country: json['country']?.toString() ?? 'India',
      kycApprovedAt: json['kyc_approved_at']?.toString() ?? '',
      availabilityUpdatedAt: json['availability_updated_at']?.toString() ?? '',
      hasProfilePhoto: json['has_profile_photo'] == true ||
          (json['profile_photo_url']?.toString() ?? '').startsWith('http') ||
          (json['profile_photo_url']?.toString() ?? '').startsWith('filestore:') ||
          (json['profile_photo_fetch_url']?.toString() ?? '').isNotEmpty,
    );
  }
}

class DeliveryPartnerDashboardStats {
  const DeliveryPartnerDashboardStats({
    this.jobsToday = 0,
    this.completedToday = 0,
    this.earningsToday = 0,
    this.earningsWeek = 0,
    this.unreadNotifications = 0,
    this.deliveryOffersCount = 0,
    this.homeServiceOffersCount = 0,
    this.pendingEarnings = 0,
    this.availableEarnings = 0,
    this.deliveryActiveCount = 0,
    this.deliveryCompletedCount = 0,
    this.homeServiceActiveCount = 0,
    this.homeServiceCompletedCount = 0,
  });

  final int jobsToday;
  final int completedToday;
  final double earningsToday;
  final double earningsWeek;
  final int unreadNotifications;
  final int deliveryOffersCount;
  final int homeServiceOffersCount;
  final double pendingEarnings;
  final double availableEarnings;
  final int deliveryActiveCount;
  final int deliveryCompletedCount;
  final int homeServiceActiveCount;
  final int homeServiceCompletedCount;

  factory DeliveryPartnerDashboardStats.fromJson(Map<String, dynamic> json) {
    final professional = json['professional_jobs'];
    final deliveryFromNested = professional is Map<String, dynamic>
        ? (professional['delivery_offered'] as num?)?.toInt()
        : null;
    final homeFromNested = professional is Map<String, dynamic>
        ? (professional['home_service_offered'] as num?)?.toInt()
        : null;
    return DeliveryPartnerDashboardStats(
      jobsToday: (json['jobs_today'] as num?)?.toInt() ?? 0,
      completedToday: (json['completed_today'] as num?)?.toInt() ?? 0,
      earningsToday: (json['earnings_today'] as num?)?.toDouble() ?? 0,
      earningsWeek: (json['earnings_week'] as num?)?.toDouble() ?? 0,
      unreadNotifications: (json['unread_notifications'] as num?)?.toInt() ?? 0,
      deliveryOffersCount:
          (json['delivery_offers_count'] as num?)?.toInt() ?? deliveryFromNested ?? 0,
      homeServiceOffersCount:
          (json['home_service_offers_count'] as num?)?.toInt() ?? homeFromNested ?? 0,
      pendingEarnings: (json['pending_earnings'] as num?)?.toDouble() ?? 0,
      availableEarnings: (json['available_earnings'] as num?)?.toDouble() ?? 0,
      deliveryActiveCount: (json['delivery_active_count'] as num?)?.toInt() ?? 0,
      deliveryCompletedCount: (json['delivery_completed_count'] as num?)?.toInt() ?? 0,
      homeServiceActiveCount: (json['home_service_active_count'] as num?)?.toInt() ?? 0,
      homeServiceCompletedCount: (json['home_service_completed_count'] as num?)?.toInt() ?? 0,
    );
  }
}

class DeliveryPartnerDashboardJob {
  const DeliveryPartnerDashboardJob({
    required this.id,
    required this.bookingNumber,
    required this.status,
    required this.serviceName,
    required this.visitLine1,
    required this.visitCity,
    required this.scheduledAt,
    required this.grandTotal,
    this.currency = 'INR',
  });

  final String id;
  final String bookingNumber;
  final String status;
  final String serviceName;
  final String visitLine1;
  final String visitCity;
  final String scheduledAt;
  final double grandTotal;
  final String currency;

  factory DeliveryPartnerDashboardJob.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerDashboardJob(
      id: json['id']?.toString() ?? '',
      bookingNumber: json['booking_number']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      serviceName: json['service_name']?.toString() ?? '',
      visitLine1: json['visit_line1']?.toString() ?? '',
      visitCity: json['visit_city']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }
}
