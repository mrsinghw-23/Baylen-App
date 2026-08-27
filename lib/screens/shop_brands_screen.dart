import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../data/shop_brand_catalog.dart';
import '../models/catalog.dart';
import '../theme/shop_theme.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../widgets/shop/shop_location_header.dart';
import 'addresses_screen.dart';
import 'cart_screen.dart';
import 'login_screen.dart';
import 'notifications_screen.dart';
import 'shop_catalog_screen.dart';
import 'shop_fashion_screen.dart';
import 'wishlist_screen.dart';

class ShopBrandsScreen extends StatefulWidget {
  const ShopBrandsScreen({
    super.key,
    this.initialTab = ShopBrandTab.popular,
  });

  final ShopBrandTab initialTab;

  @override
  State<ShopBrandsScreen> createState() => _ShopBrandsScreenState();
}

class _BrandEntry {
  const _BrandEntry({
    required this.name,
    this.id = '',
    this.logoUrl = '',
  });

  final String name;
  final String id;
  final String logoUrl;
}

class _ShopBrandsScreenState extends State<ShopBrandsScreen> {
  final _api = CatalystApi();
  final _brandSearch = TextEditingController();
  final _sidebarScroll = ScrollController();

  late ShopBrandTab _tab;
  List<CatalogBrand> _liveBrands = const [];
  String _query = '';

  @override
  void initState() {
    super.initState();
    _tab = widget.initialTab;
    _loadLiveBrands();
  }

  @override
  void dispose() {
    _brandSearch.dispose();
    _sidebarScroll.dispose();
    super.dispose();
  }

  Future<void> _loadLiveBrands() async {
    try {
      final brands = await _api.brands();
      if (!mounted) return;
      setState(() => _liveBrands = brands);
    } catch (_) {
      if (!mounted) return;
    }
  }

  Map<String, CatalogBrand> get _liveByKey {
    final map = <String, CatalogBrand>{};
    for (final brand in _liveBrands) {
      map[ShopBrandCatalog.normalize(brand.name)] = brand;
    }
    return map;
  }

  CatalogBrand? _matchLive(String name) {
    final live = _liveByKey;
    final key = ShopBrandCatalog.normalize(name);
    final direct = live[key];
    if (direct != null) {
      return direct;
    }
    if (key.startsWith('baylen')) {
      return live['baylen'];
    }
    return null;
  }

  List<_BrandEntry> get _allBrands {
    final entries = <String, _BrandEntry>{};
    for (final name in ShopBrandCatalog.allNames()) {
      final display = ShopBrandCatalog.displayName(name);
      final live = _matchLive(display);
      entries[ShopBrandCatalog.normalize(display)] = _BrandEntry(
        name: display,
        id: live?.id ?? '',
        logoUrl: live?.logoUrl ?? '',
      );
    }
    for (final brand in _liveBrands) {
      final key = ShopBrandCatalog.normalize(brand.name);
      if (entries.containsKey(key)) {
        continue;
      }
      entries[key] = _BrandEntry(
        name: ShopBrandCatalog.displayName(brand.name),
        id: brand.id,
        logoUrl: brand.logoUrl,
      );
    }
    final list = entries.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    return _filter(list);
  }

  List<_BrandEntry> get _gridBrands {
    final names = ShopBrandCatalog.namesFor(_tab);
    final list = names
        .map((name) {
          final display = ShopBrandCatalog.displayName(name);
          final live = _matchLive(display);
          return _BrandEntry(
            name: display,
            id: live?.id ?? '',
            logoUrl: live?.logoUrl ?? '',
          );
        })
        .toList();
    if (_tab == ShopBrandTab.popular) {
      final seen = list.map((item) => ShopBrandCatalog.normalize(item.name)).toSet();
      for (final brand in _liveBrands) {
        final key = ShopBrandCatalog.normalize(brand.name);
        if (seen.add(key) && !key.startsWith('baylen')) {
          list.add(
            _BrandEntry(
              name: ShopBrandCatalog.displayName(brand.name),
              id: brand.id,
              logoUrl: brand.logoUrl,
            ),
          );
        }
      }
    }
    return _filter(list);
  }

  List<_BrandEntry> _filter(List<_BrandEntry> brands) {
    final query = ShopBrandCatalog.normalize(_query);
    if (query.isEmpty) {
      return brands;
    }
    return brands
        .where((brand) => ShopBrandCatalog.normalize(brand.name).contains(query))
        .toList();
  }

  void _jumpToLetter(String letter) {
    final brands = _allBrands;
    final index = brands.indexWhere(
      (brand) => ShopBrandCatalog.letterOf(brand.name) == letter,
    );
    if (index < 0 || !_sidebarScroll.hasClients) {
      return;
    }
    _sidebarScroll.animateTo(
      (index * 36.0).clamp(0.0, _sidebarScroll.position.maxScrollExtent),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOut,
    );
  }

  void _openBrand(_BrandEntry brand) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopCatalogScreen(
          brandId: brand.id.isEmpty ? null : brand.id,
          initialQuery: brand.id.isEmpty ? brand.name : '',
        ),
      ),
    );
  }

  void _openCatalog({String query = '', bool autofocusSearch = false}) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopCatalogScreen(
          initialQuery: query,
          autofocusSearch: autofocusSearch,
        ),
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

  @override
  Widget build(BuildContext context) {
    final allBrands = _allBrands;
    final gridBrands = _gridBrands;
    final letters = <String>{
      for (final brand in allBrands) ShopBrandCatalog.letterOf(brand.name),
    };

    return Scaffold(
      backgroundColor: kShopSurface,
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
                    onTap: () => _openCatalog(),
                  ),
                  const _NavLink(label: 'Brands', selected: true),
                  _NavLink(
                    label: 'Baylen Luxe',
                    selected: _tab == ShopBrandTab.luxe,
                    onTap: () => setState(() => _tab = ShopBrandTab.luxe),
                  ),
                  _NavLink(
                    label: 'Baylen Fashion',
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const ShopFashionScreen(),
                        ),
                      );
                    },
                  ),
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
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 138,
                  child: ColoredBox(
                    color: const Color(0xFFF7F8FA),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(8, 10, 8, 8),
                          child: TextField(
                            controller: _brandSearch,
                            onChanged: (value) => setState(() => _query = value),
                            decoration: InputDecoration(
                              hintText: 'Search Brands',
                              isDense: true,
                              prefixIcon: const Icon(Icons.search, size: 18),
                              filled: true,
                              fillColor: Colors.white,
                              contentPadding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 8,
                              ),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(8),
                                borderSide: const BorderSide(
                                  color: Color(0xFFE6EEF8),
                                ),
                              ),
                            ),
                          ),
                        ),
                        Expanded(
                          child: Row(
                            children: [
                              Expanded(
                                child: ListView.builder(
                                  controller: _sidebarScroll,
                                  padding: const EdgeInsets.only(bottom: 16),
                                  itemCount: allBrands.length,
                                  itemBuilder: (context, index) {
                                    final brand = allBrands[index];
                                    return InkWell(
                                      onTap: () => _openBrand(brand),
                                      child: Padding(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 10,
                                          vertical: 9,
                                        ),
                                        child: Text(
                                          brand.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: kShopInk,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    );
                                  },
                                ),
                              ),
                              SizedBox(
                                width: 16,
                                child: ListView(
                                  children: [
                                    for (final letter in letters.toList()..sort())
                                      GestureDetector(
                                        onTap: () => _jumpToLetter(letter),
                                        child: Padding(
                                          padding: const EdgeInsets.symmetric(
                                            vertical: 2,
                                          ),
                                          child: Text(
                                            letter,
                                            textAlign: TextAlign.center,
                                            style: const TextStyle(
                                              color: kShopBlue,
                                              fontSize: 9,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const VerticalDivider(width: 1, color: Color(0xFFE6EEF8)),
                Expanded(
                  child: ColoredBox(
                    color: const Color(0xFFF4F6F8),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(10, 10, 10, 8),
                          child: SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                for (final tab in ShopBrandTab.values)
                                  Padding(
                                    padding: const EdgeInsets.only(right: 8),
                                    child: _CollectionTab(
                                      label: ShopBrandCatalog.tabLabels[tab]!,
                                      selected: _tab == tab,
                                      onTap: () => setState(() => _tab = tab),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                        Expanded(
                          child: gridBrands.isEmpty
                              ? const Center(
                                  child: Text(
                                    'No brands match this search.',
                                    style: TextStyle(color: kShopMuted),
                                  ),
                                )
                              : GridView.builder(
                                  padding: const EdgeInsets.fromLTRB(
                                    10,
                                    0,
                                    10,
                                    16,
                                  ),
                                  gridDelegate:
                                      const SliverGridDelegateWithFixedCrossAxisCount(
                                        crossAxisCount: 2,
                                        mainAxisSpacing: 8,
                                        crossAxisSpacing: 8,
                                        childAspectRatio: 1.55,
                                      ),
                                  itemCount: gridBrands.length,
                                  itemBuilder: (context, index) {
                                    final brand = gridBrands[index];
                                    return _BrandTile(
                                      brand: brand,
                                      onTap: () => _openBrand(brand),
                                    );
                                  },
                                ),
                        ),
                      ],
                    ),
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

class _CollectionTab extends StatelessWidget {
  const _CollectionTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? kShopBlue : const Color(0xFFE9EDF2),
          borderRadius: BorderRadius.circular(4),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : kShopInk,
            fontWeight: FontWeight.w800,
            fontSize: 11,
            letterSpacing: 0.2,
          ),
        ),
      ),
    );
  }
}

class _BrandTile extends StatelessWidget {
  const _BrandTile({required this.brand, required this.onTap});

  final _BrandEntry brand;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8),
          child: Center(
            child: brand.logoUrl.isNotEmpty
                ? Image.network(
                    brand.logoUrl,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) => _NameMark(name: brand.name),
                  )
                : _NameMark(name: brand.name),
          ),
        ),
      ),
    );
  }
}

class _NameMark extends StatelessWidget {
  const _NameMark({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Text(
      name,
      textAlign: TextAlign.center,
      maxLines: 3,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        color: kShopInk,
        fontWeight: FontWeight.w800,
        fontSize: 12,
        height: 1.2,
        letterSpacing: 0.2,
      ),
    );
  }
}
