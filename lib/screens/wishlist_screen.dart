import 'package:flutter/material.dart';

import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
import '../models/catalog.dart';
import '../services/cart_service.dart';
import '../theme/shop_theme.dart';
import '../widgets/product_contained_image.dart';
import 'cart_screen.dart';
import 'product_detail_screen.dart';
import 'shop_catalog_screen.dart';

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  List<WishlistItem> _items = [];
  bool _loading = true;
  String? _error;
  String? _busyId;

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
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() {
        _loading = false;
        _items = [];
        _error = null;
      });
      return;
    }
    final cached = AuthService.instance.bootstrap.value?.wishlist ?? [];
    setState(() {
      if (cached.isNotEmpty) {
        _items = cached;
        _loading = false;
      } else {
        _loading = true;
      }
      _error = null;
    });
    try {
      final items = await AuthService.instance.api.wishlist();
      AuthService.instance.noteLiveDataReceived();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_items.isEmpty) {
          _error = error.toString();
        }
      });
    }
  }

  Future<void> _remove(WishlistItem item) async {
    setState(() => _busyId = item.id);
    try {
      await AuthService.instance.api.toggleWishlist(
        item.productId,
        variantId: item.variantId,
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _moveToBag(WishlistItem item) async {
    setState(() => _busyId = item.id);
    try {
      await CartService.instance.addToCart(item.productId, item.variantId, 1);
      await AuthService.instance.api.toggleWishlist(
        item.productId,
        variantId: item.variantId,
      );
      if (!mounted) return;
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Moved to bag'),
          action: SnackBarAction(
            label: 'View bag',
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
      setState(() => _busyId = null);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  void _openProduct(WishlistItem item) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ProductDetailScreen(
          product: CatalogProduct.fromJson({
            'id': item.productId,
            'name': item.name,
            'thumbnail_url': item.thumbnailUrl,
            'selling_price': item.sellingPrice,
            'mrp': item.mrp,
            'currency': item.currency,
          }),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return ShopThemeScope(
          child: Scaffold(
          appBar: AppBar(
            title: Text(
              user == null
                  ? 'Wishlist'
                  : 'Wishlist${_items.isEmpty ? '' : ' · ${_items.length}'}',
            ),
          ),
          body: user == null
              ? _SignedOutWishlist(
                  onSignIn: () async {
                    await AuthGate.ensureSignedIn(
                      context,
                      message: 'Sign in to view your wishlist',
                    );
                  },
                )
              : _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _load,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                )
              : _items.isEmpty
              ? _EmptyWishlist(
                  onShop: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const ShopCatalogScreen(),
                      ),
                    );
                  },
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final item = _items[index];
                      final busy = _busyId == item.id;
                      return Card(
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            children: [
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                onTap: () => _openProduct(item),
                                leading: ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: SizedBox(
                                    width: 64,
                                    height: 64,
                                    child: ProductContainedImage(
                                      url: item.thumbnailUrl,
                                      compact: true,
                                      placeholder: const Icon(
                                        Icons.image_outlined,
                                        color: kShopBlue,
                                      ),
                                    ),
                                  ),
                                ),
                                title: Text(
                                  item.name,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                subtitle: Text(item.priceLabel),
                                trailing: IconButton(
                                  tooltip: 'Remove',
                                  icon: const Icon(Icons.favorite),
                                  onPressed: busy ? null : () => _remove(item),
                                ),
                              ),
                              Align(
                                alignment: Alignment.centerRight,
                                child: FilledButton.tonal(
                                  onPressed: busy ? null : () => _moveToBag(item),
                                  child: Text(busy ? 'Moving...' : 'Move to bag'),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
          ),
        );
      },
    );
  }
}

class _SignedOutWishlist extends StatelessWidget {
  const _SignedOutWishlist({required this.onSignIn});

  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.favorite_border, size: 48),
            const SizedBox(height: 12),
            const Text(
              'Sign in to save your Baylen favourites',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: onSignIn, child: const Text('Sign in')),
          ],
        ),
      ),
    );
  }
}

class _EmptyWishlist extends StatelessWidget {
  const _EmptyWishlist({required this.onShop});

  final VoidCallback onShop;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.favorite_border, size: 48),
            const SizedBox(height: 12),
            const Text('Your wishlist is empty.'),
            const SizedBox(height: 8),
            const Text(
              'Save beauty products you love, then move them to your bag anytime.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            FilledButton(onPressed: onShop, child: const Text('Shop now')),
          ],
        ),
      ),
    );
  }
}
