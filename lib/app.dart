import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'launch/launch_controller.dart';
import 'screens/shop_brand_page.dart';
import 'theme/baylen_theme.dart';

class BaylenApp extends StatelessWidget {
  const BaylenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: baylenTheme(),
      builder: (context, child) => child ?? const SizedBox.shrink(),
      home: const BaylenLaunchController(),
      onGenerateRoute: (settings) {
        final uri = Uri.tryParse(settings.name ?? '');
        if (uri != null &&
            uri.pathSegments.length == 2 &&
            uri.pathSegments.first == 'brand' &&
            uri.pathSegments[1].isNotEmpty) {
          return MaterialPageRoute<void>(
            settings: settings,
            builder: (_) => ShopBrandPage(slug: uri.pathSegments[1]),
          );
        }
        return null;
      },
    );
  }
}
