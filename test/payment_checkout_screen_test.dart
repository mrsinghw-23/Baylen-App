import 'package:baylen_app/models/account.dart';
import 'package:baylen_app/screens/payment_checkout_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('payment API failure remains readable on mobile and desktop', (
    tester,
  ) async {
    // Widget tests block HTTP. A failed preparation must never become payment success.
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.view.devicePixelRatio = 1;
    for (final size in [const Size(320, 640), const Size(1280, 800)]) {
      tester.view.physicalSize = size;
      await tester.pumpWidget(
        MaterialApp(
          key: ValueKey(size),
          home: PaymentCheckoutScreen(
            referenceType: 'JOB',
            referenceId: '123',
            payment: PaymentRecord.fromJson({
              'id': '456',
              'amount': 199.49,
              'status': 'PENDING',
              'can_resume': true,
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('INR 199.49'), findsOneWidget);
      expect(find.textContaining('Payment could not be prepared'), findsOneWidget);
      expect(find.text('Check payment status'), findsOneWidget);
      expect(find.text('Pay securely'), findsNothing);
      expect(tester.takeException(), isNull);
    }
  });
}
