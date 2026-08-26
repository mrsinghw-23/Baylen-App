import 'package:shared_preferences/shared_preferences.dart';

const _key = 'baylen_session';

Future<String?> readSession() async {
  final prefs = await SharedPreferences.getInstance();
  _memory ??= prefs.getString(_key);
  return _memory;
}

Future<void> writeSession(String? token) async {
  final prefs = await SharedPreferences.getInstance();
  _memory = token;
  if (token == null || token.isEmpty) {
    await prefs.remove(_key);
  } else {
    await prefs.setString(_key, token);
  }
}

String? _memory;

void openExternalUrl(String url) {
  throw UnsupportedError('Open this URL in a browser: $url');
}

String currentOrigin() => 'http://localhost';
