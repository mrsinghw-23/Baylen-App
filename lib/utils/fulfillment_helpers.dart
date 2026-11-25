import '../api/catalyst_api.dart';
import '../models/catalog.dart';
import '../models/fulfillment.dart';
import '../models/order.dart';

/// Customer-facing labels for backend fulfillment enums.
String fulfillmentModeDisplayLabel(String mode) {
  switch (mode.toUpperCase()) {
    case FulfillmentOptionMode.quickCommerce:
      return 'Quick Delivery';
    case FulfillmentOptionMode.ecommerce:
      return 'Standard Delivery';
    case FulfillmentOptionMode.split:
      return 'Split Delivery';
    default:
      return mode.isEmpty ? 'Delivery' : mode;
  }
}

String quickDeliveryEtaLabel({String backendEta = ''}) {
  if (backendEta.trim().isNotEmpty) {
    return backendEta.trim();
  }
  return 'Quick Delivery';
}

String standardDeliveryEtaLabel({String backendEta = ''}) {
  if (backendEta.trim().isNotEmpty) {
    return backendEta.trim();
  }
  return 'Standard Delivery';
}

/// Checkout pin summary: prefer selected fulfillment option ETA over pincode ETA.
String checkoutEstimatedDeliveryLabel({
  required String? selectedMode,
  CartFulfillmentResult? fulfillment,
  String pincodeEtaFallback = '',
}) {
  if (selectedMode != null &&
      selectedMode.isNotEmpty &&
      fulfillment != null) {
    for (final option in fulfillment.options) {
      if (option.mode != selectedMode || !option.available) {
        continue;
      }
      final eta = option.etaLabel.trim();
      if (eta.isNotEmpty) {
        final lower = eta.toLowerCase();
        if (lower.startsWith('get it ')) {
          return eta;
        }
        return 'Get it in $eta';
      }
      break;
    }
  }
  return pincodeEtaFallback.trim();
}

/// Maps backend availability reason codes to customer-friendly copy.
String fulfillmentUnavailableMessage(
  String reason, {
  bool forQuick = true,
}) {
  switch (reason.toUpperCase()) {
    case 'LOCATION_REQUIRED':
      return 'Add a delivery location to check Quick Delivery.';
    case 'NO_SERVICEABLE_STORE':
    case 'OUTSIDE_SERVICE_RADIUS_OR_STORE_CLOSED':
      return "Quick Delivery isn't available in your area.";
    case 'NO_LOCAL_STOCK':
    case 'INSUFFICIENT_LOCAL_STOCK':
      return 'Quick Delivery is currently out of stock.';
    case 'NO_WAREHOUSE_STOCK':
    case 'INSUFFICIENT_WAREHOUSE_STOCK':
      return 'Standard Delivery is currently unavailable.';
    case 'PRODUCT_QC_DISABLED':
    case 'PRODUCT_EC_DISABLED':
      return forQuick
          ? 'Quick Delivery is not offered for this product.'
          : 'Standard Delivery is not offered for this product.';
    case 'PRODUCT_UNAVAILABLE':
      return 'This item is no longer available.';
    case 'OK':
      return '';
    default:
      if (forQuick) {
        return 'Quick Delivery is not available for this item.';
      }
      return 'Standard Delivery is not available for this item.';
  }
}

String checkoutErrorMessage(Object error) {
  if (error is ApiException) {
    final code = error.code?.toUpperCase() ?? '';
    final message = error.message.toLowerCase();
    if (code == 'FULFILLMENT_MODE_UNAVAILABLE' ||
        message.contains('fulfillment mode is not available') ||
        message.contains('quick commerce is no longer available')) {
      return 'The selected delivery option is no longer available. Please choose another option and try again.';
    }
    if (code == 'INSUFFICIENT_STOCK' ||
        message.contains('insufficient stock') ||
        message.contains('out of stock')) {
      return 'This item is no longer available for the selected delivery option.';
    }
    if (code == 'NO_FULFILLMENT_OPTION') {
      return 'No delivery option is available for this cart and location. Refresh options or update your address.';
    }
    return error.message;
  }
  final text = error.toString().replaceFirst('Exception: ', '');
  if (text.contains('FULFILLMENT_MODE_UNAVAILABLE')) {
    return 'The selected delivery option is no longer available. Please choose another option and try again.';
  }
  if (text.contains('INSUFFICIENT_STOCK')) {
    return 'This item is no longer available for the selected delivery option.';
  }
  return text;
}

bool catalogProductSoldOut(
  CatalogProduct product, {
  required bool hasLocation,
}) {
  if (hasLocation) {
    return !product.fulfillment.quickAvailable &&
        !product.fulfillment.standardAvailable;
  }
  return product.availableQuantity < 1;
}

bool catalogProductCanAdd(
  CatalogProduct product, {
  required bool hasLocation,
}) {
  if (product.isZohoCommerceProduct) {
    return false;
  }
  if (hasLocation) {
    return product.fulfillment.quickAvailable ||
        product.fulfillment.standardAvailable;
  }
  return product.availableQuantity > 0;
}

List<String> catalogDeliveryBadges(
  CatalogProduct product, {
  required bool hasLocation,
}) {
  if (!hasLocation) {
    return const [];
  }
  final badges = <String>[];
  if (product.fulfillment.quickAvailable) {
    badges.add('⚡ ${quickDeliveryEtaLabel(backendEta: product.fulfillment.quickEta)}');
  }
  if (product.fulfillment.standardAvailable) {
    badges.add('📦 ${standardDeliveryEtaLabel(backendEta: product.fulfillment.standardEta)}');
  }
  return badges;
}

bool productFulfillmentCanPurchase(ProductFulfillmentAvailability? availability) {
  if (availability == null) {
    return false;
  }
  return availability.quickCommerce.available ||
      availability.standardEcommerce.available;
}

int productFulfillmentMaxQuantity(
  ProductFulfillmentAvailability? availability, {
  String? selectedMode,
}) {
  if (availability == null) {
    return 0;
  }
  final qc = availability.quickCommerce;
  final ec = availability.standardEcommerce;
  if (selectedMode == FulfillmentOptionMode.quickCommerce && qc.available) {
    return qc.availableQuantity > 0 ? qc.availableQuantity : 99;
  }
  if (selectedMode == FulfillmentOptionMode.ecommerce && ec.available) {
    return ec.availableQuantity > 0 ? ec.availableQuantity : 99;
  }
  final maxQty = [
    if (qc.available) qc.availableQuantity,
    if (ec.available) ec.availableQuantity,
  ];
  if (maxQty.isEmpty) {
    return 0;
  }
  return maxQty.reduce((a, b) => a > b ? a : b);
}

String? defaultFulfillmentMode(ProductFulfillmentAvailability? availability) {
  if (availability == null) {
    return null;
  }
  if (availability.quickCommerce.available) {
    return FulfillmentOptionMode.quickCommerce;
  }
  if (availability.standardEcommerce.available) {
    return FulfillmentOptionMode.ecommerce;
  }
  return null;
}

String orderDeliveryEstimate(ShopOrder order) {
  final mode = order.fulfillmentMode.toUpperCase();
  if (mode == FulfillmentOptionMode.quickCommerce) {
    if (order.etaLabel.trim().isNotEmpty) {
      return order.etaLabel.trim();
    }
    return quickDeliveryEtaLabel();
  }
  if (mode == FulfillmentOptionMode.ecommerce) {
    return standardDeliveryEtaLabel();
  }
  return order.etaLabel.trim();
}

// Forward import for order model — keep helpers usable from order.dart via duplicate thin wrapper if needed.
