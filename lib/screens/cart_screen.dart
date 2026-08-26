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
  final _coupon = TextEditingController();
  Cart _cart = Cart.empty();
  bool _loading = true;
  String? _error;
  String? _busyItemId;
  bool _couponBusy = false;

  @override
  void initState() {
    super.initState();
    AuthService.instance.user.addListener(_onAuthChanged);
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
        _coupon.text = cart.coupon?.code ?? '';
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

  Future<void> _remove(CartItem item) async {
    setState(() => _busyItemId = item.id);
    try {
      final cart = await AuthService.instance.api.removeCartItem(item.id);
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

  Future<void> _applyCoupon() async {
    final code = _coupon.text.trim();
    if (code.isEmpty) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Enter a coupon code')));
      return;
    }
    setState(() => _couponBusy = true);
    try {
      final cart = await AuthService.instance.api.applyCoupon(code);
      if (!mounted) return;
      setState(() {
        _cart = cart;
        _coupon.text = cart.coupon?.code ?? code.toUpperCase();
        _couponBusy = false;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Coupon ${_coupon.text} applied')));
    } catch (error) {
      if (!mounted) return;
      setState(() => _couponBusy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _removeCoupon() async {
    setState(() => _couponBusy = true);
    try {
      final cart = await AuthService.instance.api.removeCoupon();
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

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Cart')),
          body: user == null
              ? _SignedOut(
                  onSignIn: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<bool>(
                        builder: (_) => const LoginScreen(),
                      ),
                    );
                  },
                )
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
                              onMinus: () =>
                                  _setQuantity(item, item.quantity - 1),
                              onPlus: () =>
                                  _setQuantity(item, item.quantity + 1),
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
                            _CouponPanel(
                              controller: _coupon,
                              cart: _cart,
                              busy: _couponBusy,
                              onApply: _applyCoupon,
                              onRemove: _removeCoupon,
                            ),
                            const SizedBox(height: 12),
                            Row(
                              children: [
                                const Text('Subtotal'),
                                const Spacer(),
                                Text(_cart.subtotalLabel),
                              ],
                            ),
                            if (_cart.discountAmount > 0) ...[
                              const SizedBox(height: 6),
                              Row(
                                children: [
                                  Text('Discount ${_cart.coupon?.code ?? ''}'),
                                  const Spacer(),
                                  Text(
                                    _cart.discountLabel,
                                    style: const TextStyle(
                                      color: Color(0xFF35D07F),
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            const Divider(height: 20),
                            Row(
                              children: [
                                const Text(
                                  'To pay',
                                  style: TextStyle(fontWeight: FontWeight.w800),
                                ),
                                const Spacer(),
                                Text(
                                  _cart.totalLabel,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w900,
                                    color: Theme.of(context)
                                        .colorScheme
                                        .primary,
                                    fontSize: 18,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${_cart.itemCount} item${_cart.itemCount == 1 ? '' : 's'}',
                            ),
                            const SizedBox(height: 12),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute<void>(
                                      builder: (_) =>
                                          CheckoutScreen(cart: _cart),
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
            FilledButton(
              onPressed: onShop,
              child: const Text('Continue shopping'),
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

class _CouponPanel extends StatelessWidget {
  const _CouponPanel({
    required this.controller,
    required this.cart,
    required this.busy,
    required this.onApply,
    required this.onRemove,
  });

  final TextEditingController controller;
  final Cart cart;
  final bool busy;
  final VoidCallback onApply;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final coupon = cart.coupon;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.local_offer_outlined,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Text(
                  'Apply coupon',
                  style: Theme.of(context).textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ],
            ),
            const SizedBox(height: 10),
            if (coupon == null)
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: controller,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        hintText: 'Enter code',
                        prefixIcon: Icon(Icons.confirmation_number_outlined),
                      ),
                      onSubmitted: (_) {
                        if (!busy) {
                          onApply();
                        }
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  SizedBox(
                    height: 48,
                    child: FilledButton(
                      onPressed: busy ? null : onApply,
                      child: Text(busy ? '...' : 'Apply'),
                    ),
                  ),
                ],
              )
            else
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: Theme.of(context).colorScheme.primary
                        .withValues(alpha: 0.45),
                  ),
                  color: Theme.of(context).colorScheme.primary
                      .withValues(alpha: 0.12),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            coupon.code,
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                          if (coupon.title.isNotEmpty) Text(coupon.title),
                        ],
                      ),
                    ),
                    Text(
                      cart.discountLabel,
                      style: const TextStyle(
                        color: Color(0xFF35D07F),
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    IconButton(
                      tooltip: 'Remove coupon',
                      onPressed: busy ? null : onRemove,
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
            if (cart.couponError.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                cart.couponError,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
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
                  Text(
                    item.name,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.lineLabel,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
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
