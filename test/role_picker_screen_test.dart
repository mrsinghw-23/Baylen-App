import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/screens/auth/employee_login_screen.dart';
import 'package:baylen_app/screens/auth/role_picker_screen.dart';
import 'package:baylen_app/screens/login_screen.dart';

void main() {
  testWidgets('role picker renders both options and routes correctly', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: RolePickerScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text('How are you using Baylen?'), findsOneWidget);
    expect(find.text('User'), findsOneWidget);
    expect(find.text('Employee'), findsOneWidget);
    expect(find.text('Continue as User →'), findsOneWidget);
    expect(find.text('Continue as Employee →'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Together for a more beautiful tomorrow'), findsOneWidget);

    await tester.ensureVisible(find.text('Continue as User →'));
    await tester.tap(find.text('Continue as User →'));
    await tester.pumpAndSettle();
    expect(find.byType(LoginScreen), findsOneWidget);

    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Continue as Employee →'));
    await tester.tap(find.text('Continue as Employee →'));
    await tester.pumpAndSettle();
    expect(find.byType(EmployeeLoginScreen), findsOneWidget);
  });

  testWidgets('role picker fits on a compact phone size', (tester) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(home: RolePickerScreen()),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Continue as Employee →'), findsOneWidget);
    expect(find.text('Continue as User →'), findsOneWidget);
  });

  testWidgets('role picker fits on a standard phone size without overflow', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      const MaterialApp(home: RolePickerScreen()),
    );
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.text('Continue as Employee →'), findsOneWidget);
    expect(find.text('Continue as User →'), findsOneWidget);
  });
}
