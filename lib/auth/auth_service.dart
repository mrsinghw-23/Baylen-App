import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../config/app_config.dart';
import '../models/account_bootstrap.dart';
import 'auth_user.dart';
import 'browser_bridge.dart' as browser;
import 'guest_session.dart';

class AuthService {
  AuthService._();
  static final AuthService instance = AuthService._();

  final ValueNotifier<AuthUser?> user = ValueNotifier<AuthUser?>(null);
  final ValueNotifier<AccountBootstrap?> bootstrap =
      ValueNotifier<AccountBootstrap?>(null);
  final ValueNotifier<bool> isOffline = ValueNotifier<bool>(false);

  String? _token;
  late final CatalystApi _api = CatalystApi(tokenProvider: () => _token);

  String? get token => _token;
  bool get isSignedIn => user.value != null;
  CatalystApi get api => _api;

  void noteLiveDataReceived() {
    if (isOffline.value) {
      isOffline.value = false;
    }
  }

  Future<void> restore() async {
    await _captureTokenFromUrl();
    _token ??= await browser.readSession();
    if (_token == null || _token!.isEmpty) {
      user.value = null;
      bootstrap.value = null;
      isOffline.value = false;
      return;
    }
    await browser.writeSession(_token);
    try {
      final refreshed = await _api.refreshSession();
      _token = refreshed.token;
      await browser.writeSession(_token);
      user.value = refreshed.user;
      await recoverAccount();
    } on ApiException catch (error) {
      if (error.isUnauthorized) {
        await signOut();
        return;
      }
      await _restoreFromCache();
    } catch (_) {
      await _restoreFromCache();
    }
  }

  Future<void> recoverAccount() async {
    final signedIn = user.value;
    if (signedIn == null || _token == null || _token!.isEmpty) {
      return;
    }
    try {
      final recovered = await _api.recoverAccount();
      bootstrap.value = recovered;
      if (recovered.user.userId.isNotEmpty) {
        user.value = recovered.user;
      }
      isOffline.value = false;
      await browser.writeAccountCache(
        recovered.user.userId.isNotEmpty
            ? recovered.user.userId
            : signedIn.userId,
        jsonEncode(recovered.toJson()),
      );
    } on ApiException catch (error) {
      if (error.isUnauthorized) {
        rethrow;
      }
      await _restoreFromCache();
    } catch (_) {
      await _restoreFromCache();
    }
  }

  Future<void> _restoreFromCache() async {
    final signedIn = user.value;
    final userId = signedIn?.userId ?? '';
    if (userId.isEmpty) {
      isOffline.value = _token != null && _token!.isNotEmpty;
      return;
    }
    final cached = await browser.readAccountCache(userId);
    if (cached == null || cached.isEmpty) {
      isOffline.value = true;
      return;
    }
    try {
      final decoded = jsonDecode(cached);
      if (decoded is! Map<String, dynamic>) {
        isOffline.value = true;
        return;
      }
      final recovered = AccountBootstrap.fromJson(decoded, fromCache: true);
      if (recovered.user.userId.isNotEmpty && recovered.user.userId != userId) {
        isOffline.value = true;
        return;
      }
      bootstrap.value = recovered.copyWith(fromCache: true);
      isOffline.value = true;
    } catch (_) {
      isOffline.value = true;
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
    await browser.writeActiveRole('customer');
    user.value = verified.user;
    await recoverAccount();
    return user.value ?? verified.user;
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
    await browser.writeActiveRole('customer');
    user.value = result.user;
    await recoverAccount();
    return user.value ?? result.user;
  }

  Future<void> signOut() async {
    try {
      if (_token != null && _token!.isNotEmpty) {
        await _api.revokeSession();
      }
    } catch (_) {}
    final userId = user.value?.userId;
    _token = null;
    user.value = null;
    bootstrap.value = null;
    isOffline.value = false;
    await browser.writeSession(null);
    final role = await browser.readActiveRole();
    if (role == 'customer') {
      await browser.writeActiveRole(null);
    }
    if (userId != null && userId.isNotEmpty) {
      await browser.clearAccountCache(userId);
    }
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
