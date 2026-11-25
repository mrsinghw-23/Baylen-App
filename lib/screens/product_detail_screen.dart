import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../models/account.dart';
import '../models/catalog.dart';
import '../models/fulfillment.dart';
import '../services/cart_service.dart';
import '../services/delivery_location_service.dart';
import '../utils/fulfillment_helpers.dart';
import '../theme/shop_theme.dart';
import '../widgets/product_media_gallery.dart';
import '../widgets/reviews_panel.dart';
import 'cart_screen.dart';
import 'checkout_screen.dart';

class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.product});

  final CatalogProduct product;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  bool _adding = false;
  bool _buying = false;
  bool _wishing = false;
  bool _loading = true;
  String? _error;
  CatalogProductDetail? _detail;
  CatalogProductVariant? _variant;
  int _quantity = 1;
  ProductFulfillmentAvailability? _fulfillment;
  bool _fulfillmentLoading = false;
  bool _fulfillmentLoadFailed = false;
  DeliveryCoordinates _deliveryCoords = const DeliveryCoordinates();
  String? _selectedFulfillmentMode;
  List<WishlistItem> _wishlist = const [];

  @override
  void initState() {
    super.initState();
    AuthService.instance.user.addListener(_onAuthChanged);
    _load();
  }

  @override
  void dispose() {
    AuthService.instance.user.removeListener(_onAuthChanged);
    super.dispose();
  }

  void _onAuthChanged() {
    _refreshWishlist();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final detail = await CatalystApi().productDetail(
        widget.product.id,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted) return;
      final selected = preferredCatalogVariant(detail.variants);
      setState(() {
        _detail = detail;
        _variant = selected;
        _quantity = 1;
        _deliveryCoords = coords;
        _loading = false;
      });
      _loadFulfillment();
      _refreshWishlist();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _refreshWishlist() async {
    if (!AuthService.instance.isSignedIn) {
      if (mounted) setState(() => _wishlist = const []);
      return;
    }
    try {
      final items = await AuthService.instance.api.wishlist();
      if (!mounted) return;
      setState(() => _wishlist = items);
    } catch (_) {}
  }

  Future<void> _loadFulfillment() async {
    setState(() {
      _fulfillmentLoading = true;
      _fulfillmentLoadFailed = false;
    });
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final availability = await CatalystApi().productFulfillmentAvailability(
        productId: widget.product.id,
        variantId: _variant?.id,
        quantity: _quantity,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted) return;
      var mode = _selectedFulfillmentMode;
      if (mode == null ||
          (mode == FulfillmentOptionMode.quickCommerce &&
              !availability.quickCommerce.available) ||
          (mode == FulfillmentOptionMode.ecommerce &&
              !availability.standardEcommerce.available)) {
        mode = defaultFulfillmentMode(availability);
      }
      setState(() {
        _fulfillment = availability;
        _deliveryCoords = coords;
        _selectedFulfillmentMode = mode;
        _fulfillmentLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _fulfillmentLoading = false;
        _fulfillmentLoadFailed = true;
      });
    }
  }

  CatalogProduct get _product => _detail?.product ?? widget.product;

  List<CatalogProductMedia> get _visibleMedia {
    return mediaForSelectedVariant(
      _detail?.media ?? const [],
      variantId: _variant?.id,
      fallbackImageUrl: _product.thumbnailUrl,
    );
  }

  int get _availableQuantity {
    final variant = _variant;
    if (variant != null) {
      return variant.availableQuantity;
    }
    return _product.availableQuantity;
  }

  String get _priceLabel => _variant?.priceLabel ?? _product.priceLabel;

  String get _mrpLabel => _variant?.mrpLabel ?? _product.mrpLabel;

  int get _discountPercent =>
      _variant?.discountPercent ?? _product.discountPercent;

  String get _skuLabel {
    if (_variant != null && _variant!.sku.isNotEmpty) {
      return _variant!.sku;
    }
    return _product.sku;
  }

  bool get _wished {
    return _wishlist.any((item) => item.productId == _product.id);
  }

  int get _maxQuantity {
    if (_fulfillment != null) {
      final max = productFulfillmentMaxQuantity(
        _fulfillment,
        selectedMode: _selectedFulfillmentMode,
      );
      if (max > 0) {
        return max;
      }
    }
    return _availableQuantity;
  }

  bool get _hasFulfillmentData => _fulfillment != null && !_fulfillmentLoadFailed;

  bool get _canPurchase {
    if (_product.isZohoCommerceProduct || _quantity < 1) {
      return false;
    }
    if (_hasFulfillmentData) {
      return productFulfillmentCanPurchase(_fulfillment);
    }
    if (_fulfillmentLoading) {
      return false;
    }
    return _availableQuantity >= _quantity;
  }

  bool get _outOfStock {
    if (_hasFulfillmentData) {
      return !productFulfillmentCanPurchase(_fulfillment);
    }
    return _availableQuantity < 1;
  }

  void _selectVariant(CatalogProductVariant variant) {
    setState(() {
      _variant = variant;
      if (variant.availableQuantity < 1) {
        _quantity = 1;
      } else if (_quantity > variant.availableQuantity) {
        _quantity = variant.availableQuantity;
      } else if (_quantity < 1) {
        _quantity = 1;
      }
    });
    _loadFulfillment();
  }

  Future<bool> _addToCart({bool silent = false}) async {
    if (_product.isZohoCommerceProduct) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'This product is live from Zoho Commerce. Cart sync will be enabled after Zoho Commerce checkout is configured.',
            ),
          ),
        );
      }
      return false;
    }
    if (_hasFulfillmentData && !productFulfillmentCanPurchase(_fulfillment)) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('This product is not available for delivery right now'),
          ),
        );
      }
      return false;
    }
    if (!_hasFulfillmentData && _availableQuantity < 1) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('This option is out of stock')),
        );
      }
      return false;
    }
    if (!_hasFulfillmentData && _availableQuantity < _quantity) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Selected quantity is not available')),
        );
      }
      return false;
    }
    setState(() => _adding = true);
    try {
      await CartService.instance.addToCart(
        widget.product.id,
        _variant?.id ?? '',
        _quantity,
        latitude: _deliveryCoords.latitude,
        longitude: _deliveryCoords.longitude,
      );
      if (!mounted) return true;
      if (!silent) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Added to cart'),
            action: SnackBarAction(
              label: 'View cart',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const CartScreen()),
                );
              },
            ),
          ),
        );
      }
      return true;
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.toString())));
      }
      return false;
    } finally {
      if (mounted) {
        setState(() => _adding = false);
      }
    }
  }

  Future<void> _buyNow() async {
    setState(() => _buying = true);
    try {
      final added = await _addToCart(silent: true);
      if (!added || !mounted) {
        return;
      }
      final signedIn = await AuthGate.ensureSignedIn(
        context,
        message: 'Sign in to continue to checkout',
      );
      if (!signedIn || !mounted) {
        return;
      }
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => CheckoutScreen(cart: CartService.instance.cart),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _buying = false);
      }
    }
  }

  Future<void> _toggleWishlist() async {
    final wasSignedIn = AuthService.instance.isSignedIn;
    final signedIn = await AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to save items to your wishlist',
    );
    if (!signedIn || !mounted) {
      return;
    }
    await _refreshWishlist();
    if (!wasSignedIn && _wished) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Saved to wishlist')));
      return;
    }
    setState(() => _wishing = true);
    try {
      final existing = _wishlist.where((item) => item.productId == _product.id);
      final variantId = existing.isNotEmpty
          ? (existing.first.variantId.isEmpty ? null : existing.first.variantId)
          : _variant?.id;
      final wished = await AuthService.instance.api.toggleWishlist(
        widget.product.id,
        variantId: variantId,
      );
      await _refreshWishlist();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(wished ? 'Saved to wishlist' : 'Removed from wishlist'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) {
        setState(() => _wishing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final product = _product;
    final wide = MediaQuery.sizeOf(context).width >= 840;
    final gallery = ProductMediaGallery(
      key: ValueKey(
        '${_variant?.id ?? 'base'}-${_visibleMedia.map((item) => item.id).join(',')}',
      ),
      media: _visibleMedia,
      fallbackImageUrl: product.thumbnailUrl,
    );
    final details = _ProductDetailsBody(
      product: product,
      brandName: detail?.brand?.name ?? '',
      sku: _skuLabel,
      priceLabel: _priceLabel,
      mrpLabel: _mrpLabel,
      discountPercent: _discountPercent,
      availableQuantity: _maxQuantity,
      quantity: _quantity,
      variants: detail?.variants ?? const [],
      selectedVariant: _variant,
      fulfillmentLoading: _fulfillmentLoading,
      fulfillment: _fulfillment,
      fulfillmentLoadFailed: _fulfillmentLoadFailed,
      hasLocation: _deliveryCoords.hasCoordinates,
      selectedFulfillmentMode: _selectedFulfillmentMode,
      onSelectFulfillmentMode: (mode) {
        setState(() => _selectedFulfillmentMode = mode);
      },
      onSelectVariant: _selectVariant,
      onQuantityChanged: (value) {
        setState(() => _quantity = value);
        _loadFulfillment();
      },
    );

    return ShopThemeScope(
      child: Scaffold(
      backgroundColor: kShopSurface,
      appBar: AppBar(
        title: Text(product.name),
        actions: [
          IconButton(
            tooltip: 'Cart',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const CartScreen()),
              );
            },
            icon: const Icon(Icons.shopping_bag_outlined),
          ),
          IconButton(
            tooltip: _wished ? 'Remove from wishlist' : 'Add to wishlist',
            onPressed: _wishing ? null : _toggleWishlist,
            icon: Icon(
              _wished ? Icons.favorite : Icons.favorite_border,
              color: _wished ? const Color(0xFFD64545) : null,
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? _ProductDetailError(message: _error!, onRetry: _load)
          : Column(
              children: [
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _load,
                    child: wide
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                flex: 5,
                                child: ListView(
                                  children: [gallery],
                                ),
                              ),
                              Expanded(
                                flex: 4,
                                child: ListView(children: [details]),
                              ),
                            ],
                          )
                        : ListView(
                            padding: EdgeInsets.zero,
                            children: [gallery, details],
                          ),
                  ),
                ),
                _StickyPurchaseBar(
                  adding: _adding,
                  buying: _buying,
                  canPurchase: _canPurchase,
                  outOfStock: _outOfStock,
                  onAdd: () {
                    _addToCart();
                  },
                  onBuy: _buyNow,
                ),
              ],
            ),
      ),
    );
  }
}

class _ProductDetailsBody extends StatelessWidget {
  const _ProductDetailsBody({
    required this.product,
    required this.brandName,
    required this.sku,
    required this.priceLabel,
    required this.mrpLabel,
    required this.discountPercent,
    required this.availableQuantity,
    required this.quantity,
    required this.variants,
    required this.selectedVariant,
    required this.fulfillmentLoading,
    required this.fulfillment,
    required this.fulfillmentLoadFailed,
    required this.hasLocation,
    required this.selectedFulfillmentMode,
    required this.onSelectFulfillmentMode,
    required this.onSelectVariant,
    required this.onQuantityChanged,
  });

  final CatalogProduct product;
  final String brandName;
  final String sku;
  final String priceLabel;
  final String mrpLabel;
  final int discountPercent;
  final int availableQuantity;
  final int quantity;
  final List<CatalogProductVariant> variants;
  final CatalogProductVariant? selectedVariant;
  final bool fulfillmentLoading;
  final ProductFulfillmentAvailability? fulfillment;
  final bool fulfillmentLoadFailed;
  final bool hasLocation;
  final String? selectedFulfillmentMode;
  final ValueChanged<String> onSelectFulfillmentMode;
  final ValueChanged<CatalogProductVariant> onSelectVariant;
  final ValueChanged<int> onQuantityChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            product.name,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.w800,
              color: kShopInk,
            ),
          ),
          if (brandName.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(brandName, style: const TextStyle(color: kShopMuted)),
          ],
          if (sku.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'SKU $sku',
              style: const TextStyle(color: kShopMuted, fontSize: 12),
            ),
          ],
          const SizedBox(height: 10),
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            children: [
              Text(
                priceLabel,
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: Theme.of(context).colorScheme.primary,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (discountPercent > 0) ...[
                Text(
                  mrpLabel,
                  style: const TextStyle(
                    decoration: TextDecoration.lineThrough,
                    color: kShopMuted,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: kShopBlue.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '$discountPercent% off',
                    style: const TextStyle(
                      color: kShopBlue,
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 16),
          _DeliveryOptionsPanel(
            loading: fulfillmentLoading,
            availability: fulfillment,
            loadFailed: fulfillmentLoadFailed,
            hasLocation: hasLocation,
            selectedMode: selectedFulfillmentMode,
            onSelectMode: onSelectFulfillmentMode,
          ),
          if (fulfillmentLoadFailed) ...[
            const SizedBox(height: 6),
            Text(
              'Could not refresh delivery options. Showing standard availability.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: kShopMuted,
              ),
            ),
          ],
          const SizedBox(height: 8),
          if (fulfillment == null && !fulfillmentLoading)
            Text(
              availableQuantity > 0
                  ? '$availableQuantity available'
                  : 'Out of stock',
              style: TextStyle(
                color: availableQuantity > 0
                    ? Colors.green.shade700
                    : Colors.red.shade700,
                fontWeight: FontWeight.w700,
              ),
            ),
          if (variants.isNotEmpty) ...[
            const SizedBox(height: 16),
            Text('Options', style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: kShopInk,
              fontWeight: FontWeight.w800,
            )),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: variants
                  .map(
                    (variant) => ChoiceChip(
                      label: Text(
                        variant.availableQuantity < 1
                            ? '${variant.optionLabel} · Out of stock'
                            : variant.optionLabel,
                      ),
                      selected: selectedVariant?.id == variant.id,
                      onSelected: (_) => onSelectVariant(variant),
                      labelPadding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Text(
                'Quantity',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: kShopInk,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const Spacer(),
              IconButton(
                style: IconButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  foregroundColor: kShopInk,
                ),
                onPressed: quantity <= 1
                    ? null
                    : () => onQuantityChanged(quantity - 1),
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Text(
                '$quantity',
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  color: kShopInk,
                  fontSize: 16,
                ),
              ),
              IconButton(
                style: IconButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  foregroundColor: kShopInk,
                ),
                onPressed:
                    quantity >= availableQuantity || availableQuantity < 1
                    ? null
                    : () => onQuantityChanged(quantity + 1),
                icon: const Icon(Icons.add_circle_outline),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            product.description.isEmpty
                ? product.shortDescription
                : product.description,
            style: const TextStyle(
              color: kShopInk,
              height: 1.45,
              fontSize: 15,
            ),
          ),
          const SizedBox(height: 24),
          ReviewsPanel(
            targetType: 'PRODUCT',
            targetId: product.id,
            title: 'Product reviews',
          ),
        ],
      ),
    );
  }
}

class _StickyPurchaseBar extends StatelessWidget {
  const _StickyPurchaseBar({
    required this.adding,
    required this.buying,
    required this.canPurchase,
    required this.outOfStock,
    required this.onAdd,
    required this.onBuy,
  });

  final bool adding;
  final bool buying;
  final bool canPurchase;
  final bool outOfStock;
  final VoidCallback onAdd;
  final VoidCallback onBuy;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 10,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: adding || buying || !canPurchase ? null : onAdd,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    foregroundColor: kShopPrimary,
                    backgroundColor: Colors.white,
                    disabledForegroundColor: const Color(0xFF6B7C93),
                    side: const BorderSide(color: kShopPrimary, width: 1.6),
                    textStyle: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  child: Text(
                    adding
                        ? 'Adding...'
                        : outOfStock
                        ? 'Out of stock'
                        : 'Add to cart',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton(
                  onPressed: adding || buying || !canPurchase ? null : onBuy,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                  ),
                  child: Text(buying ? 'Please wait...' : 'Buy now'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProductDetailError extends StatelessWidget {
  const _ProductDetailError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off_outlined,
              size: 48,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 12),
            Text(
              'Could not load product details',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                color: kShopInk,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              message.replaceFirst('Exception: ', ''),
              textAlign: TextAlign.center,
              style: const TextStyle(color: kShopMuted),
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeliveryOptionsPanel extends StatelessWidget {
  const _DeliveryOptionsPanel({
    required this.loading,
    required this.availability,
    required this.loadFailed,
    required this.hasLocation,
    required this.selectedMode,
    required this.onSelectMode,
  });

  final bool loading;
  final ProductFulfillmentAvailability? availability;
  final bool loadFailed;
  final bool hasLocation;
  final String? selectedMode;
  final ValueChanged<String> onSelectMode;

  @override
  Widget build(BuildContext context) {
    if (loading && availability == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(minHeight: 2),
      );
    }
    if (availability == null) {
      if (loadFailed) {
        return const SizedBox.shrink();
      }
      if (!hasLocation) {
        return Text(
          'Add a delivery location to check Quick Delivery.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: kShopMuted,
          ),
        );
      }
      return const SizedBox.shrink();
    }

    final qc = availability!.quickCommerce;
    final ec = availability!.standardEcommerce;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Delivery options',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
            color: kShopInk,
          ),
        ),
        const SizedBox(height: 8),
        _SelectableDeliveryOptionCard(
          icon: Icons.bolt,
          title: 'Quick Delivery',
          subtitle: quickDeliveryEtaLabel(backendEta: qc.etaLabel),
          available: qc.available,
          selected: selectedMode == FulfillmentOptionMode.quickCommerce,
          disabledReason: !hasLocation
              ? 'Add a delivery location to check Quick Delivery.'
              : fulfillmentUnavailableMessage(qc.reason, forQuick: true),
          accent: const Color(0xFF0B6E4F),
          onTap: qc.available
              ? () => onSelectMode(FulfillmentOptionMode.quickCommerce)
              : null,
        ),
        const SizedBox(height: 8),
        _SelectableDeliveryOptionCard(
          icon: Icons.local_shipping_outlined,
          title: 'Standard Delivery',
          subtitle: standardDeliveryEtaLabel(backendEta: ec.etaLabel),
          available: ec.available,
          selected: selectedMode == FulfillmentOptionMode.ecommerce,
          disabledReason: fulfillmentUnavailableMessage(ec.reason, forQuick: false),
          accent: const Color(0xFF1B4F9C),
          onTap: ec.available
              ? () => onSelectMode(FulfillmentOptionMode.ecommerce)
              : null,
        ),
        if (!qc.available && !ec.available) ...[
          const SizedBox(height: 6),
          Text(
            'This product cannot be purchased with the selected options.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: Colors.red.shade700,
            ),
          ),
        ],
      ],
    );
  }
}

class _SelectableDeliveryOptionCard extends StatelessWidget {
  const _SelectableDeliveryOptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.available,
    required this.selected,
    required this.disabledReason,
    required this.accent,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool available;
  final bool selected;
  final String disabledReason;
  final Color accent;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final borderColor = selected
        ? accent
        : accent.withValues(alpha: available ? 0.35 : 0.2);
    return Opacity(
      opacity: available ? 1 : 0.72,
      child: Material(
        color: selected
            ? accent.withValues(alpha: 0.12)
            : accent.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              border: Border.all(color: borderColor, width: selected ? 2 : 1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: accent),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: accent,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: kShopInk,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        available ? 'Available' : disabledReason,
                        style: TextStyle(
                          color: available ? kShopMuted : Colors.red.shade700,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                if (selected)
                  Icon(Icons.check_circle, color: accent)
                else if (!available)
                  Icon(Icons.block, color: Colors.red.shade400, size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
