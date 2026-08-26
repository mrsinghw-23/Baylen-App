import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../config/app_config.dart';
import 'auth_user.dart';
import 'browser_bridge.dart' as browser;
import 'guest_session.dart';

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
    _token ??= await browser.readSession();
    if (_token == null || _token!.isEmpty) {
      user.value = null;
      return;
    }
    await browser.writeSession(_token);
    try {
      final refreshed = await _api.refreshSession();
      _token = refreshed.token;
      await browser.writeSession(_token);
      user.value = refreshed.user;
    } catch (_) {
      await signOut();
    }
  }

  Future<void> startHostedLogin() async {
    final start = Uri.parse('${AppConfig.apiBaseUrl}/v1/auth/start')
        .replace(queryParameters: {'app_origin': browser.currentOrigin()});
    browser.openExternalUrl(start.toString());
  }

  Future<void> openHostedLoginPage() async {
    browser.openExternalUrl(AppConfig.hostedLoginUrl);
  }

  Future<OtpRequestResult> requestOtp(String mobile) {
    return _api.requestOtp(mobile: mobile);
  }

  Future<AuthUser> verifyOtp({
    required String mobile,
    required String otp,
    String? challengeId,
  }) async {
    final verified = await _api.verifyOtp(
      mobile: mobile,
      otp: otp,
      challengeId: challengeId,
      guestSessionId: await GuestSession.instance.id(),
    );
    _token = verified.token;
    await browser.writeSession(_token);
    user.value = verified.user;
    return verified.user;
  }

  Future<AuthUser> completeProfile({
    required String firstName,
    required String lastName,
    required String email,
    String? gender,
    String? dateOfBirth,
  }) async {
    final result = await _api.completeProfile(
      firstName: firstName,
      lastName: lastName,
      email: email,
      gender: gender,
      dateOfBirth: dateOfBirth,
    );
    _token = result.token;
    await browser.writeSession(_token);
    user.value = result.user;
    return result.user;
  }

  Future<void> signOut() async {
    try {
      if (_token != null && _token!.isNotEmpty) {
        await _api.revokeSession();
      }
    } catch (_) {}
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
