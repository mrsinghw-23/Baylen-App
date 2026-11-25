import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../utils/home_service_categories.dart';
import '../widgets/salon_image.dart';

class HomeServiceCategoryOutletsScreen extends StatefulWidget {
  const HomeServiceCategoryOutletsScreen({
    super.key,
    required this.category,
    required this.outlets,
    required this.onOutletSelected,
  });

  final BeautyCategory category;
  final List<SalonOutlet> outlets;
  final void Function(SalonOutlet outlet) onOutletSelected;

  @override
  State<HomeServiceCategoryOutletsScreen> createState() =>
      _HomeServiceCategoryOutletsScreenState();
}

class _HomeServiceCategoryOutletsScreenState
    extends State<HomeServiceCategoryOutletsScreen> {
  List<SalonOutlet> _matchingOutlets = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMatchingOutlets();
  }

  Future<void> _loadMatchingOutlets() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = AuthService.instance.api;
      final serviceType =
          homeServiceCategoryToServiceType(widget.category.slug);
      final results = await Future.wait(
        widget.outlets.map((outlet) async {
          try {
            final services = await api.salonServices(
              outletId: outlet.id,
              serviceType: serviceType,
              isAtHomeOnly: true,
            );
            final hasMatch = services.any(
              (service) =>
                  salonServiceMatchesCategory(service, widget.category),
            );
            return hasMatch ? outlet : null;
          } catch (_) {
            return null;
          }
        }),
      );
      if (!mounted) return;
      final filtered = results.whereType<SalonOutlet>().toList()
        ..sort((a, b) => a.distanceKm.compareTo(b.distanceKm));
      setState(() {
        _matchingOutlets = filtered;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.category.name} — Home Service'),
      ),
      body: RefreshIndicator(
        onRefresh: _loadMatchingOutlets,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              'Salons offering ${widget.category.name} at home, nearest first.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _EmptyPanel(
                icon: Icons.error_outline,
                message: _error!,
                action: FilledButton(
                  onPressed: _loadMatchingOutlets,
                  child: const Text('Try again'),
                ),
              )
            else if (_matchingOutlets.isEmpty)
              _EmptyPanel(
                icon: Icons.home_work_outlined,
                message:
                    'No salons offer ${widget.category.name} at home near you.',
              )
            else
              ..._matchingOutlets.map(
                (outlet) => Card(
                  child: ListTile(
                    leading: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        width: 48,
                        height: 48,
                        child: SalonImage(imageUrl: outlet.imageUrl),
                      ),
                    ),
                    title: Text(outlet.name),
                    subtitle: Text(
                      [
                        outlet.city,
                        if (outlet.distanceKm > 0)
                          '${outlet.distanceKm.toStringAsFixed(1)} km away',
                        'Home service available',
                      ].where((part) => part.isNotEmpty).join(' · '),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => widget.onOutletSelected(outlet),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  const _EmptyPanel({
    required this.icon,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 48),
      child: Column(
        children: [
          Icon(icon, size: 44, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}
