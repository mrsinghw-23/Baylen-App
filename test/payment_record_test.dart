import 'package:baylen_app/models/account.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('payment success requires backend fulfillment confirmation', () {
    for (final status in [
      'PENDING',
      'FAILED',
      'REFUND_REQUESTED',
      'REFUNDED',
    ]) {
      expect(
        PaymentRecord.fromJson({'status': status, 'fulfillment_ready': true})
            .isConfirmed,
        isFalse,
      );
    }
    expect(PaymentRecord.fromJson({'status': 'SUCCESS'}).isConfirmed, isFalse);
    expect(
      PaymentRecord.fromJson({'status': 'SUCCESS', 'fulfillment_ready': true})
          .isConfirmed,
      isTrue,
    );
  });

  test('missing permissions and non-boolean flags fail closed', () {
    final payment = PaymentRecord.fromJson({
      'status': 'SUCCESS',
      'fulfillment_ready': 'true',
      'can_resume': 'true',
    });
    expect(payment.isConfirmed, isFalse);
    expect(payment.canResume, isFalse);
    expect(payment.canRequestRefund, isFalse);
  });

  test('payment amount keeps paise in its display', () {
    final payment = PaymentRecord.fromJson({
      'amount': 199.49,
      'currency': 'INR',
    });
    expect(payment.amountLabel, 'INR 199.49');
  });
}
