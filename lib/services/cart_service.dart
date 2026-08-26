import 'package:flutter/foundation.dart';

import '../auth/auth_service.dart';
import '../models/cart.dart';

class CartService {
  static final CartService instance = CartService._internal();
  CartService._internal();

  final ValueNotifier<Cart?> cartState = ValueNotifier(null);
  final ValueNotifier<bool> isLoading = ValueNotifier(false);
  final ValueNotifier<String?> error = ValueNotifier(null);

  Future<void> fetchCart() async {
    if (!AuthService.instance.isSignedIn) {
      cartState.value = Cart.empty();
      error.value = null;
      isLoading.value = false;
      return;
    }
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.getCart();
      cartState.value = cart;
    } catch (e) {
      error.value = 'Failed to load cart: $e';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> addToCart(
    String productId,
    String variantId,
    int quantity,
  ) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.addToCart(
        productId: productId,
        variantId: variantId,
        quantity: quantity,
      );
      cartState.value = cart;
    } catch (e) {
      error.value = 'Failed to add item: $e';
      rethrow;
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> updateQuantity(String itemId, int newQuantity) async {
    if (newQuantity <= 0) {
      return removeFromCart(itemId);
    }
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.updateCartItemQuantity(
        itemId: itemId,
        quantity: newQuantity,
      );
      cartState.value = cart;
    } catch (e) {
      error.value = 'Failed to update quantity: $e';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> removeFromCart(String itemId) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.removeCartItem(itemId);
      cartState.value = cart;
    } catch (e) {
      error.value = 'Failed to remove item: $e';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> applyCoupon(String code) async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.applyCoupon(code);
      cartState.value = cart;
    } catch (e) {
      error.value = 'Invalid or expired coupon';
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> removeCoupon() async {
    isLoading.value = true;
    error.value = null;
    try {
      final cart = await AuthService.instance.api.removeCoupon();
      cartState.value = cart;
    } catch (e) {
      error.value = 'Failed to remove coupon';
    } finally {
      isLoading.value = false;
    }
  }
}
