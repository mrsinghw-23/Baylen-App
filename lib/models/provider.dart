class ProviderProfile {
  const ProviderProfile({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.rating,
    required this.status,
    required this.isActive,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String phone;
  final double rating;
  final String status;
  final bool isActive;

  String get fullName =>
      [firstName, lastName].where((s) => s.isNotEmpty).join(' ');

  factory ProviderProfile.fromJson(Map<String, dynamic> json) {
    return ProviderProfile(
      id: json['id']?.toString() ?? json['ROWID']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toDouble() ?? 0,
      status: json['status']?.toString() ?? 'AVAILABLE',
      isActive:
          json['is_active'] == true || json['is_active']?.toString() == 'true',
    );
  }
}

class ProviderJob {
  const ProviderJob({
    required this.id,
    required this.appointmentId,
    required this.providerId,
    required this.status,
    required this.visitAddressId,
    required this.visitLine1,
    required this.visitCity,
    required this.visitState,
    required this.scheduledAt,
    required this.requestedAt,
    required this.grandTotal,
    required this.currency,
  });

  final String id;
  final String appointmentId;
  final String providerId;
  final String status;
  final String visitAddressId;
  final String visitLine1;
  final String visitCity;
  final String visitState;
  final String scheduledAt;
  final String requestedAt;
  final double grandTotal;
  final String currency;

  String get amountLabel {
    final price = grandTotal.toStringAsFixed(0);
    return currency == 'INR' ? 'INR $price' : '$currency $price';
  }

  String get fullAddress =>
      [visitLine1, visitCity, visitState].where((s) => s.isNotEmpty).join(', ');

  bool get isActive => [
    'ASSIGNED',
    'ACCEPTED',
    'EN_ROUTE',
    'ARRIVED',
    'STARTED',
  ].contains(status);
  bool get isCompleted => status == 'COMPLETED';
  bool get isCancelled => status == 'CANCELLED';

  factory ProviderJob.fromJson(Map<String, dynamic> json) {
    return ProviderJob(
      id: json['id']?.toString() ?? json['ROWID']?.toString() ?? '',
      appointmentId: json['appointment_id']?.toString() ?? '',
      providerId: json['provider_id']?.toString() ?? '',
      status: json['status']?.toString() ?? 'REQUESTED',
      visitAddressId: json['visit_address_id']?.toString() ?? '',
      visitLine1: json['visit_line1']?.toString() ?? '',
      visitCity: json['visit_city']?.toString() ?? '',
      visitState: json['visit_state']?.toString() ?? '',
      scheduledAt: json['scheduled_at']?.toString() ?? '',
      requestedAt: json['requested_at']?.toString() ?? '',
      grandTotal: (json['grand_total'] as num?)?.toDouble() ?? 0,
      currency: json['currency']?.toString() ?? 'INR',
    );
  }
}

class ProviderDispatchOffer {
  const ProviderDispatchOffer({
    required this.dispatchId,
    required this.jobId,
    required this.providerId,
    required this.providerName,
    required this.status,
  });

  final String dispatchId;
  final String jobId;
  final String providerId;
  final String providerName;
  final String status;

  factory ProviderDispatchOffer.fromJson(Map<String, dynamic> json) {
    return ProviderDispatchOffer(
      dispatchId:
          json['dispatch_id']?.toString() ?? json['ROWID']?.toString() ?? '',
      jobId: json['job_id']?.toString() ?? '',
      providerId: json['provider_id']?.toString() ?? '',
      providerName: json['provider_name']?.toString() ?? '',
      status: json['status']?.toString() ?? 'OFFERED',
    );
  }
}

class JobProofRecord {
  const JobProofRecord({
    required this.id,
    required this.jobId,
    required this.providerId,
    required this.fileUrl,
    required this.proofType,
    required this.notes,
  });

  final String id;
  final String jobId;
  final String providerId;
  final String fileUrl;
  final String proofType;
  final String notes;

  factory JobProofRecord.fromJson(Map<String, dynamic> json) {
    return JobProofRecord(
      id:
          json['id']?.toString() ??
          json['proof_id']?.toString() ??
          json['ROWID']?.toString() ??
          '',
      jobId: json['job_id']?.toString() ?? '',
      providerId: json['provider_id']?.toString() ?? '',
      fileUrl: json['file_url']?.toString() ?? '',
      proofType: json['proof_type']?.toString() ?? 'PHOTO',
      notes: json['notes']?.toString() ?? '',
    );
  }
}
