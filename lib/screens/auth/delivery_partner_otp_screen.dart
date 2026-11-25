import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api/catalyst_api.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/professional_onboarding.dart';
import 'employee_login_screen.dart';

class DeliveryPartnerOtpScreen extends StatefulWidget {
  const DeliveryPartnerOtpScreen({super.key});

  @override
  State<DeliveryPartnerOtpScreen> createState() =>
      _DeliveryPartnerOtpScreenState();
}

class _DeliveryPartnerOtpScreenState extends State<DeliveryPartnerOtpScreen> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  DeliveryPartnerOtpRequestResult? _request;
  String? _error;
  bool _sending = false;
  bool _verifying = false;
  Timer? _resendTimer;
  int _resendRemaining = 0;

  @override
  void dispose() {
    _resendTimer?.cancel();
    _mobile.dispose();
    _otp.dispose();
    super.dispose();
  }

  String get _mobileText => _mobile.text.trim();

  Future<void> _requestOtp() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final request =
          await DeliveryPartnerAuthService.instance.requestOtp(_mobileText);
      if (!request.deliveredViaWhatsapp &&
          request.sentVia.toUpperCase() != 'DEV') {
        throw ApiException(
          'OTP could not be sent on WhatsApp. Please try again.',
        );
      }
      if (!mounted) return;
      setState(() {
        _request = request;
        _sending = false;
      });
      _startResendTimer(request.resendAfterSeconds);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _verifyOtp() async {
    FocusScope.of(context).unfocus();
    final request = _request;
    final otp = _otp.text.trim();
    if (request == null) {
      setState(() => _error = 'Request OTP first');
      return;
    }
    if (!RegExp(r'^\d{6}$').hasMatch(otp)) {
      setState(() => _error = 'Enter the 6 digit OTP');
      return;
    }
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      final verified = await DeliveryPartnerAuthService.instance.verifyOtp(
        mobile: request.phone,
        otp: otp,
        challengeId: request.challengeId,
      );
      if (!mounted) return;
      if (verified.requiresPasswordLogin) {
        setState(() {
          _verifying = false;
          _error = verified.message.isNotEmpty
              ? verified.message
              : 'Registration complete. Sign in with your password.';
        });
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(builder: (_) => const EmployeeLoginScreen()),
        );
        return;
      }
      await DeliveryPartnerAuthService.instance.applyVerifiedSession(verified);
      if (!mounted) return;
      setState(() => _verifying = false);
      await ProfessionalOnboarding.navigateAfterOtp(context);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _error = error.toString();
      });
    }
  }

  void _changeMobile() {
    _resendTimer?.cancel();
    setState(() {
      _request = null;
      _otp.clear();
      _error = null;
      _resendRemaining = 0;
    });
  }

  void _startResendTimer(int seconds) {
    _resendTimer?.cancel();
    setState(() => _resendRemaining = seconds);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_resendRemaining <= 1) {
        timer.cancel();
        setState(() => _resendRemaining = 0);
        return;
      }
      setState(() => _resendRemaining -= 1);
    });
  }

  String _otpDeliveryMessage(DeliveryPartnerOtpRequestResult request) {
    if (request.deliveredViaWhatsapp) {
      return 'OTP sent to WhatsApp on ${request.phone}';
    }
    if (request.sentVia.toUpperCase() == 'DEV' &&
        request.debugOtp != null &&
        request.debugOtp!.isNotEmpty) {
      return 'Development OTP: ${request.debugOtp} (WhatsApp unavailable)';
    }
    return 'OTP sent to ${request.phone}';
  }

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final request = _request;
    return Scaffold(
      appBar: AppBar(title: const Text('Professional sign in')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const SizedBox(height: 24),
                Icon(Icons.delivery_dining_outlined, color: primary, size: 48),
                const SizedBox(height: 18),
                Text(
                  'Partner mobile OTP',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Enter your registered partner mobile number. This OTP flow is separate from customer sign-in.',
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 28),
                Form(
                  key: _formKey,
                  child: TextFormField(
                    controller: _mobile,
                    enabled: request == null && !_sending,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.done,
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(
                        RegExp(r'[0-9+\s\-()]'),
                      ),
                    ],
                    decoration: const InputDecoration(
                      labelText: 'Mobile number',
                      hintText: 'Enter your mobile number',
                      prefixIcon: Icon(Icons.call_outlined),
                    ),
                    validator: (value) {
                      final text = value?.trim() ?? '';
                      final compact = text.replaceAll(RegExp(r'[\s\-()]'), '');
                      if (compact.isEmpty) return 'Mobile number is required';
                      if (!RegExp(r'^(\+\d{8,15}|\d{10})$').hasMatch(compact)) {
                        return 'Enter a valid mobile number';
                      }
                      return null;
                    },
                    onFieldSubmitted: (_) {
                      if (request == null) _requestOtp();
                    },
                  ),
                ),
                const SizedBox(height: 14),
                if (request == null)
                  FilledButton(
                    onPressed: _sending ? null : _requestOtp,
                    child: Text(_sending ? 'Sending OTP...' : 'Send OTP'),
                  )
                else ...[
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          _otpDeliveryMessage(request),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      TextButton(
                        onPressed: _verifying ? null : _changeMobile,
                        child: const Text('Change'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _otp,
                    enabled: !_verifying,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.done,
                    maxLength: 6,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      labelText: 'OTP',
                      hintText: '6-digit code from WhatsApp',
                      counterText: '',
                      prefixIcon: Icon(Icons.lock_outline),
                    ),
                    onSubmitted: (_) => _verifyOtp(),
                  ),
                  const SizedBox(height: 14),
                  FilledButton(
                    onPressed: _verifying ? null : _verifyOtp,
                    child: Text(
                      _verifying ? 'Verifying...' : 'Verify and continue',
                    ),
                  ),
                  TextButton(
                    onPressed: _sending || _verifying || _resendRemaining > 0
                        ? null
                        : _requestOtp,
                    child: Text(
                      _resendRemaining > 0
                          ? 'Resend after ${_resendRemaining}s'
                          : 'Resend OTP',
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!.replaceFirst('Exception: ', ''),
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
