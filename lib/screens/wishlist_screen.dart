import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
import 'login_screen.dart';

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  List<WishlistItem> _items = [];
  bool _loading = true;
  String? _error;

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
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await AuthService.instance.api.wishlist();
      if (!mounted) return;
      setState(() {
        _items = items;
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

  Future<void> _remove(WishlistItem item) async {
    if (!AuthService.instance.isSignedIn) {
      await Navigator.of(context)
          .push(MaterialPageRoute<bool>(builder: (_) => const LoginScreen()));
      return;
    }
    await AuthService.instance.api.toggleWishlist(item.productId);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Wishlist')),
          body: user == null
              ? Center(
                  child: FilledButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<bool>(
                          builder: (_) => const LoginScreen(),
                        ),
                      );
                    },
                    child: const Text('Sign in'),
                  ),
                )
              : _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(child: Text(_error!))
              : _items.isEmpty
              ? const Center(child: Text('Your wishlist is empty.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final item = _items[index];
                      return Card(
                        child: ListTile(
                          leading: SizedBox(
                            width: 56,
                            height: 56,
                            child: item.thumbnailUrl.isEmpty
                                ? const ColoredBox(color: Color(0xFFDCE7FF))
                                : Image.network(
                                    item.thumbnailUrl,
                                    fit: BoxFit.cover,
                                  ),
                          ),
                          title: Text(item.name),
                          subtitle: Text(item.priceLabel),
                          trailing: IconButton(
                            tooltip: 'Remove',
                            icon: const Icon(Icons.favorite),
                            onPressed: () => _remove(item),
                          ),
                        ),
                      );
                    },
                  ),
                ),
        );
      },
    );
  }
}
