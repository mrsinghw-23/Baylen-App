import 'dart:async';

import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../data/shop_brand_catalog.dart';
import '../models/catalog.dart';
import '../services/cart_service.dart';
import '../services/delivery_location_service.dart';
import '../utils/fulfillment_helpers.dart';
import '../services/notification_service.dart';
import '../auth/auth_gate.dart';
import '../theme/shop_theme.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../widgets/product_contained_image.dart';
import '../widgets/location/required_location_panel.dart';
import '../widgets/shop/shop_location_header.dart';
import 'addresses_screen.dart';
import 'cart_screen.dart';
import 'login_screen.dart';
import 'notifications_screen.dart';
import 'product_detail_screen.dart';
import 'shop_brands_screen.dart';
import 'shop_catalog_screen.dart';
import 'shop_fashion_screen.dart';
import 'wishlist_screen.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  final _api = CatalystApi();
  final _pageController = PageController();
  Timer? _hintTimer;
  Timer? _bannerTimer;

  ShopHome? _home;
  bool _loading = true;
  String? _error;
  String? _hubId;
  int _hintIndex = 0;
  int _bannerIndex = 0;
  String? _addingProductId;
  List<CatalogProduct> _filteredGlow = const [];
  bool _filteringGlow = false;
  int _glowRequest = 0;
  bool _hasDeliveryLocation = false;

  static const _shopFilterSlugs = [
    'makeup',
    'skin',
    'hair',
    'appliances',
    'bath-and-body',
    'natural',
    'mom-and-baby',
    'health-and-wellness',
    'men',
    'fragrance',
    'fashion-selects',
  ];

  List<ShopHomeTile> get _hubs {
    final all = _home?.hubs ?? const [];
    final filtered = all
        .where((hub) => _shopFilterSlugs.contains(hub.slug))
        .toList();
    filtered.sort(
      (a, b) =>
          _shopFilterSlugs.indexOf(a.slug) - _shopFilterSlugs.indexOf(b.slug),
    );
    return filtered;
  }

  List<ShopHomeTile> get _tiles => _hubs;

  List<CatalogProduct> get _glowProducts {
    if (_hubId != null && _hubId!.isNotEmpty) {
      return _filteredGlow;
    }
    return _home?.glowProducts ?? const [];
  }

  @override
  void initState() {
    super.initState();
    CartService.instance.fetchCart();
    NotificationService.instance.refreshUnreadCount();
    _load();
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    _bannerTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final home = await _api.shopHome(
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted) return;
      setState(() {
        _home = home;
        _hasDeliveryLocation = coords.hasCoordinates;
        _loading = false;
        _hintIndex = 0;
        _bannerIndex = 0;
      });
      _startHintRotation();
      _startBannerRotation();
      if (_hubId != null && _hubId!.isNotEmpty) {
        await _loadGlowForCategory(_hubId!);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Shop data is temporarily unavailable.';
      });
    }
  }

  void _startHintRotation() {
    _hintTimer?.cancel();
    final hints = _home?.searchHints ?? const [];
    if (hints.length < 2) {
      return;
    }
    _hintTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted) return;
      setState(() => _hintIndex = (_hintIndex + 1) % hints.length);
    });
  }

  void _startBannerRotation() {
    _bannerTimer?.cancel();
    final banners = _home?.banners ?? const [];
    if (banners.length < 2) {
      return;
    }
    _bannerTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || !_pageController.hasClients) return;
      final next = (_bannerIndex + 1) % banners.length;
      _pageController.animateToPage(
        next,
        duration: const Duration(milliseconds: 420),
        curve: Curves.easeInOut,
      );
    });
  }

  void _openCatalog({
    String? categoryId,
    String? brandId,
    String query = '',
    bool autofocusSearch = false,
  }) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopCatalogScreen(
          categoryId: categoryId,
          brandId: brandId,
          initialQuery: query,
          autofocusSearch: autofocusSearch,
        ),
      ),
    );
  }

  void _openBrands({ShopBrandTab tab = ShopBrandTab.popular}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopBrandsScreen(initialTab: tab),
      ),
    );
  }

  void _openLuxe() {
    _openBrands(tab: ShopBrandTab.luxe);
  }

  void _openFashion() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const ShopFashionScreen(),
      ),
    );
  }

  Future<void> _onSelectHub(String id) async {
    if (_hubId == id) {
      setState(() {
        _hubId = null;
        _filteredGlow = const [];
        _filteringGlow = false;
      });
      return;
    }
    setState(() {
      _hubId = id;
    });
    await _loadGlowForCategory(id);
  }

  Future<void> _loadGlowForCategory(String categoryId) async {
    final request = ++_glowRequest;
    setState(() => _filteringGlow = true);
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final pageData = await _api.productsPage(
        categoryId: categoryId,
        page: 1,
        limit: 24,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted || request != _glowRequest) {
        return;
      }
      final items = pageData['products'];
      final products = items is List
          ? items
                .whereType<Map<String, dynamic>>()
                .map(CatalogProduct.fromJson)
                .toList()
          : <CatalogProduct>[];
      setState(() {
        _filteredGlow = products;
        _filteringGlow = false;
        _hasDeliveryLocation = coords.hasCoordinates;
      });
    } catch (_) {
      if (!mounted || request != _glowRequest) {
        return;
      }
      setState(() {
        _filteredGlow = const [];
        _filteringGlow = false;
      });
    }
  }

  void _openBeautyAdvice() {
    final hubs = _hubs;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 24),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Text(
                'Baylen Beauty Advice',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                  color: kShopInk,
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Text(
                'Browse Baylen De Louis beauty categories for products and care.',
                style: TextStyle(color: kShopMuted),
              ),
            ),
            if (hubs.isEmpty)
              ListTile(
                title: const Text('Shop Baylen De Louis'),
                onTap: () {
                  Navigator.pop(context);
                  _openCatalog();
                },
              )
            else
              ...hubs.map(
                (hub) => ListTile(
                  title: Text(hub.name),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.pop(context);
                    _openCatalog(categoryId: hub.id);
                  },
                ),
              ),
          ],
        );
      },
    );
  }

  Future<void> _openWishlist() async {
    final signedIn = await AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to view your wishlist',
    );
    if (!signedIn || !mounted) return;
    Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => const WishlistScreen()));
  }

  Future<void> _openNotifications() async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (!mounted || signedIn != true) return;
    }
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => const NotificationsScreen()),
    );
  }

  Future<void> _openAddress() async {
    if (AuthService.instance.isSignedIn) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const AddressesScreen()),
      );
      DeliveryLocationService.instance.invalidate();
      if (_hubId != null && _hubId!.isNotEmpty) {
        await _loadGlowForCategory(_hubId!);
      } else {
        await _load();
      }
      return;
    }
    LocationPickerSheet.show(context, onLocationSelected: () {
      DeliveryLocationService.instance.invalidate();
      _load();
    });
  }

  void _openBanner(ShopHomeBanner banner) {
    final type = banner.actionType.toUpperCase();
    if (type == 'PRODUCT' && banner.actionValue.isNotEmpty) {
      final product = _home?.glowProducts.where((item) => item.id == banner.actionValue);
      if (product != null && product.isNotEmpty) {
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ProductDetailScreen(product: product.first),
          ),
        );
        return;
      }
    }
    _openCatalog();
  }

  Future<void> _addToCart(CatalogProduct product) async {
    if (product.isZohoCommerceProduct) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'This product is live from Zoho Commerce. Cart will unlock after Commerce checkout is configured.',
          ),
        ),
      );
      return;
    }
    if (!catalogProductCanAdd(product, hasLocation: _hasDeliveryLocation)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('This product is out of stock')),
      );
      return;
    }
    if (product.hasVariants) {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ProductDetailScreen(product: product),
        ),
      );
      return;
    }
    setState(() => _addingProductId = product.id);
    try {
      await CartService.instance.addToCart(product.id, '', 1);
      if (!mounted) return;
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
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _addingProductId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hints = _home?.searchHints ?? const ['products'];
    final hint = hints.isEmpty ? 'products' : hints[_hintIndex % hints.length];
    final banners = _home?.banners ?? const <ShopHomeBanner>[];
    final offers = _home?.offers ?? const <ShopHomeOffer>[];
    final glow = _glowProducts;

    return ShopThemeScope(
      child: Scaffold(
      backgroundColor: kShopSurface,
      body: RefreshIndicator(
        color: kShopBlue,
        onRefresh: _load,
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(
              child: Container(
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [kShopBlue, kShopCyan],
                  ),
                ),
                child: SafeArea(
                  bottom: false,
                  child: Column(
                    children: [
                      ShopLocationHeader(
                        onAddressTap: _openAddress,
                        onNotifyTap: _openNotifications,
                        onWishlistTap: _openWishlist,
                        onCartTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => const CartScreen(),
                            ),
                          );
                        },
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                        child: GestureDetector(
                          onTap: () => _openCatalog(autofocusSearch: true),
                          child: Container(
                            height: 48,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(12),
                              boxShadow: [
                                BoxShadow(
                                  color: kShopBlue.withValues(alpha: 0.18),
                                  blurRadius: 12,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              children: [
                                const SizedBox(width: 14),
                                const Icon(Icons.search, color: kShopMuted),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text.rich(
                                    TextSpan(
                                      text: 'Search for ',
                                      style: const TextStyle(
                                        color: kShopMuted,
                                        fontSize: 14,
                                      ),
                                      children: [
                                        TextSpan(
                                          text: hint,
                                          style: const TextStyle(
                                            color: kShopBlue,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: ColoredBox(
                color: Colors.white,
                child: Column(
                  children: [
                    _BaylenMainNav(
                      onCategories: () => _openCatalog(),
                      onBrands: () => _openBrands(),
                      onLuxe: _openLuxe,
                      onFashion: _openFashion,
                      onBeautyAdvice: _openBeautyAdvice,
                    ),
                    const Divider(height: 1, color: Color(0xFFE6EEF8)),
                    _BaylenCategoryBar(
                      loading: _loading,
                      hubs: _hubs,
                      selectedId: _hubId,
                      onSelectHub: _onSelectHub,
                    ),
                  ],
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 12, 0, 8),
                child: _loading
                    ? const SizedBox(
                        height: 180,
                        child: Center(child: CircularProgressIndicator()),
                      )
                    : banners.isNotEmpty
                    ? SizedBox(
                        height: 200,
                        child: PageView.builder(
                          controller: _pageController,
                          itemCount: banners.length,
                          onPageChanged: (index) =>
                              setState(() => _bannerIndex = index),
                          itemBuilder: (context, index) {
                            return _HeroCard(
                              banner: banners[index],
                              onShopNow: () => _openBanner(banners[index]),
                            );
                          },
                        ),
                      )
                    : _HeroCard(
                        banner: const ShopHomeBanner(
                          id: '',
                          title: 'Baylen Beauty Picks',
                          subtitle:
                              'Shop makeup, skin, and hair from the Baylen De Louis catalog',
                          imageUrl: '',
                          actionType: 'SHOP',
                          actionValue: '',
                          ctaLabel: 'Shop Now',
                        ),
                        onShopNow: _openCatalog,
                      ),
              ),
            ),
            if (_error != null)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: _ErrorBanner(message: _error!, onRetry: _load),
                ),
              ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
                child: GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _tiles.isEmpty && _loading ? 4 : _tiles.length,
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 4,
                    mainAxisSpacing: 10,
                    crossAxisSpacing: 10,
                    childAspectRatio: 0.78,
                  ),
                  itemBuilder: (context, index) {
                    if (_tiles.isEmpty) {
                      return const _CategorySkeleton();
                    }
                    final tile = _tiles[index];
                    return _CategoryCard(
                      tile: tile,
                      onTap: () => _openCatalog(categoryId: tile.id),
                    );
                  },
                ),
              ),
            ),
            if (offers.isNotEmpty)
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 72,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    scrollDirection: Axis.horizontal,
                    itemCount: offers.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 10),
                    itemBuilder: (context, index) {
                      final offer = offers[index];
                      return _OfferChip(
                        offer: offer,
                        onTap: () {
                          _openCatalog();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                'Use ${offer.code} at checkout. ${offer.description}',
                              ),
                            ),
                          );
                        },
                      );
                    },
                  ),
                ),
              ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Row(
                  children: const [
                    Expanded(
                      child: Divider(color: kShopCyan, thickness: 1.2),
                    ),
                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 10),
                      child: Text(
                        'Baylen Glow Picks',
                        style: TextStyle(
                          color: kShopBlue,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Divider(color: kShopCyan, thickness: 1.2),
                    ),
                  ],
                ),
              ),
            ),
            if (!_hasDeliveryLocation)
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                  child: RequiredLocationPanel(
                    compact: true,
                    requireDeviceGps: false,
                    onLocationReady: () {
                      DeliveryLocationService.instance.invalidate();
                      _load();
                    },
                  ),
                ),
              ),
            if (_filteringGlow)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              )
            else if (glow.isEmpty && !_loading)
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(
                    child: Text(
                      'No live products in this shop category yet.',
                      style: TextStyle(color: kShopMuted),
                    ),
                  ),
                ),
              )
            else
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 250,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    scrollDirection: Axis.horizontal,
                    itemCount: glow.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 12),
                    itemBuilder: (context, index) {
                      final product = glow[index];
                      return _GlowProductCard(
                        product: product,
                        hasLocation: _hasDeliveryLocation,
                        adding: _addingProductId == product.id,
                        onOpen: () {
                          Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) =>
                                  ProductDetailScreen(product: product),
                            ),
                          );
                        },
                        onAdd: () => _addToCart(product),
                      );
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
    );
  }
}

class _BaylenMainNav extends StatelessWidget {
  const _BaylenMainNav({
    required this.onCategories,
    required this.onBrands,
    required this.onLuxe,
    required this.onFashion,
    required this.onBeautyAdvice,
  });

  final VoidCallback onCategories;
  final VoidCallback onBrands;
  final VoidCallback onLuxe;
  final VoidCallback onFashion;
  final VoidCallback onBeautyAdvice;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 38,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          _MainNavLink(label: 'Categories', onTap: onCategories),
          _MainNavLink(label: 'Brands', onTap: onBrands),
          _MainNavLink(label: 'Baylen Luxe', onTap: onLuxe),
          _MainNavLink(label: 'Baylen Fashion', onTap: onFashion),
          _MainNavLink(label: 'Beauty Advice', onTap: onBeautyAdvice),
        ],
      ),
    );
  }
}

class _MainNavLink extends StatelessWidget {
  const _MainNavLink({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 18),
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Center(
          child: Text(
            label,
            style: const TextStyle(
              color: kShopInk,
              fontWeight: FontWeight.w800,
              fontSize: 14,
            ),
          ),
        ),
      ),
    );
  }
}

class _BaylenCategoryBar extends StatefulWidget {
  const _BaylenCategoryBar({
    required this.loading,
    required this.hubs,
    required this.selectedId,
    required this.onSelectHub,
  });

  final bool loading;
  final List<ShopHomeTile> hubs;
  final String? selectedId;
  final ValueChanged<String> onSelectHub;

  static const _fallbackLabels = [
    'Makeup',
    'Skin',
    'Hair',
    'Appliances',
    'Bath & Body',
    'Natural',
    'Mom & Baby',
    'Health & Wellness',
    'Men',
    'Fragrance',
    'Fashion Selects',
  ];

  @override
  State<_BaylenCategoryBar> createState() => _BaylenCategoryBarState();
}

class _BaylenCategoryBarState extends State<_BaylenCategoryBar> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final chips = widget.hubs.isNotEmpty
        ? widget.hubs
              .map((hub) => (id: hub.id, label: hub.name))
              .toList()
        : widget.loading
        ? _BaylenCategoryBar._fallbackLabels
              .map((label) => (id: '', label: label))
              .toList()
        : <({String id, String label})>[];

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 8, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Shop by category',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: kShopInk,
                  ),
                ),
              ),
              GestureDetector(
                onTap: () => setState(() => _expanded = !_expanded),
                behavior: HitTestBehavior.opaque,
                child: Row(
                  children: [
                    Text(
                      _expanded ? 'Less' : 'More',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: kShopBlue,
                      ),
                    ),
                    Icon(
                      _expanded ? Icons.expand_less : Icons.expand_more,
                      size: 18,
                      color: kShopBlue,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_expanded)
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: chips
                  .map(
                    (chip) => _CategoryFilterChip(
                      label: chip.label,
                      selected:
                          chip.id.isNotEmpty && widget.selectedId == chip.id,
                      onTap: chip.id.isEmpty
                          ? null
                          : () => widget.onSelectHub(chip.id),
                    ),
                  )
                  .toList(),
            )
          else
            SizedBox(
              height: 32,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: chips.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (context, index) {
                  final chip = chips[index];
                  return _CategoryFilterChip(
                    label: chip.label,
                    selected:
                        chip.id.isNotEmpty && widget.selectedId == chip.id,
                    onTap: chip.id.isEmpty
                        ? null
                        : () => widget.onSelectHub(chip.id),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _CategoryFilterChip extends StatelessWidget {
  const _CategoryFilterChip({
    required this.label,
    required this.selected,
    this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? kShopBlue : const Color(0xFFF3F7FC),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? kShopBlue : const Color(0xFFE6EEF8),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: selected ? Colors.white : kShopInk,
          ),
        ),
      ),
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.banner, required this.onShopNow});

  final ShopHomeBanner banner;
  final VoidCallback onShopNow;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (banner.imageUrl.isNotEmpty)
              Image.network(
                banner.imageUrl,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => const ColoredBox(color: kShopBlue),
              )
            else
              const ColoredBox(color: kShopBlue),
            Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [
                    kShopBlue.withValues(alpha: 0.82),
                    kShopCyan.withValues(alpha: 0.18),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    banner.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    banner.subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white, fontSize: 13),
                  ),
                  const Spacer(),
                  FilledButton(
                    onPressed: onShopNow,
                    style: FilledButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: kShopBlue,
                    ),
                    child: Text('${banner.ctaLabel}  →'),
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

class _CategoryCard extends StatelessWidget {
  const _CategoryCard({required this.tile, required this.onTap});

  final ShopHomeTile tile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: kShopBlue.withValues(alpha: 0.12),
              blurRadius: 8,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        padding: const EdgeInsets.all(6),
        child: Column(
          children: [
            Text(
              tile.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: kShopInk,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 4),
            Expanded(
              child: tile.imageUrl.isEmpty
                  ? const Icon(Icons.spa_outlined, color: kShopBlue)
                  : Image.network(
                      tile.imageUrl,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) =>
                          const Icon(Icons.spa_outlined, color: kShopBlue),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CategorySkeleton extends StatelessWidget {
  const _CategorySkeleton();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
      ),
    );
  }
}

class _OfferChip extends StatelessWidget {
  const _OfferChip({required this.offer, required this.onTap});

  final ShopHomeOffer offer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: 220,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: kShopCyan),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              offer.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: kShopInk,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              offer.code,
              style: const TextStyle(
                color: kShopBlue,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GlowProductCard extends StatelessWidget {
  const _GlowProductCard({
    required this.product,
    required this.hasLocation,
    required this.adding,
    required this.onOpen,
    required this.onAdd,
  });

  final CatalogProduct product;
  final bool hasLocation;
  final bool adding;
  final VoidCallback onOpen;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final soldOut = catalogProductSoldOut(product, hasLocation: hasLocation);
    final badges = catalogDeliveryBadges(product, hasLocation: hasLocation);
    return SizedBox(
      width: 168,
      child: InkWell(
        onTap: onOpen,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: kShopCyan.withValues(alpha: 0.6)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(14),
                ),
                child: SizedBox(
                  height: 120,
                  width: double.infinity,
                  child: product.thumbnailUrl.isEmpty
                      ? const ColoredBox(
                          color: kShopSurface,
                          child: Icon(Icons.spa_outlined, color: kShopBlue),
                        )
                      : ProductContainedImage(
                          url: product.thumbnailUrl,
                          placeholder: const Icon(
                            Icons.spa_outlined,
                            color: kShopBlue,
                          ),
                        ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: kShopInk,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      product.priceLabel,
                      style: const TextStyle(
                        color: kShopBlue,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    if (badges.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      ...badges.map(
                        (badge) => Padding(
                          padding: const EdgeInsets.only(bottom: 2),
                          child: Text(
                            badge,
                            style: const TextStyle(
                              color: kShopMuted,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: soldOut || adding ? null : onAdd,
                        style: FilledButton.styleFrom(
                          backgroundColor: kShopBlue,
                          foregroundColor: Colors.white,
                          minimumSize: const Size.fromHeight(34),
                        ),
                        child: adding
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(soldOut ? 'Sold out' : 'Add'),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: kShopBlue.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.cloud_off_outlined, color: kShopBlue),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message, style: const TextStyle(color: kShopInk)),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}
