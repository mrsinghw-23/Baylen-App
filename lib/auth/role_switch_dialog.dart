import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../screens/auth/role_picker_screen.dart';

Future<void> showRoleSwitchDialog(
  BuildContext context, {
  required ApiException error,
}) async {
  if (!context.mounted) return;
  final signedInAsCustomer =
      error.message.toLowerCase().contains('customer account');
  final message = signedInAsCustomer
      ? "You're signed in as a customer. Switch to Professional to continue."
      : "You're signed in as a professional. Switch to Customer to continue.";

  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return AlertDialog(
        title: const Text('Wrong account type'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(dialogContext).pop();
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RolePickerScreen(message: message),
                ),
              );
            },
            child: const Text('Switch role'),
          ),
        ],
      );
    },
  );
}
