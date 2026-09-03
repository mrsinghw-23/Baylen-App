import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/models/catalog.dart';

void main() {
  CatalogProductMedia media({
    required String id,
    String type = 'IMAGE',
    String url = 'https://cdn.example/a.jpg',
    String variantId = '',
    int order = 0,
    bool primary = false,
  }) {
    return CatalogProductMedia(
      id: id,
      mediaType: type,
      fileUrl: url,
      variantId: variantId,
      displayOrder: order,
      isPrimary: primary,
    );
  }

  CatalogProductVariant variant({
    required String id,
    String name = '30ml',
    String value = '30.00',
    int qty = 4,
    double mrp = 899,
    double selling = 450,
  }) {
    return CatalogProductVariant(
      id: id,
      productId: 'p1',
      sku: 'SKU-$id',
      variantName: name,
      variantValue: value,
      mrp: mrp,
      sellingPrice: selling,
      currency: 'INR',
      availableQuantity: qty,
    );
  }

  test('mediaForSelectedVariant prefers variant media then shared', () {
    final items = [
      media(id: 'shared', url: 'https://cdn.example/shared.jpg', order: 1),
      media(
        id: 'v1-img',
        url: 'https://cdn.example/v1.jpg',
        variantId: 'v1',
        order: 2,
        primary: true,
      ),
      media(
        id: 'v2-img',
        url: 'https://cdn.example/v2.jpg',
        variantId: 'v2',
        order: 2,
      ),
      media(
        id: 'video',
        type: 'VIDEO',
        url: 'https://cdn.example/v1.mp4',
        variantId: 'v1',
        order: 100,
      ),
      media(id: 'empty', url: ''),
    ];

    final selected = mediaForSelectedVariant(items, variantId: 'v1');
    expect(selected.map((item) => item.id), ['v1-img', 'video', 'shared']);
  });

  test('mediaForSelectedVariant falls back to product thumbnail', () {
    final selected = mediaForSelectedVariant(
      const [],
      variantId: 'v1',
      fallbackImageUrl: 'https://cdn.example/thumb.jpg',
    );
    expect(selected, hasLength(1));
    expect(selected.first.fileUrl, 'https://cdn.example/thumb.jpg');
  });

  test('optionLabel does not append numeric duplicate values', () {
    expect(variant(id: 'a').optionLabel, '30ml');
    expect(
      variant(id: 'b', name: 'Red', value: 'Nude').optionLabel,
      'Nude',
    );
  });

  test('preferredCatalogVariant skips out-of-stock options', () {
    final selected = preferredCatalogVariant([
      variant(id: 'oos', qty: 0),
      variant(id: 'ok', name: '50ml', value: '50.00', qty: 3),
    ]);
    expect(selected?.id, 'ok');
  });

  test('variant price and discount come from variant fields', () {
    final item = variant(id: 'a');
    expect(item.priceLabel, '₹450');
    expect(item.mrpLabel, '₹899');
    expect(item.discountPercent, 50);
  });
}
