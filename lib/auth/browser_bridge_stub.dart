String? readSession() => _memory;
Future<void> writeSession(String? token) async {
  _memory = token;
}

String? _memory;

void openExternalUrl(String url) {
  throw UnsupportedError('Open this URL in a browser: $url');
}

String currentOrigin() => 'http://localhost';
