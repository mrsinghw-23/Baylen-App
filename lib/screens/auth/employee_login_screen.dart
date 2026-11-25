import 'package:flutter/material.dart';

import '../../auth/professional_auth_exit.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../widgets/pro/pro_components.dart';
import 'delivery_partner_otp_screen.dart';
import 'employee_forgot_password_screen.dart';
import 'professional_launch_gate.dart';

class EmployeeLoginScreen extends StatefulWidget {
  const EmployeeLoginScreen({super.key, this.onAuthenticated});

  final VoidCallback? onAuthenticated;

  @override
  State<EmployeeLoginScreen> createState() => _EmployeeLoginScreenState();
}

class _EmployeeLoginScreenState extends State<EmployeeLoginScreen> {
  final _mobile = TextEditingController();
  final _password = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _rememberMe = false;
  bool _obscure = true;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _mobile.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    FocusScope.of(context).unfocus();
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await DeliveryPartnerAuthService.instance.login(
        mobile: _mobile.text.trim(),
        password: _password.text,
      );
      if (!mounted) return;
      setState(() => _submitting = false);
      if (widget.onAuthenticated != null) {
        widget.onAuthenticated!();
        return;
      }
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (gateContext) => ProfessionalLaunchGate(
            onExit: () => ProfessionalAuthExit.navigateToCustomerHome(gateContext),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  void _openRegister() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const DeliveryPartnerOtpScreen()),
    );
  }

  void _openForgotPassword() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => EmployeeForgotPasswordScreen(
          initialMobile: _mobile.text.trim(),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Scaffold(
      backgroundColor: kProCanvas,
      appBar: AppBar(
        backgroundColor: kProCanvas,
        title: const Text('Employee Login'),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final compact = constraints.maxHeight < 640;
            final padding = compact ? 16.0 : 24.0;
            return Align(
              alignment: compact ? Alignment.topCenter : Alignment.center,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 460),
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(padding, compact ? 8 : 16, padding, padding),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Icon(Icons.badge_outlined, color: primary, size: compact ? 40 : 48),
                      SizedBox(height: compact ? 12 : 18),
                      Text(
                        'Employee Login',
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w900,
                          fontSize: compact ? 22 : null,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: compact ? 6 : 8),
                      Text(
                        'Login with your registered mobile number and password.',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          fontSize: compact ? 13 : 14,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: compact ? 20 : 28),
                      Form(
                        key: _formKey,
                        child: Column(
                          children: [
                            TextFormField(
                              controller: _mobile,
                              keyboardType: TextInputType.phone,
                              decoration: const InputDecoration(
                                labelText: 'Mobile number',
                                prefixIcon: Icon(Icons.phone_outlined),
                              ),
                              validator: (value) {
                                final text = value?.trim() ?? '';
                                if (text.isEmpty) return 'Mobile number is required';
                                return null;
                              },
                            ),
                            SizedBox(height: compact ? 10 : 14),
                            TextFormField(
                              controller: _password,
                              obscureText: _obscure,
                              decoration: InputDecoration(
                                labelText: 'Password',
                                prefixIcon: const Icon(Icons.lock_outline),
                                suffixIcon: IconButton(
                                  onPressed: () => setState(() => _obscure = !_obscure),
                                  tooltip: _obscure ? 'Show password' : 'Hide password',
                                  icon: Icon(
                                    _obscure
                                        ? Icons.visibility_outlined
                                        : Icons.visibility_off_outlined,
                                  ),
                                ),
                              ),
                              validator: (value) {
                                if ((value ?? '').isEmpty) return 'Password is required';
                                return null;
                              },
                            ),
                          ],
                        ),
                      ),
                      Row(
                        children: [
                          Checkbox(
                            value: _rememberMe,
                            onChanged: _submitting
                                ? null
                                : (value) => setState(() => _rememberMe = value ?? false),
                          ),
                          const Expanded(
                            child: Text('Remember me', overflow: TextOverflow.ellipsis),
                          ),
                          TextButton(
                            onPressed: _submitting ? null : _openForgotPassword,
                            child: const Text('Forgot Password?'),
                          ),
                        ],
                      ),
                      SizedBox(height: compact ? 4 : 8),
                      FilledButton(
                        onPressed: _submitting ? null : _login,
                        style: FilledButton.styleFrom(
                          minimumSize: Size.fromHeight(compact ? 46 : 50),
                        ),
                        child: Text(_submitting ? 'Signing in…' : 'Login'),
                      ),
                      SizedBox(height: compact ? 12 : 16),
                      const Row(
                        children: [
                          Expanded(child: Divider()),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 12),
                            child: Text('OR'),
                          ),
                          Expanded(child: Divider()),
                        ],
                      ),
                      SizedBox(height: compact ? 12 : 16),
                      OutlinedButton(
                        onPressed: _submitting ? null : _openRegister,
                        style: OutlinedButton.styleFrom(
                          minimumSize: Size.fromHeight(compact ? 46 : 50),
                        ),
                        child: const Text('Register as New Employee'),
                      ),
                      if (_error != null) ...[
                        const SizedBox(height: 16),
                        Text(
                          _error!,
                          style: TextStyle(color: Theme.of(context).colorScheme.error),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
