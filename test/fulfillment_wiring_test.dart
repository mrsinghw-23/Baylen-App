import 'package:baylen_app/api/catalyst_api.dart';
import 'package:baylen_app/models/catalog.dart';
import 'package:baylen_app/models/fulfillment.dart';
import 'package:baylen_app/models/order.dart';
import 'package:baylen_app/utils/fulfillment_helpers.dart';
import 'package:flutter_test/flutter_test.dart';

ProductFulfillmentAvailability _availability({
  bool quick = false,
  bool standard = false,
  String quickReason = '',
  String standardReason = '',
  int quickQty = 0,
  int standardQty = 0,
}) {
  return ProductFulfillmentAvailability(
    productId: 'p1',
    quickCommerce: DeliveryAvailability(
      available: quick,
      reason: quick ? 'OK' : quickReason,
      label: 'Quick Delivery',
      etaLabel: '15–20 minutes',
      availableQuantity: quickQty,
    ),
    standardEcommerce: DeliveryAvailability(
      available: standard,
      reason: standard ? 'OK' : standardReason,
      label: 'Standard Delivery',
      etaLabel: '2–3 days',
      availableQuantity: standardQty,
    ),
    warnings: const [],
  );
}

CatalogProduct _catalogProduct({
  int aggregate = 10,
  bool quick = false,
  bool standard = false,
}) {
  return CatalogProduct(
    id: 'p1',
    name: 'Test',
    slug: 'test',
    sku: 'SKU1',
    categoryId: 'c1',
    brandId: 'b1',
    brandName: 'Brand',
    shortDescription: '',
    description: '',
    mrp: 100,
    sellingPrice: 90,
    currency: 'INR',
    taxPercent: 0,
    thumbnailUrl: '',
    hasVariants: false,
    isFeatured: false,
    availableQuantity: aggregate,
    fulfillment: CatalogFulfillmentSnapshot(
      quickAvailable: quick,
      standardAvailable: standard,
      quickEta: '15–20 minutes',
      standardEta: '2–3 days',
    ),
  );
}

void main() {
  group('Catalog fulfillment snapshot', () {
    test('parses backend fulfillment fields', () {
      final product = CatalogProduct.fromJson({
        'id': '1',
        'name': 'Serum',
        'available_quantity': 12,
        'quick_available': true,
        'standard_available': false,
        'quick_available_quantity': 3,
        'standard_available_quantity': 0,
        'quick_eta': '15–20 minutes',
        'standard_eta': '2–3 days',
        'quick_commerce_enabled': true,
        'ecommerce_enabled': true,
        'quick_commerce_restriction_reason': '',
      });

      expect(product.fulfillment.quickAvailable, isTrue);
      expect(product.fulfillment.standardAvailable, isFalse);
      expect(product.fulfillment.quickAvailableQuantity, 3);
      expect(product.availableQuantity, 12);
    });
  });

  group('Product detail purchase gating', () {
    test('A both Quick + Standard available', () {
      final availability = _availability(quick: true, standard: true);
      expect(productFulfillmentCanPurchase(availability), isTrue);
      expect(defaultFulfillmentMode(availability),
          FulfillmentOptionMode.quickCommerce);
    });

    test('B Quick unavailable + Standard available', () {
      final availability = _availability(
        quick: false,
        standard: true,
        quickReason: 'NO_LOCAL_STOCK',
      );
      expect(productFulfillmentCanPurchase(availability), isTrue);
      expect(defaultFulfillmentMode(availability),
          FulfillmentOptionMode.ecommerce);
    });

    test('C Quick available + Standard unavailable', () {
      final availability = _availability(
        quick: true,
        standard: false,
        standardReason: 'NO_WAREHOUSE_STOCK',
      );
      expect(productFulfillmentCanPurchase(availability), isTrue);
    });

    test('D both unavailable', () {
      final availability = _availability(
        quick: false,
        standard: false,
        quickReason: 'NO_LOCAL_STOCK',
        standardReason: 'NO_WAREHOUSE_STOCK',
      );
      expect(productFulfillmentCanPurchase(availability), isFalse);
    });

    test('E no location uses aggregate fallback in catalog listing', () {
      final product = _catalogProduct(aggregate: 5, quick: false, standard: true);
      expect(catalogProductCanAdd(product, hasLocation: false), isTrue);
      expect(catalogProductSoldOut(product, hasLocation: false), isFalse);
      expect(catalogDeliveryBadges(product, hasLocation: false), isEmpty);
    });

    test('F variant change keeps separate max quantity per mode', () {
      final availability = _availability(
        quick: true,
        standard: true,
        quickQty: 2,
        standardQty: 8,
      );
      expect(
        productFulfillmentMaxQuantity(
          availability,
          selectedMode: FulfillmentOptionMode.quickCommerce,
        ),
        2,
      );
      expect(
        productFulfillmentMaxQuantity(
          availability,
          selectedMode: FulfillmentOptionMode.ecommerce,
        ),
        8,
      );
    });
  });

  group('Shop listing helpers', () {
    test('location-aware sold out when both modes unavailable', () {
      final product = _catalogProduct(aggregate: 10, quick: false, standard: false);
      expect(catalogProductSoldOut(product, hasLocation: true), isTrue);
    });

    test('shows Quick badge only with location', () {
      final product = _catalogProduct(quick: true, standard: true);
      final badges = catalogDeliveryBadges(product, hasLocation: true);
      expect(badges.any((b) => b.startsWith('⚡')), isTrue);
      expect(badges.any((b) => b.startsWith('📦')), isTrue);
    });
  });

  group('Add to cart eligibility', () {
    test('G add to cart with Standard only', () {
      final product = _catalogProduct(aggregate: 0, quick: false, standard: true);
      expect(catalogProductCanAdd(product, hasLocation: true), isTrue);
    });

    test('H add to cart with Quick only', () {
      final product = _catalogProduct(aggregate: 0, quick: true, standard: false);
      expect(catalogProductCanAdd(product, hasLocation: true), isTrue);
    });
  });

  group('Checkout labels and errors', () {
    test('I Quick checkout label', () {
      expect(
        fulfillmentModeDisplayLabel(FulfillmentOptionMode.quickCommerce),
        'Quick Delivery',
      );
    });

    test('J Standard checkout label', () {
      expect(
        fulfillmentModeDisplayLabel(FulfillmentOptionMode.ecommerce),
        'Standard Delivery',
      );
    });

    test('K backend fulfillment unavailable message', () {
      final message = checkoutErrorMessage(
        ApiException(
          'Quick Commerce is no longer available for one or more items',
          code: 'FULFILLMENT_MODE_UNAVAILABLE',
        ),
      );
      expect(message, contains('no longer available'));
    });

    test('L stock changes between cart and checkout', () {
      final message = checkoutErrorMessage(
        ApiException('Not enough stock', code: 'INSUFFICIENT_STOCK'),
      );
      expect(message, contains('no longer available'));
    });

    test('M split fulfillment label', () {
      expect(
        fulfillmentModeDisplayLabel(FulfillmentOptionMode.split),
        'Split Delivery',
      );
      final order = ShopOrder(
        id: '1',
        orderNumber: 'ORD-1',
        status: 'PLACED',
        paymentStatus: 'PENDING',
        currency: 'INR',
        subtotal: 100,
        grandTotal: 100,
        shippingName: 'Test',
        shippingLine1: 'Line',
        shippingCity: 'City',
        canCancel: true,
        canReturn: false,
        items: const [],
        fulfillmentMode: FulfillmentOptionMode.split,
      );
      expect(order.fulfillmentLabel, 'Split Delivery');
    });
  });

  group('Customer-facing unavailable copy', () {
    test('maps location required for Quick', () {
      expect(
        fulfillmentUnavailableMessage('LOCATION_REQUIRED', forQuick: true),
        contains('delivery location'),
      );
    });

    test('maps no local stock for Quick', () {
      expect(
        fulfillmentUnavailableMessage('NO_LOCAL_STOCK', forQuick: true),
        contains('out of stock'),
      );
    });
  });

  group('checkoutEstimatedDeliveryLabel', () {
    CartFulfillmentResult fulfillmentResult() {
      return CartFulfillmentResult(
        options: [
          FulfillmentOption(
            mode: FulfillmentOptionMode.quickCommerce,
            available: true,
            label: 'Quick Commerce',
            etaLabel: '15–20 minutes',
            itemCount: 1,
          ),
          FulfillmentOption(
            mode: FulfillmentOptionMode.ecommerce,
            available: true,
            label: 'Standard Delivery',
            etaLabel: '2–3 days',
            itemCount: 1,
          ),
        ],
        quickCommerceAvailable: true,
        standardEcommerceAvailable: true,
        splitAvailable: false,
        warnings: const [],
      );
    }

    test('uses Quick ETA when QUICK_COMMERCE is selected', () {
      expect(
        checkoutEstimatedDeliveryLabel(
          selectedMode: FulfillmentOptionMode.quickCommerce,
          fulfillment: fulfillmentResult(),
          pincodeEtaFallback: 'Get it in 3 days',
        ),
        'Get it in 15–20 minutes',
      );
    });

    test('uses Standard ETA when E_COMMERCE is selected', () {
      expect(
        checkoutEstimatedDeliveryLabel(
          selectedMode: FulfillmentOptionMode.ecommerce,
          fulfillment: fulfillmentResult(),
          pincodeEtaFallback: 'Get it in 3 days',
        ),
        'Get it in 2–3 days',
      );
    });

    test('falls back to pincode ETA when fulfillment is unavailable', () {
      expect(
        checkoutEstimatedDeliveryLabel(
          selectedMode: null,
          fulfillment: null,
          pincodeEtaFallback: 'Get it in 3 days',
        ),
        'Get it in 3 days',
      );
    });
  });
}
