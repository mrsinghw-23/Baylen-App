import 'dart:async';

import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../models/catalog.dart';
import '../services/cart_service.dart';
import '../services/delivery_location_service.dart';
import '../utils/fulfillment_helpers.dart';
import '../theme/shop_theme.dart';
import '../widgets/product_contained_image.dart';
import 'cart_screen.dart';
import 'product_detail_screen.dart';

class ShopCatalogScreen extends StatefulWidget {
  const ShopCatalogScreen({
    super.key,
    this.categoryId,
    this.brandId,
    this.initialQuery = '',
    this.autofocusSearch = false,
  });

  final String? categoryId;
  final String? brandId;
  final String initialQuery;
  final bool autofocusSearch;

  @override
  State<ShopCatalogScreen> createState() => _ShopCatalogScreenState();
}

class _ShopCatalogScreenState extends State<ShopCatalogScreen> {
  final _api = CatalystApi();
  final _search = TextEditingController();
  Timer? _debounce;

  List<CatalogCategoryNode> _menu = [];
  List<CatalogBrand> _brands = [];
  List<CatalogProduct> _products = [];
  List<CatalogProduct> _searchResults = [];

  int _hubIndex = 0;
  String? _nextCursor;
  bool _hasMoreProducts = false;
  bool _loadingMore = false;
  String? _categoryId;
  String? _brandId;
  String _sort = '';
  bool _loading = true;
  bool _searching = false;
  String? _error;
  String? _addingProductId;
  bool _hasDeliveryLocation = false;

  CatalogCategoryNode? get _activeHub =>
      _menu.isEmpty ? null : _menu[_hubIndex.clamp(0, _menu.length - 1)];

  @override
  void initState() {
    super.initState();
    _categoryId = widget.categoryId;
    _brandId = widget.brandId;
    if (widget.initialQuery.isNotEmpty) {
      _search.text = widget.initialQuery;
    }
    _load(categoryId: widget.categoryId, brandId: widget.brandId);
    if (widget.initialQuery.trim().length >= 2) {
      _runSearch(widget.initialQuery.trim());
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({
    String? categoryId,
    String? brandId,
    String? sort,
  }) async {
    setState(() {
      _loading = true;
      _error = null;
      _categoryId = categoryId;
      _brandId = brandId;
      _nextCursor = null;
      _hasMoreProducts = false;
      if (sort != null) {
        _sort = sort;
      }
    });
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final nav = await _api.shopNavigation();
      final menu = nav.isNotEmpty
          ? nav.map((item) => item.toCategoryNode()).toList()
          : await _api.megaMenu();
      final brands = await _api.brands();
      final pageData = await _api.productsPage(
        categoryId: categoryId,
        brandId: brandId,
        sort: _sort,
        page: 1,
        limit: 24,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      final items = pageData['products'];
      final products = items is List
          ? items
                .whereType<Map<String, dynamic>>()
                .map(CatalogProduct.fromJson)
                .toList()
          : <CatalogProduct>[];
      final pagination = pageData['pagination'];
      final hasMore = pagination is Map
          ? pagination['has_more'] == true
          : false;
      final nextCursor = pagination is Map
          ? pagination['next_cursor'] as String?
          : null;
      if (!mounted) return;
      setState(() {
        _menu = menu;
        _brands = brands;
        _products = products;
        _hasMoreProducts = hasMore;
        _nextCursor = nextCursor;
        _hasDeliveryLocation = coords.hasCoordinates;
        _loading = false;
        if (_hubIndex >= menu.length) {
          _hubIndex = 0;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Live product data is temporarily unavailable.';
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMoreProducts || _nextCursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final pageData = await _api.productsPage(
        categoryId: _categoryId,
        brandId: _brandId,
        sort: _sort,
        cursor: _nextCursor,
        limit: 24,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      final items = pageData['products'];
      final more = items is List
          ? items
                .whereType<Map<String, dynamic>>()
                .map(CatalogProduct.fromJson)
                .toList()
          : <CatalogProduct>[];
      final pagination = pageData['pagination'];
      final hasMore = pagination is Map
          ? pagination['has_more'] == true
          : false;
      final nextCursor = pagination is Map
          ? pagination['next_cursor'] as String?
          : null;
      if (!mounted) return;
      setState(() {
        _nextCursor = nextCursor;
        _hasMoreProducts = hasMore;
        _products = [..._products, ...more];
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    final query = value.trim();
    if (query.length < 2) {
      setState(() {
        _searching = false;
        _searchResults = [];
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () {
      _runSearch(query);
    });
  }

  Future<void> _runSearch(String query) async {
    setState(() {
      _searching = true;
      _error = null;
    });
    try {
      final coords = await DeliveryLocationService.instance.resolve();
      final results = await _api.shopSearch(
        query,
        latitude: coords.latitude,
        longitude: coords.longitude,
      );
      if (!mounted || _search.text.trim() != query) return;
      setState(() {
        _searchResults = results;
        _searching = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _searching = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _selectHub(int index) async {
    final hub = _menu[index];
    setState(() => _hubIndex = index);
    await _load(categoryId: hub.id, brandId: _brandId, sort: _sort);
  }

  Future<void> _selectCategory(String categoryId) async {
    await _load(categoryId: categoryId, brandId: _brandId, sort: _sort);
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
      _openProduct(product);
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
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) {
        setState(() => _addingProductId = null);
      }
    }
  }

  void _openProduct(CatalogProduct product) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim();
    final showSearch = query.length >= 2;

    return Theme(
      data: shopLightTheme(),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Categories'),
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
          ],
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: TextField(
                controller: _search,
                autofocus: widget.autofocusSearch,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Search products, brands, or concerns',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Clear',
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            _search.clear();
                            _onSearchChanged('');
                          },
                        ),
                ),
                onChanged: _onSearchChanged,
                onSubmitted: (value) {
                  if (value.trim().length >= 2) {
                    _runSearch(value.trim());
                  }
                },
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: _ShopStatusBanner(
                  message: _error!,
                  onRetry: showSearch
                      ? () => _runSearch(query)
                      : () => _load(
                          categoryId: _categoryId,
                          brandId: _brandId,
                          sort: _sort,
                        ),
                ),
              ),
            Expanded(
              child: showSearch
                  ? _buildSearchBody()
                  : RefreshIndicator(
                      onRefresh: () => _load(
                        categoryId: _categoryId,
                        brandId: _brandId,
                        sort: _sort,
                      ),
                      child: _buildMegaMenuBody(),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBody() {
    if (_searching && _searchResults.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_searchResults.isEmpty) {
      return const _CatalogEmptyState(
        searching: true,
        onClear: null,
        message:
            'Try a brand, product, or category like Compact or Night Cream.',
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      itemCount: _searchResults.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, index) {
        final product = _searchResults[index];
        return _SearchProductTile(
          product: product,
          hasLocation: _hasDeliveryLocation,
          adding: _addingProductId == product.id,
          onOpen: () => _openProduct(product),
          onAdd: () => _addToCart(product),
        );
      },
    );
  }

  Widget _buildMegaMenuBody() {
    final hub = _activeHub;
    final sections = hub?.subCategories ?? const <CatalogCategoryNode>[];

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 96,
          color: const Color(0xFF111111),
          child: ListView.builder(
            itemCount: _menu.length + 1,
            itemBuilder: (context, index) {
              if (index == 0) {
                final selected = _categoryId == null;
                return _HubTab(
                  label: 'All',
                  selected: selected,
                  onTap: () => _load(brandId: _brandId, sort: _sort),
                );
              }
              final hubItem = _menu[index - 1];
              return _HubTab(
                label: hubItem.name,
                selected: _categoryId != null && _hubIndex == index - 1,
                onTap: () => _selectHub(index - 1),
              );
            },
          ),
        ),
        Expanded(
          child: ColoredBox(
            color: kShopSurface,
            child: CustomScrollView(
              slivers: [
                if (sections.isNotEmpty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                    sliver: SliverList.builder(
                      itemCount: sections.length,
                      itemBuilder: (context, index) {
                        final section = sections[index];
                        return _SectionBlock(
                          section: section,
                          selectedId: _categoryId,
                          onSelect: _selectCategory,
                        );
                      },
                    ),
                  ),
                if (_brands.isNotEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                      child: SizedBox(
                        height: 36,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(right: 8),
                              child: FilterChip(
                                label: const Text('All brands'),
                                selected: _brandId == null,
                                onSelected: (_) =>
                                    _load(categoryId: _categoryId, sort: _sort),
                              ),
                            ),
                            ..._brands.map(
                              (brand) => Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: FilterChip(
                                  label: Text(brand.name),
                                  selected: _brandId == brand.id,
                                  onSelected: (_) => _load(
                                    categoryId: _categoryId,
                                    brandId: brand.id,
                                    sort: _sort,
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
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: DropdownButtonFormField<String>(
                      initialValue: _sort.isEmpty ? null : _sort,
                      decoration: const InputDecoration(labelText: 'Sort'),
                      items: const [
                        DropdownMenuItem(
                          value: 'newest',
                          child: Text('Newest'),
                        ),
                        DropdownMenuItem(
                          value: 'price_low',
                          child: Text('Price low to high'),
                        ),
                        DropdownMenuItem(
                          value: 'price_high',
                          child: Text('Price high to low'),
                        ),
                      ],
                      onChanged: (value) => _load(
                        categoryId: _categoryId,
                        brandId: _brandId,
                        sort: value ?? '',
                      ),
                    ),
                  ),
                ),
                if (_loading)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_products.isEmpty)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: _CatalogEmptyState(
                        searching: _categoryId != null || _brandId != null,
                        onClear: () {
                          _search.clear();
                          _load(sort: _sort);
                        },
                      ),
                    ),
                  )
                else ...[
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    sliver: SliverGrid(
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            mainAxisSpacing: 12,
                            crossAxisSpacing: 12,
                            childAspectRatio: 0.62,
                          ),
                      delegate: SliverChildBuilderDelegate((context, index) {
                        final product = _products[index];
                        return _ProductCard(
                          product: product,
                          hasLocation: _hasDeliveryLocation,
                          adding: _addingProductId == product.id,
                          onTap: () => _openProduct(product),
                          onAdd: () => _addToCart(product),
                        );
                      }, childCount: _products.length),
                    ),
                  ),
                  if (_hasMoreProducts)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                        child: FilledButton.tonal(
                          onPressed: _loadingMore ? null : _loadMore,
                          child: Text(
                            _loadingMore ? 'Loading...' : 'Load more products',
                          ),
                        ),
                      ),
                    ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _HubTab extends StatelessWidget {
  const _HubTab({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF1C1C1C) : Colors.transparent,
          border: selected
              ? const Border(left: BorderSide(color: kShopBlue, width: 3))
              : null,
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            color: selected ? kShopBlue : Colors.white.withValues(alpha: 0.82),
          ),
        ),
      ),
    );
  }
}

class _SectionBlock extends StatelessWidget {
  const _SectionBlock({
    required this.section,
    required this.selectedId,
    required this.onSelect,
  });

  final CatalogCategoryNode section;
  final String? selectedId;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final items = section.subCategories;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: () => onSelect(section.id),
            child: Text(
              section.name.toUpperCase(),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w800,
                letterSpacing: 1,
                color: kShopBlue,
              ),
            ),
          ),
          const SizedBox(height: 8),
          if (items.isEmpty)
            _SubCategoryChip(
              label: section.name,
              selected: selectedId == section.id,
              onTap: () => onSelect(section.id),
            )
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: items
                  .map(
                    (item) => _SubCategoryChip(
                      label: item.name,
                      selected: selectedId == item.id,
                      onTap: () => onSelect(item.id),
                    ),
                  )
                  .toList(),
            ),
        ],
      ),
    );
  }
}

class _SubCategoryChip extends StatelessWidget {
  const _SubCategoryChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          decoration: BoxDecoration(
            color: selected ? kShopBlue : Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? kShopBlue : kShopLine),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : kShopInk,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SearchProductTile extends StatelessWidget {
  const _SearchProductTile({
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
    return Card(
      child: ListTile(
        onTap: onOpen,
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: SizedBox(
            width: 50,
            height: 50,
            child: product.thumbnailUrl.isEmpty
                ? const _ProductImageFallback()
                : ProductContainedImage(
                    url: product.thumbnailUrl,
                    compact: true,
                    placeholder: const _ProductImageFallback(),
                  ),
          ),
        ),
        title: Text(
          product.brandName.isEmpty
              ? product.name
              : '[${product.brandName}] ${product.name}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(product.priceLabel),
            if (badges.isNotEmpty)
              ...badges.map(
                (badge) => Text(
                  badge,
                  style: const TextStyle(fontSize: 11, color: kShopMuted),
                ),
              ),
          ],
        ),
        trailing: FilledButton(
          onPressed: soldOut || adding ? null : onAdd,
          style: FilledButton.styleFrom(
            minimumSize: const Size(64, 36),
            padding: const EdgeInsets.symmetric(horizontal: 12),
          ),
          child: adding
              ? const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(soldOut ? 'Sold out' : 'Add'),
        ),
      ),
    );
  }
}

class _ShopStatusBanner extends StatelessWidget {
  const _ShopStatusBanner({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.28)),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_outlined, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: Theme.of(context).textTheme.bodyMedium),
          ),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

class _CatalogEmptyState extends StatelessWidget {
  const _CatalogEmptyState({
    required this.searching,
    this.onClear,
    this.message,
  });

  final bool searching;
  final VoidCallback? onClear;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return _CatalogPanel(
      icon: Icons.inventory_2_outlined,
      title: searching ? 'No matching products' : 'No products yet',
      message:
          message ??
          (searching
              ? 'Try another category, brand, or search phrase.'
              : 'Products you add manually in Catalyst will appear here.'),
      action: onClear == null
          ? null
          : OutlinedButton.icon(
              onPressed: onClear,
              icon: const Icon(Icons.filter_alt_off_outlined),
              label: const Text('Clear filters'),
            ),
    );
  }
}

class _CatalogPanel extends StatelessWidget {
  const _CatalogPanel({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          children: [
            Icon(icon, size: 42, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 10),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(message, textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 14), action!],
          ],
        ),
      ),
    );
  }
}

class _ProductImageFallback extends StatelessWidget {
  const _ProductImageFallback();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFFDCE7FF),
      child: Center(
        child: Icon(
          Icons.spa_outlined,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}

class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.product,
    required this.hasLocation,
    required this.adding,
    required this.onTap,
    required this.onAdd,
  });

  final CatalogProduct product;
  final bool hasLocation;
  final bool adding;
  final VoidCallback onTap;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    final soldOut = catalogProductSoldOut(product, hasLocation: hasLocation);
    final badges = catalogDeliveryBadges(product, hasLocation: hasLocation);
    final stockLabel = soldOut
        ? 'Sold out'
        : hasLocation
            ? (badges.isNotEmpty ? badges.first : 'Available')
            : '${product.availableQuantity} in stock';
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: product.thumbnailUrl.isEmpty
                  ? const ColoredBox(
                      color: Color(0xFFF3F7FC),
                      child: _ProductImageFallback(),
                    )
                  : ProductContainedImage(
                      url: product.thumbnailUrl,
                      placeholder: const _ProductImageFallback(),
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
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    product.priceLabel,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    stockLabel,
                    style: TextStyle(
                      color: soldOut
                          ? Colors.red.shade700
                          : Colors.green.shade700,
                      fontSize: 12,
                    ),
                  ),
                  if (badges.length > 1) ...[
                    const SizedBox(height: 2),
                    Text(
                      badges.sublist(1).join(' · '),
                      style: const TextStyle(fontSize: 11, color: kShopMuted),
                    ),
                  ],
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: soldOut || adding ? null : onAdd,
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(36),
                      ),
                      child: adding
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
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
    );
  }
}
