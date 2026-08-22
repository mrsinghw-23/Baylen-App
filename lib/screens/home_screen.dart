import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../shell/main_shell.dart';
import 'cart_screen.dart';
import 'orders_screen.dart';
import 'login_screen.dart';
import 'placeholder_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = CatalystApi();
  String _apiStatus = 'Checking API…';
  bool _apiUp = false;

  @override
  void initState() {
    super.initState();
    _loadHealth();
  }

  Future<void> _loadHealth() async {
    try {
      final up = await _api.isHealthy();
      if (!mounted) return;
      setState(() {
        _apiUp = up;
        _apiStatus = up ? 'Catalyst API connected' : 'Catalyst API not reachable';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _apiUp = false;
        _apiStatus = 'Catalyst API not reachable';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Baylen'),
        actions: [
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => _open(
              context,
              const PlaceholderScreen(
                title: 'Notifications',
                subtitle: 'Alerts for orders, bookings, and jobs will show here.',
                icon: Icons.notifications_outlined,
              ),
            ),
            icon: const Icon(Icons.notifications_outlined),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'One account for shop, salon, and home service.',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
          _StatusChip(label: _apiStatus, ok: _apiUp),
          const SizedBox(height: 12),
          ValueListenableBuilder<AuthUser?>(
            valueListenable: AuthService.instance.user,
            builder: (context, user, _) {
              if (user != null) {
                return _StatusChip(label: 'Signed in as ${user.displayName}', ok: true);
              }
              return Align(
                alignment: Alignment.centerLeft,
                child: ActionChip(
                  avatar: const Icon(Icons.login, size: 18),
                  label: const Text('Sign in'),
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
                    );
                  },
                ),
              );
            },
          ),
          const SizedBox(height: 20),
          _ModuleCard(
            title: 'Shop',
            subtitle: 'Nykaa-style beauty shopping',
            icon: Icons.storefront_outlined,
            onTap: () => widget.onOpenTab(MainShell.shopIndex),
          ),
          _ModuleCard(
            title: 'Salon',
            subtitle: 'Lakmé-style booking',
            icon: Icons.content_cut_outlined,
            onTap: () => widget.onOpenTab(MainShell.salonIndex),
          ),
          _ModuleCard(
            title: 'Home Service',
            subtitle: 'Urban Company-style jobs',
            icon: Icons.home_repair_service_outlined,
            onTap: () => widget.onOpenTab(MainShell.homeServiceIndex),
          ),
          const SizedBox(height: 8),
          Text('Your activity', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _ShortcutChip(
                label: 'Cart',
                icon: Icons.shopping_bag_outlined,
                onTap: () => _open(context, const CartScreen()),
              ),
              _ShortcutChip(
                label: 'Orders',
                icon: Icons.receipt_long_outlined,
                onTap: () => _open(context, const OrdersScreen()),
              ),
              _ShortcutChip(
                label: 'Bookings',
                icon: Icons.event_available_outlined,
                onTap: () => _open(
                  context,
                  const PlaceholderScreen(
                    title: 'Bookings',
                    subtitle: 'Salon appointments will list from Catalyst.',
                    icon: Icons.event_available_outlined,
                  ),
                ),
              ),
              _ShortcutChip(
                label: 'Loyalty',
                icon: Icons.card_giftcard_outlined,
                onTap: () => _open(
                  context,
                  const PlaceholderScreen(
                    title: 'Loyalty',
                    subtitle: 'Loyalty is planned after the core app flows.',
                    icon: Icons.card_giftcard_outlined,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _open(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.label, required this.ok});

  final String label;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Chip(
        avatar: Icon(
          ok ? Icons.check_circle : Icons.cloud_off,
          size: 18,
          color: ok ? Colors.green.shade700 : Colors.orange.shade800,
        ),
        label: Text(label),
      ),
    );
  }
}

class _ModuleCard extends StatelessWidget {
  const _ModuleCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon, color: Theme.of(context).colorScheme.primary),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

class _ShortcutChip extends StatelessWidget {
  const _ShortcutChip({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ActionChip(
      avatar: Icon(icon, size: 18),
      label: Text(label),
      onPressed: onTap,
    );
  }
}
