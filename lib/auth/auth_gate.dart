import 'package:flutter/material.dart';

import 'auth_service.dart';
import '../auth/professional_onboarding.dart';
import '../screens/auth/role_picker_screen.dart';
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
    final result = await Navigator.of(context).push<AuthRoleResult>(
      MaterialPageRoute<AuthRoleResult>(
        builder: (_) => RolePickerScreen(message: message),
      ),
    );
    if (result == AuthRoleResult.customerSignedIn) {
      await CartService.instance.fetchCart();
      return true;
    }
    if (result == AuthRoleResult.deliveryPartnerSignedIn && context.mounted) {
      await ProfessionalOnboarding.navigateAfterOtp(context);
    }
    return false;
  }
}
