import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/delivery_partner_kyc.dart';
import 'package:baylen_app/models/professional_job.dart';
import 'package:baylen_app/repositories/mock_professional_job_repository.dart';
import 'package:baylen_app/repositories/professional_job_repository.dart';
import 'package:baylen_app/repositories/professional_job_scope.dart';
import 'package:baylen_app/screens/auth/delivery_partner_otp_screen.dart';
import 'package:baylen_app/screens/auth/professional_pending_screen.dart';
import 'package:baylen_app/screens/auth/role_picker_screen.dart';
import 'package:baylen_app/screens/pro/pro_flow_screens.dart';
import 'package:baylen_app/screens/pro/pro_home_shell.dart';
import 'package:baylen_app/screens/pro/pro_job_flow.dart';
import 'package:baylen_app/screens/pro/pro_map_tab_screen.dart';
import 'package:baylen_app/screens/pro/pro_orders_tab_screen.dart';
import 'package:baylen_app/state/professional_dashboard_store.dart';

Widget _wrap(Widget child, {ProfessionalJobRepository? repository}) {
  return MaterialApp(
    home: ProfessionalJobScope(
      repository: repository ?? MockProfessionalJobRepository(),
      child: child,
    ),
  );
}

void main() {
  group('Professional onboarding screens', () {
    testWidgets('role picker shows customer and professional options', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: RolePickerScreen()));
      await tester.pumpAndSettle();
      expect(find.text('User'), findsOneWidget);
      expect(find.text('Employee'), findsOneWidget);
      expect(find.text('Continue as User →'), findsOneWidget);
    });

    testWidgets('professional OTP screen has no password field', (tester) async {
      await tester.pumpWidget(const MaterialApp(home: DeliveryPartnerOtpScreen()));
      expect(find.text('Partner mobile OTP'), findsOneWidget);
      expect(find.text('Password'), findsNothing);
      expect(find.text('Forgot Password?'), findsNothing);
    });

    testWidgets('pending verification screen renders status', (tester) async {
      const kyc = DeliveryPartnerKyc(
        partnerStatus: 'kyc_submitted',
        partnerStatusLabel: 'Under review',
        editable: false,
        canSubmit: false,
        operational: false,
      );
      await tester.pumpWidget(
        const MaterialApp(home: ProfessionalPendingScreen(kyc: kyc)),
      );
      expect(find.text('Under review'), findsWidgets);
      expect(find.text('Refresh status'), findsOneWidget);
    });
  });

  group('Professional shell and tabs', () {
    testWidgets('pro home shell renders Home Orders Service Profile', (tester) async {
      await tester.pumpWidget(
        _wrap(
          ProHomeShell(
            repository: MockProfessionalJobRepository(),
            skipKycCheck: true,
            enableLiveRefresh: false,
            initialKyc: const DeliveryPartnerKyc(
              partnerStatus: 'active',
              partnerStatusLabel: 'Active',
              editable: false,
              canSubmit: false,
              operational: true,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final nav = find.byType(NavigationBar);
      expect(find.descendant(of: nav, matching: find.text('Home')), findsOneWidget);
      expect(find.descendant(of: nav, matching: find.text('Orders')), findsOneWidget);
      expect(find.descendant(of: nav, matching: find.text('Service')), findsOneWidget);
      expect(find.descendant(of: nav, matching: find.text('Profile')), findsOneWidget);
      expect(find.descendant(of: nav, matching: find.text('Map')), findsNothing);
      expect(find.text('Neha Sharma'), findsOneWidget);
      expect(find.text('Available for jobs'), findsOneWidget);
    });
  });

  group('Professional dashboard store', () {
    test('accept updates cached lists without a full reload wait', () async {
      final store = ProfessionalDashboardStore(MockProfessionalJobRepository());
      await store.ensureLoaded();
      expect(store.offeredHome, isNotEmpty);
      final offer = store.offeredHome.first;
      final result = await store.acceptHomeService(offer);
      expect(result.success, isTrue);
      expect(store.offeredHome.any((item) => item.id == offer.id), isFalse);
      expect(store.activeHome.any((item) => item.id == offer.id), isTrue);
      expect(store.dashboard!.isBusy, isTrue);
      expect(store.dashboard!.homeServiceOffersCount, 0);
    });

    test('dispose is safe after bootstrap', () async {
      final store = ProfessionalDashboardStore(MockProfessionalJobRepository());
      await store.ensureLoaded();
      store.dispose();
      expect(() => store.ensureEarnings(), returnsNormally);
    });
  });

  group('Professional job screens (mock repository)', () {
    testWidgets('orders tab shows integration empty state', (tester) async {
      await tester.pumpWidget(_wrap(const ProOrdersTabScreen()));
      await tester.pumpAndSettle();
      expect(find.text('No Product Orders Yet'), findsOneWidget);
      expect(find.text('Connect Order Integration'), findsOneWidget);
      expect(find.text('Quick Commerce Order'), findsNothing);
    });

    testWidgets('services tab lists mocked home service offers', (tester) async {
      await tester.pumpWidget(_wrap(const ProServicesTabScreen(enabled: true)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Upcoming (1)'));
      await tester.pumpAndSettle();
      expect(find.text('Hair Spa at home'), findsOneWidget);
    });

    testWidgets('product detail screen renders pickup and deliver cards', (tester) async {
      await tester.pumpWidget(
        _wrap(const ProProductDetailScreen(jobId: 'pj-del-001')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Accept order'), findsOneWidget);
      expect(find.text('Pickup from'), findsOneWidget);
      expect(find.text('Deliver to'), findsOneWidget);
    });

    testWidgets('home service detail screen renders accept CTA', (tester) async {
      await tester.pumpWidget(
        _wrap(const ProHomeServiceDetailScreen(jobId: 'pj-hs-001')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Accept service'), findsOneWidget);
    });

    testWidgets('service prep checklist screen renders', (tester) async {
      await tester.pumpWidget(_wrap(const ProServicePrepScreen(jobId: 'pj-hs-001')));
      await tester.pumpAndSettle();
      expect(find.text('Before you start'), findsOneWidget);
      expect(find.text("I'm ready — start travel"), findsOneWidget);
    });

    testWidgets('arrival OTP screen renders 6-digit entry', (tester) async {
      await tester.pumpWidget(_wrap(const ProArrivalOtpScreen(jobId: 'pj-hs-001')));
      expect(find.text('You have arrived'), findsOneWidget);
      expect(find.text('Verify & continue'), findsOneWidget);
    });

    testWidgets('service in progress shows progress ring', (tester) async {
      await tester.pumpWidget(
        _wrap(const ProServiceInProgressScreen(jobId: 'pj-hs-001')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Service in progress'), findsOneWidget);
      expect(find.text('Complete service'), findsOneWidget);
    });

    testWidgets('earnings tab lists mock history', (tester) async {
      await tester.pumpWidget(_wrap(const ProEarningsTabScreen()));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(ProEarningsTabScreen), findsOneWidget);
      expect(find.textContaining('Today'), findsWidgets);
    });

    testWidgets('map tab shows permission empty state when locked', (tester) async {
      await tester.pumpWidget(_wrap(const ProMapTabScreen(enabled: false)));
      await tester.pump();
      expect(find.text('Map unlocks after KYC approval'), findsOneWidget);
    });
  });

  group('Professional navigation flows', () {
    testWidgets('product delivery flow navigates detail → navigation → completion', (tester) async {
      final repository = MockProfessionalJobRepository();
      await tester.pumpWidget(
        MaterialApp(
          home: ProfessionalJobScope(
            repository: repository,
            child: Builder(
              builder: (context) {
                return ElevatedButton(
                  onPressed: () => ProJobFlow.openOfferDetail(
                    context,
                    const ProfessionalJobOffer(
                      id: 'pj-del-001',
                      type: ProfessionalJobType.productDelivery,
                      title: 'Quick Commerce Order',
                      subtitle: 'test',
                      amount: 100,
                      distanceKm: 1,
                      etaMinutes: 10,
                    ),
                  ),
                  child: const Text('open'),
                );
              },
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      expect(find.byType(ProProductDetailScreen), findsOneWidget);
      await tester.tap(find.text('Accept order'));
      await tester.pumpAndSettle();
      expect(find.byType(ProProductNavigationScreen), findsOneWidget);
    });
  });
}
