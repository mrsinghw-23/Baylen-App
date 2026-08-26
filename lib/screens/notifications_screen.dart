import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/notification_item.dart';
import 'login_screen.dart';
import 'notification_preferences_screen.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<BaylenNotification> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await AuthService.instance.api.notifications();
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

  Future<void> _markRead(BaylenNotification item) async {
    if (!item.isUnread) {
      return;
    }
    try {
      await AuthService.instance.api.markNotificationRead(item.id);
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _markAllRead() async {
    try {
      await AuthService.instance.api.markAllNotificationsRead();
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount = _items.where((item) => item.isUnread).length;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          IconButton(
            tooltip: 'Alert preferences',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const NotificationPreferencesScreen(),
                ),
              );
            },
            icon: const Icon(Icons.tune_outlined),
          ),
          if (unreadCount > 0)
            TextButton(onPressed: _markAllRead, child: const Text('Read all')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!AuthService.instance.isSignedIn)
              _SignInPanel(onSignedIn: _load)
            else if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 64),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _StatePanel(
                icon: Icons.cloud_off_outlined,
                title: 'Could not load notifications',
                subtitle: _error!,
              )
            else if (_items.isEmpty)
              const _StatePanel(
                icon: Icons.notifications_none_outlined,
                title: 'No notifications yet',
                subtitle: 'Order, booking, payment, and service alerts will appear here.',
              )
            else ...[
              _NotificationSummary(
                unreadCount: unreadCount,
                totalCount: _items.length,
              ),
              const SizedBox(height: 12),
              ..._items.map(
                (item) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _NotificationCard(
                    item: item,
                    onTap: () => _markRead(item),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SignInPanel extends StatelessWidget {
  const _SignInPanel({required this.onSignedIn});

  final VoidCallback onSignedIn;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.lock_outline,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 12),
            Text(
              'Sign in to view alerts',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text(
              'Notifications are linked to your orders, bookings, and account security.',
            ),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
                );
                onSignedIn();
              },
              child: const Text('Login / Register'),
            ),
          ],
        ),
      ),
    );
  }
}

class _NotificationSummary extends StatelessWidget {
  const _NotificationSummary({
    required this.unreadCount,
    required this.totalCount,
  });

  final int unreadCount;
  final int totalCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.45),
        ),
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
      ),
      child: Row(
        children: [
          Icon(
            Icons.notifications_active_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              '$unreadCount unread from $totalCount alerts',
              style: Theme.of(context).textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.item, required this.onTap});

  final BaylenNotification item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = item.isUnread
        ? Theme.of(context).colorScheme.primary
        : const Color(0xFFAAA4B6);
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(_iconFor(item.type), color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title.isEmpty ? 'Baylen alert' : item.title,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: item.isUnread
                            ? FontWeight.w900
                            : FontWeight.w700,
                      ),
                    ),
                    if (item.body.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(item.body),
                    ],
                    if (item.createdAt.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      Text(
                        item.createdAt,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: const Color(0xFFAAA4B6)),
                      ),
                    ],
                  ],
                ),
              ),
              if (item.isUnread)
                Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(top: 6),
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _iconFor(String type) {
    switch (type.toUpperCase()) {
      case 'ORDER':
        return Icons.shopping_bag_outlined;
      case 'BOOKING':
        return Icons.event_available_outlined;
      case 'PAYMENT':
        return Icons.payments_outlined;
      case 'SECURITY':
        return Icons.verified_user_outlined;
      case 'SERVICE':
        return Icons.home_repair_service_outlined;
      default:
        return Icons.notifications_outlined;
    }
  }
}

class _StatePanel extends StatelessWidget {
  const _StatePanel({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text(subtitle),
          ],
        ),
      ),
    );
  }
}
