import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/guest_session.dart';
import '../auth/auth_user.dart';
import '../config/app_config.dart';
import '../models/account.dart';
import '../models/cart.dart';
import '../models/catalog.dart';
import '../models/launch_content.dart';
import '../models/notification_item.dart';
import '../models/order.dart';
import '../models/review.dart';
import '../models/salon.dart';
import '../models/service_job.dart';

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class OtpRequestResult {
  const OtpRequestResult({
    required this.challengeId,
    required this.mobile,
    required this.expiresInSeconds,
    required this.resendAfterSeconds,
    this.debugOtp,
  });

  final String challengeId;
  final String mobile;
  final int expiresInSeconds;
  final int resendAfterSeconds;
  final String? debugOtp;

  factory OtpRequestResult.fromJson(Map<String, dynamic> json) {
    return OtpRequestResult(
      challengeId: json['challenge_id']?.toString() ?? '',
      mobile: json['mobile']?.toString() ?? '',
      expiresInSeconds: (json['expires_in_seconds'] as num?)?.toInt() ?? 300,
      resendAfterSeconds: (json['resend_after_seconds'] as num?)?.toInt() ?? 45,
      debugOtp: json['debug_otp']?.toString(),
    );
  }
}

class CatalystApi {
  CatalystApi({http.Client? client, this._tokenProvider})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String? Function()? _tokenProvider;
  static const _timeout = Duration(seconds: 12);

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
    Map<String, dynamic> body,
  ) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final http.Response response;
    try {
      response = await _client
          .post(
            uri,
            headers: {..._headers(), 'Content-Type': 'application/json'},
            body: jsonEncode(body),
          )
          .timeout(_timeout);
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
      throw ApiException(decoded['error']?.toString() ?? 'Request failed');
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
    final data = await _post('/v1/auth/otp/request', {'mobile': mobile});
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
    });
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
    });
    final token = data['token']?.toString() ?? '';
    final user = data['user'];
    if (token.isEmpty || user is! Map<String, dynamic>) {
      throw ApiException('Profile completion failed');
    }
    return (token: token, user: AuthUser.fromJson(user));
  }

  Future<Map<String, dynamic>> homeFeed() async {
    return _get('/v1/home', null, false);
  }

  Future<LaunchContent> launchContent() async {
    final data = await _get('/v1/launch', null, false);
    return LaunchContent.fromJson(data);
  }

  Future<UserProfile> profile() async {
    final data = await _get('/v1/profile');
    final profile = data['profile'];
    if (profile is! Map<String, dynamic>) {
      throw ApiException('Profile was not returned');
    }
    return UserProfile.fromJson(profile);
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
    bool isDefault = false,
  }) async {
    final data = await _post('/v1/addresses', {
      'label': label,
      'line1': line1,
      'city': city,
      'state': state,
      'postal_code': postalCode,
      'is_default': isDefault,
      if (fullName != null && fullName.isNotEmpty) 'full_name': fullName,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (line2 != null && line2.isNotEmpty) 'line2': line2,
    });
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

  Future<List<CatalogProduct>> products({
    String? categoryId,
    String? brandId,
    String? search,
    String? sort,
  }) async {
    final query = <String, String>{};
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

  Future<CatalogProductDetail> productDetail(String id) async {
    final data = await _get('/v1/catalog/product', {'id': id}, false);
    return CatalogProductDetail.fromJson(data);
  }

  Cart _cartFrom(Map<String, dynamic> data) {
    final cart = data['cart'];
    if (cart is Map<String, dynamic>) {
      return Cart.fromJson(cart);
    }
    return Cart.empty();
  }

  Future<Cart> getCart() async {
    return _cartFrom(await _get('/v1/cart'));
  }

  Future<Cart> addToCart({
    required String productId,
    String? variantId,
    int quantity = 1,
  }) async {
    return _cartFrom(
      await _post('/v1/cart/items', {
        'product_id': productId,
        if (variantId != null && variantId.isNotEmpty) 'variant_id': variantId,
        'quantity': quantity,
      }),
    );
  }

  Future<Cart> updateCartItemQuantity({
    required String itemId,
    required int quantity,
  }) async {
    return _cartFrom(
      await _post('/v1/cart/item/quantity', {
        'item_id': itemId,
        'quantity': quantity,
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

  Future<bool> toggleWishlist(String productId) async {
    final data = await _post('/v1/wishlist/toggle', {'product_id': productId});
    return data['wished'] == true;
  }

  ShopOrder _orderFrom(Map<String, dynamic> data) {
    final order = data['order'];
    if (order is Map<String, dynamic>) {
      return ShopOrder.fromJson(order);
    }
    throw ApiException('Order was not returned');
  }

  Future<ShopOrder> checkout({
    String? shippingName,
    String? shippingPhone,
    String? shippingLine1,
    String? shippingCity,
    String? shippingState,
    String? shippingPostalCode,
    String? addressId,
  }) async {
    return _orderFrom(
      await _post('/v1/checkout', {
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
      }),
    );
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
    return _orderFrom(await _get('/v1/orders', {'id': id}));
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

  Future<List<SalonOutlet>> salonOutlets() async {
    final data = await _get('/v1/salon/outlets', null, false);
    final items = data['outlets'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(SalonOutlet.fromJson)
        .toList();
  }

  Future<List<SalonService>> salonServices({String? categoryId}) async {
    final query = <String, String>{};
    if (categoryId != null && categoryId.isNotEmpty) {
      query['category_id'] = categoryId;
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
  }) async {
    final query = <String, String>{'outlet_id': outletId};
    if (serviceId != null && serviceId.isNotEmpty) {
      query['service_id'] = serviceId;
    }
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

  Future<SalonAppointment> bookAppointment({
    required String slotId,
    required String serviceId,
  }) async {
    return _appointmentFrom(
      await _post('/v1/appointments', {
        'slot_id': slotId,
        'service_id': serviceId,
      }),
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

  Future<List<SalonOutlet>> nearbyOutlets({double? lat, double? lng}) async {
    if (lat == null || lng == null) {
      final data = await _get('/v1/outlets/nearby', null, false);
      final items = data['outlets'];
      if (items is! List) return [];
      return items
          .whereType<Map<String, dynamic>>()
          .map(SalonOutlet.fromJson)
          .toList();
    }
    final data = await _get('/v1/outlets/nearby', {
      'lat': lat.toString(),
      'lng': lng.toString(),
      'latitude': lat.toString(),
      'longitude': lng.toString(),
      'limit': '100',
    }, false);
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
