import 'package:baylen_app/models/at_home_beauty.dart';
import 'package:baylen_app/widgets/home/beauty_services.dart';
import 'package:baylen_app/widgets/home/brand_collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('Home section empty states', () {
    testWidgets('BeautyServices shows empty message without hardcoded categories',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BeautyServices(
              categories: const [],
              loading: false,
              onViewAll: () {},
              onCategoryTap: (_) {},
            ),
          ),
        ),
      );

      expect(find.text('No beauty categories available.'), findsOneWidget);
      expect(find.text('Hair'), findsNothing);
      expect(find.text('L\u2019OR\u00c9AL'), findsNothing);
    });

    testWidgets('BrandCollection shows empty message without fallback brands',
        (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BrandCollection(
              brands: const [],
              loading: false,
              onViewAll: () {},
              onBrandTap: (_) {},
            ),
          ),
        ),
      );

      expect(find.text('No brands available.'), findsOneWidget);
      expect(find.text('WELLA'), findsNothing);
    });
  });

  group('Home category mapping', () {
    BeautyCategory categoryFromFeed(Map<String, dynamic> cat) {
      final slug = cat['slug']?.toString().trim() ?? '';
      final iconKey = cat['icon_key']?.toString().trim() ?? 'more';
      final name = cat['name']?.toString().trim() ?? '';
      if (slug.isNotEmpty) {
        return BeautyCategory(slug: slug, name: name, iconKey: iconKey);
      }
      final normalized = iconKey.toLowerCase();
      return BeautyCategory(
        slug: normalized == 'nail' ? 'nails' : normalized,
        name: name.isNotEmpty ? name : iconKey,
        iconKey: iconKey,
      );
    }

    test('maps API slug when present', () {
      final category = categoryFromFeed({
        'slug': 'facial-skin',
        'name': 'Facial & Skin',
        'icon_key': 'skin',
      });
      expect(category.slug, 'facial-skin');
    });

    test('normalizes nail icon key to nails slug', () {
      final category = categoryFromFeed({
        'name': 'Nail',
        'icon_key': 'nail',
      });
      expect(category.slug, 'nails');
    });
  });
}
