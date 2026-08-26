import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/catalog.dart';
import '../widgets/reviews_panel.dart';
import 'cart_screen.dart';
import 'login_screen.dart';

class ProductDetailScreen extends StatefulWidget {
  const ProductDetailScreen({super.key, required this.product});

  final CatalogProduct product;

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  bool _adding = false;
  bool _wishing = false;
  bool _loading = true;
  String? _error;
  CatalogProductDetail? _detail;
  CatalogProductVariant? _variant;
  int _quantity = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await CatalystApi().productDetail(widget.product.id);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _variant = detail.variants.isNotEmpty ? detail.variants.first : null;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  CatalogProduct get _product => _detail?.product ?? widget.product;

  int get _availableQuantity {
    final variant = _variant;
    if (variant != null) {
      return variant.availableQuantity;
    }
    return _product.availableQuantity;
  }

  String get _priceLabel => _variant?.priceLabel ?? _product.priceLabel;

  Future<void> _addToCart() async {
    if (_product.isZohoCommerceProduct) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'This product is live from Zoho Commerce. Cart sync will be enabled after Zoho Commerce checkout is configured.',
          ),
        ),
      );
      return;
    }
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (!mounted) return;
      if (signedIn != true) return;
    }
    if (_availableQuantity < _quantity) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Selected quantity is not available')),
      );
      return;
    }
    setState(() => _adding = true);
    try {
      await AuthService.instance.api.addToCart(
        productId: widget.product.id,
        variantId: _variant?.id,
        quantity: _quantity,
      );
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
        setState(() => _adding = false);
      }
    }
  }

  Future<void> _toggleWishlist() async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (!mounted) return;
      if (signedIn != true) return;
    }
    setState(() => _wishing = true);
    try {
      final wished = await AuthService.instance.api.toggleWishlist(
        widget.product.id,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(wished ? 'Saved to wishlist' : 'Removed from wishlist'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
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
    final imageUrl = detail != null && detail.media.isNotEmpty
        ? detail.media.first.fileUrl
        : product.thumbnailUrl;
    return Scaffold(
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
            tooltip: 'Wishlist',
            onPressed: _wishing ? null : _toggleWishlist,
            icon: const Icon(Icons.favorite_border),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? _ProductDetailError(message: _error!, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                AspectRatio(
                  aspectRatio: 1.2,
                  child: imageUrl.isEmpty
                      ? const _ProductDetailImageFallback()
                      : Image.network(
                          imageUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) =>
                              const _ProductDetailImageFallback(),
                        ),
                ),
                const SizedBox(height: 16),
                Text(
                  product.name,
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                if (detail?.brand != null &&
                    detail!.brand!.name.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(detail.brand!.name),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    Text(
                      _priceLabel,
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      product.mrpLabel,
                      style: const TextStyle(
                        decoration: TextDecoration.lineThrough,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _availableQuantity > 0
                      ? '$_availableQuantity available'
                      : 'Out of stock',
                  style: TextStyle(
                    color: _availableQuantity > 0
                        ? Colors.green.shade700
                        : Colors.red.shade700,
                  ),
                ),
                if (detail != null && detail.variants.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(
                    'Variant',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: detail.variants
                        .map(
                          (variant) => ChoiceChip(
                            label: Text(
                              variant.label.isEmpty
                                  ? variant.sku
                                  : variant.label,
                            ),
                            selected: _variant?.id == variant.id,
                            onSelected: (_) => setState(() {
                              _variant = variant;
                              _quantity = 1;
                            }),
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
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    const Spacer(),
                    IconButton(
                      onPressed: _quantity <= 1
                          ? null
                          : () => setState(() => _quantity--),
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    Text('$_quantity'),
                    IconButton(
                      onPressed: _quantity >= _availableQuantity
                          ? null
                          : () => setState(() => _quantity++),
                      icon: const Icon(Icons.add_circle_outline),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Text(
                  product.description.isEmpty
                      ? product.shortDescription
                      : product.description,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _adding || _availableQuantity < 1
                      ? null
                      : _addToCart,
                  child: Text(_adding ? 'Adding...' : 'Add to cart'),
                ),
                const SizedBox(height: 16),
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
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              message.replaceFirst('Exception: ', ''),
              textAlign: TextAlign.center,
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

class _ProductDetailImageFallback extends StatelessWidget {
  const _ProductDetailImageFallback();

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFFDCE7FF),
      child: Center(
        child: Icon(
          Icons.spa_outlined,
          size: 48,
          color: Theme.of(context).colorScheme.primary,
        ),
      ),
    );
  }
}
