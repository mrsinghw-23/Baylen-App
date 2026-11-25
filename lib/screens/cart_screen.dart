import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../models/cart.dart';
import '../models/catalog.dart';
import '../models/fulfillment.dart';
import '../services/cart_service.dart';
import '../services/delivery_location_service.dart';
import '../utils/fulfillment_helpers.dart';
import '../theme/shop_theme.dart';
import '../widgets/product_contained_image.dart';
import 'addresses_screen.dart';
import 'checkout_screen.dart';
import 'product_detail_screen.dart';
import 'shop_catalog_screen.dart';
import 'wishlist_screen.dart';

const _kBagGreen = Color(0xFF128C4B);
const _kBagInk = kShopInk;
const _kBagMuted = kShopMuted;

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  final _coupon = TextEditingController();
  Cart _cart = Cart.empty();
  bool _loading = false;
  String? _error;
  String? _busyItemId;
  bool _couponBusy = false;
  bool _addingProductIdBusy = false;
  bool _priceExpanded = false;
  CartFulfillmentResult? _fulfillment;
  bool _fulfillmentLoading = false;

  @override
  void initState() {
    super.initState();
    AuthService.instance.user.addListener(_onAuthChanged);
    _cart = CartService.instance.cart;
    _loading = AuthService.instance.isSignedIn && _cart.isEmpty;
    _load();
  }

  @override
  void dispose() {
    AuthService.instance.user.removeListener(_onAuthChanged);
    _coupon.dispose();
    super.dispose();
  }

  void _onAuthChanged() {
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _error = null;
      if (AuthService.instance.isSignedIn && _cart.isEmpty) {
        _loading = true;
      }
    });
    try {
      final cart = await CartService.instance.fetchCart(rethrowOnError: true);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.text = cart.coupon?.code ?? '';
        _loading = false;
      });
      _loadFulfillment();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_cart.isEmpty && !AuthService.instance.isSignedIn) {
          _error = null;
        } else {
          _error = error.toString();
        }
      });
    }
  }

  Future<void> _loadFulfillment() async {
    if (_cart.isEmpty) {
      setState(() {
        _fulfillment = null;
        _fulfillmentLoading = false;
      });
      return;
    }
    setState(() => _fulfillmentLoading = true);
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final result = await CatalystApi().checkFulfillment(
        useCart: true,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted) return;
      setState(() {
        _fulfillment = result;
        _fulfillmentLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _fulfillmentLoading = false);
    }
  }

  Future<void> _setQuantity(CartItem item, int quantity) async {
    setState(() => _busyItemId = item.id);
    try {
      final cart = await CartService.instance.updateQuantity(item.id, quantity);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.text = cart.coupon?.code ?? _coupon.text;
        _busyItemId = null;
      });
      _loadFulfillment();
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyItemId = null);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _remove(CartItem item) async {
    setState(() => _busyItemId = item.id);
    try {
      final cart = await CartService.instance.removeFromCart(item.id);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.text = cart.coupon?.code ?? _coupon.text;
        _busyItemId = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyItemId = null);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _moveToWishlist(CartItem item) async {
    final signedIn = await AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to save items to your wishlist',
    );
    if (!signedIn || !mounted) return;
    setState(() => _busyItemId = item.id);
    try {
      await AuthService.instance.api.toggleWishlist(
        item.productId,
        variantId: item.variantId,
      );
      final cart = await CartService.instance.removeFromCart(item.id);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _busyItemId = null;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Moved to wishlist')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyItemId = null);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _applyCoupon() async {
    final signedIn = await AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to apply coupons',
    );
    if (!signedIn || !mounted) return;
    final code = _coupon.text.trim();
    if (code.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Enter a coupon code')));
      return;
    }
    setState(() => _couponBusy = true);
    try {
      final cart = await CartService.instance.applyCoupon(code);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.text = cart.coupon?.code ?? code.toUpperCase();
        _couponBusy = false;
      });
      if (cart.couponError.isNotEmpty) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(cart.couponError)));
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Coupon ${_coupon.text} applied')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _couponBusy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _removeCoupon() async {
    final signedIn = await AuthGate.ensureSignedIn(context);
    if (!signedIn || !mounted) return;
    setState(() => _couponBusy = true);
    try {
      final cart = await CartService.instance.removeCoupon();
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.clear();
        _couponBusy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _couponBusy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _addRecommended(CatalogProduct product) async {
    if (product.hasVariants) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ProductDetailScreen(product: product),
        ),
      );
      return;
    }
    setState(() => _addingProductIdBusy = true);
    try {
      final cart = await CartService.instance.addToCart(product.id, '', 1);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _addingProductIdBusy = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${product.name} added to bag')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _addingProductIdBusy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _openLogin() async {
    await AuthGate.ensureSignedIn(context);
  }

  Future<void> _continueCheckout() async {
    final blocked = _cart.items.where((item) => item.unavailable || !item.inStock);
    if (blocked.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Remove unavailable or out-of-stock items to continue'),
        ),
      );
      return;
    }
    final signedIn = await AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to continue checkout',
    );
    if (!signedIn || !mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => CheckoutScreen(cart: _cart)),
    );
    if (mounted) {
      _load();
    }
  }

  void _openProduct(CartItem item) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(
          product: CatalogProduct.fromJson({
            'id': item.productId,
            'name': item.name,
            'thumbnail_url': item.thumbnailUrl,
            'selling_price': item.unitPrice,
            'mrp': item.unitMrp,
            'currency': item.currency,
          }),
        ),
      ),
    );
  }

  void _continueShopping() {
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const ShopCatalogScreen()),
    );
  }

  ThemeData get _bagTheme {
    return ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: kShopBlue,
        brightness: Brightness.light,
      ),
      scaffoldBackgroundColor: Colors.white,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.white,
        foregroundColor: _kBagInk,
        elevation: 0,
        surfaceTintColor: Colors.white,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: _bagTheme,
      child: Scaffold(
        appBar: AppBar(
          title: Text(
            _cart.isEmpty
                ? 'Bag'
                : 'Bag · ${_cart.itemCount} item${_cart.itemCount == 1 ? '' : 's'}',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          actions: [
            IconButton(
              tooltip: 'Search',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const ShopCatalogScreen(autofocusSearch: true),
                  ),
                );
              },
              icon: const Icon(Icons.search),
            ),
            IconButton(
              tooltip: 'Wishlist',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const WishlistScreen()),
                );
              },
              icon: const Icon(Icons.favorite_border),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _cart.isEmpty
            ? _ErrorState(message: _error!, onRetry: _load)
            : _cart.isEmpty
            ? _EmptyBag(
                cart: _cart,
                signedIn: AuthService.instance.isSignedIn,
                onSignIn: _openLogin,
                onShop: _continueShopping,
                onAdd: _addRecommended,
                adding: _addingProductIdBusy,
              )
            : Column(
                children: [
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        children: [
                          _DeliveryBar(
                            signedIn: AuthService.instance.isSignedIn,
                            onTap: () async {
                              final ok = await AuthGate.ensureSignedIn(
                                context,
                                message: 'Sign in to check delivery',
                              );
                              if (!ok || !context.mounted) return;
                              await Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => const AddressesScreen(),
                                ),
                              );
                              DeliveryLocationService.instance.invalidate();
                              _loadFulfillment();
                            },
                          ),
                          const SizedBox(height: 12),
                          _CartFulfillmentPanel(
                            loading: _fulfillmentLoading,
                            result: _fulfillment,
                          ),
                          const SizedBox(height: 16),
                          const Text(
                            'Bag items',
                            style: TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: _kBagInk,
                            ),
                          ),
                          const SizedBox(height: 8),
                          ..._cart.items.map(
                            (item) => Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _BagItemCard(
                                item: item,
                                busy: _busyItemId == item.id,
                                onOpen: () => _openProduct(item),
                                onMinus: () =>
                                    _setQuantity(item, item.quantity - 1),
                                onPlus: () =>
                                    _setQuantity(item, item.quantity + 1),
                                onRemove: () => _remove(item),
                                onWishlist: () => _moveToWishlist(item),
                              ),
                            ),
                          ),
                          const SizedBox(height: 8),
                          _CouponBar(
                            controller: _coupon,
                            cart: _cart,
                            busy: _couponBusy,
                            signedIn: AuthService.instance.isSignedIn,
                            onApply: _applyCoupon,
                            onRemove: _removeCoupon,
                            onLogin: _openLogin,
                          ),
                          const SizedBox(height: 10),
                          _PriceDetails(
                            cart: _cart,
                            expanded: _priceExpanded,
                            onToggle: () {
                              setState(() => _priceExpanded = !_priceExpanded);
                            },
                          ),
                          if (_cart.youMayAlsoLike.isNotEmpty) ...[
                            const SizedBox(height: 20),
                            _RecommendRow(
                              title: 'You may also like',
                              products: _cart.youMayAlsoLike,
                              onAdd: _addRecommended,
                            ),
                          ],
                          if (_cart.frequentlyBoughtTogether.isNotEmpty) ...[
                            const SizedBox(height: 16),
                            _RecommendRow(
                              title: 'Frequently bought together',
                              products: _cart.frequentlyBoughtTogether,
                              onAdd: _addRecommended,
                            ),
                          ],
                          if (_cart.lastMinuteAdditions.isNotEmpty) ...[
                            const SizedBox(height: 16),
                            _RecommendRow(
                              title: 'Last minute additions',
                              products: _cart.lastMinuteAdditions,
                              onAdd: _addRecommended,
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  _StickyCheckoutBar(
                    cart: _cart,
                    onContinue: _continueCheckout,
                  ),
                ],
              ),
      ),
    );
  }
}

class _DeliveryBar extends StatelessWidget {
  const _DeliveryBar({required this.signedIn, required this.onTap});

  final bool signedIn;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: kShopSurface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          child: Row(
            children: [
              const Icon(Icons.location_on_outlined, color: kShopBlue),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Check delivery date',
                  style: TextStyle(fontWeight: FontWeight.w600, color: _kBagInk),
                ),
              ),
              Text(
                signedIn ? 'Select address' : 'Enter pincode',
                style: const TextStyle(
                  color: kShopBlue,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CartFulfillmentPanel extends StatelessWidget {
  const _CartFulfillmentPanel({
    required this.loading,
    required this.result,
  });

  final bool loading;
  final CartFulfillmentResult? result;

  @override
  Widget build(BuildContext context) {
    if (loading && result == null) {
      return const LinearProgressIndicator(minHeight: 2);
    }
    if (result == null || result!.options.isEmpty) {
      if (result != null && result!.warnings.isNotEmpty) {
        return Text(
          result!.warnings.first,
          style: const TextStyle(color: _kBagMuted, fontSize: 12),
        );
      }
      return const SizedBox.shrink();
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Available delivery',
          style: TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 15,
            color: _kBagInk,
          ),
        ),
        const SizedBox(height: 8),
        ...result!.options.map((option) {
          final isQc = option.mode == FulfillmentOptionMode.quickCommerce;
          final isSplit = option.mode == FulfillmentOptionMode.split;
          final color = isQc
              ? _kBagGreen
              : isSplit
                  ? const Color(0xFF8A5A00)
                  : kShopBlue;
          final icon = isQc
              ? Icons.bolt
              : isSplit
                  ? Icons.call_split
                  : Icons.local_shipping_outlined;
          final label = fulfillmentModeDisplayLabel(option.mode);
          final eta = option.etaLabel.isNotEmpty
              ? option.etaLabel
              : (isQc
                  ? quickDeliveryEtaLabel()
                  : standardDeliveryEtaLabel());
          return Opacity(
            opacity: option.available ? 1 : 0.72,
            child: Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color.withValues(alpha: 0.35)),
                color: color.withValues(alpha: 0.06),
              ),
              child: Row(
                children: [
                  Icon(icon, color: color),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          style: TextStyle(
                            color: color,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          option.available
                              ? '${option.itemCount} item${option.itemCount == 1 ? '' : 's'} · $eta'
                              : _unavailableCartMessage(option.mode),
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: option.available
                                ? _kBagInk
                                : Colors.red.shade700,
                            fontSize: option.available ? null : 12,
                          ),
                        ),
                        if (option.available && option.description.isNotEmpty)
                          Text(
                            option.description,
                            style: const TextStyle(
                              color: _kBagMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (!option.available)
                    Icon(Icons.block, color: Colors.red.shade400, size: 18),
                ],
              ),
            ),
          );
        }),
      ],
    );
  }

  String _unavailableCartMessage(String mode) {
    if (mode == FulfillmentOptionMode.quickCommerce) {
      return 'Quick Delivery is no longer available for this item.';
    }
    if (mode == FulfillmentOptionMode.ecommerce) {
      return 'Standard Delivery is currently unavailable.';
    }
    return 'Split Delivery is not available for this cart.';
  }
}

class _EmptyBag extends StatelessWidget {
  const _EmptyBag({
    required this.cart,
    required this.signedIn,
    required this.onSignIn,
    required this.onShop,
    required this.onAdd,
    required this.adding,
  });

  final Cart cart;
  final bool signedIn;
  final VoidCallback onSignIn;
  final VoidCallback onShop;
  final ValueChanged<CatalogProduct> onAdd;
  final bool adding;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
      children: [
        const SizedBox(height: 24),
        Center(
          child: Container(
            width: 132,
            height: 132,
            decoration: BoxDecoration(
              color: const Color(0xFFE8F2FF),
              borderRadius: BorderRadius.circular(28),
            ),
            child: const Icon(
              Icons.shopping_bag_outlined,
              size: 72,
              color: kShopBlue,
            ),
          ),
        ),
        const SizedBox(height: 20),
        const Text(
          'Feeling empty?',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w900,
            color: _kBagInk,
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Pamper yourself with the care you deserve. Shop Baylen beauty essentials below.',
          textAlign: TextAlign.center,
          style: TextStyle(color: _kBagMuted, height: 1.4),
        ),
        const SizedBox(height: 20),
        if (!signedIn)
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: onSignIn,
              style: OutlinedButton.styleFrom(
                foregroundColor: kShopBlue,
                side: const BorderSide(color: kShopBlue, width: 1.4),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(28),
                ),
              ),
              child: const Text(
                'Sign up / Login',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ),
        const SizedBox(height: 12),
        SizedBox(
          height: 48,
          child: FilledButton(
            onPressed: onShop,
            child: const Text('Continue shopping'),
          ),
        ),
        if (cart.offers.isNotEmpty) ...[
          const SizedBox(height: 20),
          _CouponPromoCard(offer: cart.offers.first, onTap: onSignIn),
        ],
        const SizedBox(height: 22),
        const _TrustRow(),
        if (cart.lastMinuteAdditions.isNotEmpty ||
            cart.youMayAlsoLike.isNotEmpty) ...[
          const SizedBox(height: 24),
          _RecommendRow(
            title: 'You may also like',
            products: cart.youMayAlsoLike.isNotEmpty
                ? cart.youMayAlsoLike
                : cart.lastMinuteAdditions,
            onAdd: adding ? null : onAdd,
          ),
        ],
      ],
    );
  }
}

class _CouponPromoCard extends StatelessWidget {
  const _CouponPromoCard({required this.offer, required this.onTap});

  final ShopHomeOffer offer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFEAF3FF),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              const Icon(Icons.percent, color: kShopBlue, size: 32),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Coupons',
                      style: TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 16,
                        color: _kBagInk,
                      ),
                    ),
                    Text(
                      offer.title.isNotEmpty
                          ? offer.title
                          : 'Collect now to save extra!',
                      style: const TextStyle(
                        color: kShopBlue,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: kShopBlue),
            ],
          ),
        ),
      ),
    );
  }
}

class _TrustRow extends StatelessWidget {
  const _TrustRow();

  @override
  Widget build(BuildContext context) {
    const items = [
      (Icons.local_shipping_outlined, 'Free shipping', 'On every order'),
      (Icons.replay_outlined, 'Easy returns', 'Hassle-free'),
      (Icons.verified_outlined, '100% authentic', 'Baylen products'),
      (Icons.favorite_outline, 'Expert care', 'Beauty first'),
    ];
    return Row(
      children: items
          .map(
            (item) => Expanded(
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(color: kShopBlue.withValues(alpha: 0.45)),
                    ),
                    child: Icon(item.$1, color: kShopBlue, size: 22),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    item.$2,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: _kBagInk,
                    ),
                  ),
                  Text(
                    item.$3,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 10, color: _kBagMuted),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

class _BagItemCard extends StatelessWidget {
  const _BagItemCard({
    required this.item,
    required this.busy,
    required this.onOpen,
    required this.onMinus,
    required this.onPlus,
    required this.onRemove,
    required this.onWishlist,
  });

  final CartItem item;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onMinus;
  final VoidCallback onPlus;
  final VoidCallback onRemove;
  final VoidCallback onWishlist;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: InkWell(
        onTap: onOpen,
        borderRadius: BorderRadius.circular(14),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: SizedBox(
                      width: 84,
                      height: 84,
                      child: item.thumbnailUrl.isEmpty
                          ? const ColoredBox(
                              color: Color(0xFFE8F2FF),
                              child: Icon(Icons.image_outlined, color: kShopBlue),
                            )
                          : ProductContainedImage(
                              url: item.thumbnailUrl,
                              compact: true,
                              placeholder: const Icon(
                                Icons.image_outlined,
                                color: kShopBlue,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.name,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w700,
                                  color: _kBagInk,
                                ),
                              ),
                            ),
                            IconButton(
                              tooltip: 'Remove',
                              visualDensity: VisualDensity.compact,
                              onPressed: busy ? null : onRemove,
                              icon: const Icon(Icons.delete_outline),
                            ),
                          ],
                        ),
                        if (item.variantLabel.isNotEmpty)
                          Text(
                            item.variantLabel,
                            style: const TextStyle(color: _kBagMuted, fontSize: 12),
                          ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Text(
                              item.lineLabel,
                              style: const TextStyle(
                                fontWeight: FontWeight.w900,
                                fontSize: 16,
                                color: _kBagInk,
                              ),
                            ),
                            if (item.unitMrp > item.unitPrice) ...[
                              const SizedBox(width: 8),
                              Text(
                                item.mrpLabel,
                                style: const TextStyle(
                                  decoration: TextDecoration.lineThrough,
                                  color: _kBagMuted,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                '₹${item.lineSavings} off',
                                style: const TextStyle(
                                  color: _kBagGreen,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (item.unavailable || !item.inStock) ...[
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    item.unavailable
                        ? 'This product is no longer available'
                        : item.availableQuantity < 1
                        ? 'Out of stock'
                        : 'Only ${item.availableQuantity} left',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 8),
              Row(
                children: [
                  _QtyChip(
                    quantity: item.quantity,
                    enabled: !busy && !item.unavailable,
                    onMinus: onMinus,
                    onPlus: onPlus,
                  ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: busy ? null : onWishlist,
                    icon: const Icon(Icons.favorite_border, size: 18),
                    label: const Text('Wishlist'),
                  ),
                ],
              ),
              if (busy) const LinearProgressIndicator(),
            ],
          ),
        ),
      ),
    );
  }
}

class _QtyChip extends StatelessWidget {
  const _QtyChip({
    required this.quantity,
    required this.enabled,
    required this.onMinus,
    required this.onPlus,
  });

  final int quantity;
  final bool enabled;
  final VoidCallback onMinus;
  final VoidCallback onPlus;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: Border.all(color: kShopBlue.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: enabled ? onMinus : null,
            icon: const Icon(Icons.remove),
          ),
          Text(
            'Qty $quantity',
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          IconButton(
            visualDensity: VisualDensity.compact,
            onPressed: enabled ? onPlus : null,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
    );
  }
}

class _CouponBar extends StatelessWidget {
  const _CouponBar({
    required this.controller,
    required this.cart,
    required this.busy,
    required this.signedIn,
    required this.onApply,
    required this.onRemove,
    required this.onLogin,
  });

  final TextEditingController controller;
  final Cart cart;
  final bool busy;
  final bool signedIn;
  final VoidCallback onApply;
  final VoidCallback onRemove;
  final VoidCallback onLogin;

  @override
  Widget build(BuildContext context) {
    final coupon = cart.coupon;
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.local_offer_outlined, color: kShopBlue),
                const SizedBox(width: 8),
                const Expanded(
                  child: Text(
                    'Coupons and offers',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                if (!signedIn)
                  TextButton(
                    onPressed: onLogin,
                    child: const Text('Log in >'),
                  ),
              ],
            ),
            if (signedIn && coupon == null)
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: controller,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        hintText: 'Enter code',
                        isDense: true,
                      ),
                      onSubmitted: (_) {
                        if (!busy) onApply();
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: busy ? null : onApply,
                    child: Text(busy ? '...' : 'Apply'),
                  ),
                ],
              ),
            if (coupon != null)
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${coupon.code} · ${coupon.title}',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                  Text(
                    cart.discountLabel,
                    style: const TextStyle(
                      color: _kBagGreen,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  IconButton(
                    onPressed: busy ? null : onRemove,
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            if (cart.couponError.isNotEmpty)
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  cart.couponError,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _PriceDetails extends StatelessWidget {
  const _PriceDetails({
    required this.cart,
    required this.expanded,
    required this.onToggle,
  });

  final Cart cart;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.06)),
      ),
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.shopping_bag_outlined, color: kShopBlue),
            title: const Text(
              'Price details',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  cart.totalLabel,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                Icon(expanded ? Icons.expand_less : Icons.expand_more),
              ],
            ),
            onTap: onToggle,
          ),
          if (expanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Column(
                children: [
                  _priceRow('Bag MRP', cartMoney(cart.currency, cart.mrpTotal)),
                  _priceRow('Bag total', cart.subtotalLabel),
                  if (cart.itemSavings > 0)
                    _priceRow(
                      'Item savings',
                      cartMoney(cart.currency, cart.itemSavings, minus: true),
                      color: _kBagGreen,
                    ),
                  if (cart.discountAmount > 0)
                    _priceRow(
                      'Coupon ${cart.coupon?.code ?? ''}',
                      cart.discountLabel,
                      color: _kBagGreen,
                    ),
                  _priceRow(
                    cart.taxIncluded ? 'GST (included)' : 'Tax',
                    cart.taxLabel,
                  ),
                  _priceRow('Delivery', cart.shippingValueLabel, color: _kBagGreen),
                  const Divider(),
                  _priceRow('Grand total', cart.totalLabel, bold: true),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _priceRow(String label, String value, {Color? color, bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label)),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontWeight: bold ? FontWeight.w900 : FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _RecommendRow extends StatelessWidget {
  const _RecommendRow({
    required this.title,
    required this.products,
    this.onAdd,
  });

  final String title;
  final List<CatalogProduct> products;
  final ValueChanged<CatalogProduct>? onAdd;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 16,
            color: _kBagInk,
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 210,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: products.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (context, index) {
              final product = products[index];
              return SizedBox(
                width: 132,
                child: InkWell(
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ProductDetailScreen(product: product),
                      ),
                    );
                  },
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: ColoredBox(
                            color: const Color(0xFFE8F2FF),
                            child: product.thumbnailUrl.isEmpty
                                ? const Center(
                                    child: Icon(
                                      Icons.image_outlined,
                                      color: kShopBlue,
                                    ),
                                  )
                                : ProductContainedImage(
                                    url: product.thumbnailUrl,
                                    compact: true,
                                    placeholder: const Icon(
                                      Icons.image_outlined,
                                      color: kShopBlue,
                                    ),
                                  ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        product.priceLabel,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      if (onAdd != null)
                        TextButton(
                          onPressed: () => onAdd!(product),
                          child: const Text('Add'),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _StickyCheckoutBar extends StatelessWidget {
  const _StickyCheckoutBar({required this.cart, required this.onContinue});

  final Cart cart;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 12,
      color: Colors.white,
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (cart.totalSavings > 0)
              Container(
                width: double.infinity,
                color: const Color(0xFFE8F8EE),
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Text(
                  'You are saving ${cartMoney(cart.currency, cart.totalSavings)} on this order',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: _kBagGreen,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
              child: Row(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        cart.totalLabel,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 20,
                          color: _kBagInk,
                        ),
                      ),
                      const Text(
                        'Grand total',
                        style: TextStyle(color: _kBagMuted, fontSize: 12),
                      ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: FilledButton(
                        onPressed: onContinue,
                        child: const Text('Continue'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

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
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
