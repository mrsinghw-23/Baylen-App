import 'package:baylen_app/models/catalog.dart';
import 'package:baylen_app/utils/fulfillment_helpers.dart';
import 'package:flutter_test/flutter_test.dart';

CatalogProduct _product({
  bool quick = false,
  bool standard = false,
  String quickEta = '',
  String standardEta = '',
  int availableQuantity = 10,
}) {
  return CatalogProduct(
    id: 'p1',
    name: 'Test Product',
    slug: 'test-product',
    sku: 'SKU-1',
    brandId: 'b1',
    brandName: 'Baylen',
    categoryId: 'c1',
    shortDescription: '',
    description: '',
    thumbnailUrl: '',
    mrp: 100,
    sellingPrice: 80,
    currency: 'INR',
    taxPercent: 0,
    hasVariants: false,
    isFeatured: false,
    availableQuantity: availableQuantity,
    fulfillment: CatalogFulfillmentSnapshot(
      quickAvailable: quick,
      standardAvailable: standard,
      quickEta: quickEta,
      standardEta: standardEta,
    ),
  );
}

void main() {
  group('Shop delivery labels', () {
    test('uses backend ETA when provided', () {
      expect(
        quickDeliveryEtaLabel(backendEta: '15-20 minutes'),
        '15-20 minutes',
      );
      expect(
        standardDeliveryEtaLabel(backendEta: '2-3 business days'),
        '2-3 business days',
      );
    });

    test('does not invent ETA when backend is empty', () {
      expect(quickDeliveryEtaLabel(), 'Quick Delivery');
      expect(standardDeliveryEtaLabel(), 'Standard Delivery');
    });

    test('catalog badges only when location and mode available', () {
      final located = _product(quick: true, quickEta: '15-20 minutes');
      final badges = catalogDeliveryBadges(located, hasLocation: true);
      expect(badges.length, 1);
      expect(badges.first, contains('15-20 minutes'));

      final noLocation = catalogDeliveryBadges(located, hasLocation: false);
      expect(noLocation, isEmpty);
    });
  });

  group('Shop availability authority', () {
    test('sold out uses fulfillment modes when location is known', () {
      final unavailable = _product();
      expect(
        catalogProductSoldOut(unavailable, hasLocation: true),
        isTrue,
      );

      final quickOnly = _product(quick: true);
      expect(catalogProductSoldOut(quickOnly, hasLocation: true), isFalse);
      expect(catalogProductCanAdd(quickOnly, hasLocation: true), isTrue);
    });

    test('without location falls back to aggregate quantity only', () {
      final product = _product(availableQuantity: 0);
      expect(catalogProductSoldOut(product, hasLocation: false), isTrue);

      final inStock = _product(availableQuantity: 3);
      expect(catalogProductCanAdd(inStock, hasLocation: false), isTrue);
    });
  });
}
