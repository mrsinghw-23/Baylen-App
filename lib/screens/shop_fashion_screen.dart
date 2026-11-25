import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../data/shop_brand_catalog.dart';
import '../data/shop_fashion_catalog.dart';
import '../theme/shop_theme.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../widgets/shop/shop_location_header.dart';
import 'addresses_screen.dart';
import 'cart_screen.dart';
import 'login_screen.dart';
import 'notifications_screen.dart';
import 'shop_brands_screen.dart';
import 'shop_catalog_screen.dart';
import 'wishlist_screen.dart';

class ShopFashionScreen extends StatefulWidget {
  const ShopFashionScreen({super.key});

  @override
  State<ShopFashionScreen> createState() => _ShopFashionScreenState();
}

class _ShopFashionScreenState extends State<ShopFashionScreen> {
  final _promoController = PageController();
  Timer? _promoTimer;
  int _promoIndex = 0;

  @override
  void initState() {
    super.initState();
    _promoTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !_promoController.hasClients) return;
      final next = (_promoIndex + 1) % ShopFashionCatalog.promos.length;
      _promoController.animateToPage(
        next,
        duration: const Duration(milliseconds: 420),
        curve: Curves.easeInOut,
      );
    });
  }

  @override
  void dispose() {
    _promoTimer?.cancel();
    _promoController.dispose();
    super.dispose();
  }

  void _openQuery(String query) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopCatalogScreen(initialQuery: query),
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
      return;
    }
    LocationPickerSheet.show(context, onLocationSelected: () {});
  }

  void _openBeautyAdvice() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: const [
            Text(
              'Baylen Beauty Advice',
              style: TextStyle(
                fontWeight: FontWeight.w800,
                fontSize: 18,
                color: kShopInk,
              ),
            ),
            SizedBox(height: 8),
            Text(
              'Browse Baylen De Louis beauty categories for products and care.',
              style: TextStyle(color: kShopMuted),
            ),
          ],
        );
      },
    );
  }

  Widget _promoPager({required bool vertical}) {
    return PageView.builder(
      controller: _promoController,
      scrollDirection: vertical ? Axis.vertical : Axis.horizontal,
      onPageChanged: (index) => setState(() => _promoIndex = index),
      itemCount: ShopFashionCatalog.promos.length,
      itemBuilder: (context, index) {
        final slide = ShopFashionCatalog.promos[index];
        return _FashionPromoCard(
          slide: slide,
          onShopNow: () => _openQuery(slide.query),
        );
      },
    );
  }

  Widget _menuColumns() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 16, 8, 24),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final column in ShopFashionCatalog.columns)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(right: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final group in column)
                      _FashionGroupBlock(
                        group: group,
                        onTap: _openQuery,
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _compactMenu() {
    final groups = ShopFashionCatalog.groups;
    final mid = (groups.length / 2).ceil();
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final group in groups.take(mid))
                  _FashionGroupBlock(group: group, onTap: _openQuery),
              ],
            ),
          ),
          const SizedBox(width: 18),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final group in groups.skip(mid))
                  _FashionGroupBlock(group: group, onTap: _openQuery),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ShopThemeScope(
      child: Scaffold(
      backgroundColor: const Color(0xFFF6F7F9),
      body: Column(
        children: [
          Container(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [kShopBlue, kShopCyan],
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Back',
                    onPressed: () => Navigator.of(context).pop(),
                    color: Colors.white,
                    icon: const Icon(Icons.arrow_back),
                  ),
                  Expanded(
                    child: ShopLocationHeader(
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
                  ),
                ],
              ),
            ),
          ),
          ColoredBox(
            color: Colors.white,
            child: SizedBox(
              height: 38,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  _NavLink(
                    label: 'Categories',
                    onTap: () => _openQuery(''),
                  ),
                  _NavLink(
                    label: 'Brands',
                    onTap: () => _openBrands(),
                  ),
                  _NavLink(
                    label: 'Baylen Luxe',
                    onTap: () => _openBrands(tab: ShopBrandTab.luxe),
                  ),
                  const _NavLink(label: 'Baylen Fashion', selected: true),
                  _NavLink(
                    label: 'Beauty Advice',
                    onTap: _openBeautyAdvice,
                  ),
                ],
              ),
            ),
          ),
          const Divider(height: 1, color: Color(0xFFE6EEF8)),
          Expanded(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final wide = constraints.maxWidth >= 720;
                if (wide) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(child: _menuColumns()),
                      SizedBox(
                        width: 220,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(0, 12, 12, 12),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: _promoPager(vertical: true),
                          ),
                        ),
                      ),
                    ],
                  );
                }
                return Column(
                  children: [
                    SizedBox(
                      height: 210,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: _promoPager(vertical: false),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: Row(
                        children: List.generate(
                          ShopFashionCatalog.promos.length,
                          (index) => Container(
                            width: 7,
                            height: 7,
                            margin: const EdgeInsets.only(right: 6),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: _promoIndex == index
                                  ? kShopBlue
                                  : const Color(0xFFCDD6E4),
                            ),
                          ),
                        ),
                      ),
                    ),
                    Expanded(child: _compactMenu()),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    ),
    );
  }
}

class _FashionGroupBlock extends StatelessWidget {
  const _FashionGroupBlock({required this.group, required this.onTap});

  final FashionGroup group;
  final ValueChanged<String> onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (group.title.isNotEmpty)
            GestureDetector(
              onTap: () => onTap(group.title),
              child: Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  group.title,
                  style: const TextStyle(
                    color: kShopInk,
                    fontWeight: FontWeight.w800,
                    fontSize: 14,
                  ),
                ),
              ),
            ),
          for (final item in group.items)
            GestureDetector(
              onTap: () => onTap(item.label),
              behavior: HitTestBehavior.opaque,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text(
                  item.label,
                  style: TextStyle(
                    color: item.featured ? kShopBlue : kShopMuted,
                    fontWeight: item.featured
                        ? FontWeight.w800
                        : FontWeight.w500,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _FashionPromoCard extends StatelessWidget {
  const _FashionPromoCard({required this.slide, required this.onShopNow});

  final FashionPromoSlide slide;
  final VoidCallback onShopNow;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onShopNow,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [kShopBlue, kShopCyan],
              ),
            ),
            child: Image.asset(
              slide.imageAsset,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => const SizedBox.expand(),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.black.withValues(alpha: 0.08),
                  Colors.black.withValues(alpha: 0.62),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  slide.kicker,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 11,
                    letterSpacing: 1.2,
                  ),
                ),
                const Spacer(),
                Text(
                  slide.title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 22,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  slide.subtitle,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'SHOP NOW',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                    decoration: TextDecoration.underline,
                    decorationColor: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NavLink extends StatelessWidget {
  const _NavLink({
    required this.label,
    this.selected = false,
    this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

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
            style: TextStyle(
              color: selected ? kShopBlue : kShopInk,
              fontWeight: FontWeight.w800,
              fontSize: 14,
            ),
          ),
        ),
      ),
    );
  }
}
