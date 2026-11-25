import 'package:flutter/material.dart';

import '../auth/auth_service.dart';

class OfflineAccountBanner extends StatelessWidget {
  const OfflineAccountBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: AuthService.instance.isOffline,
      builder: (context, offline, _) {
        if (!offline) {
          return const SizedBox.shrink();
        }
        return Material(
          color: const Color(0xFF8A5A00),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Text(
              'You are offline. Showing the last account data saved on this device. It will refresh from Baylen when you are back online.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Colors.white,
              ),
            ),
          ),
        );
      },
    );
  }
}
