import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/delivery_partner_kyc.dart';
import 'package:baylen_app/screens/delivery_partner/delivery_partner_kyc_screen.dart';

void main() {
  testWidgets('KYC screen shows loading shell', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: DeliveryPartnerKycScreen()),
    );

    expect(find.text('Professional KYC'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  test('rejected KYC model surfaces resubmission state', () {
    final kyc = DeliveryPartnerKyc.fromJson({
      'partner_status': 'kyc_rejected',
      'partner_status_label': 'Rejected',
      'editable': true,
      'can_submit': true,
      'operational': false,
      'rejection_reason': 'Invalid PAN image',
    });
    expect(kyc.isRejected, isTrue);
    expect(kyc.canSubmit, isTrue);
  });

  test('approved KYC model marks operational access', () {
    final kyc = DeliveryPartnerKyc.fromJson({
      'partner_status': 'active',
      'partner_status_label': 'Active',
      'editable': false,
      'can_submit': false,
      'operational': true,
    });
    expect(kyc.isApproved, isTrue);
    expect(kyc.operational, isTrue);
  });
}
