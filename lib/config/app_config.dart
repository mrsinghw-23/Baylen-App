import 'package:flutter/foundation.dart';

class AppConfig {
  static const appName = 'Baylen';
  static String get apiBaseUrl {
    if (kIsWeb) {
      final origin = Uri.base.origin;
      if (origin.isNotEmpty &&
          !origin.startsWith('null') &&
          origin.contains('catalystserverless.in')) {
        return origin;
      }
    }
    return 'https://baylen-app-60069781151.development.catalystserverless.in';
  }

  static const primaryColor = 0xFF0059E9;
  static const canvasColor = 0xFFDCE7FF;
  static const hostedLoginUrl =
      'https://baylen-app-60069781151.development.catalystserverless.in/__catalyst/auth/login';
  static const googleMapsApiKey =
      ''; // Provide your Google Cloud Maps API key here
}
