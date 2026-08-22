import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../config/app_config.dart';
import 'auth_user.dart';
import 'browser_bridge.dart' as browser;

class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  final ValueNotifier<AuthUser?> user = ValueNotifier<AuthUser?>(null);

  String? _token;
  late final CatalystApi _api = CatalystApi(tokenProvider: () => _token);

  String? get token => _token;
  bool get isSignedIn => user.value != null;
  CatalystApi get api => _api;

  Future<void> restore() async {
    await _captureTokenFromUrl();
    _token ??= browser.readSession();
    if (_token == null || _token!.isEmpty) {
      user.value = null;
      return;
    }
    await browser.writeSession(_token);
    try {
      user.value = await _api.currentUser();
    } catch (_) {
      await signOut();
    }
  }

  Future<void> startHostedLogin() async {
    final start = Uri.parse('${AppConfig.apiBaseUrl}/v1/auth/start').replace(
      queryParameters: {'app_origin': browser.currentOrigin()},
    );
    browser.openExternalUrl(start.toString());
  }

  Future<void> openHostedLoginPage() async {
    browser.openExternalUrl(AppConfig.hostedLoginUrl);
  }

  Future<void> signOut() async {
    _token = null;
    user.value = null;
    await browser.writeSession(null);
  }

  Future<void> _captureTokenFromUrl() async {
    final uri = Uri.base;
    final fragment = uri.fragment;
    String? token;
    if (fragment.startsWith('auth=')) {
      token = Uri.decodeComponent(fragment.substring(5));
    } else if (uri.queryParameters['token'] != null) {
      token = uri.queryParameters['token'];
    }
    if (token == null || token.isEmpty) {
      return;
    }
    _token = token;
    await browser.writeSession(token);
  }
}
