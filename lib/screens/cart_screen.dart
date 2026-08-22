import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/cart.dart';
import 'checkout_screen.dart';
import 'login_screen.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  Cart _cart = Cart.empty();
  bool _loading = true;
  String? _error;
  String? _busyItemId;

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
        _error = null;
        _cart = Cart.empty();
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cart = await AuthService.instance.api.getCart();
      if (!mounted) return;
      setState(() {
        _cart = cart;
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

  Future<void> _setQuantity(CartItem item, int quantity) async {
    setState(() => _busyItemId = item.id);
    try {
      final cart = quantity < 1
          ? await AuthService.instance.api.removeCartItem(item.id)
          : await AuthService.instance.api.updateCartItemQuantity(
              itemId: item.id,
              quantity: quantity,
            );
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _busyItemId = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyItemId = null);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _remove(CartItem item) async {
    setState(() => _busyItemId = item.id);
    try {
      final cart = await AuthService.instance.api.removeCartItem(item.id);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _busyItemId = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busyItemId = null);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Cart')),
          body: user == null
              ? _SignedOut(onSignIn: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
                  );
                })
              : _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null
                      ? _ErrorState(message: _error!, onRetry: _load)
                      : _cart.isEmpty
                          ? _EmptyCart(
                              onShop: () {
                                if (Navigator.of(context).canPop()) {
                                  Navigator.of(context).pop();
                                }
                              },
                            )
                          : Column(
                              children: [
                                Expanded(
                                  child: RefreshIndicator(
                                    onRefresh: _load,
                                    child: ListView.separated(
                                      padding: const EdgeInsets.all(16),
                                      itemCount: _cart.items.length,
                                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                                      itemBuilder: (context, index) {
                                        final item = _cart.items[index];
                                        return _CartTile(
                                          item: item,
                                          busy: _busyItemId == item.id,
                                          onMinus: () => _setQuantity(item, item.quantity - 1),
                                          onPlus: () => _setQuantity(item, item.quantity + 1),
                                          onRemove: () => _remove(item),
                                        );
                                      },
                                    ),
                                  ),
                                ),
                                Material(
                                  elevation: 8,
                                  child: Padding(
                                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                                    child: Column(
                                      children: [
                                        Row(
                                          children: [
                                            const Text('Subtotal', style: TextStyle(fontWeight: FontWeight.w600)),
                                            const Spacer(),
                                            Text(
                                              _cart.subtotalLabel,
                                              style: TextStyle(
                                                fontWeight: FontWeight.w700,
                                                color: Theme.of(context).colorScheme.primary,
                                                fontSize: 18,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          '${_cart.itemCount} item${_cart.itemCount == 1 ? '' : 's'}',
                                          style: Theme.of(context).textTheme.bodySmall,
                                        ),
                                        const SizedBox(height: 12),
                                        SizedBox(
                                          width: double.infinity,
                                          child: FilledButton(
                                            onPressed: () {
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) => CheckoutScreen(cart: _cart),
                                                ),
                                              );
                                            },
                                            child: const Text('Checkout'),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ],
                            ),
        );
      },
    );
  }
}

class _SignedOut extends StatelessWidget {
  const _SignedOut({required this.onSignIn});

  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.shopping_bag_outlined, size: 48),
            const SizedBox(height: 12),
            const Text('Sign in to view your cart'),
            const SizedBox(height: 16),
            FilledButton(onPressed: onSignIn, child: const Text('Sign in')),
          ],
        ),
      ),
    );
  }
}

class _EmptyCart extends StatelessWidget {
  const _EmptyCart({required this.onShop});

  final VoidCallback onShop;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.remove_shopping_cart_outlined, size: 48),
            const SizedBox(height: 12),
            const Text('Your cart is empty'),
            const SizedBox(height: 16),
            FilledButton(onPressed: onShop, child: const Text('Continue shopping')),
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

class _CartTile extends StatelessWidget {
  const _CartTile({
    required this.item,
    required this.busy,
    required this.onMinus,
    required this.onPlus,
    required this.onRemove,
  });

  final CartItem item;
  final bool busy;
  final VoidCallback onMinus;
  final VoidCallback onPlus;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 72,
                height: 72,
                child: item.thumbnailUrl.isEmpty
                    ? const ColoredBox(color: Color(0xFFDCE7FF))
                    : Image.network(item.thumbnailUrl, fit: BoxFit.cover),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.name, style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text(item.lineLabel, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        onPressed: busy ? null : onMinus,
                        icon: const Icon(Icons.remove_circle_outline),
                      ),
                      Text('${item.quantity}'),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        onPressed: busy ? null : onPlus,
                        icon: const Icon(Icons.add_circle_outline),
                      ),
                      const Spacer(),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        onPressed: busy ? null : onRemove,
                        icon: const Icon(Icons.delete_outline),
                      ),
                    ],
                  ),
                  if (busy) const LinearProgressIndicator(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
