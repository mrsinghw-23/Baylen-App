class DeliveryPartnerSession {
  const DeliveryPartnerSession({
    required this.deliveryPartnerId,
    required this.phone,
    required this.status,
    this.outletId = '',
    this.firstName = '',
    this.lastName = '',
    this.registrationPhase = 'otp_verified',
    this.registrationComplete = false,
  });

  final String deliveryPartnerId;
  final String phone;
  final String status;
  final String outletId;
  final String firstName;
  final String lastName;
  final String registrationPhase;
  final bool registrationComplete;

  bool get isActive => status == 'active';
  bool get needsKyc => !isActive;
  bool get needsRegistration => !registrationComplete;

  factory DeliveryPartnerSession.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerSession(
      deliveryPartnerId: json['delivery_partner_id']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      status: json['status']?.toString() ?? 'pending_kyc',
      outletId: json['outlet_id']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      registrationPhase: json['registration_phase']?.toString() ?? 'otp_verified',
      registrationComplete: json['registration_complete'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'delivery_partner_id': deliveryPartnerId,
    'phone': phone,
    'status': status,
    'outlet_id': outletId,
    'first_name': firstName,
    'last_name': lastName,
    'registration_phase': registrationPhase,
    'registration_complete': registrationComplete,
  };
}

class DeliveryPartnerLead {
  const DeliveryPartnerLead({
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

  factory DeliveryPartnerLead.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerLead(
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
