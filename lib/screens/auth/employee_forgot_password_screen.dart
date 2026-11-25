import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../auth/delivery_partner_auth_service.dart';

class EmployeeForgotPasswordScreen extends StatefulWidget {
  const EmployeeForgotPasswordScreen({super.key, this.initialMobile = ''});

  final String initialMobile;

  @override
  State<EmployeeForgotPasswordScreen> createState() =>
      _EmployeeForgotPasswordScreenState();
}

class _EmployeeForgotPasswordScreenState extends State<EmployeeForgotPasswordScreen> {
  final _mobile = TextEditingController();
  final _otp = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;
  String? _error;
  String _challengeId = '';
  int _resendSeconds = 0;
  Timer? _resendTimer;

  @override
  void initState() {
    super.initState();
    _mobile.text = widget.initialMobile;
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    _mobile.dispose();
    _otp.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  void _startResendTimer(int seconds) {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = seconds);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      if (_resendSeconds <= 1) {
        timer.cancel();
        setState(() => _resendSeconds = 0);
        return;
      }
      setState(() => _resendSeconds -= 1);
    });
  }

  Future<void> _requestOtp() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await DeliveryPartnerAuthService.instance.api
          .requestDeliveryPartnerPasswordReset(mobile: _mobile.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _otpSent = true;
        _challengeId = result.challengeId;
        if (result.phone.isNotEmpty) {
          _mobile.text = result.phone;
        }
      });
      if (result.challengeId.isEmpty) {
        setState(() {
          _error =
              'OTP sent, but session id was missing. Tap Resend OTP before entering the code.';
        });
      }
      _startResendTimer(result.resendAfterSeconds > 0 ? result.resendAfterSeconds : 45);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _resetPassword() async {
    if (_challengeId.isEmpty) {
      setState(() {
        _error = 'Session expired. Tap Resend OTP and try again.';
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await DeliveryPartnerAuthService.instance.api.resetDeliveryPartnerPassword(
        mobile: _mobile.text.trim(),
        otp: _otp.text.trim(),
        password: _password.text,
        confirmPassword: _confirmPassword.text,
        challengeId: _challengeId,
      );
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Password reset successful'),
          content: const Text('You can now sign in with your new password.'),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Continue to login'),
            ),
          ],
        ),
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset Password')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Text(
              'Enter your registered mobile number. We will send a one-time password to verify your identity.',
              style: TextStyle(height: 1.4),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              enabled: !_otpSent && !_busy,
              decoration: const InputDecoration(labelText: 'Mobile number'),
            ),
            const SizedBox(height: 12),
            if (!_otpSent)
              FilledButton(
                onPressed: _busy ? null : _requestOtp,
                child: Text(_busy ? 'Sending OTP…' : 'Send OTP'),
              )
            else ...[
              TextField(
                controller: _otp,
                keyboardType: TextInputType.number,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(labelText: '6-digit OTP'),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _busy || _resendSeconds > 0 ? null : _requestOtp,
                  child: Text(
                    _resendSeconds > 0 ? 'Resend OTP in ${_resendSeconds}s' : 'Resend OTP',
                  ),
                ),
              ),
              TextField(
                controller: _password,
                obscureText: _obscurePassword,
                decoration: InputDecoration(
                  labelText: 'New password',
                  prefixIcon: const Icon(Icons.lock_outline),
                  helperText: 'At least 8 characters with a letter, number, and special character',
                  suffixIcon: IconButton(
                    tooltip: _obscurePassword ? 'Show password' : 'Hide password',
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _confirmPassword,
                obscureText: _obscureConfirm,
                decoration: InputDecoration(
                  labelText: 'Confirm password',
                  prefixIcon: const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    tooltip: _obscureConfirm ? 'Show password' : 'Hide password',
                    onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                    icon: Icon(
                      _obscureConfirm
                          ? Icons.visibility_outlined
                          : Icons.visibility_off_outlined,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _resetPassword,
                child: Text(_busy ? 'Updating password…' : 'Reset password'),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}
