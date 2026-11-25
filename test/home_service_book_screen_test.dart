import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/salon.dart';
import 'package:baylen_app/screens/home_service_book_screen.dart';
import 'package:baylen_app/screens/home_service_service_detail_screen.dart';

void main() {
  testWidgets('HomeServiceBookScreen lays out choose professional step', (tester) async {
    const outlet = SalonOutlet(
      id: '1',
      name: 'Baylen Salon',
      addressLine1: 'Main Road',
      city: 'Ranchi',
      phone: '9999999999',
      openingTime: '09:00',
      closingTime: '20:00',
    );
    const service = SalonService(
      id: '10',
      name: 'Haircut',
      description: 'Home haircut',
      durationMinutes: 45,
      mrp: 500,
      sellingPrice: 399,
      currency: 'INR',
      imageUrl: '',
      serviceType: 'Hair',
      prices: [
        SalonServicePrice(gender: 'MALE', mrp: 500, sellingPrice: 399, durationMinutes: 45),
        SalonServicePrice(gender: 'FEMALE', mrp: 600, sellingPrice: 499, durationMinutes: 45),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: HomeServiceBookScreen(
          outlet: outlet,
          service: service,
          initialGender: 'MALE',
        ),
      ),
    );
    await tester.pump();

    expect(find.text('Choose professional'), findsOneWidget);
    expect(find.text('Haircut'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);

    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('gender selection screen lays out Male and Female prices', (tester) async {
    const outlet = SalonOutlet(
      id: '1',
      name: 'Baylen De Louis - Lalpur',
      addressLine1: 'Main Road',
      city: 'Ranchi',
      phone: '9999999999',
      openingTime: '09:00',
      closingTime: '20:00',
    );
    const service = SalonService(
      id: '10',
      name: 'Hair Spa',
      description: 'Relaxing spa',
      durationMinutes: 60,
      mrp: 999,
      sellingPrice: 999,
      currency: 'INR',
      imageUrl: '',
      serviceType: 'Hair',
      prices: [
        SalonServicePrice(gender: 'MALE', mrp: 999, sellingPrice: 999, durationMinutes: 60),
        SalonServicePrice(gender: 'FEMALE', mrp: 1199, sellingPrice: 1199, durationMinutes: 60),
      ],
    );

    await tester.pumpWidget(
      const MaterialApp(
        home: HomeServiceServiceDetailScreen(outlet: outlet, service: service),
      ),
    );
    await tester.pump();

    expect(find.text('Select gender'), findsOneWidget);
    expect(find.text('Male'), findsOneWidget);
    expect(find.text('Female'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
