import 'package:baylen_app/api/catalyst_api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('OtpRequestResult marks WhatsApp delivery from sent_via', () {
    final whatsapp = OtpRequestResult.fromJson({
      'challenge_id': '123',
      'mobile': '+919876543210',
      'expires_in_seconds': 300,
      'resend_after_seconds': 45,
      'sent_via': 'WHATSAPP',
    });
    expect(whatsapp.deliveredViaWhatsapp, isTrue);
    expect(whatsapp.debugOtp, isNull);
  });

  test('OtpRequestResult exposes development fallback OTP', () {
    final dev = OtpRequestResult.fromJson({
      'challenge_id': '123',
      'mobile': '+919876543210',
      'expires_in_seconds': 300,
      'resend_after_seconds': 45,
      'sent_via': 'DEV',
      'debug_otp': '123456',
    });
    expect(dev.deliveredViaWhatsapp, isFalse);
    expect(dev.sentVia, 'DEV');
    expect(dev.debugOtp, '123456');
  });
}
