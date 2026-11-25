import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../models/delivery_partner_session.dart';
import 'browser_bridge.dart' as browser;

class DeliveryPartnerAuthService {
  DeliveryPartnerAuthService._();
  static final DeliveryPartnerAuthService instance =
      DeliveryPartnerAuthService._();

  final ValueNotifier<DeliveryPartnerSession?> session =
      ValueNotifier<DeliveryPartnerSession?>(null);

  String? _token;
  late final CatalystApi _api = CatalystApi(tokenProvider: () => _token);

  String? get token => _token;
  bool get isSignedIn => session.value != null && _token != null;
  CatalystApi get api => _api;

  Future<void> restore() async {
    _token = await browser.readDpSession();
    final meta = await browser.readDpSessionMeta();
    if (_token == null || _token!.isEmpty) {
      session.value = null;
      return;
    }
    if (meta != null && meta.isNotEmpty) {
      try {
        final decoded = jsonDecode(meta);
        if (decoded is Map<String, dynamic>) {
          session.value = DeliveryPartnerSession.fromJson(decoded);
          return;
        }
      } catch (_) {}
    }
    session.value = const DeliveryPartnerSession(
      deliveryPartnerId: '',
      phone: '',
      status: 'pending_profile',
    );
  }

  Future<DeliveryPartnerOtpRequestResult> requestOtp(String mobile) {
    return _api.requestDeliveryPartnerOtp(mobile: mobile);
  }

  Future<DeliveryPartnerOtpVerifyResult> verifyOtp({
    required String mobile,
    required String otp,
    String? challengeId,
  }) {
    return _api.verifyDeliveryPartnerOtp(
      mobile: mobile,
      otp: otp,
      challengeId: challengeId,
    );
  }

  Future<void> applyVerifiedSession(DeliveryPartnerOtpVerifyResult verified) async {
    if (verified.requiresPasswordLogin || verified.token.isEmpty || verified.session == null) {
      return;
    }
    _token = verified.token;
    session.value = verified.session;
    await browser.writeDpSession(
      _token,
      metaJson: jsonEncode(verified.session!.toJson()),
    );
    await browser.writeActiveRole('delivery_partner');
  }

  Future<DeliveryPartnerSession> login({
    required String mobile,
    required String password,
  }) async {
    final result = await _api.loginDeliveryPartner(
      mobile: mobile,
      password: password,
    );
    _token = result.token;
    session.value = result.session;
    await browser.writeDpSession(
      _token,
      metaJson: jsonEncode(result.session.toJson()),
    );
    await browser.writeActiveRole('delivery_partner');
    return result.session;
  }

  Future<void> applySessionToken(
    String token, {
    DeliveryPartnerSession? sessionOverride,
  }) async {
    _token = token;
    if (sessionOverride != null) {
      session.value = sessionOverride;
      await browser.writeDpSession(
        _token,
        metaJson: jsonEncode(sessionOverride.toJson()),
      );
      return;
    }
    await browser.writeDpSession(_token);
  }

  Future<void> refreshSessionMeta({
    String? registrationPhase,
    bool? registrationComplete,
    String? firstName,
    String? lastName,
    String? outletId,
    String? status,
  }) async {
    final current = session.value;
    if (current == null || _token == null) return;
    final updated = DeliveryPartnerSession(
      deliveryPartnerId: current.deliveryPartnerId,
      phone: current.phone,
      status: status ?? current.status,
      outletId: outletId ?? current.outletId,
      firstName: firstName ?? current.firstName,
      lastName: lastName ?? current.lastName,
      registrationPhase: registrationPhase ?? current.registrationPhase,
      registrationComplete: registrationComplete ?? current.registrationComplete,
    );
    session.value = updated;
    await browser.writeDpSession(
      _token,
      metaJson: jsonEncode(updated.toJson()),
    );
  }

  Future<void> signOut() async {
    _token = null;
    session.value = null;
    await browser.writeDpSession(null);
    final role = await browser.readActiveRole();
    if (role == 'delivery_partner') {
      await browser.writeActiveRole(null);
    }
  }
}
