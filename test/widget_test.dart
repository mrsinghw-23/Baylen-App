import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/app.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Baylen Super App shell loads', (WidgetTester tester) async {
    await tester.pumpWidget(const BaylenApp());
    await tester.pump();

    expect(find.text('Baylen'), findsWidgets);
    expect(find.text('Shop'), findsWidgets);
    expect(find.text('Salon'), findsWidgets);
  });
}
