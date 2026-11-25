import 'dart:async';

import 'package:flutter/material.dart';

import '../../auth/professional_auth_exit.dart';
import '../../auth/professional_onboarding.dart';
import '../../models/delivery_partner_kyc.dart';
import 'employee_login_screen.dart';
import 'employee_registration_flow.dart';
import 'professional_boot_screen.dart';
import '../delivery_partner/delivery_partner_kyc_screen.dart';
import '../pro/pro_home_shell.dart';

/// Resolves the correct professional destination after app launch or sign-out.
class ProfessionalLaunchGate extends StatefulWidget {
  const ProfessionalLaunchGate({super.key, required this.onExit});

  /// Called when the user leaves the employee flow entirely (back to customer app).
  final VoidCallback onExit;

  @override
  State<ProfessionalLaunchGate> createState() => _ProfessionalLaunchGateState();
}

class _ProfessionalLaunchGateState extends State<ProfessionalLaunchGate> {
  bool _loading = true;
  bool _resolving = false;
  ProfessionalDestination? _destination;
  int _registrationStep = 0;
  DeliveryPartnerKyc? _kyc;
  int _loginGeneration = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_resolve());
  }

  Future<void> _resolve({bool afterAuth = false}) async {
    if (afterAuth && mounted) {
      setState(() => _resolving = true);
    }
    try {
      final resolved = await ProfessionalOnboarding.resolveDestination(
        afterPasswordLogin: afterAuth,
      ).timeout(const Duration(seconds: 25));
      if (!mounted) return;
      setState(() {
        _loading = false;
        _resolving = false;
        _destination = resolved.destination;
        _registrationStep = resolved.registrationStep;
        _kyc = resolved.kyc;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _resolving = false;
        _destination = ProfessionalDestination.login;
      });
    }
  }

  Future<void> _onLoginSuccess() async {
    if (!mounted) return;
    setState(() => _resolving = true);
    await _resolve(afterAuth: true);
  }

  void _returnToLoginScreen() {
    if (!mounted) return;
    setState(() {
      _loginGeneration += 1;
      _destination = ProfessionalDestination.login;
      _registrationStep = 0;
      _kyc = null;
      _loading = false;
      _resolving = false;
    });
  }

  Future<void> _handleSignOut() async {
    await ProfessionalAuthExit.signOutDeliveryPartner();
    _returnToLoginScreen();
  }

  void _handleSignOutFromChild() {
    unawaited(_handleSignOut());
  }

  Widget _buildDestination() {
    switch (_destination) {
      case ProfessionalDestination.login:
        return EmployeeLoginScreen(
          key: ValueKey('employee_login_$_loginGeneration'),
          onAuthenticated: _onLoginSuccess,
        );
      case ProfessionalDestination.registration:
        return EmployeeRegistrationFlow(
          initialPhase: _registrationStep,
          onSignedOut: _handleSignOutFromChild,
          onRegistrationFinished: _resolve,
        );
      case ProfessionalDestination.kyc:
        return DeliveryPartnerKycScreen(
          onFinished: _resolve,
          onSignedOut: _handleSignOutFromChild,
        );
      case ProfessionalDestination.pending:
      case ProfessionalDestination.shell:
      case null:
        return ProHomeShell(
          onSignedOut: _returnToLoginScreen,
          initialKyc: _kyc,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const ProfessionalBootScreen();
    }

    if (_resolving) {
      return const ProfessionalBootScreen(message: 'Signing you in…');
    }

    return _buildDestination();
  }
}
