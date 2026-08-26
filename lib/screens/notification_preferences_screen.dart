import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import 'login_screen.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends State<NotificationPreferencesScreen> {
  Map<String, bool> _prefs = const {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  static const _labels = {
    'push_enabled': 'Push notifications',
    'email_enabled': 'Email alerts',
    'order_updates': 'Order updates',
    'booking_updates': 'Booking updates',
    'service_tracking': 'Service tracking',
    'offers': 'Offers and promotions',
  };

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
      final prefs = await AuthService.instance.api.notificationPreferences();
      if (!mounted) return;
      setState(() {
        _prefs = _withDefaults(prefs);
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

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final prefs = await AuthService.instance.api
          .updateNotificationPreferences(_prefs);
      if (!mounted) return;
      setState(() {
        _prefs = _withDefaults(prefs);
        _saving = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Notification preferences saved')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _saving = false;
      });
    }
  }

  Map<String, bool> _withDefaults(Map<String, bool> prefs) {
    return {for (final key in _labels.keys) key: prefs[key] ?? true};
  }

  void _setPref(String key, bool value) {
    setState(() => _prefs = {..._prefs, key: value});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Alert preferences')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!AuthService.instance.isSignedIn)
            _SignInRequired(onSignedIn: _load)
          else if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 64),
              child: Center(child: CircularProgressIndicator()),
            )
          else ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Choose Baylen alerts',
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'These settings control order, booking, service, and offer notifications.',
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Column(
                children: [
                  for (final entry in _labels.entries)
                    SwitchListTile(
                      value: _prefs[entry.key] ?? true,
                      title: Text(entry.value),
                      secondary: Icon(_iconFor(entry.key)),
                      onChanged: (value) => _setPref(entry.key, value),
                    ),
                ],
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Saving...' : 'Save preferences'),
            ),
          ],
        ],
      ),
    );
  }

  IconData _iconFor(String key) {
    switch (key) {
      case 'push_enabled':
        return Icons.notifications_active_outlined;
      case 'email_enabled':
        return Icons.email_outlined;
      case 'order_updates':
        return Icons.shopping_bag_outlined;
      case 'booking_updates':
        return Icons.event_available_outlined;
      case 'service_tracking':
        return Icons.near_me_outlined;
      default:
        return Icons.local_offer_outlined;
    }
  }
}

class _SignInRequired extends StatelessWidget {
  const _SignInRequired({required this.onSignedIn});

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
              'Sign in required',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text(
              'Notification preferences are saved to your Baylen account.',
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
