import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/auth/auth_service.dart';
import 'package:baylen_app/launch/baylen_splash_screen.dart';
import 'package:baylen_app/launch/launch_assets.dart';
import 'package:baylen_app/models/cart.dart';
import 'package:baylen_app/screens/cart_screen.dart';
import 'package:baylen_app/screens/checkout_screen.dart';
import 'package:baylen_app/screens/shop_brands_screen.dart';
import 'package:baylen_app/screens/shop_fashion_screen.dart';
import 'package:baylen_app/screens/wishlist_screen.dart';
import 'package:baylen_app/shell/main_shell.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    AuthService.instance.user.value = null;
  });

  testWidgets('premium splash renders brand and lady logo layers', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(home: BaylenSplashScreen(assets: const BaylenLaunchAssets())),
    );
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byType(Image), findsAtLeastNWidgets(2));
  });

  testWidgets('guest can open Home, Shop, and Salon without login', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: MainShell()));
    await tester.pump();

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Shop'), findsWidgets);
    expect(find.text('Salon'), findsWidgets);

    await tester.tap(find.text('Shop').last);
    await tester.pump();
    expect(find.textContaining('Search for'), findsWidgets);
    expect(find.text('Makeup'), findsWidgets);
    expect(find.text('Brands'), findsWidgets);
    expect(find.text('Baylen Fashion'), findsWidgets);

    await tester.tap(find.text('Salon').last);
    await tester.pump();
    expect(find.text('Salon booking'), findsOneWidget);
  });

  testWidgets('guest bag shows empty state with login CTA', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CartScreen()));
    await tester.pump();

    expect(find.text('Feeling empty?'), findsOneWidget);
    expect(find.text('Sign up / Login'), findsOneWidget);
  });

  testWidgets('guest wishlist requires sign in', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: WishlistScreen()));
    await tester.pump();

    expect(find.text('Wishlist'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('guest checkout requires sign in', (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: CheckoutScreen(cart: Cart.empty())),
    );
    await tester.pump();

    expect(find.text('Checkout'), findsOneWidget);
    expect(find.text('Sign in to continue checkout'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('brands section lists Baylen names instead of Nykaa', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: ShopBrandsScreen()));
    await tester.pump();

    expect(find.text('Add Address'), findsOneWidget);
    expect(find.text('ONLY AT BAYLEN'), findsOneWidget);
    expect(find.text('Search Brands'), findsOneWidget);
    expect(find.text('Nykaa'), findsNothing);
    expect(find.textContaining('Nykaa'), findsNothing);
  });

  testWidgets('fashion section lists Baylen options and promo', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: ShopFashionScreen()));
    await tester.pump();

    expect(find.text('House of Baylen'), findsOneWidget);
    expect(find.text('Twenty Dresses By Baylen Fashion'), findsOneWidget);
    expect(find.text('Floor Coverings'), findsOneWidget);
    expect(find.text('First In Fashion'), findsOneWidget);
    expect(find.text('SHOP NOW'), findsWidgets);
    expect(find.textContaining('Nykaa'), findsNothing);
  });
}
