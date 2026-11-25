import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/api/catalyst_api.dart';
import 'package:baylen_app/auth/role_switch_dialog.dart';

void main() {
  testWidgets('FORBIDDEN_ROLE shows role-switch dialog', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            return Scaffold(
              body: FilledButton(
                onPressed: () {
                  showRoleSwitchDialog(
                    context,
                    error: ApiException(
                      'This action requires a delivery partner account',
                      statusCode: 403,
                      code: 'FORBIDDEN_ROLE',
                    ),
                  );
                },
                child: const Text('Trigger'),
              ),
            );
          },
        ),
      ),
    );

    await tester.tap(find.text('Trigger'));
    await tester.pumpAndSettle();

    expect(find.text('Wrong account type'), findsOneWidget);
    expect(find.text('Switch role'), findsOneWidget);
    expect(find.textContaining('Switch to'), findsOneWidget);
  });
}
