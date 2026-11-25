import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import 'profile_setup_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  OtpRequestResult? _request;
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
      final request = await AuthService.instance.requestOtp(_mobileText);
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
      final user = await AuthService.instance.verifyOtp(
        mobile: request.mobile,
        otp: otp,
        challengeId: request.challengeId,
      );
      if (!mounted) return;
      if (!user.isProfileComplete) {
        final registered = await Navigator.of(context).push<bool>(
          MaterialPageRoute(
            builder: (_) => ProfileSetupScreen(
              mobile: request.mobile,
              initialFirstName: user.firstName,
              initialLastName: user.lastName,
              initialEmail: user.email,
            ),
          ),
        );
        if (!mounted) return;
        Navigator.of(context).pop(registered == true);
      } else {
        Navigator.of(context).pop(true);
      }
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

  String _otpDeliveryMessage(OtpRequestResult request) {
    if (request.deliveredViaWhatsapp) {
      return 'OTP sent to WhatsApp on ${request.mobile}';
    }
    if (request.sentVia.toUpperCase() == 'DEV' &&
        request.debugOtp != null &&
        request.debugOtp!.isNotEmpty) {
      return 'Development OTP: ${request.debugOtp} (WhatsApp unavailable)';
    }
    return 'OTP sent to ${request.mobile}';
  }

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final request = _request;
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: ListView(
              padding: const EdgeInsets.all(24),
              children: [
                const SizedBox(height: 24),
                Icon(Icons.phone_iphone_outlined, color: primary, size: 48),
                const SizedBox(height: 18),
                Text(
                  'Continue with mobile OTP',
                  style: Theme.of(context).textTheme.headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  'Enter your mobile number. We will send a 6-digit OTP to WhatsApp on that number.',
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
                  _AuthError(message: _error!),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthError extends StatelessWidget {
  const _AuthError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.error),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline, color: Theme.of(context).colorScheme.error),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message.replaceFirst('Exception: ', ''),
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ),
        ],
      ),
    );
  }
}
