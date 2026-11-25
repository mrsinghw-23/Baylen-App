class DeliveryPartnerKyc {
  const DeliveryPartnerKyc({
    required this.partnerStatus,
    required this.partnerStatusLabel,
    required this.editable,
    required this.canSubmit,
    this.readyToSubmit = false,
    required this.operational,
    this.kycId = '',
    this.firstName = '',
    this.lastName = '',
    this.dateOfBirth = '',
    this.age,
    this.qualification = '',
    this.addressLine1 = '',
    this.addressLine2 = '',
    this.city = '',
    this.state = '',
    this.postalCode = '',
    this.country = 'India',
    this.ifsc = '',
    this.accountHolderName = '',
    this.panMasked = '',
    this.aadhaarMasked = '',
    this.bankAccountMasked = '',
    this.rejectionReason = '',
    this.submittedAt = '',
    this.reviewedAt = '',
    this.documents = const DeliveryPartnerKycDocuments.empty(),
  });

  final String kycId;
  final String partnerStatus;
  final String partnerStatusLabel;
  final bool editable;
  final bool canSubmit;
  final bool readyToSubmit;
  final bool operational;
  final String firstName;
  final String lastName;
  final String dateOfBirth;
  final int? age;
  final String qualification;
  final String addressLine1;
  final String addressLine2;
  final String city;
  final String state;
  final String postalCode;
  final String country;
  final String ifsc;
  final String accountHolderName;
  final String panMasked;
  final String aadhaarMasked;
  final String bankAccountMasked;
  final String rejectionReason;
  final String submittedAt;
  final String reviewedAt;
  final DeliveryPartnerKycDocuments documents;

  bool get needsKyc =>
      !operational &&
      partnerStatus != 'kyc_submitted' &&
      partnerStatus != 'kyc_under_review';

  bool get isRejected => partnerStatus == 'kyc_rejected';

  bool get isSubmitted =>
      partnerStatus == 'kyc_submitted' || partnerStatus == 'kyc_under_review';

  bool get isApproved =>
      partnerStatus == 'active' || partnerStatus == 'kyc_approved';

  factory DeliveryPartnerKyc.fromJson(Map<String, dynamic> json) {
    final docs = json['documents'];
    return DeliveryPartnerKyc(
      kycId: json['kyc_id']?.toString() ?? '',
      partnerStatus: json['partner_status']?.toString() ?? 'pending_kyc',
      partnerStatusLabel: json['partner_status_label']?.toString() ?? 'Draft',
      editable: json['editable'] == true,
      canSubmit: json['can_submit'] == true,
      readyToSubmit: json['ready_to_submit'] == true,
      operational: json['operational'] == true,
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      dateOfBirth: json['date_of_birth']?.toString() ?? '',
      age: (json['age'] as num?)?.toInt(),
      qualification: json['qualification']?.toString() ?? '',
      addressLine1: json['address_line1']?.toString() ?? '',
      addressLine2: json['address_line2']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      postalCode: json['postal_code']?.toString() ?? '',
      country: json['country']?.toString() ?? 'India',
      ifsc: json['ifsc']?.toString() ?? '',
      accountHolderName: json['account_holder_name']?.toString() ?? '',
      panMasked: json['pan_masked']?.toString() ?? '',
      aadhaarMasked: json['aadhaar_masked']?.toString() ?? '',
      bankAccountMasked: json['bank_account_masked']?.toString() ?? '',
      rejectionReason: json['rejection_reason']?.toString() ?? '',
      submittedAt: json['submitted_at']?.toString() ?? '',
      reviewedAt: json['reviewed_at']?.toString() ?? '',
      documents: docs is Map<String, dynamic>
          ? DeliveryPartnerKycDocuments.fromJson(docs)
          : const DeliveryPartnerKycDocuments.empty(),
    );
  }

  Map<String, dynamic> toPayload({
    String? panNumber,
    String? aadhaarNumber,
    String? bankAccountNumber,
  }) {
    return {
      if (firstName.isNotEmpty) 'first_name': firstName,
      if (lastName.isNotEmpty) 'last_name': lastName,
      if (dateOfBirth.isNotEmpty) 'date_of_birth': dateOfBirth,
      if (age != null) 'age': age,
      if (qualification.isNotEmpty) 'qualification': qualification,
      if (panNumber != null && panNumber.isNotEmpty) 'pan_number': panNumber,
      if (aadhaarNumber != null && aadhaarNumber.isNotEmpty)
        'aadhaar_number': aadhaarNumber,
      if (addressLine1.isNotEmpty) 'address_line1': addressLine1,
      if (addressLine2.isNotEmpty) 'address_line2': addressLine2,
      if (city.isNotEmpty) 'city': city,
      if (state.isNotEmpty) 'state': state,
      if (postalCode.isNotEmpty) 'postal_code': postalCode,
      if (country.isNotEmpty) 'country': country,
      if (bankAccountNumber != null && bankAccountNumber.isNotEmpty)
        'bank_account_number': bankAccountNumber,
      if (ifsc.isNotEmpty) 'ifsc': ifsc,
      if (accountHolderName.isNotEmpty) 'account_holder_name': accountHolderName,
    };
  }
}

class DeliveryPartnerKycDocuments {
  const DeliveryPartnerKycDocuments({
    required this.profilePhoto,
    required this.aadhaarFront,
    required this.aadhaarBack,
    required this.identityDocument,
    required this.addressDocument,
  });

  final DeliveryPartnerKycDocument profilePhoto;
  final DeliveryPartnerKycDocument aadhaarFront;
  final DeliveryPartnerKycDocument aadhaarBack;
  final DeliveryPartnerKycDocument identityDocument;
  final DeliveryPartnerKycDocument addressDocument;

  const DeliveryPartnerKycDocuments.empty()
    : profilePhoto = const DeliveryPartnerKycDocument(),
      aadhaarFront = const DeliveryPartnerKycDocument(),
      aadhaarBack = const DeliveryPartnerKycDocument(),
      identityDocument = const DeliveryPartnerKycDocument(),
      addressDocument = const DeliveryPartnerKycDocument();

  bool get allUploaded =>
      profilePhoto.uploaded && aadhaarFront.uploaded && aadhaarBack.uploaded;

  factory DeliveryPartnerKycDocuments.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> readDoc(String primary, String fallback) {
      final raw = json[primary] ?? json[fallback];
      if (raw is Map<String, dynamic>) return raw;
      if (raw is Map) return Map<String, dynamic>.from(raw);
      return const {};
    }

    final frontJson = readDoc('aadhaar_front', 'identity_document');
    final backJson = readDoc('aadhaar_back', 'address_document');
    return DeliveryPartnerKycDocuments(
      profilePhoto: DeliveryPartnerKycDocument.fromJson(
        json['profile_photo'] is Map<String, dynamic>
            ? json['profile_photo'] as Map<String, dynamic>
            : const {},
      ),
      aadhaarFront: DeliveryPartnerKycDocument.fromJson(frontJson),
      aadhaarBack: DeliveryPartnerKycDocument.fromJson(backJson),
      identityDocument: DeliveryPartnerKycDocument.fromJson(frontJson),
      addressDocument: DeliveryPartnerKycDocument.fromJson(backJson),
    );
  }
}

class DeliveryPartnerKycDocument {
  const DeliveryPartnerKycDocument({this.uploaded = false});

  final bool uploaded;

  factory DeliveryPartnerKycDocument.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerKycDocument(uploaded: json['uploaded'] == true);
  }
}
