import 'dart:convert';

import 'package:http/http.dart' as http;

import '../auth/auth_user.dart';
import '../config/app_config.dart';
import '../models/cart.dart';
import '../models/catalog.dart';
import '../models/order.dart';

class ApiException implements Exception {
  ApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class CatalystApi {
  CatalystApi({http.Client? client, this._tokenProvider})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String? Function()? _tokenProvider;
  static const _timeout = Duration(seconds: 12);

  Map<String, String> _headers() {
    final headers = <String, String>{'Accept': 'application/json'};
    final token = _tokenProvider?.call();
    if (token != null && token.isNotEmpty) {
      headers['X-Baylen-Token'] = token;
    }
    return headers;
  }

  Future<Map<String, dynamic>> _get(String path, [Map<String, String>? query]) async {
    var uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: query);
    }
    final response = await _client.get(uri, headers: _headers()).timeout(_timeout);
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final response = await _client
        .post(
          uri,
          headers: {..._headers(), 'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(_timeout);
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

  Future<List<CatalogCategory>> categories({String type = 'PRODUCT'}) async {
    final data = await _get('/v1/catalog/categories', {'type': type});
    final items = data['categories'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogCategory.fromJson)
        .toList();
  }

  Future<List<CatalogProduct>> products({String? categoryId}) async {
    final query = <String, String>{};
    if (categoryId != null && categoryId.isNotEmpty) {
      query['category_id'] = categoryId;
    }
    final data = await _get('/v1/catalog/products', query);
    final items = data['products'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(CatalogProduct.fromJson)
        .toList();
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

  Future<Cart> addToCart({required String productId, int quantity = 1}) async {
    return _cartFrom(
      await _post('/v1/cart/items', {
        'product_id': productId,
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
  }) async {
    return _orderFrom(
      await _post('/v1/checkout', {
        if (shippingName != null && shippingName.isNotEmpty) 'shipping_name': shippingName,
        if (shippingPhone != null && shippingPhone.isNotEmpty) 'shipping_phone': shippingPhone,
        if (shippingLine1 != null && shippingLine1.isNotEmpty) 'shipping_line1': shippingLine1,
        if (shippingCity != null && shippingCity.isNotEmpty) 'shipping_city': shippingCity,
        if (shippingState != null && shippingState.isNotEmpty) 'shipping_state': shippingState,
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
    return items.whereType<Map<String, dynamic>>().map(ShopOrder.fromJson).toList();
  }

  Future<ShopOrder> order(String id) async {
    return _orderFrom(await _get('/v1/orders', {'id': id}));
  }
}
