import 'package:flutter/material.dart';



import '../models/delivery_partner_kyc.dart';

import 'professional_auth_exit.dart';
import '../screens/auth/employee_login_screen.dart';

import '../screens/auth/employee_registration_flow.dart';

import '../screens/auth/professional_launch_gate.dart';

import '../screens/delivery_partner/delivery_partner_kyc_screen.dart';

import '../screens/pro/pro_home_shell.dart';

import 'delivery_partner_auth_service.dart';



enum ProfessionalDestination {

  login,

  registration,

  kyc,

  pending,

  shell,

}



class ProfessionalDestinationResult {

  const ProfessionalDestinationResult({

    required this.destination,

    this.registrationStep = 0,

    this.kyc,

  });



  final ProfessionalDestination destination;

  final int registrationStep;

  final DeliveryPartnerKyc? kyc;

}



/// Routes a professional to the correct post-OTP destination based on registration/KYC.

class ProfessionalOnboarding {

  ProfessionalOnboarding._();



  static Future<ProfessionalDestinationResult> resolveDestination({
    bool afterPasswordLogin = false,
  }) async {
    if (!DeliveryPartnerAuthService.instance.isSignedIn) {
      return const ProfessionalDestinationResult(
        destination: ProfessionalDestination.login,
      );
    }

    final session = DeliveryPartnerAuthService.instance.session.value;
    final registrationStep = registrationStepFromPhase(session?.registrationPhase ?? '');

    if (afterPasswordLogin && session?.registrationComplete == true) {
      try {
        final kyc = await DeliveryPartnerAuthService.instance.api.fetchDeliveryPartnerKyc();
        if (kyc.operational) {
          return ProfessionalDestinationResult(
            destination: ProfessionalDestination.shell,
            kyc: kyc,
          );
        }
        return ProfessionalDestinationResult(
          destination: ProfessionalDestination.kyc,
          kyc: kyc,
        );
      } catch (_) {
        return const ProfessionalDestinationResult(
          destination: ProfessionalDestination.shell,
        );
      }
    }

    try {
      final status = await DeliveryPartnerAuthService.instance.api
          .fetchEmployeeRegistrationStatus();
      if (!status.registrationComplete) {
        return ProfessionalDestinationResult(
          destination: ProfessionalDestination.registration,
          registrationStep: registrationStepFromPhase(status.registrationPhase),
        );
      }
    } catch (_) {
      if (session?.needsRegistration == true) {
        return ProfessionalDestinationResult(
          destination: ProfessionalDestination.registration,
          registrationStep: registrationStep,
        );
      }
    }

    DeliveryPartnerKyc kyc;
    try {
      kyc = await DeliveryPartnerAuthService.instance.api.fetchDeliveryPartnerKyc();
    } catch (_) {
      return const ProfessionalDestinationResult(
        destination: ProfessionalDestination.kyc,
      );
    }

    if (kyc.operational) {
      return ProfessionalDestinationResult(
        destination: ProfessionalDestination.shell,
        kyc: kyc,
      );
    }

    return ProfessionalDestinationResult(
      destination: ProfessionalDestination.kyc,
      kyc: kyc,
    );
  }



  static Future<void> navigateAfterOtp(BuildContext context) async {
    if (!context.mounted) return;
    await Navigator.of(context).pushAndRemoveUntil<void>(
      MaterialPageRoute<void>(
        builder: (gateContext) => ProfessionalLaunchGate(
          onExit: () => ProfessionalAuthExit.navigateToCustomerHome(gateContext),
        ),
      ),
      (route) => false,
    );
  }



  static Future<void> navigateAfterKycSubmit(BuildContext context) async {
    if (!context.mounted) return;
    await _openShell(context);
  }



  static int registrationStepFromPhase(String phase) {
    switch (phase) {
      case 'profile_complete':
      case 'photos_complete':
        return 1;
      case 'password_set':
        return 2;
      case 'registered':
        return 3;
      default:
        return 0;
    }
  }



  static Future<void> _openDestination(

    BuildContext context,

    ProfessionalDestinationResult resolved,

  ) {

    switch (resolved.destination) {

      case ProfessionalDestination.login:

        return Navigator.of(context).pushAndRemoveUntil(

          MaterialPageRoute<void>(builder: (_) => const EmployeeLoginScreen()),

          (route) => false,

        );

      case ProfessionalDestination.registration:

        return Navigator.of(context).pushAndRemoveUntil(

          MaterialPageRoute<void>(

            builder: (_) => EmployeeRegistrationFlow(

              initialPhase: resolved.registrationStep,

            ),

          ),

          (route) => false,

        );

      case ProfessionalDestination.kyc:

        return Navigator.of(context).pushAndRemoveUntil(

          MaterialPageRoute<void>(builder: (_) => const DeliveryPartnerKycScreen()),

          (route) => false,

        );

      case ProfessionalDestination.pending:

        return _openShell(context);

      case ProfessionalDestination.shell:

        return _openShell(context);

    }

  }



  static Future<void> _openShell(BuildContext context) {
    return Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => const ProHomeShell(),
      ),
      (route) => false,
    );
  }



}

