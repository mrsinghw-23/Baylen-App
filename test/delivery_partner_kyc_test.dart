import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/delivery_partner_kyc.dart';

void main() {
  group('DeliveryPartnerKyc', () {
    test('parses rejected KYC with reason', () {
      final kyc = DeliveryPartnerKyc.fromJson({
        'partner_status': 'kyc_rejected',
        'partner_status_label': 'Rejected',
        'editable': true,
        'can_submit': true,
        'operational': false,
        'rejection_reason': 'Blurry identity document',
      });
      expect(kyc.isRejected, isTrue);
      expect(kyc.rejectionReason, 'Blurry identity document');
      expect(kyc.needsKyc, isTrue);
    });

    test('submitted KYC is not editable in UI flags', () {
      final kyc = DeliveryPartnerKyc.fromJson({
        'partner_status': 'kyc_submitted',
        'partner_status_label': 'KYC Submitted',
        'editable': false,
        'can_submit': false,
        'operational': false,
      });
      expect(kyc.isSubmitted, isTrue);
      expect(kyc.needsKyc, isFalse);
    });

    test('approved operational KYC unlocks features', () {
      final kyc = DeliveryPartnerKyc.fromJson({
        'partner_status': 'active',
        'partner_status_label': 'Active',
        'editable': false,
        'can_submit': false,
        'operational': true,
      });
      expect(kyc.isApproved, isTrue);
      expect(kyc.needsKyc, isFalse);
    });

    test('payload excludes empty sensitive fields', () {
      const kyc = DeliveryPartnerKyc(
        partnerStatus: 'pending_kyc',
        partnerStatusLabel: 'Draft',
        editable: true,
        canSubmit: true,
        operational: false,
        firstName: 'Asha',
        lastName: 'Singh',
        dateOfBirth: '1995-06-15',
        addressLine1: '12 MG Road',
        city: 'Ranchi',
        state: 'Jharkhand',
        postalCode: '834001',
        ifsc: 'HDFC0001234',
        accountHolderName: 'Asha Singh',
      );
      final payload = kyc.toPayload();
      expect(payload.containsKey('pan_number'), isFalse);
      expect(payload['first_name'], 'Asha');
    });
  });
}
