import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../models/salon.dart';
import 'salon_book_screen.dart';

class SalonScreen extends StatefulWidget {
  const SalonScreen({super.key});

  @override
  State<SalonScreen> createState() => _SalonScreenState();
}

class _SalonScreenState extends State<SalonScreen> {
  final _api = CatalystApi();
  List<SalonOutlet> _outlets = [];
  bool _loading = true;
  String? _error;

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
      final outlets = await _api.salonOutlets();
      if (!mounted) return;
      setState(() {
        _outlets = outlets;
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Salon')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Salon booking',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 4),
            const Text('Choose an outlet, then pick a service and time.'),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _SalonErrorState(message: _error!, onRetry: _load)
            else if (_outlets.isEmpty)
              const _SalonEmptyState()
            else
              ..._outlets.map(
                (outlet) => Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: ListTile(
                    leading: Icon(
                      Icons.store_mall_directory_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                    title: Text(outlet.name),
                    subtitle: Text(
                      [
                        outlet.subtitle,
                        if (outlet.openingTime.isNotEmpty &&
                            outlet.closingTime.isNotEmpty)
                          '${outlet.openingTime} - ${outlet.closingTime}',
                      ].where((part) => part.isNotEmpty).join('\n'),
                    ),
                    isThreeLine: outlet.openingTime.isNotEmpty,
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => SalonBookScreen(outlet: outlet),
                        ),
                      );
                    },
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _SalonErrorState extends StatelessWidget {
  const _SalonErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return _SalonPanel(
      icon: Icons.cloud_off_outlined,
      title: 'Could not load live outlets',
      message: message.replaceFirst('Exception: ', ''),
      action: FilledButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
        label: const Text('Retry'),
      ),
    );
  }
}

class _SalonEmptyState extends StatelessWidget {
  const _SalonEmptyState();

  @override
  Widget build(BuildContext context) {
    return const _SalonPanel(
      icon: Icons.store_mall_directory_outlined,
      title: 'No salon outlets yet',
      message: 'Outlets added in Catalyst will appear here automatically.',
    );
  }
}

class _SalonPanel extends StatelessWidget {
  const _SalonPanel({
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
