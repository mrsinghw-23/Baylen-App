import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../models/catalog.dart';
import 'cart_screen.dart';
import 'product_detail_screen.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  final _api = CatalystApi();
  final _search = TextEditingController();
  List<CatalogCategory> _categories = [];
  List<CatalogBrand> _brands = [];
  List<CatalogProduct> _products = [];
  String? _categoryId;
  String? _brandId;
  String _sort = '';
  bool _loading = true;
  String? _error;

  static const _fallbackCategories = [
    CatalogCategory(
      id: 'hair-care',
      name: 'Hair Care',
      slug: 'hair-care',
      description: '',
    ),
    CatalogCategory(
      id: 'skin-care',
      name: 'Skin Care',
      slug: 'skin-care',
      description: '',
    ),
    CatalogCategory(
      id: 'nail-care',
      name: 'Nail Care',
      slug: 'nail-care',
      description: '',
    ),
    CatalogCategory(
      id: 'makeup',
      name: 'Makeup',
      slug: 'makeup',
      description: '',
    ),
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
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
      if (sort != null) {
        _sort = sort;
      }
    });
    try {
      final categories = await _api.categories();
      final brands = await _api.brands();
      final products = await _api.products(
        categoryId: categoryId,
        brandId: brandId,
        search: _search.text.trim(),
        sort: _sort,
      );
      if (!mounted) return;
      setState(() {
        _categories = categories;
        _brands = brands;
        _products = products;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _categories = _categories.isEmpty ? _fallbackCategories : _categories;
        _error = 'Live product data is temporarily unavailable.';
      });
    }
  }

  Future<void> _searchProducts() async {
    await _load(categoryId: _categoryId, brandId: _brandId, sort: _sort);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Shop'),
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
        onRefresh: () =>
            _load(categoryId: _categoryId, brandId: _brandId, sort: _sort),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Beauty shopping',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            const Text('Products, brands, prices, and stock from Catalyst.'),
            const SizedBox(height: 12),
            TextField(
              controller: _search,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                hintText: 'Search products',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _search.clear();
                          _searchProducts();
                        },
                      ),
              ),
              onSubmitted: (_) => _searchProducts(),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue: _sort.isEmpty ? null : _sort,
                    decoration: const InputDecoration(labelText: 'Sort'),
                    items: const [
                      DropdownMenuItem(value: 'newest', child: Text('Newest')),
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
              ],
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              _ShopStatusBanner(message: _error!, onRetry: _searchProducts),
              const SizedBox(height: 12),
            ],
            if (_categories.isNotEmpty)
              SizedBox(
                height: 40,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: const Text('All'),
                        selected: _categoryId == null,
                        onSelected: (_) =>
                            _load(brandId: _brandId, sort: _sort),
                      ),
                    ),
                    ..._categories.map(
                      (category) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(category.name),
                          selected: _categoryId == category.id,
                          onSelected: (_) => _load(
                            categoryId: category.id,
                            brandId: _brandId,
                            sort: _sort,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (_brands.isNotEmpty) ...[
              const SizedBox(height: 12),
              SizedBox(
                height: 40,
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
            ],
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_products.isEmpty)
              _CatalogEmptyState(
                searching:
                    _search.text.trim().isNotEmpty ||
                    _categoryId != null ||
                    _brandId != null,
                onClear: () {
                  _search.clear();
                  _load(sort: _sort);
                },
              )
            else
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _products.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  mainAxisSpacing: 12,
                  crossAxisSpacing: 12,
                  childAspectRatio: 0.68,
                ),
                itemBuilder: (context, index) {
                  final product = _products[index];
                  return _ProductCard(
                    product: product,
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => ProductDetailScreen(product: product),
                        ),
                      );
                    },
                  );
                },
              ),
          ],
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
  const _CatalogEmptyState({required this.searching, required this.onClear});

  final bool searching;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return _CatalogPanel(
      icon: Icons.inventory_2_outlined,
      title: searching ? 'No matching products' : 'No products yet',
      message: searching ? 'Try clearing search, category, or brand filters.' : 'Products added or synced from Zoho Books will appear here automatically.',
      action: searching
          ? OutlinedButton.icon(
              onPressed: onClear,
              icon: const Icon(Icons.filter_alt_off_outlined),
              label: const Text('Clear filters'),
            )
          : null,
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
  const _ProductCard({required this.product, required this.onTap});

  final CatalogProduct product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
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
                      color: Color(0xFFDCE7FF),
                      child: SizedBox.expand(),
                    )
                  : Image.network(
                      product.thumbnailUrl,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const _ProductImageFallback(),
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
                    product.availableQuantity > 0
                        ? '${product.availableQuantity} in stock'
                        : 'Out of stock',
                    style: TextStyle(
                      color: product.availableQuantity > 0
                          ? Colors.green.shade700
                          : Colors.red.shade700,
                      fontSize: 12,
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
