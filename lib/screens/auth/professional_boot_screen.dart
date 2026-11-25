import 'package:flutter/material.dart';

import '../../launch/launch_assets.dart';
import '../../widgets/pro/pro_components.dart';

/// Branded loading screen while the employee app resolves its destination.
class ProfessionalBootScreen extends StatelessWidget {
  const ProfessionalBootScreen({
    super.key,
    this.message = 'Opening your workspace…',
  });

  final String message;

  static const _assets = BaylenLaunchAssets();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kProCanvas,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Image.asset(
                  _assets.brandLogo,
                  height: 44,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) => const Text(
                    'BAYLEN DE LOUIS',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1.2,
                    ),
                  ),
                ),
                const SizedBox(height: 28),
                const SizedBox(
                  width: 28,
                  height: 28,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.6,
                    color: kProPink,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: kProTextSecondary,
                    fontSize: 14,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
