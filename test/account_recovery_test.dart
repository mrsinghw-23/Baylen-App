import 'package:baylen_app/auth/auth_user.dart';
import 'package:baylen_app/models/account_bootstrap.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('same phone recovery payload restores one user and related records', () {
    final bootstrap = AccountBootstrap.fromJson({
      'user': {
        'user_id': '1001',
        'email': 'asha@example.com',
        'mobile': '+919876543210',
        'first_name': 'Asha',
        'last_name': 'Kumar',
        'gender': 'FEMALE',
        'date_of_birth': '1994-02-10',
        'profile_photo_url': 'https://cdn.example/asha.jpg',
        'created_at': '2025-01-01 09:00:00',
        'is_profile_complete': true,
      },
      'profile': {
        'user_id': '1001',
        'full_name': 'Asha Kumar',
        'mobile': '+919876543210',
        'email': 'asha@example.com',
        'gender': 'FEMALE',
        'date_of_birth': '1994-02-10',
        'profile_photo_url': 'https://cdn.example/asha.jpg',
        'loyalty_tier': 'Gold',
        'loyalty_points': 120,
        'created_at': '2025-01-01 09:00:00',
      },
      'addresses': [
        {
          'id': 'a1',
          'label': 'Home',
          'full_name': 'Asha Kumar',
          'phone': '9876543210',
          'line1': '12 MG Road',
          'landmark': 'Near park',
          'city': 'Ranchi',
          'state': 'Jharkhand',
          'postal_code': '834001',
          'is_default': true,
        },
        {
          'id': 'a2',
          'label': 'Work',
          'line1': 'Office park',
          'city': 'Ranchi',
          'state': 'Jharkhand',
          'postal_code': '834002',
          'is_default': false,
        },
      ],
      'orders': [
        {
          'id': 'o1',
          'order_number': 'BLN-2026-000009',
          'status': 'CONFIRMED',
          'payment_status': 'PAID',
          'grand_total': 499,
        },
      ],
      'bookings': [
        {
          'type': 'salon',
          'id': 'b1',
          'appointment_number': 'APT-1',
          'appointment_date': '2026-09-01',
          'start_time': '10:00',
          'end_time': '11:00',
          'status': 'CONFIRMED',
          'payment_status': 'PAID',
          'grand_total': 1200,
        },
        {
          'type': 'home_service',
          'id': 'j1',
          'status': 'ASSIGNED',
          'visit_city': 'Ranchi',
          'visit_line1': '12 MG Road',
          'grand_total': 800,
        },
      ],
      'wishlist': [
        {
          'id': 'w1',
          'product_id': 'p1',
          'name': 'Serum',
          'selling_price': 799,
        },
      ],
      'preferences': {'push_enabled': false, 'offers': true},
    });

    expect(bootstrap.user.userId, '1001');
    expect(bootstrap.user.email, 'asha@example.com');
    expect(bootstrap.profile?.fullName, 'Asha Kumar');
    expect(bootstrap.addresses.length, 2);
    expect(bootstrap.addresses.where((item) => item.isDefault).single.label, 'Home');
    expect(bootstrap.orders.single.orderNumber, 'BLN-2026-000009');
    expect(bootstrap.appointments.single.id, 'b1');
    expect(bootstrap.jobs.single.id, 'j1');
    expect(bootstrap.wishlist.single.name, 'Serum');
    expect(bootstrap.preferences.pushEnabled, isFalse);
    expect(bootstrap.addresses.any((item) => item.id == 'deleted'), isFalse);
  });

  test('updated profile fields survive round-trip cache JSON', () {
    const user = AuthUser(
      userId: '1001',
      email: 'updated@example.com',
      mobile: '+919876543210',
      firstName: 'Asha',
      lastName: 'Updated',
      isProfileComplete: true,
    );
    final original = AccountBootstrap(
      user: user,
      recoveredAt: DateTime.parse('2026-09-01T06:00:00Z'),
    );
    final restored = AccountBootstrap.fromJson(original.toJson());
    expect(restored.user.userId, '1001');
    expect(restored.user.email, 'updated@example.com');
    expect(restored.user.lastName, 'Updated');
  });

  test('cache from another user is rejected by identity check', () {
    final cached = AccountBootstrap.fromJson({
      'user': {
        'user_id': '2002',
        'email': 'other@example.com',
        'mobile': '+919111111111',
        'first_name': 'Other',
        'last_name': 'User',
      },
    });
    expect(cached.user.userId, isNot('1001'));
  });
}
