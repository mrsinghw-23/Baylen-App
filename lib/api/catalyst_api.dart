import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../auth/guest_session.dart';
import '../auth/auth_user.dart';
import '../config/app_config.dart';
import '../models/account.dart';
import '../models/account_bootstrap.dart';
import '../models/cart.dart';
import '../models/catalog.dart';
import '../models/fulfillment.dart';
import '../models/launch_content.dart';
import '../models/notification_item.dart';
import '../models/order.dart';
import '../models/order_tracking.dart';
import '../models/review.dart';
import '../models/salon.dart';
import '../models/service_job.dart';
import '../models/at_home_beauty.dart';
import '../models/my_booking.dart';
import '../models/delivery_partner_session.dart';
import '../models/delivery_partner_kyc.dart';
import '../models/delivery_partner_dashboard.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;

  bool get isUnauthorized =>
      statusCode == 401 ||
      message.toLowerCase().contains('sign in required') ||
      message.toLowerCase().contains('not signed in');

  bool get isForbiddenRole => code == 'FORBIDDEN_ROLE';

  @override
  String toString() => message;
}

class DeliveryPartnerOtpRequestResult {
  const DeliveryPartnerOtpRequestResult({
    required this.challengeId,
    required this.phone,
    required this.expiresInSeconds,
    required this.resendAfterSeconds,
    this.sentVia = '',
    this.debugOtp,
  });

  final String challengeId;
  final String phone;
  final int expiresInSeconds;
  final int resendAfterSeconds;
  final String sentVia;
  final String? debugOtp;

  bool get deliveredViaWhatsapp => sentVia.toUpperCase() == 'WHATSAPP';

  factory DeliveryPartnerOtpRequestResult.fromJson(Map<String, dynamic> json) {
    return DeliveryPartnerOtpRequestResult(
      challengeId: json['challenge_id']?.toString() ?? '',
      phone: json['phone']?.toString() ?? '',
      expiresInSeconds:
          (json['expires_in'] as num?)?.toInt() ??
          (json['expires_in_seconds'] as num?)?.toInt() ??
          300,
      resendAfterSeconds: (json['resend_after_seconds'] as num?)?.toInt() ?? 45,
      sentVia: json['sent_via']?.toString() ?? '',
      debugOtp: json['debug_otp']?.toString(),
    );
  }
}

class DeliveryPartnerOtpVerifyResult {
  const DeliveryPartnerOtpVerifyResult({
    this.token = '',
    this.session,
    this.requiresPasswordLogin = false,
    this.phone = '',
    this.message = '',
    this.registrationPhase = 'otp_verified',
  });

  final String token;
  final DeliveryPartnerSession? session;
  final bool requiresPasswordLogin;
  final String phone;
  final String message;
  final String registrationPhase;

  factory DeliveryPartnerOtpVerifyResult.fromJson(Map<String, dynamic> json) {
    final requiresPasswordLogin = json['requires_password_login'] == true;
    return DeliveryPartnerOtpVerifyResult(
      token: json['token']?.toString() ?? '',
      session: requiresPasswordLogin
          ? null
          : DeliveryPartnerSession.fromJson(json),
      requiresPasswordLogin: requiresPasswordLogin,
      phone: json['phone']?.toString() ?? '',
      message: json['message']?.toString() ?? '',
      registrationPhase:
          json['registration_phase']?.toString() ?? 'otp_verified',
    );
  }
}

class EmployeeRegistrationStatus {
  const EmployeeRegistrationStatus({
    required this.registrationPhase,
    required this.registrationComplete,
    required this.phone,
    this.firstName = '',
    this.lastName = '',
    this.email = '',
    this.outletName = '',
    this.warehouseName = '',
    this.selfieUploaded = false,
    this.passportPhotoUploaded = false,
    this.passwordSet = false,
    this.state = '',
    this.district = '',
    this.pincode = '',
    this.qualification = '',
    this.serviceZone = '',
    this.city = '',
  });

  final String registrationPhase;
  final bool registrationComplete;
  final String phone;
  final String firstName;
  final String lastName;
  final String email;
  final String outletName;
  final String warehouseName;
  final bool selfieUploaded;
  final bool passportPhotoUploaded;
  final bool passwordSet;
  final String state;
  final String district;
  final String pincode;
  final String qualification;
  final String serviceZone;
  final String city;

  factory EmployeeRegistrationStatus.fromJson(Map<String, dynamic> json) {
    final photos = json['photos'];
    return EmployeeRegistrationStatus(
      registrationPhase:
          json['registration_phase']?.toString() ?? 'otp_verified',
      registrationComplete: json['registration_complete'] == true,
      phone: json['phone']?.toString() ?? '',
      firstName: json['first_name']?.toString() ?? '',
      lastName: json['last_name']?.toString() ?? '',
      email: json['email']?.toString() ?? '',
      outletName: json['outlet_name']?.toString() ?? '',
      warehouseName: json['warehouse_name']?.toString() ?? '',
      selfieUploaded: photos is Map && photos['selfie'] == true,
      passportPhotoUploaded: photos is Map && photos['passport_photo'] == true,
      passwordSet: json['password_set'] == true,
      state: json['state']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      pincode: json['pincode']?.toString() ?? '',
      qualification: json['qualification']?.toString() ?? '',
      serviceZone: json['service_zone']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
    );
  }
}

class OtpRequestResult {
  const OtpRequestResult({
    required this.challengeId,
    required this.mobile,
    required this.expiresInSeconds,
    required this.resendAfterSeconds,
    this.sentVia = '',
    this.debugOtp,
  });

  final String challengeId;
  final String mobile;
  final int expiresInSeconds;
  final int resendAfterSeconds;
  final String sentVia;
  final String? debugOtp;

  bool get deliveredViaWhatsapp => sentVia.toUpperCase() == 'WHATSAPP';

  factory OtpRequestResult.fromJson(Map<String, dynamic> json) {
    return OtpRequestResult(
      challengeId: json['challenge_id']?.toString() ?? '',
      mobile: json['mobile']?.toString() ?? '',
      expiresInSeconds: (json['expires_in_seconds'] as num?)?.toInt() ?? 300,
      resendAfterSeconds: (json['resend_after_seconds'] as num?)?.toInt() ?? 45,
      sentVia: json['sent_via']?.toString() ?? '',
      debugOtp: json['debug_otp']?.toString(),
    );
  }
}

class BookAppointmentResult {
  const BookAppointmentResult({
    required this.appointment,
    this.notificationStatus = '',
    this.notificationReason = '',
    this.notificationMode = '',
  });

  final SalonAppointment appointment;
  final String notificationStatus;
  final String notificationReason;
  final String notificationMode;

  bool get whatsappSent =>
      notificationStatus.toUpperCase() == 'SENT' &&
      notificationMode.toLowerCase() != 'auth_template';
}

class AtHomeBookingResult {
  const AtHomeBookingResult({
    required this.booking,
    this.notificationStatus = '',
    this.notificationReason = '',
  });

  final AtHomeBooking booking;
  final String notificationStatus;
  final String notificationReason;

  bool get whatsappSent => notificationStatus.toUpperCase() == 'SENT';
}

class SalesIqMobileConfig {
  const SalesIqMobileConfig({
    required this.configured,
    required this.bundleId,
    required this.androidAppKey,
    required this.androidAccessKey,
    required this.androidBundleMatch,
    required this.iosAppKey,
    required this.iosAccessKey,
    required this.iosBundleMatch,
  });

  final bool configured;
  final String bundleId;
  final String androidAppKey;
  final String androidAccessKey;
  final bool androidBundleMatch;
  final String iosAppKey;
  final String iosAccessKey;
  final bool iosBundleMatch;

  factory SalesIqMobileConfig.fromJson(Map<String, dynamic> json) {
    final android = json['android'];
    final ios = json['ios'];
    return SalesIqMobileConfig(
      configured: json['configured'] == true,
      bundleId: json['bundle_id']?.toString() ?? '',
      androidAppKey: android is Map ? android['app_key']?.toString() ?? '' : '',
      androidAccessKey: android is Map
          ? android['access_key']?.toString() ?? ''
          : '',
      androidBundleMatch: android is Map
          ? android['bundle_match'] == true
          : false,
      iosAppKey: ios is Map ? ios['app_key']?.toString() ?? '' : '',
      iosAccessKey: ios is Map ? ios['access_key']?.toString() ?? '' : '',
      iosBundleMatch: ios is Map ? ios['bundle_match'] == true : false,
    );
  }
}

class CatalystApi {
  CatalystApi({http.Client? client, this._tokenProvider})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String? Function()? _tokenProvider;
  static const _timeout = Duration(seconds: 20);
  static const _authTimeout = Duration(seconds: 35);
  static const _uploadTimeout = Duration(seconds: 60);

  Map<String, String> _headers({
    bool includeAuth = true,
    bool includeGuestSession = true,
  }) {
    final headers = <String, String>{'Accept': 'application/json'};
    final token = includeAuth ? _tokenProvider?.call() : null;
    if (includeAuth && token != null && token.isNotEmpty) {
      headers['X-Baylen-Token'] = token;
    }
    final guestSessionId = includeGuestSession
        ? GuestSession.instance.currentId
        : null;
    if (includeGuestSession &&
        guestSessionId != null &&
        guestSessionId.isNotEmpty) {
      headers['X-Baylen-Guest-Session'] = guestSessionId;
    }
    return headers;
  }

  Future<Map<String, dynamic>> _get(
    String path, [
    Map<String, String>? query,
    bool includeAuth = true,
    bool includeGuestSession = false,
  ]) async {
    var uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: query);
    }
    final http.Response response;
    try {
      response = await _client
          .get(
            uri,
            headers: _headers(
              includeAuth: includeAuth,
              includeGuestSession: includeGuestSession,
            ),
          )
          .timeout(_timeout);
    } catch (_) {
      throw ApiException('Live data is temporarily unavailable. Please retry.');
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final http.Response response;
    try {
      response = await _client
          .post(
            uri,
            headers: {..._headers(), 'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(timeout ?? _timeout);
    } catch (_) {
      throw ApiException('Live data is temporarily unavailable. Please retry.');
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _delete(String path, {Duration? timeout}) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final http.Response response;
    try {
      response = await _client
          .delete(uri, headers: _headers())
          .timeout(timeout ?? _timeout);
    } catch (_) {
      throw ApiException('Live data is temporarily unavailable. Please retry.');
    }
    return _decode(response);
  }

  Future<Map<String, dynamic>> _put(
    String path,
    Map<String, dynamic> body, {
    Duration? timeout,
  }) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final http.Response response;
    try {
      response = await _client
          .put(
            uri,
            headers: {..._headers(), 'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(timeout ?? _timeout);
    } catch (_) {
      throw ApiException('Live data is temporarily unavailable. Please retry.');
    }
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ApiException('Request failed');
    }
    if (decoded is! Map<String, dynamic>) {
      throw ApiException('Unexpected response');
    }
    if (response.statusCode >= 400 || decoded['ok'] != true) {
      if (response.statusCode == 413) {
        throw ApiException(
          'This photo or document is too large. Use a smaller JPG or PDF.',
          statusCode: response.statusCode,
        );
      }
      final message = decoded['error']?.toString() ?? 'Request failed';
      final code = decoded['code']?.toString();
      final details = decoded['details'];
      if (details is String && details.isNotEmpty) {
        throw ApiException(
          '$message $details',
          statusCode: response.statusCode,
          code: code,
        );
      }
      if (details is Map && details['gateway'] != null) {
        throw ApiException(
          '$message ${details['gateway']}',
          statusCode: response.statusCode,
          code: code,
        );
      }
      throw ApiException(message, statusCode: response.statusCode, code: code);
    }
    final data = decoded['data'];
    if (data is Map<String, dynamic>) {
      return data;
    }
    return {};
  }

  Future<bool> isHealthy() async {
    try {
      final data = await _get('/health');
      return data['status'] == 'up';
    } catch (_) {
      return false;
    }
  }

  Future<AuthUser> currentUser() async {
    final data = await _get('/v1/auth/me');
    final user = data['user'];
    if (user is! Map<String, dynamic>) {
      throw ApiException('Not signed in');
    }
    return AuthUser.fromJson(user);
  }

  Future<({String token, AuthUser user})> refreshSession() async {
    final data = await _post('/v1/auth/session/refresh', {});
    final token = data['token']?.toString() ?? '';
    final user = data['user'];
    if (token.isEmpty || user is! Map<String, dynamic>) {
      throw ApiException('Session refresh failed');
    }
    return (token: token, user: AuthUser.fromJson(user));
  }

  Future<void> revokeSession({String? deviceId}) async {
    await _post('/v1/auth/session/revoke', {
      if (deviceId != null && deviceId.isNotEmpty) 'device_id': deviceId,
    });
  }

  Future<OtpRequestResult> requestOtp({required String mobile}) async {
    final data = await _post('/v1/auth/otp/request', {
      'mobile': mobile,
    }, timeout: _authTimeout);
    return OtpRequestResult.fromJson(data);
  }

  Future<({String token, AuthUser user})> verifyOtp({
    required String mobile,
    required String otp,
    String? challengeId,
    String? guestSessionId,
  }) async {
    final data = await _post('/v1/auth/otp/verify', {
      'mobile': mobile,
      'otp': otp,
      if (challengeId != null && challengeId.isNotEmpty)
        'challenge_id': challengeId,
      if (guestSessionId != null && guestSessionId.isNotEmpty)
        'guest_session_id': guestSessionId,
    }, timeout: _authTimeout);
    final token = data['token']?.toString() ?? '';
    final user = data['user'];
    if (token.isEmpty || user is! Map<String, dynamic>) {
      throw ApiException('OTP verification failed');
    }
    return (token: token, user: AuthUser.fromJson(user));
  }

  Future<({String token, AuthUser user})> completeProfile({
    required String firstName,
    required String lastName,
    required String email,
    String? gender,
    String? dateOfBirth,
  }) async {
    final data = await _post('/v1/auth/profile/complete', {
      'first_name': firstName,
      'last_name': lastName,
      'email': email,
      if (gender != null && gender.isNotEmpty) 'gender': gender,
      if (dateOfBirth != null && dateOfBirth.isNotEmpty)
        'date_of_birth': dateOfBirth,
    }, timeout: _authTimeout);
    final token = data['token']?.toString() ?? '';
    final user = data['user'];
    if (token.isEmpty || user is! Map<String, dynamic>) {
      throw ApiException('Profile completion failed');
    }
    return (token: token, user: AuthUser.fromJson(user));
  }

  Future<List<String>> roleSelect({required String phone}) async {
    final data = await _post('/v1/auth/role-select', {
      'phone': phone,
    }, timeout: _authTimeout);
    final roles = data['available_roles'];
    if (roles is! List) {
      return const ['customer', 'delivery_partner'];
    }
    return roles.map((role) => role.toString()).toList();
  }

  Future<DeliveryPartnerOtpRequestResult> requestDeliveryPartnerOtp({
    required String mobile,
  }) async {
    final data = await _post('/v1/auth/delivery-partner/otp/request', {
      'phone': mobile,
    }, timeout: _authTimeout);
    return DeliveryPartnerOtpRequestResult.fromJson(data);
  }

  Future<DeliveryPartnerOtpVerifyResult> verifyDeliveryPartnerOtp({
    required String mobile,
    required String otp,
    String? challengeId,
  }) async {
    final data = await _post('/v1/auth/delivery-partner/otp/verify', {
      'phone': mobile,
      'otp': otp,
      if (challengeId != null && challengeId.isNotEmpty)
        'challenge_id': challengeId,
    }, timeout: _authTimeout);
    return DeliveryPartnerOtpVerifyResult.fromJson(data);
  }

  Future<({String token, DeliveryPartnerSession session})>
  loginDeliveryPartner({
    required String mobile,
    required String password,
  }) async {
    final data = await _post('/v1/auth/delivery-partner/login', {
      'phone': mobile,
      'password': password,
    }, timeout: _authTimeout);
    final token = data['token']?.toString() ?? '';
    if (token.isEmpty) {
      throw ApiException('Login failed');
    }
    return (token: token, session: DeliveryPartnerSession.fromJson(data));
  }

  Future<EmployeeRegistrationStatus> fetchEmployeeRegistrationStatus() async {
    final data = await _get(
      '/v1/auth/delivery-partner/registration/status',
      {},
      true,
    );
    final registration = data['registration'];
    if (registration is! Map<String, dynamic>) {
      throw ApiException('Could not load registration status');
    }
    return EmployeeRegistrationStatus.fromJson(registration);
  }

  Future<EmployeeRegistrationStatus> saveEmployeeRegistrationProfile(
    Map<String, dynamic> body,
  ) async {
    final data = await _post(
      '/v1/auth/delivery-partner/registration/profile',
      body,
    );
    final registration = data['registration'];
    if (registration is! Map<String, dynamic>) {
      throw ApiException('Could not save profile');
    }
    return EmployeeRegistrationStatus.fromJson(registration);
  }

  Future<EmployeeRegistrationStatus> uploadEmployeeRegistrationPhoto({
    required String photoType,
    required String fileName,
    required String contentType,
    required String base64,
  }) async {
    final data = await _post('/v1/auth/delivery-partner/registration/photos', {
      'document_type': photoType,
      'file_name': fileName,
      'content_type': contentType,
      'base64': base64,
    });
    final registration = data['registration'];
    if (registration is! Map<String, dynamic>) {
      throw ApiException('Could not upload photo');
    }
    return EmployeeRegistrationStatus.fromJson(registration);
  }

  Future<EmployeeRegistrationStatus> saveEmployeeRegistrationPassword({
    required String password,
    required String confirmPassword,
  }) async {
    final data = await _post(
      '/v1/auth/delivery-partner/registration/password',
      {'password': password, 'confirm_password': confirmPassword},
    );
    final registration = data['registration'];
    if (registration is! Map<String, dynamic>) {
      throw ApiException('Could not save password');
    }
    return EmployeeRegistrationStatus.fromJson(registration);
  }

  Future<EmployeeRegistrationStatus> completeEmployeeRegistration() async {
    final data = await _post(
      '/v1/auth/delivery-partner/registration/complete',
      {},
    );
    final registration = data['registration'];
    if (registration is! Map<String, dynamic>) {
      throw ApiException('Could not complete registration');
    }
    return EmployeeRegistrationStatus.fromJson(registration);
  }

  Future<DeliveryPartnerOtpRequestResult> requestDeliveryPartnerPasswordReset({
    required String mobile,
  }) async {
    final data = await _post(
      '/v1/auth/delivery-partner/password/forgot/request',
      {'phone': mobile},
      timeout: _authTimeout,
    );
    return DeliveryPartnerOtpRequestResult.fromJson(data);
  }

  Future<void> resetDeliveryPartnerPassword({
    required String mobile,
    required String otp,
    required String password,
    required String confirmPassword,
    String challengeId = '',
  }) async {
    await _post('/v1/auth/delivery-partner/password/forgot/reset', {
      'phone': mobile,
      'otp': otp,
      'password': password,
      'confirm_password': confirmPassword,
      if (challengeId.isNotEmpty) 'challenge_id': challengeId,
    }, timeout: _authTimeout);
  }

  Future<List<DeliveryPartnerLead>> deliveryPartnerLeads({
    required String status,
  }) async {
    final data = await _get('/v1/delivery-partner/leads', {'status': status});
    final leads = data['leads'];
    if (leads is! List) {
      return const [];
    }
    return leads
        .whereType<Map<String, dynamic>>()
        .map(DeliveryPartnerLead.fromJson)
        .toList();
  }

  Future<DeliveryPartnerKyc> fetchDeliveryPartnerKyc() async {
    final data = await _get('/v1/delivery-partner/kyc');
    final kyc = data['kyc'];
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('KYC details were not returned');
    }
    return DeliveryPartnerKyc.fromJson(kyc);
  }

  Future<DeliveryPartnerKyc> createDeliveryPartnerKyc(
    Map<String, dynamic> body,
  ) async {
    final data = await _post(
      '/v1/delivery-partner/kyc',
      body,
      timeout: _authTimeout,
    );
    final kyc = data['kyc'];
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('KYC create failed');
    }
    return DeliveryPartnerKyc.fromJson(kyc);
  }

  Future<DeliveryPartnerKyc> updateDeliveryPartnerKyc(
    Map<String, dynamic> body,
  ) async {
    final data = await _put(
      '/v1/delivery-partner/kyc',
      body,
      timeout: _authTimeout,
    );
    final kyc = data['kyc'];
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('KYC update failed');
    }
    return DeliveryPartnerKyc.fromJson(kyc);
  }

  Future<({DeliveryPartnerKyc kyc, String token})> submitDeliveryPartnerKyc({
    String? aadhaarNumber,
  }) async {
    final body = <String, dynamic>{};
    final digits = aadhaarNumber?.replaceAll(RegExp(r'\D'), '') ?? '';
    if (digits.length == 12) {
      body['aadhaar_number'] = digits;
    }
    final data = await _post(
      '/v1/delivery-partner/kyc/submit',
      body,
      timeout: _authTimeout,
    );
    final kyc = data['kyc'];
    final token = data['token']?.toString() ?? '';
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('KYC submit failed');
    }
    return (kyc: DeliveryPartnerKyc.fromJson(kyc), token: token);
  }

  Future<DeliveryPartnerKyc> uploadDeliveryPartnerKycDocument({
    required String documentType,
    required String fileName,
    required String contentType,
    required String base64,
  }) async {
    final data = await _post('/v1/delivery-partner/kyc/documents', {
      'document_type': documentType,
      'file_name': fileName,
      'content_type': contentType,
      'base64': base64,
    }, timeout: _uploadTimeout);
    final kyc = data['kyc'];
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('Document upload failed');
    }
    return DeliveryPartnerKyc.fromJson(kyc);
  }

  Future<DeliveryPartnerKyc> deleteDeliveryPartnerKycDocument({
    required String documentType,
  }) async {
    final data = await _delete(
      '/v1/delivery-partner/kyc/documents/$documentType',
      timeout: _authTimeout,
    );
    final kyc = data['kyc'];
    if (kyc is! Map<String, dynamic>) {
      throw ApiException('Document delete failed');
    }
    return DeliveryPartnerKyc.fromJson(kyc);
  }

  Future<DeliveryPartnerDashboard> fetchPartnerDashboard() async {
    final data = await _get('/v1/delivery-partner/dashboard');
    return DeliveryPartnerDashboard.fromJson(data);
  }

  Future<Uint8List?> fetchPartnerProfilePhotoBytes() async {
    final uri = Uri.parse(
      '${AppConfig.apiBaseUrl}/v1/delivery-partner/profile-photo',
    );
    try {
      final response = await _client
          .get(uri, headers: _headers())
          .timeout(_timeout);
      if (response.statusCode != 200 || response.bodyBytes.isEmpty) {
        return null;
      }
      return response.bodyBytes;
    } catch (_) {
      return null;
    }
  }

  Future<Map<String, dynamic>> fetchPartnerEarnings({int limit = 50}) async {
    return _get('/v1/delivery-partner/earnings', {'limit': '$limit'});
  }

  Future<DeliveryPartnerDashboard> setPartnerOnlineStatus({
    required String onlineStatus,
    double? latitude,
    double? longitude,
    double? accuracyM,
    DateTime? capturedAt,
  }) async {
    final body = <String, dynamic>{'online_status': onlineStatus};
    if (latitude != null && longitude != null) {
      body['latitude'] = latitude;
      body['longitude'] = longitude;
      if (accuracyM != null) body['accuracy_m'] = accuracyM;
      body['captured_at'] = (capturedAt ?? DateTime.now().toUtc())
          .toIso8601String();
    }
    final data = await _post(
      '/v1/delivery-partner/status',
      body,
      timeout: _authTimeout,
    );
    return DeliveryPartnerDashboard.fromJson(data);
  }

  Future<DeliveryPartnerDashboard> savePartnerAvailabilitySchedule(
    Map<String, dynamic> schedule,
  ) async {
    final data = await _put('/v1/delivery-partner/availability-schedule', {
      'availability_schedule': schedule,
    }, timeout: _authTimeout);
    return DeliveryPartnerDashboard.fromJson(data);
  }

  Future<List<Map<String, dynamic>>> fetchPartnerJobs({
    String view = 'offered',
    String? jobType,
  }) async {
    final query = <String, String>{'view': view};
    if (jobType != null && jobType.isNotEmpty) {
      query['job_type'] = jobType;
    }
    final data = await _get('/v1/delivery-partner/jobs', query);
    final jobs = data['jobs'];
    if (jobs is! List) {
      return const [];
    }
    return jobs.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<Map<String, dynamic>> fetchPartnerJobDetail(String jobId) async {
    final data = await _get('/v1/delivery-partner/jobs/detail', {
      'professional_job_id': jobId,
    });
    final job = data['job'];
    if (job is! Map<String, dynamic>) {
      throw ApiException('Professional job detail was not returned');
    }
    return job;
  }

  Future<Map<String, dynamic>> acceptPartnerJob(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-accept', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> rejectPartnerJob({
    required String jobId,
    required String reason,
  }) async {
    return _post('/v1/delivery-partner/professional-job-reject', {
      'professional_job_id': jobId,
      'reason': reason,
    });
  }

  Future<Map<String, dynamic>> startPartnerJobTravel(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-start-travel', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> startPartnerJobPickup(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-start-pickup', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> confirmPartnerJobPickupArrival(
    String jobId,
  ) async {
    return _post('/v1/delivery-partner/professional-job-pickup-arrive', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> verifyPartnerJobPickup({
    required String jobId,
    required String otp,
  }) async {
    return _post('/v1/delivery-partner/professional-job-verify-pickup', {
      'professional_job_id': jobId,
      'otp': otp,
    });
  }

  Future<Map<String, dynamic>> confirmPartnerJobPickedUp(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-pickup', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> startPartnerJobDelivery(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-start-delivery', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> confirmPartnerJobDeliveryArrival(
    String jobId,
  ) async {
    return _post('/v1/delivery-partner/professional-job-delivery-arrive', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> verifyPartnerJobDeliveryOtp({
    required String jobId,
    required String otp,
  }) async {
    return _post('/v1/delivery-partner/professional-job-verify-delivery-otp', {
      'professional_job_id': jobId,
      'otp': otp,
    });
  }

  Future<Map<String, dynamic>> confirmPartnerJobDelivered(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-delivered', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> completePartnerJobDelivery(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-complete-delivery', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> sendPartnerAvailabilityLocation({
    required double latitude,
    required double longitude,
    double? accuracyM,
    required DateTime capturedAt,
  }) async {
    return _post('/v1/delivery-partner/availability-location', {
      'latitude': latitude,
      'longitude': longitude,
      if (accuracyM != null) 'accuracy_m': accuracyM,
      'captured_at': capturedAt.toIso8601String(),
    });
  }

  Future<Map<String, dynamic>> sendPartnerJobLocation({
    required String jobId,
    required double latitude,
    required double longitude,
    double? accuracyM,
    double? speedMps,
    double? heading,
    required DateTime capturedAt,
  }) async {
    return _post('/v1/delivery-partner/professional-job-location', {
      'professional_job_id': jobId,
      'latitude': latitude,
      'longitude': longitude,
      if (accuracyM != null) 'accuracy_m': accuracyM,
      if (speedMps != null) 'speed_mps': speedMps,
      if (heading != null) 'heading': heading,
      'captured_at': capturedAt.toIso8601String(),
    });
  }

  Future<Map<String, dynamic>> fetchProfessionalJobTracking({
    String? professionalJobId,
    String? orderId,
    String? serviceJobId,
  }) async {
    return _get('/v1/professional-jobs/tracking', {
      if (professionalJobId != null) 'professional_job_id': professionalJobId,
      if (orderId != null) 'order_id': orderId,
      if (serviceJobId != null) 'service_job_id': serviceJobId,
    });
  }

  Future<Map<String, dynamic>> fetchPartnerJobArrivalPreview(
    String jobId,
  ) async {
    return _get('/v1/delivery-partner/professional-job-arrival-preview', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> confirmPartnerJobArrival(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-arrive', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> verifyPartnerJobOtp({
    required String jobId,
    required String otp,
  }) async {
    return _post('/v1/delivery-partner/professional-job-verify-otp', {
      'professional_job_id': jobId,
      'otp': otp,
    });
  }

  Future<Map<String, dynamic>> resendPartnerJobOtp(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-resend-otp', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> fetchPartnerJobExecution(String jobId) async {
    return _get('/v1/delivery-partner/professional-job-execution', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> startPartnerJobService(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-start-service', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> updatePartnerJobChecklistItem({
    required String jobId,
    required String itemId,
    required bool done,
  }) async {
    return _post('/v1/delivery-partner/professional-job-checklist-item', {
      'professional_job_id': jobId,
      'item_id': itemId,
      'done': done,
    });
  }

  Future<Map<String, dynamic>> completePartnerJobService(String jobId) async {
    return _post('/v1/delivery-partner/professional-job-complete-service', {
      'professional_job_id': jobId,
    });
  }

  Future<List<Map<String, dynamic>>> fetchPartnerNotifications({
    int limit = 20,
  }) async {
    final data = await _get('/v1/delivery-partner/notifications', {
      'limit': '$limit',
    });
    final items = data['notifications'];
    if (items is! List) return [];
    return items.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<void> markPartnerNotificationsRead(
    List<String> notificationIds,
  ) async {
    await _post('/v1/delivery-partner/notifications/read', {
      'notification_ids': notificationIds,
    });
  }

  Future<Map<String, dynamic>> cancelPartnerJob(
    String jobId, {
    required String reasonCode,
    String? note,
  }) async {
    return _post('/v1/delivery-partner/professional-job-cancel', {
      'professional_job_id': jobId,
      'reason_code': reasonCode,
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }

  Future<Map<String, dynamic>> fetchPartnerNoShowEligibility(
    String jobId,
  ) async {
    return _get('/v1/delivery-partner/professional-job-no-show-eligibility', {
      'professional_job_id': jobId,
    });
  }

  Future<Map<String, dynamic>> reportPartnerNoShow(
    String jobId, {
    String? note,
  }) async {
    return _post('/v1/delivery-partner/professional-job-no-show', {
      'professional_job_id': jobId,
      if (note != null && note.isNotEmpty) 'note': note,
    });
  }

  Future<Map<String, dynamic>> createPartnerSupportTicket({
    required String category,
    required String message,
    String? jobId,
  }) async {
    return _post('/v1/delivery-partner/support/tickets', {
      'category': category,
      'message': message,
      if (jobId != null && jobId.isNotEmpty) 'professional_job_id': jobId,
    });
  }

  Future<List<Map<String, dynamic>>> fetchPartnerSupportTickets({
    int limit = 20,
  }) async {
    final data = await _get('/v1/delivery-partner/support/tickets', {
      'limit': '$limit',
    });
    final items = data['tickets'];
    if (items is! List) return [];
    return items.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  Future<Map<String, dynamic>> homeFeed() async {
    return _get('/v1/home', null, false);
  }

  Future<LaunchContent> launchContent() async {
    final data = await _get('/v1/launch', null, false);
    return LaunchContent.fromJson(data);
  }

  Future<SalesIqMobileConfig> salesIqMobileConfig() async {
    final data = await _get('/v1/salesiq/mobile-config', null, false);
    return SalesIqMobileConfig.fromJson(data);
  }

  Future<UserProfile> profile() async {
    final data = await _get('/v1/profile');
    final profile = data['profile'];
    if (profile is! Map<String, dynamic>) {
      throw ApiException('Profile was not returned');
    }
    return UserProfile.fromJson(profile);
  }

  Future<AccountBootstrap> recoverAccount() async {
    final data = await _get('/v1/account/recover');
    return AccountBootstrap.fromJson(data);
  }

  Future<UserProfile> updateProfile({
    required String fullName,
    required String mobile,
    required String email,
    String? gender,
    String? dateOfBirth,
    String? profilePhotoUrl,
  }) async {
    final data = await _post('/v1/profile', {
      'full_name': fullName,
      'mobile': mobile,
      'email': email,
      if (gender != null && gender.isNotEmpty) 'gender': gender,
      if (dateOfBirth != null && dateOfBirth.isNotEmpty)
        'date_of_birth': dateOfBirth,
      if (profilePhotoUrl != null && profilePhotoUrl.isNotEmpty)
        'profile_photo_url': profilePhotoUrl,
    });
    final profile = data['profile'];
    if (profile is! Map<String, dynamic>) {
      throw ApiException('Profile was not returned');
    }
    return UserProfile.fromJson(profile);
  }

  Future<List<Address>> addresses() async {
    final data = await _get('/v1/addresses');
    final items = data['addresses'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(Address.fromJson)
        .toList();
  }

  Future<List<Address>> addAddress({
    required String label,
    required String line1,
    required String city,
    required String state,
    required String postalCode,
    String? fullName,
    String? phone,
    String? line2,
    String? landmark,
    bool isDefault = false,
    double? latitude,
    double? longitude,
  }) async {
    final body = <String, dynamic>{
      'label': label,
      'line1': line1,
      'city': city,
      'state': state,
      'postal_code': postalCode,
      'is_default': isDefault,
      if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (line2 != null && line2.isNotEmpty) 'line2': line2,
      if (landmark != null && landmark.isNotEmpty) 'landmark': landmark,
    };
    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    final data = await _post('/v1/addresses', body);
    final items = data['addresses'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(Address.fromJson)
        .toList();
  }

  Future<List<Address>> updateAddress({
    required String addressId,
    required String label,
    required String line1,
    required String city,
    required String state,
    required String postalCode,
    String? fullName,
    String? phone,
    String? line2,
    String? landmark,
    bool isDefault = false,
    double? latitude,
    double? longitude,
  }) async {
    final body = <String, dynamic>{
      'address_id': addressId,
      'label': label,
      'line1': line1,
      'city': city,
      'state': state,
      'postal_code': postalCode,
      'is_default': isDefault,
      if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (line2 != null && line2.isNotEmpty) 'line2': line2,
      if (landmark != null && landmark.isNotEmpty) 'landmark': landmark,
    };
    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    final data = await _post('/v1/address/update', body);
    final items = data['addresses'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(Address.fromJson)
        .toList();
  }

  Future<List<Address>> setDefaultAddress(String addressId) async {
    final data = await _post('/v1/address/default', {'address_id': addressId});
    final items = data['addresses'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(Address.fromJson)
        .toList();
  }

  Future<void> removeAddress(String addressId) async {
    await _post('/v1/address/remove', {'address_id': addressId});
  }

  Future<Map<String, dynamic>> lookupPincode(String pincode) {
    return _get('/v1/location/pincode', {'pincode': pincode}, false);
  }

  Future<Map<String, dynamic>> checkServiceablePincode(String pincode) {
    return _post('/v1/checkout/check-pincode', {'pincode': pincode});
  }

  Future<Map<String, dynamic>> validateCheckout({
    String? pincode,
    String? shippingPostalCode,
  }) {
    return _post('/v1/checkout/validate', {
      if (pincode != null && pincode.isNotEmpty) 'pincode': pincode,
      if (shippingPostalCode != null && shippingPostalCode.isNotEmpty)
        'shipping_postal_code': shippingPostalCode,
    });
  }

  Map<String, dynamic> _checkoutPayload({
    String? shippingName,
    String? shippingPhone,
    String? shippingLine1,
    String? shippingCity,
    String? shippingState,
    String? shippingPostalCode,
    String? addressId,
    String? fulfillmentMode,
    double? latitude,
    double? longitude,
    String? paymentMethod,
    String? idempotencyKey,
  }) {
    final body = <String, dynamic>{
      if (addressId != null && addressId.isNotEmpty) 'address_id': addressId,
      if (shippingName != null && shippingName.isNotEmpty)
        'shipping_name': shippingName,
      if (shippingPhone != null && shippingPhone.isNotEmpty)
        'shipping_phone': shippingPhone,
      if (shippingLine1 != null && shippingLine1.isNotEmpty)
        'shipping_line1': shippingLine1,
      if (shippingCity != null && shippingCity.isNotEmpty)
        'shipping_city': shippingCity,
      if (shippingState != null && shippingState.isNotEmpty)
        'shipping_state': shippingState,
      if (shippingPostalCode != null && shippingPostalCode.isNotEmpty)
        'shipping_postal_code': shippingPostalCode,
      if (fulfillmentMode != null && fulfillmentMode.isNotEmpty)
        'fulfillment_mode': fulfillmentMode,
      if (paymentMethod != null && paymentMethod.isNotEmpty)
        'payment_method': paymentMethod,
      if (idempotencyKey != null && idempotencyKey.isNotEmpty)
        'idempotency_key': idempotencyKey,
    };
    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    return body;
  }

  Future<ShopOrder> checkout({
    String? shippingName,
    String? shippingPhone,
    String? shippingLine1,
    String? shippingCity,
    String? shippingState,
    String? shippingPostalCode,
    String? addressId,
    String? fulfillmentMode,
    double? latitude,
    double? longitude,
    String? paymentMethod,
    String? idempotencyKey,
  }) async {
    return _orderFrom(
      await _post(
        '/v1/checkout',
        _checkoutPayload(
          shippingName: shippingName,
          shippingPhone: shippingPhone,
          shippingLine1: shippingLine1,
          shippingCity: shippingCity,
          shippingState: shippingState,
          shippingPostalCode: shippingPostalCode,
          addressId: addressId,
          fulfillmentMode: fulfillmentMode,
          latitude: latitude,
          longitude: longitude,
          paymentMethod: paymentMethod,
          idempotencyKey: idempotencyKey,
        ),
      ),
    );
  }

  Future<ShopOrder> placeCodOrder({
    String? shippingName,
    String? shippingPhone,
    String? shippingLine1,
    String? shippingCity,
    String? shippingState,
    String? shippingPostalCode,
    String? addressId,
    String? fulfillmentMode,
    double? latitude,
    double? longitude,
    String? idempotencyKey,
  }) async {
    return _orderFrom(
      await _post(
        '/v1/checkout/place-cod-order',
        _checkoutPayload(
          shippingName: shippingName,
          shippingPhone: shippingPhone,
          shippingLine1: shippingLine1,
          shippingCity: shippingCity,
          shippingState: shippingState,
          shippingPostalCode: shippingPostalCode,
          addressId: addressId,
          fulfillmentMode: fulfillmentMode,
          latitude: latitude,
          longitude: longitude,
          paymentMethod: 'COD',
          idempotencyKey: idempotencyKey,
        ),
      ),
    );
  }

  Future<Map<String, dynamic>> createCheckoutPayment({
    String? shippingName,
    String? shippingPhone,
    String? shippingLine1,
    String? shippingCity,
    String? shippingState,
    String? shippingPostalCode,
    String? addressId,
    String? fulfillmentMode,
    double? latitude,
    double? longitude,
    String paymentMethod = 'UPI',
    String? idempotencyKey,
  }) {
    return _post(
      '/v1/checkout/create-payment',
      _checkoutPayload(
        shippingName: shippingName,
        shippingPhone: shippingPhone,
        shippingLine1: shippingLine1,
        shippingCity: shippingCity,
        shippingState: shippingState,
        shippingPostalCode: shippingPostalCode,
        addressId: addressId,
        fulfillmentMode: fulfillmentMode,
        latitude: latitude,
        longitude: longitude,
        paymentMethod: paymentMethod,
        idempotencyKey: idempotencyKey,
      ),
    );
  }

  Future<PaymentRecord> verifyCheckoutPayment({
    required String paymentId,
    required String status,
    String? providerPaymentId,
    String? providerSignature,
  }) async {
    final data = await _post('/v1/checkout/verify-payment', {
      'payment_id': paymentId,
      'status': status,
      if (providerPaymentId != null && providerPaymentId.isNotEmpty)
        'provider_payment_id': providerPaymentId,
      if (providerSignature != null && providerSignature.isNotEmpty)
        'provider_signature': providerSignature,
    });
    final payment = data['payment'];
    if (payment is! Map<String, dynamic>) {
      throw ApiException('Payment was not returned');
    }
    return PaymentRecord.fromJson(payment);
  }

  Future<void> registerDevice({
    required String deviceId,
    String? deviceType,
    String? platform,
    String? osVersion,
    String? appVersion,
    String? pushToken,
  }) async {
    await _post('/v1/devices/register', {
      'device_id': deviceId,
      if (deviceType != null && deviceType.isNotEmpty)
        'device_type': deviceType,
      if (platform != null && platform.isNotEmpty) 'platform': platform,
      if (osVersion != null && osVersion.isNotEmpty) 'os_version': osVersion,
      if (appVersion != null && appVersion.isNotEmpty)
        'app_version': appVersion,
      if (pushToken != null && pushToken.isNotEmpty) 'push_token': pushToken,
    });
  }

  Future<List<CatalogCategory>> categories({String type = 'PRODUCT'}) async {
    final data = await _get('/v1/catalog/categories', {'type': type}, false);
    final items = data['categories'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogCategory.fromJson)
        .toList();
  }

  Future<List<CatalogCategoryNode>> megaMenu() async {
    final data = await _get('/v1/catalog/mega-menu', null, false);
    final items = data['menu'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogCategoryNode.fromJson)
        .toList();
  }

  Future<List<ShopNavMenu>> shopNavigation() async {
    final data = await _get('/v1/catalog/navigation', null, false);
    final items = data['menus'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(ShopNavMenu.fromJson)
        .toList();
  }

  Future<List<String>> trendingSearches() async {
    final data = await _get('/v1/catalog/search/trending', null, false);
    final items = data['trending'];
    if (items is! List) {
      return [];
    }
    return items
        .map((item) {
          if (item is Map<String, dynamic>) {
            return item['query']?.toString() ?? '';
          }
          return item.toString();
        })
        .where((item) => item.isNotEmpty)
        .toList();
  }

  Future<ShopHome> shopHome({double? latitude, double? longitude}) async {
    final query = <String, String>{};
    if (latitude != null) {
      query['latitude'] = '$latitude';
    }
    if (longitude != null) {
      query['longitude'] = '$longitude';
    }
    final data = await _get(
      '/v1/catalog/shop-home',
      query.isEmpty ? null : query,
      false,
    );
    return ShopHome.fromJson(data);
  }

  Future<List<CatalogProduct>> shopSearch(
    String query, {
    double? latitude,
    double? longitude,
    int page = 1,
    int limit = 24,
  }) async {
    final params = <String, String>{
      'q': query,
      'page': '$page',
      'limit': '$limit',
    };
    if (latitude != null) {
      params['latitude'] = '$latitude';
    }
    if (longitude != null) {
      params['longitude'] = '$longitude';
    }
    final data = await _get('/v1/catalog/search', params, false);
    final items = data['products'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogProduct.fromJson)
        .toList();
  }

  Future<List<CatalogBrand>> brands() async {
    final data = await _get('/v1/catalog/brands', null, false);
    final items = data['brands'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogBrand.fromJson)
        .toList();
  }

  Future<CatalogBrandPage> brandPage(String slug) async {
    final data = await _get('/v1/catalog/brand', {'slug': slug}, false);
    return CatalogBrandPage.fromJson(data);
  }

  Future<List<CatalogProduct>> products({
    String? categoryId,
    String? brandId,
    String? search,
    String? sort,
    int page = 1,
    int limit = 24,
    double? latitude,
    double? longitude,
  }) async {
    final query = <String, String>{'page': '$page', 'limit': '$limit'};
    if (categoryId != null && categoryId.isNotEmpty) {
      query['category_id'] = categoryId;
    }
    if (brandId != null && brandId.isNotEmpty) {
      query['brand_id'] = brandId;
    }
    if (search != null && search.isNotEmpty) {
      query['search'] = search;
    }
    if (sort != null && sort.isNotEmpty) {
      query['sort'] = sort;
    }
    if (latitude != null) {
      query['latitude'] = '$latitude';
    }
    if (longitude != null) {
      query['longitude'] = '$longitude';
    }
    final data = await _get('/v1/catalog/products', query, false);
    final items = data['products'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogProduct.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> productsPage({
    String? categoryId,
    String? brandId,
    String? search,
    String? sort,
    int page = 1,
    String? cursor,
    int limit = 24,
    double? minPrice,
    double? maxPrice,
    int? minDiscount,
    double? minRating,
    bool? inStock,
    String? gender,
    String? ageGroup,
    double? latitude,
    double? longitude,
  }) async {
    final query = <String, String>{'limit': '$limit'};
    if (cursor != null && cursor.isNotEmpty) {
      query['cursor'] = cursor;
    } else {
      query['page'] = '$page';
    }
    if (categoryId != null && categoryId.isNotEmpty) {
      query['category_id'] = categoryId;
    }
    if (brandId != null && brandId.isNotEmpty) {
      query['brand_id'] = brandId;
    }
    if (search != null && search.isNotEmpty) {
      query['search'] = search;
    }
    if (sort != null && sort.isNotEmpty) {
      query['sort'] = sort;
    }
    if (minPrice != null && minPrice > 0) {
      query['min_price'] = minPrice.toString();
    }
    if (maxPrice != null && maxPrice > 0) {
      query['max_price'] = maxPrice.toString();
    }
    if (minDiscount != null && minDiscount > 0) {
      query['min_discount'] = '$minDiscount';
    }
    if (minRating != null && minRating > 0) {
      query['min_rating'] = minRating.toString();
    }
    if (inStock == true) {
      query['in_stock'] = 'true';
    }
    if (gender != null && gender.isNotEmpty) {
      query['gender'] = gender;
    }
    if (ageGroup != null && ageGroup.isNotEmpty) {
      query['age_group'] = ageGroup;
    }
    if (latitude != null) {
      query['latitude'] = '$latitude';
    }
    if (longitude != null) {
      query['longitude'] = '$longitude';
    }
    return _get('/v1/catalog/products', query, false);
  }

  Future<CatalogProductDetail> productDetail(
    String id, {
    double? latitude,
    double? longitude,
  }) async {
    final query = <String, String>{'id': id};
    if (latitude != null) {
      query['latitude'] = '$latitude';
    }
    if (longitude != null) {
      query['longitude'] = '$longitude';
    }
    final data = await _get('/v1/catalog/product', query, false);
    return CatalogProductDetail.fromJson(data);
  }

  Future<ProductFulfillmentAvailability> productFulfillmentAvailability({
    required String productId,
    String? variantId,
    int quantity = 1,
    double? latitude,
    double? longitude,
  }) async {
    final query = <String, String>{
      'product_id': productId,
      'quantity': '$quantity',
    };
    if (variantId != null && variantId.isNotEmpty) {
      query['variant_id'] = variantId;
    }
    if (latitude != null) {
      query['latitude'] = '$latitude';
    }
    if (longitude != null) {
      query['longitude'] = '$longitude';
    }
    final data = await _get(
      '/v1/fulfillment/product-availability',
      query,
      false,
    );
    return ProductFulfillmentAvailability.fromJson(data);
  }

  Future<CartFulfillmentResult> checkFulfillment({
    double? latitude,
    double? longitude,
    bool useCart = true,
    List<Map<String, dynamic>>? items,
  }) async {
    final body = <String, dynamic>{'use_cart': useCart};
    if (latitude != null) body['latitude'] = latitude;
    if (longitude != null) body['longitude'] = longitude;
    if (items != null) body['items'] = items;
    final data = await _post('/v1/fulfillment/check', body);
    return CartFulfillmentResult.fromJson(data);
  }

  Cart _cartFrom(Map<String, dynamic> data) {
    return Cart.fromPayload(data);
  }

  Future<Cart> getCart() async {
    return _cartFrom(await _get('/v1/cart', null, true, true));
  }

  Future<Cart> addToCart({
    required String productId,
    String? variantId,
    int quantity = 1,
    double? latitude,
    double? longitude,
  }) async {
    return _cartFrom(
      await _post('/v1/cart/items', {
        'product_id': productId,
        if (variantId != null && variantId.isNotEmpty) 'variant_id': variantId,
        'quantity': quantity,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      }),
    );
  }

  Future<Cart> updateCartItemQuantity({
    required String itemId,
    required int quantity,
    double? latitude,
    double? longitude,
  }) async {
    return _cartFrom(
      await _post('/v1/cart/item/quantity', {
        'item_id': itemId,
        'quantity': quantity,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      }),
    );
  }

  Future<Cart> removeCartItem(String itemId) async {
    return _cartFrom(await _post('/v1/cart/item/remove', {'item_id': itemId}));
  }

  Future<Cart> applyCoupon(String code) async {
    return _cartFrom(await _post('/v1/cart/coupon', {'coupon_code': code}));
  }

  Future<Cart> removeCoupon() async {
    return _cartFrom(await _post('/v1/cart/coupon/remove', {}));
  }

  Future<List<WishlistItem>> wishlist() async {
    final data = await _get('/v1/wishlist');
    final items = data['wishlist'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(WishlistItem.fromJson)
        .toList();
  }

  Future<bool> toggleWishlist(String productId, {String? variantId}) async {
    final data = await _post('/v1/wishlist/toggle', {
      'product_id': productId,
      if (variantId != null && variantId.isNotEmpty) 'variant_id': variantId,
    });
    return data['wished'] == true;
  }

  ShopOrder _orderFrom(Map<String, dynamic> data) {
    final order = data['order'];
    if (order is Map<String, dynamic>) {
      return ShopOrder.fromJson(order);
    }
    throw ApiException('Order was not returned');
  }

  Future<List<ShopOrder>> orders() async {
    final data = await _get('/v1/orders');
    final items = data['orders'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(ShopOrder.fromJson)
        .toList();
  }

  Future<ShopOrder> order(String id) async {
    try {
      return _orderFrom(await _get('/v1/orders/$id'));
    } catch (_) {
      return _orderFrom(await _get('/v1/orders', {'id': id}));
    }
  }

  Future<List<OrderTimelineEntry>> orderTimeline(String id) async {
    final data = await _get('/v1/order/timeline', {'id': id});
    final items = data['timeline'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(OrderTimelineEntry.fromJson)
        .toList();
  }

  /// Live QC tracking (picker → rider → delivered). Requires customer session.
  Future<OrderTracking> orderTracking(String id) async {
    final data = await _get('/v1/orders/$id/tracking');
    return OrderTracking.fromJson(data);
  }

  Future<ShopOrder> cancelOrder({
    required String orderId,
    required String reason,
  }) async {
    return _orderFrom(
      await _post('/v1/order/cancel', {'order_id': orderId, 'reason': reason}),
    );
  }

  Future<ShopOrder> requestOrderReturn({
    required String orderId,
    String? orderItemId,
    required String reason,
  }) async {
    return _orderFrom(
      await _post('/v1/order/return', {
        'order_id': orderId,
        if (orderItemId != null && orderItemId.isNotEmpty)
          'order_item_id': orderItemId,
        'reason': reason,
      }),
    );
  }

  Future<PaymentRecord> createPaymentIntent({
    required String referenceType,
    required String referenceId,
    String provider = 'MANUAL',
  }) async {
    final data = await _post('/v1/payments/intent', {
      'reference_type': referenceType,
      'reference_id': referenceId,
      'provider': provider,
    });
    final payment = data['payment'];
    if (payment is! Map<String, dynamic>) {
      throw ApiException('Payment was not returned');
    }
    return PaymentRecord.fromJson(payment);
  }

  Future<Map<String, dynamic>> paymentProviders() async {
    final data = await _get('/v1/payments/providers');
    final providers = data['providers'];
    if (providers is Map<String, dynamic>) {
      return providers;
    }
    return {};
  }

  Future<Map<String, dynamic>> paymentCheckoutSession(String paymentId) {
    return _post('/v1/payments/checkout-session', {'payment_id': paymentId});
  }

  Future<PaymentRecord> reconcilePayment(String paymentId) async {
    final data = await _post('/v1/payments/reconcile', {
      'payment_id': paymentId,
    });
    return PaymentRecord.fromJson(data['payment'] as Map<String, dynamic>);
  }

  Future<List<Map<String, dynamic>>> paymentRefunds() async {
    final data = await _get('/v1/payments/refunds');
    return (data['refunds'] as List? ?? [])
        .whereType<Map<String, dynamic>>()
        .toList();
  }

  Future<PaymentRecord> verifyPayment({
    required String paymentId,
    required String status,
    String? providerPaymentId,
    String? providerSignature,
  }) async {
    final data = await _post('/v1/payments/verify', {
      'payment_id': paymentId,
      'status': status,
      if (providerPaymentId != null && providerPaymentId.isNotEmpty)
        'provider_payment_id': providerPaymentId,
      if (providerSignature != null && providerSignature.isNotEmpty)
        'provider_signature': providerSignature,
    });
    final payment = data['payment'];
    if (payment is! Map<String, dynamic>) {
      throw ApiException('Payment was not returned');
    }
    return PaymentRecord.fromJson(payment);
  }

  Future<List<PaymentRecord>> payments() async {
    final data = await _get('/v1/payments');
    final items = data['payments'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(PaymentRecord.fromJson)
        .toList();
  }

  Future<void> requestRefund({
    required String paymentId,
    required String reason,
  }) async {
    await _post('/v1/payments/refund-request', {
      'payment_id': paymentId,
      'reason': reason,
    });
  }

  Future<void> submitReview({
    required String targetType,
    required String targetId,
    required int rating,
    String? review,
  }) async {
    await _post('/v1/reviews', {
      'target_type': targetType,
      'target_id': targetId,
      'rating': rating,
      if (review != null && review.isNotEmpty) 'review': review,
    });
  }

  Future<List<BaylenReview>> reviews({
    required String targetType,
    required String targetId,
  }) async {
    final data = await _get('/v1/reviews', {
      'target_type': targetType,
      'target_id': targetId,
    }, false);
    final items = data['reviews'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(BaylenReview.fromJson)
        .toList();
  }

  Future<List<BaylenNotification>> notifications() async {
    final data = await _get('/v1/notifications');
    final items = data['notifications'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(BaylenNotification.fromJson)
        .toList();
  }

  Future<void> markNotificationRead(String notificationId) async {
    await _post('/v1/notifications/read', {'notification_id': notificationId});
  }

  Future<void> markAllNotificationsRead() async {
    await _post('/v1/notifications/read', {'all': true});
  }

  Future<Map<String, bool>> notificationPreferences() async {
    final data = await _get('/v1/notifications/preferences');
    final prefs = data['preferences'];
    if (prefs is! Map<String, dynamic>) {
      return {};
    }
    return prefs.map((key, value) => MapEntry(key, value == true));
  }

  Future<Map<String, bool>> updateNotificationPreferences(
    Map<String, bool> preferences,
  ) async {
    final data = await _post('/v1/notifications/preferences', preferences);
    final prefs = data['preferences'];
    if (prefs is! Map<String, dynamic>) {
      return {};
    }
    return prefs.map((key, value) => MapEntry(key, value == true));
  }

  Future<List<SalonOutlet>> salonOutlets({
    String? city,
    String? pincode,
    double? lat,
    double? lng,
    String? id,
    String? queryText,
  }) async {
    final query = <String, String>{};
    if (id != null && id.isNotEmpty) query['id'] = id;
    if (city != null && city.isNotEmpty) query['city'] = city;
    if (pincode != null && pincode.isNotEmpty) query['pincode'] = pincode;
    if (lat != null) query['lat'] = lat.toString();
    if (lng != null) query['lng'] = lng.toString();
    if (queryText != null && queryText.isNotEmpty) query['q'] = queryText;
    final data = await _get('/v1/salon/outlets', query, false);
    if (id != null && id.isNotEmpty) {
      final outlet = data['outlet'];
      if (outlet is Map<String, dynamic>) {
        return [SalonOutlet.fromJson(outlet)];
      }
    }
    final items = data['outlets'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonOutlet.fromJson)
        .toList();
  }

  Future<List<SalonLocation>> salonLocations() async {
    final data = await _get('/v1/salon/locations', null, false);
    final items = data['locations'];
    if (items is! List) return [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonLocation.fromJson)
        .where((item) => item.city.isNotEmpty)
        .toList();
  }

  Future<List<SalonPackage>> salonPackages({String? outletId}) async {
    final query = <String, String>{};
    if (outletId != null && outletId.isNotEmpty) {
      query['outlet_id'] = outletId;
    }
    final data = await _get('/v1/salon/packages', query, false);
    final items = data['packages'];
    if (items is! List) return [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonPackage.fromJson)
        .toList();
  }

  Future<List<SalonService>> salonServices({
    String? categoryId,
    String? outletId,
    String? packageId,
    String? serviceType,
    String? gender,
    String? queryText,
    bool isAtHomeOnly = false,
  }) async {
    final query = <String, String>{};
    if (categoryId != null && categoryId.isNotEmpty) {
      query['category_id'] = categoryId;
    }
    if (outletId != null && outletId.isNotEmpty) {
      query['outlet_id'] = outletId;
    }
    if (packageId != null && packageId.isNotEmpty) {
      query['package_id'] = packageId;
    }
    if (serviceType != null && serviceType.isNotEmpty) {
      query['service_type'] = serviceType;
    }
    if (gender != null && gender.isNotEmpty) query['gender'] = gender;
    if (queryText != null && queryText.isNotEmpty) query['q'] = queryText;
    if (isAtHomeOnly) {
      query['is_at_home'] = 'true';
      query['fulfillment_mode'] = 'AT_HOME';
    }
    final data = await _get('/v1/salon/services', query, false);
    final items = data['services'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonService.fromJson)
        .toList();
  }

  Future<List<SalonStaff>> salonStaff({
    required String outletId,
    String? serviceId,
    String? gender,
    String? queryText,
  }) async {
    final query = <String, String>{'outlet_id': outletId};
    if (serviceId != null && serviceId.isNotEmpty) {
      query['service_id'] = serviceId;
    }
    if (gender != null && gender.isNotEmpty) query['gender'] = gender;
    if (queryText != null && queryText.isNotEmpty) query['q'] = queryText;
    final data = await _get('/v1/salon/staff', query, false);
    final items = data['staff'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonStaff.fromJson)
        .toList();
  }

  Future<List<SalonSlot>> salonSlots({
    required String outletId,
    required String slotDate,
    String? staffId,
    String? serviceId,
  }) async {
    final query = <String, String>{
      'outlet_id': outletId,
      'slot_date': slotDate,
    };
    if (staffId != null && staffId.isNotEmpty) {
      query['staff_id'] = staffId;
    }
    if (serviceId != null && serviceId.isNotEmpty) {
      query['service_id'] = serviceId;
    }
    final data = await _get('/v1/slots', query, false);
    final items = data['slots'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonSlot.fromJson)
        .toList();
  }

  SalonAppointment _appointmentFrom(Map<String, dynamic> data) {
    final appointment = data['appointment'];
    if (appointment is Map<String, dynamic>) {
      return SalonAppointment.fromJson(appointment);
    }
    throw ApiException('Appointment was not returned');
  }

  Future<BookAppointmentResult> bookAppointment({
    String? slotId,
    required String serviceId,
    String? outletId,
    String? packageId,
    String? staffId,
    String? gender,
    String? appointmentDate,
    String? startTime,
  }) async {
    final body = <String, dynamic>{'service_id': serviceId};
    if (slotId != null && slotId.isNotEmpty) {
      body['slot_id'] = slotId;
    }
    if (outletId != null && outletId.isNotEmpty) {
      body['outlet_id'] = outletId;
    }
    if (packageId != null && packageId.isNotEmpty) {
      body['package_id'] = packageId;
    }
    if (staffId != null && staffId.isNotEmpty) body['staff_id'] = staffId;
    if (gender != null && gender.isNotEmpty) body['gender'] = gender;
    if (appointmentDate != null && appointmentDate.isNotEmpty) {
      body['appointment_date'] = appointmentDate;
    }
    if (startTime != null && startTime.isNotEmpty) {
      body['start_time'] = startTime;
    }
    final data = await _post('/v1/appointments', body);
    final notification = data['notification'];
    return BookAppointmentResult(
      appointment: _appointmentFrom(data),
      notificationStatus: notification is Map
          ? notification['status']?.toString() ?? ''
          : '',
      notificationReason: notification is Map
          ? notification['reason']?.toString() ?? ''
          : '',
      notificationMode: notification is Map
          ? notification['mode']?.toString() ?? ''
          : '',
    );
  }

  Future<List<SalonAppointment>> appointments() async {
    final data = await _get('/v1/appointments');
    final items = data['appointments'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonAppointment.fromJson)
        .toList();
  }

  Future<List<ServiceJob>> serviceJobs() async {
    final data = await _get('/v1/jobs');
    final items = data['jobs'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(ServiceJob.fromJson)
        .toList();
  }

  Future<ServiceJobTracking> serviceJobTracking(String id) async {
    final data = await _get('/v1/jobs/tracking', {'id': id});
    return ServiceJobTracking.fromJson(data);
  }

  Future<AtHomeServiceability> atHomeServiceability({
    required double latitude,
    required double longitude,
    String? city,
    String? state,
    String? pincode,
  }) async {
    final data = await _post('/v1/at-home-beauty/serviceability', {
      'latitude': latitude,
      'longitude': longitude,
      if (city != null && city.isNotEmpty) 'city': city,
      if (state != null && state.isNotEmpty) 'state': state,
      if (pincode != null && pincode.isNotEmpty) 'pincode': pincode,
    });
    return AtHomeServiceability.fromJson(data);
  }

  Future<List<AtHomeServiceSlot>> atHomeSlots({
    required String outletId,
    required String serviceId,
    required String slotDate,
    String? preferredProviderId,
  }) async {
    final query = <String, String>{
      'outlet_id': outletId,
      'service_id': serviceId,
      'slot_date': slotDate,
    };
    if (preferredProviderId != null && preferredProviderId.isNotEmpty) {
      query['preferred_provider_id'] = preferredProviderId;
    }
    final data = await _get('/v1/at-home-beauty/slots', query, false);
    final items = data['slots'];
    if (items is! List) return [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(AtHomeServiceSlot.fromJson)
        .toList();
  }

  Future<List<HomeServiceProfessional>> atHomeProviders({
    required String outletId,
    required String serviceId,
    String? city,
    String? gender,
  }) async {
    final query = <String, String>{
      'outlet_id': outletId,
      'service_id': serviceId,
    };
    if (city != null && city.isNotEmpty) query['city'] = city;
    if (gender != null && gender.isNotEmpty) query['gender'] = gender;
    final data = await _get('/v1/at-home-beauty/providers', query, false);
    final items = data['providers'];
    if (items is! List) return [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(HomeServiceProfessional.fromJson)
        .toList();
  }

  Future<AtHomeBookingQuote> atHomeQuote(Map<String, dynamic> body) async {
    final data = await _post('/v1/at-home-beauty/quote', body);
    final quote = data['quote'];
    return AtHomeBookingQuote.fromJson(
      quote is Map<String, dynamic> ? quote : data,
    );
  }

  Future<AtHomeBooking> createAtHomeBooking(
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) async {
    final payload = {
      ...body,
      if (idempotencyKey != null && idempotencyKey.isNotEmpty)
        'idempotency_key': idempotencyKey,
    };
    final data = await _post('/v1/at-home-beauty/bookings', payload);
    final booking = data['booking'];
    return AtHomeBooking.fromJson(
      booking is Map<String, dynamic> ? booking : data,
    );
  }

  Future<AtHomeBookingsPage> atHomeBookings({
    MyBookingFilter filter = MyBookingFilter.all,
    int limit = 50,
    int offset = 0,
  }) async {
    final query = <String, String>{'limit': '$limit', 'offset': '$offset'};
    if (filter != MyBookingFilter.all) {
      query['status'] = filter.name;
    }
    final data = await _get('/v1/at-home-beauty/bookings', query);
    final items = data['bookings'];
    final pagination = data['pagination'];
    return AtHomeBookingsPage(
      bookings: items is List
          ? items
                .whereType<Map<String, dynamic>>()
                .map(AtHomeBooking.fromJson)
                .toList()
          : const [],
      total: pagination is Map
          ? (pagination['total'] as num?)?.toInt() ?? 0
          : 0,
      hasMore: pagination is Map ? pagination['has_more'] == true : false,
    );
  }

  Future<AtHomeBooking> confirmAtHomePayment({
    required String bookingId,
    String? paymentId,
  }) async {
    final data = await _post('/v1/at-home-beauty/bookings/confirm-payment', {
      'booking_id': bookingId,
      if (paymentId != null) 'payment_id': paymentId,
    });
    final booking = data['booking'];
    return AtHomeBooking.fromJson(
      booking is Map<String, dynamic> ? booking : data,
    );
  }

  Future<AtHomeBookingResult> completeAtHomeBooking(
    Map<String, dynamic> body, {
    String? idempotencyKey,
  }) async {
    final booking = await createAtHomeBooking(
      body,
      idempotencyKey: idempotencyKey,
    );
    return finalizeAtHomeBooking(booking.id);
  }

  Future<AtHomeBookingResult> finalizeAtHomeBooking(String bookingId) async {
    final data = await _post('/v1/at-home-beauty/bookings/confirm-payment', {
      'booking_id': bookingId,
    });
    final confirmed = data['booking'];
    final notification = data['notification'];
    return AtHomeBookingResult(
      booking: confirmed is Map<String, dynamic>
          ? AtHomeBooking.fromJson(confirmed)
          : throw ApiException('Booking was not returned'),
      notificationStatus: notification is Map
          ? notification['status']?.toString() ?? ''
          : '',
      notificationReason: notification is Map
          ? notification['reason']?.toString() ?? ''
          : '',
    );
  }

  Future<Uint8List?> fetchAtHomeProfessionalPhoto(String bookingId) async {
    final uri = Uri.parse(
      '${AppConfig.apiBaseUrl}/v1/at-home-beauty/bookings/$bookingId/professional-photo',
    );
    try {
      final response = await _client
          .get(uri, headers: _headers())
          .timeout(_timeout);
      if (response.statusCode != 200 || response.bodyBytes.isEmpty) {
        return null;
      }
      return response.bodyBytes;
    } catch (_) {
      return null;
    }
  }

  Future<AtHomeBookingTracking> atHomeBookingTracking(String bookingId) async {
    final data = await _get('/v1/at-home-beauty/bookings/tracking', {
      'id': bookingId,
    });
    return AtHomeBookingTracking.fromJson(data);
  }

  Future<void> respondAtHomeExtraService({
    required String bookingId,
    required bool approve,
  }) async {
    await _post('/v1/at-home-beauty/bookings/extra-services/respond', {
      'booking_id': bookingId,
      'decision': approve ? 'APPROVE' : 'DECLINE',
    });
  }

  Future<void> submitJobReview({
    required String jobId,
    required int rating,
    String? review,
  }) async {
    await _post('/v1/reviews', {
      'reference_type': 'JOB',
      'reference_id': jobId,
      'rating': rating,
      if (review != null && review.isNotEmpty) 'review': review,
    });
  }

  Future<Map<String, dynamic>> search({
    required String query,
    String type = '',
    double? lat,
    double? lng,
  }) async {
    final params = <String, String>{'q': query};
    if (type.isNotEmpty) params['type'] = type;
    if (lat != null) params['lat'] = lat.toString();
    if (lng != null) params['lng'] = lng.toString();
    return _get('/v1/search', params, false);
  }

  Future<List<SalonOutlet>> nearbyOutlets({
    required double lat,
    required double lng,
    String? city,
    int limit = 20,
  }) async {
    final data = await _post('/v1/outlets/nearby', {
      'latitude': lat,
      'longitude': lng,
      if (city != null && city.isNotEmpty) 'city': city,
      'limit': limit,
    });
    final items = data['outlets'];
    if (items is! List) return [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonOutlet.fromJson)
        .toList();
  }

  Future<int> notificationUnreadCount() async {
    try {
      final data = await _get('/v1/notifications/count');
      return (data['count'] as num?)?.toInt() ?? 0;
    } catch (_) {
      return 0;
    }
  }

  Future<List<Map<String, dynamic>>> galleryItems({String? month}) async {
    try {
      final query = <String, String>{};
      if (month != null && month.isNotEmpty) query['month'] = month;
      final data = await _get(
        '/v1/gallery',
        query.isEmpty ? null : query,
        false,
      );
      final items = data['gallery_items'];
      if (items is! List) return [];
      return items.whereType<Map<String, dynamic>>().toList();
    } catch (_) {
      return [];
    }
  }
}
