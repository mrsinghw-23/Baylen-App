import 'package:flutter/material.dart';

import '../screens/auth/employee_login_screen.dart';
import '../services/professional_tracking_service.dart';
import '../shell/main_shell.dart';
import 'delivery_partner_auth_service.dart';

/// Signs out delivery partner / employee sessions and returns to login or customer home.
class ProfessionalAuthExit {
  ProfessionalAuthExit._();

  static Future<void> signOutDeliveryPartner() async {
    await ProfessionalTrackingService.instance.stopAvailabilityTracking();
    await ProfessionalTrackingService.instance.stopTracking();
    if (DeliveryPartnerAuthService.instance.isSignedIn) {
      try {
        await DeliveryPartnerAuthService.instance.api.setPartnerOnlineStatus(
          onlineStatus: 'OFFLINE',
        );
      } catch (_) {}
    }
    await DeliveryPartnerAuthService.instance.signOut();
  }

  /// Employee login screen — used after sign out from the employee app.
  static void navigateToEmployeeLogin(BuildContext context, {Key? loginKey}) {
    if (!context.mounted) return;
    Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => EmployeeLoginScreen(key: loginKey),
      ),
      (_) => false,
    );
  }

  /// Guest/normal customer app — clears professional stack.
  static void navigateToCustomerHome(BuildContext context) {
    if (!context.mounted) return;
    Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(
      MaterialPageRoute<void>(builder: (_) => const MainShell()),
      (_) => false,
    );
  }

  static Future<void> signOutAndReturnToLogin(BuildContext context, {Key? loginKey}) async {
    await signOutDeliveryPartner();
    if (!context.mounted) return;
    navigateToEmployeeLogin(context, loginKey: loginKey);
  }

  static Future<void> signOutAndReturnToCustomerHome(BuildContext context) async {
    await signOutDeliveryPartner();
    if (!context.mounted) return;
    navigateToCustomerHome(context);
  }
}
