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

class ShopBrandPage extends StatefulWidget {
  const ShopBrandPage({super.key, required this.slug, this.brand});

  final String slug;
  final CatalogBrand? brand;

  @override
  State<ShopBrandPage> createState() => _ShopBrandPageState();
}

class _ShopBrandPageState extends State<ShopBrandPage> {
  final _api = CatalystApi();
  final _search = TextEditingController();
  Timer? _debounce;

  CatalogBrandPage? _page;
  List<CatalogProduct> _products = const [];
  String? _nextCursor;
  bool _hasMoreProducts = false;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;

  String _sort = 'relevance';
  String? _categoryId;
  String? _gender;
  String? _ageGroup;
  bool _inStock = false;
  int? _minDiscount;
  double? _minRating;
  RangeValues? _priceRange;

  String? _addingProductId;
  bool _hasDeliveryLocation = false;

  CatalogBrand get _brand => _page?.brand ?? widget.brand ?? _placeholderBrand;

  CatalogBrand get _placeholderBrand => CatalogBrand(
    id: '',
    name: widget.slug,
    slug: widget.slug,
    logoUrl: '',
    bannerUrl: '',
    description: '',
    rating: 0,
    reviewCount: 0,
    url: '/brand/${widget.slug}',
  );

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  Future<CatalogBrandPage> _brandPageFromList(String slug) async {
    final brands = await _api.brands();
    CatalogBrand? brand;
    final needle = slug.toLowerCase();
    for (final item in brands) {
      if (item.slug.toLowerCase() == needle || item.id == slug) {
        brand = item;
        break;
      }
    }
    if (brand == null) {
      throw ApiException('Brand not found');
    }
    return CatalogBrandPage(
      brand: brand,
      url: '/brand/${brand.slug.isEmpty ? brand.id : brand.slug}',
      seoTitle: '${brand.name} | Baylen',
      seoDescription: brand.description.isEmpty
          ? 'Shop ${brand.name} products at Baylen.'
          : brand.description,
      productCount: 0,
      categories: const [],
      minPrice: 0,
      maxPrice: 0,
      genders: const [],
      ageGroups: const [],
    );
  }

  Future<void> _load({bool resetPage = true}) async {
    setState(() {
      _loading = true;
      _error = null;
      if (resetPage) {
        _nextCursor = null;
        _hasMoreProducts = false;
      }
    });
    try {
      CatalogBrandPage page;
      try {
        page = await _api.brandPage(widget.slug);
      } catch (_) {
        page = await _brandPageFromList(widget.slug);
      }
      if (page.brand.id.isEmpty) {
        throw ApiException('Brand not found');
      }
      final productData = await _fetchProducts(
        brandId: page.brand.id,
        cursor: null,
      );
      if (!mounted) return;
      var minPrice = page.minPrice;
      var maxPrice = page.maxPrice;
      if (maxPrice <= 0 && productData.products.isNotEmpty) {
        minPrice = productData.products
            .map((product) => product.sellingPrice)
            .reduce((a, b) => a < b ? a : b);
        maxPrice = productData.products
            .map((product) => product.sellingPrice)
            .reduce((a, b) => a > b ? a : b);
      }
      setState(() {
        _page = CatalogBrandPage(
          brand: page.brand,
          url: page.url,
          seoTitle: page.seoTitle,
          seoDescription: page.seoDescription,
          productCount: productData.products.length,
          categories: page.categories,
          minPrice: minPrice,
          maxPrice: maxPrice,
          genders: page.genders,
          ageGroups: page.ageGroups,
        );
        _products = productData.products;
        _hasMoreProducts = productData.hasMore;
        _nextCursor = productData.nextCursor;
        _loading = false;
        _priceRange ??= maxPrice > 0 ? RangeValues(minPrice, maxPrice) : null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<({
    List<CatalogProduct> products,
    bool hasMore,
    String? nextCursor,
  })> _fetchProducts({
    required String brandId,
    String? cursor,
  }) async {
    final coords = await DeliveryLocationService.instance.resolve();
    _hasDeliveryLocation = coords.hasCoordinates;
    final minPrice = _priceRange?.start;
    final maxPrice = _priceRange?.end;
    final data = await _api.productsPage(
      brandId: brandId,
      categoryId: _categoryId,
      search: _search.text.trim(),
      sort: _sort,
      cursor: cursor,
      page: 1,
      limit: 24,
      minPrice: minPrice,
      maxPrice: maxPrice,
      minDiscount: _minDiscount,
      minRating: _minRating,
      inStock: _inStock ? true : null,
      gender: _gender,
      ageGroup: _ageGroup,
      latitude: coords.latitude,
      longitude: coords.longitude,
    );
    final items = data['products'];
    final products = items is List
        ? items
              .whereType<Map<String, dynamic>>()
              .map(CatalogProduct.fromJson)
              .where((product) => product.brandId == brandId)
              .toList()
        : <CatalogProduct>[];
    final pagination = data['pagination'];
    final hasMore = pagination is Map ? pagination['has_more'] == true : false;
    final nextCursor =
        pagination is Map ? pagination['next_cursor'] as String? : null;
    return (products: products, hasMore: hasMore, nextCursor: nextCursor);
  }

  Future<void> _reloadProducts() async {
    final brandId = _brand.id;
    if (brandId.isEmpty) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _nextCursor = null;
      _hasMoreProducts = false;
    });
    try {
      final productData = await _fetchProducts(brandId: brandId, cursor: null);
      if (!mounted) return;
      setState(() {
        _products = productData.products;
        _hasMoreProducts = productData.hasMore;
        _nextCursor = productData.nextCursor;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _loadMore() async {
    final brandId = _brand.id;
    if (_loadingMore || brandId.isEmpty || !_hasMoreProducts || _nextCursor == null) {
      return;
    }
    setState(() => _loadingMore = true);
    try {
      final productData = await _fetchProducts(
        brandId: brandId,
        cursor: _nextCursor,
      );
      if (!mounted) return;
      setState(() {
        _nextCursor = productData.nextCursor;
        _hasMoreProducts = productData.hasMore;
        _products = [..._products, ...productData.products];
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _reloadProducts);
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _addingProductId = null);
    }
  }

  void _openProduct(CatalogProduct product) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(product: product),
      ),
    );
  }

  Future<void> _openFilters() async {
    final page = _page;
    if (page == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        return _BrandFilterSheet(
          page: page,
          categoryId: _categoryId,
          gender: _gender,
          ageGroup: _ageGroup,
          inStock: _inStock,
          minDiscount: _minDiscount,
          minRating: _minRating,
          priceRange: _priceRange,
          onApply: (result) {
            setState(() {
              _categoryId = result.categoryId;
              _gender = result.gender;
              _ageGroup = result.ageGroup;
              _inStock = result.inStock;
              _minDiscount = result.minDiscount;
              _minRating = result.minRating;
              _priceRange = result.priceRange;
            });
            _reloadProducts();
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final brand = _brand;
    final seoTitle = _page?.seoTitle.isNotEmpty == true
        ? _page!.seoTitle
        : '${brand.name} | Baylen';
    final countLabel = _loading
        ? 'Loading products'
        : _hasMoreProducts
        ? '${_products.length}+ products'
        : '${_products.length} product${_products.length == 1 ? '' : 's'}';

    return Title(
      title: seoTitle,
      color: kShopBlue,
      child: ShopThemeScope(
        child: Scaffold(
        backgroundColor: kShopSurface,
        appBar: AppBar(
          title: Text(brand.name.isEmpty ? 'Brand' : brand.name),
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
        body: RefreshIndicator(
          onRefresh: _load,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(child: _BrandHeader(brand: brand, countLabel: countLabel)),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                  child: TextField(
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    onChanged: (value) {
                      setState(() {});
                      _onSearchChanged(value);
                    },
                    onSubmitted: (_) => _reloadProducts(),
                    decoration: InputDecoration(
                      hintText: 'Search in ${brand.name}',
                      prefixIcon: const Icon(Icons.search),
                      suffixIcon: _search.text.isEmpty
                          ? null
                          : IconButton(
                              tooltip: 'Clear',
                              icon: const Icon(Icons.close),
                              onPressed: () {
                                _search.clear();
                                _reloadProducts();
                              },
                            ),
                    ),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: _sort,
                          decoration: const InputDecoration(labelText: 'Sort'),
                          items: const [
                            DropdownMenuItem(
                              value: 'relevance',
                              child: Text('Relevance'),
                            ),
                            DropdownMenuItem(
                              value: 'popularity',
                              child: Text('Popularity'),
                            ),
                            DropdownMenuItem(
                              value: 'newest',
                              child: Text('Newest'),
                            ),
                            DropdownMenuItem(
                              value: 'price_low',
                              child: Text('Price: low to high'),
                            ),
                            DropdownMenuItem(
                              value: 'price_high',
                              child: Text('Price: high to low'),
                            ),
                          ],
                          onChanged: (value) {
                            setState(() => _sort = value ?? 'relevance');
                            _reloadProducts();
                          },
                        ),
                      ),
                      const SizedBox(width: 12),
                      OutlinedButton.icon(
                        onPressed: _page == null ? null : _openFilters,
                        icon: const Icon(Icons.filter_list),
                        label: const Text('Filters'),
                      ),
                    ],
                  ),
                ),
              ),
              if (_error != null)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                    child: Text(
                      _error!,
                      style: TextStyle(color: Colors.red.shade700),
                    ),
                  ),
                ),
              if (_loading)
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_products.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.storefront_outlined, size: 42, color: kShopBlue),
                        const SizedBox(height: 12),
                        Text(
                          'No products from ${brand.name} yet',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                            color: kShopInk,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'This brand page only shows products linked to this brand in the catalog.',
                          textAlign: TextAlign.center,
                          style: TextStyle(color: kShopMuted),
                        ),
                      ],
                    ),
                  ),
                )
              else ...[
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                  sliver: SliverGrid(
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 0.58,
                    ),
                    delegate: SliverChildBuilderDelegate((context, index) {
                      final product = _products[index];
                      return _BrandProductCard(
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
                        child: Text(_loadingMore ? 'Loading...' : 'Load more products'),
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    ),
    );
  }
}

class _BrandFilterResult {
  const _BrandFilterResult({
    this.categoryId,
    this.gender,
    this.ageGroup,
    required this.inStock,
    this.minDiscount,
    this.minRating,
    this.priceRange,
  });

  final String? categoryId;
  final String? gender;
  final String? ageGroup;
  final bool inStock;
  final int? minDiscount;
  final double? minRating;
  final RangeValues? priceRange;
}

class _BrandFilterSheet extends StatefulWidget {
  const _BrandFilterSheet({
    required this.page,
    required this.categoryId,
    required this.gender,
    required this.ageGroup,
    required this.inStock,
    required this.minDiscount,
    required this.minRating,
    required this.priceRange,
    required this.onApply,
  });

  final CatalogBrandPage page;
  final String? categoryId;
  final String? gender;
  final String? ageGroup;
  final bool inStock;
  final int? minDiscount;
  final double? minRating;
  final RangeValues? priceRange;
  final ValueChanged<_BrandFilterResult> onApply;

  @override
  State<_BrandFilterSheet> createState() => _BrandFilterSheetState();
}

class _BrandFilterSheetState extends State<_BrandFilterSheet> {
  late String? _categoryId = widget.categoryId;
  late String? _gender = widget.gender;
  late String? _ageGroup = widget.ageGroup;
  late bool _inStock = widget.inStock;
  late int? _minDiscount = widget.minDiscount;
  late double? _minRating = widget.minRating;
  late RangeValues? _priceRange = widget.priceRange;

  @override
  Widget build(BuildContext context) {
    final min = widget.page.minPrice;
    final max = widget.page.maxPrice <= min ? min + 1 : widget.page.maxPrice;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        0,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Filters',
              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
            ),
            const SizedBox(height: 12),
            if (widget.page.categories.isNotEmpty) ...[
              const Text('Category', style: TextStyle(fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('All'),
                    selected: _categoryId == null,
                    onSelected: (_) => setState(() => _categoryId = null),
                  ),
                  ...widget.page.categories.map(
                    (category) => ChoiceChip(
                      label: Text('${category.name} (${category.count})'),
                      selected: _categoryId == category.id,
                      onSelected: (_) => setState(() => _categoryId = category.id),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],
            if (widget.page.maxPrice > 0) ...[
              Text(
                'Price  ₹${(_priceRange?.start ?? min).round()} - ₹${(_priceRange?.end ?? max).round()}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              RangeSlider(
                values: _priceRange ?? RangeValues(min, max),
                min: min,
                max: max,
                divisions: 20,
                labels: RangeLabels(
                  '₹${(_priceRange?.start ?? min).round()}',
                  '₹${(_priceRange?.end ?? max).round()}',
                ),
                onChanged: (value) => setState(() => _priceRange = value),
              ),
            ],
            const Text('Discount', style: TextStyle(fontWeight: FontWeight.w700)),
            Wrap(
              spacing: 8,
              children: [
                for (final value in [10, 20, 30, 50])
                  ChoiceChip(
                    label: Text('$value%+'),
                    selected: _minDiscount == value,
                    onSelected: (selected) =>
                        setState(() => _minDiscount = selected ? value : null),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            const Text('Rating', style: TextStyle(fontWeight: FontWeight.w700)),
            Wrap(
              spacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('3+'),
                  selected: _minRating == 3,
                  onSelected: (selected) =>
                      setState(() => _minRating = selected ? 3 : null),
                ),
                ChoiceChip(
                  label: const Text('4+'),
                  selected: _minRating == 4,
                  onSelected: (selected) =>
                      setState(() => _minRating = selected ? 4 : null),
                ),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('In stock only'),
              value: _inStock,
              onChanged: (value) => setState(() => _inStock = value),
            ),
            if (widget.page.genders.isNotEmpty) ...[
              const Text('Gender', style: TextStyle(fontWeight: FontWeight.w700)),
              Wrap(
                spacing: 8,
                children: widget.page.genders
                    .map(
                      (value) => ChoiceChip(
                        label: Text(value),
                        selected: _gender == value,
                        onSelected: (selected) =>
                            setState(() => _gender = selected ? value : null),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 12),
            ],
            if (widget.page.ageGroups.isNotEmpty) ...[
              const Text('Age group', style: TextStyle(fontWeight: FontWeight.w700)),
              Wrap(
                spacing: 8,
                children: widget.page.ageGroups
                    .map(
                      (value) => ChoiceChip(
                        label: Text(value),
                        selected: _ageGroup == value,
                        onSelected: (selected) =>
                            setState(() => _ageGroup = selected ? value : null),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 12),
            ],
            Row(
              children: [
                TextButton(
                  onPressed: () {
                    setState(() {
                      _categoryId = null;
                      _gender = null;
                      _ageGroup = null;
                      _inStock = false;
                      _minDiscount = null;
                      _minRating = null;
                      _priceRange = widget.page.maxPrice > 0
                          ? RangeValues(widget.page.minPrice, widget.page.maxPrice)
                          : null;
                    });
                  },
                  child: const Text('Clear'),
                ),
                const Spacer(),
                FilledButton(
                  onPressed: () {
                    widget.onApply(
                      _BrandFilterResult(
                        categoryId: _categoryId,
                        gender: _gender,
                        ageGroup: _ageGroup,
                        inStock: _inStock,
                        minDiscount: _minDiscount,
                        minRating: _minRating,
                        priceRange: _priceRange,
                      ),
                    );
                    Navigator.pop(context);
                  },
                  child: const Text('Apply'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.brand, required this.countLabel});

  final CatalogBrand brand;
  final String countLabel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE6EEF8)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: 72,
                height: 72,
                child: brand.logoUrl.isNotEmpty
                    ? Image.network(
                        brand.logoUrl,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => const ColoredBox(
                          color: Color(0xFFDCE7FF),
                          child: Icon(Icons.storefront_outlined),
                        ),
                      )
                    : const ColoredBox(
                        color: Color(0xFFDCE7FF),
                        child: Icon(Icons.storefront_outlined),
                      ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    brand.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                      color: kShopInk,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(countLabel, style: const TextStyle(color: kShopMuted)),
                  if (brand.rating > 0) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${brand.rating.toStringAsFixed(1)} rating'
                      '${brand.reviewCount > 0 ? ' · ${brand.reviewCount} reviews' : ''}',
                      style: const TextStyle(color: kShopInk, fontSize: 12),
                    ),
                  ],
                  if (brand.description.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      brand.description,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: kShopMuted, height: 1.35),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BrandProductCard extends StatelessWidget {
  const _BrandProductCard({
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
    final soldOut =
        catalogProductSoldOut(product, hasLocation: hasLocation);
    final badges = catalogDeliveryBadges(product, hasLocation: hasLocation);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  product.thumbnailUrl.isEmpty
                      ? const ColoredBox(color: Color(0xFFF3F7FC))
                      : ProductContainedImage(url: product.thumbnailUrl),
                  if (product.discountPercent > 0)
                    Positioned(
                      left: 8,
                      top: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: kShopBlue,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${product.discountPercent}% off',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                ],
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
                      fontWeight: FontWeight.w600,
                      color: kShopInk,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    product.priceLabel,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (product.mrp > product.sellingPrice)
                    Text(
                      product.mrpLabel,
                      style: const TextStyle(
                        color: kShopMuted,
                        fontSize: 12,
                        decoration: TextDecoration.lineThrough,
                      ),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    soldOut ? 'Out of stock' : 'In stock',
                    style: TextStyle(
                      color: soldOut ? Colors.red.shade700 : Colors.green.shade700,
                      fontSize: 12,
                    ),
                  ),
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
