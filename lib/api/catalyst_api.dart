import 'dart:convert';

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

class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  bool get isUnauthorized =>
      statusCode == 401 ||
      message.toLowerCase().contains('sign in required') ||
      message.toLowerCase().contains('not signed in');

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

class BookAppointmentResult {
  const BookAppointmentResult({
    required this.appointment,
    this.notificationStatus = '',
    this.notificationReason = '',
  });

  final SalonAppointment appointment;
  final String notificationStatus;
  final String notificationReason;

  bool get whatsappSent => notificationStatus.toUpperCase() == 'SENT';
}

class CatalystApi {
  CatalystApi({http.Client? client, this._tokenProvider})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String? Function()? _tokenProvider;
  static const _timeout = Duration(seconds: 20);
  static const _authTimeout = Duration(seconds: 35);

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
      final message = decoded['error']?.toString() ?? 'Request failed';
      final details = decoded['details'];
      if (details is String && details.isNotEmpty) {
        throw ApiException(
          '$message $details',
          statusCode: response.statusCode,
        );
      }
      if (details is Map && details['gateway'] != null) {
        throw ApiException(
          '$message ${details['gateway']}',
          statusCode: response.statusCode,
        );
      }
      throw ApiException(message, statusCode: response.statusCode);
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

  Future<ShopHome> shopHome() async {
    final data = await _get('/v1/catalog/shop-home', null, false);
    return ShopHome.fromJson(data);
  }

  Future<List<CatalogProduct>> shopSearch(String query) async {
    final data = await _get('/v1/catalog/search', {'q': query}, false);
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
    int limit = 24,
    double? minPrice,
    double? maxPrice,
    int? minDiscount,
    double? minRating,
    bool? inStock,
    String? gender,
    String? ageGroup,
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
    return _get('/v1/catalog/products', query, false);
  }

  Future<CatalogProductDetail> productDetail(String id) async {
    final data = await _get('/v1/catalog/product', {'id': id}, false);
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

  Future<List<SalonOutlet>> nearbyOutlets({
    double? lat,
    double? lng,
    String? city,
  }) async {
    final params = <String, String>{'limit': '100'};
    if (city != null && city.isNotEmpty) {
      params['city'] = city;
    }
    if (lat != null && lng != null) {
      params['lat'] = lat.toString();
      params['lng'] = lng.toString();
      params['latitude'] = lat.toString();
      params['longitude'] = lng.toString();
    }
    final data = await _get('/v1/salon/outlets', params, false);
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
