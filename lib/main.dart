import 'package:flutter/material.dart';

import 'app.dart';
import 'auth/auth_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AuthService.instance.restore();
  runApp(const BaylenApp());
}
