import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/catalog.dart';
import 'package:baylen_app/widgets/product_media_gallery.dart';

void main() {
  CatalogProductMedia image(String id) {
    return CatalogProductMedia(
      id: id,
      mediaType: 'IMAGE',
      fileUrl: 'https://cdn.example/$id.jpg',
      displayOrder: int.tryParse(id) ?? 0,
    );
  }

  testWidgets('hides gallery chrome when a product has one image', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProductMediaGallery(media: [image('1')]),
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.chevron_left), findsNothing);
    expect(find.byIcon(Icons.chevron_right), findsNothing);
    expect(find.byIcon(Icons.play_circle_fill), findsNothing);
  });

  testWidgets('shows thumbnail strip when a product has several images', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(800, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProductMediaGallery(
            media: [image('1'), image('2'), image('3')],
          ),
        ),
      ),
    );
    await tester.pump();

    expect(find.byIcon(Icons.chevron_left), findsOneWidget);
    expect(find.byIcon(Icons.chevron_right), findsOneWidget);
  });
}
