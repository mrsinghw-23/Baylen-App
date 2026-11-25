import 'package:baylen_app/models/account.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Address maps landmark and keeps a reviewable summary', () {
    final address = Address.fromJson({
      'id': '1',
      'label': 'Home',
      'full_name': 'Asha',
      'phone': '9876543210',
      'line1': 'Main Road',
      'line2': 'Block A',
      'landmark': 'Near GPO',
      'city': 'Ranchi',
      'state': 'Jharkhand',
      'postal_code': '834001',
      'country': 'India',
      'is_default': true,
      'latitude': 23.34,
      'longitude': 85.31,
    });
    expect(address.landmark, 'Near GPO');
    expect(address.summary, contains('Near GPO'));
    expect(address.summary, contains('834001'));
    expect(address.isDefault, isTrue);
  });
}
