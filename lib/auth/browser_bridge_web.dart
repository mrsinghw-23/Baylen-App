import 'package:web/web.dart' as web;

const _key = 'baylen_session';

Future<String?> readSession() async => web.window.localStorage.getItem(_key);

Future<void> writeSession(String? token) async {
  if (token == null || token.isEmpty) {
    web.window.localStorage.removeItem(_key);
  } else {
    web.window.localStorage.setItem(_key, token);
  }
}

void openExternalUrl(String url) {
  web.window.location.href = url;
}

String currentOrigin() => web.window.location.origin;
