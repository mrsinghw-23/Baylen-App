import 'package:flutter/material.dart';

import 'config/app_config.dart';
import 'launch/launch_controller.dart';
import 'theme/baylen_theme.dart';

class BaylenApp extends StatelessWidget {
  const BaylenApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: baylenTheme(),
      home: const BaylenLaunchController(),
    );
  }
}
