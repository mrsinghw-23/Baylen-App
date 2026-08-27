import 'package:flutter/material.dart';

import 'auth_service.dart';
import '../screens/login_screen.dart';
import '../services/cart_service.dart';

class AuthGate {
  static Future<bool> ensureSignedIn(
    BuildContext context, {
    String? message,
  }) async {
    if (AuthService.instance.isSignedIn) {
      return true;
    }
    if (message != null && message.isNotEmpty && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
    final signedIn = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
    );
    if (signedIn == true) {
      await CartService.instance.fetchCart();
      return true;
    }
    return false;
  }
}
