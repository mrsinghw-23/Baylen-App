import 'package:flutter/foundation.dart';

import '../auth/auth_service.dart';
import '../models/cart.dart';
import '../services/delivery_location_service.dart';

class CartService {
  static final CartService instance = CartService._internal();
  CartService._internal() {
    AuthService.instance.user.addListener(() {
      fetchCart();
    });
  }

  final ValueNotifier<Cart?> cartState = ValueNotifier(null);
  final ValueNotifier<bool> isLoading = ValueNotifier(false);
  final ValueNotifier<String?> error = ValueNotifier(null);

  Cart get cart => cartState.value ?? Cart.empty();

  int get itemCount => cart.itemCount;

  Future<Cart> fetchCart({bool rethrowOnError = false}) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.getCart();
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      cartState.value ??= Cart.empty();
      if (rethrowOnError) {
        rethrow;
      }
      return cartState.value ?? Cart.empty();
    } finally {
      isLoading.value = false;
    }
  }

  Future<Cart> addToCart(
    String productId,
    String variantId,
    int quantity, {
    double? latitude,
    double? longitude,
  }) async {
    isLoading.value = true;
    error.value = null;
    try {
      final coords = await _resolveCoords(latitude: latitude, longitude: longitude);
      final cart = await AuthService.instance.api.addToCart(
        productId: productId,
        variantId: variantId,
        quantity: quantity,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<Cart> updateQuantity(
    String itemId,
    int newQuantity, {
    double? latitude,
    double? longitude,
  }) async {
    if (newQuantity <= 0) {
      return removeFromCart(itemId);
    }
    isLoading.value = true;
    error.value = null;
    try {
      final coords = await _resolveCoords(latitude: latitude, longitude: longitude);
      final cart = await AuthService.instance.api.updateCartItemQuantity(
        itemId: itemId,
        quantity: newQuantity,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<Cart> removeFromCart(String itemId) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.removeCartItem(itemId);
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<Cart> applyCoupon(String code) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.applyCoupon(code);
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<Cart> removeCoupon() async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.removeCoupon();
      cartState.value = cart;
      return cart;
    } catch (e) {
      error.value = e.toString();
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<DeliveryCoordinates> _resolveCoords({
    double? latitude,
    double? longitude,
  }) async {
    if (latitude != null && longitude != null) {
      return DeliveryCoordinates(latitude: latitude, longitude: longitude);
    }
    return DeliveryLocationService.instance.resolve();
  }
}
