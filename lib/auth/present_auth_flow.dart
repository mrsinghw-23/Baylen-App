import 'package:flutter/material.dart';

import 'auth_service.dart';
import '../screens/auth/role_picker_screen.dart';

Future<bool> presentAuthFlow(
  BuildContext context, {
  String? message,
}) async {
  if (AuthService.instance.isSignedIn) {
    return true;
  }
  final result = await Navigator.of(context).push<AuthRoleResult>(
    MaterialPageRoute<AuthRoleResult>(
      builder: (_) => RolePickerScreen(message: message),
    ),
  );
  return result == AuthRoleResult.customerSignedIn;
}
