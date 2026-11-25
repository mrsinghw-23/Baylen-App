import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/salon.dart';
import '../utils/home_service_categories.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/salon_image.dart';
import 'home_service_service_detail_screen.dart';

class HomeServiceOutletScreen extends StatefulWidget {
  const HomeServiceOutletScreen({
    super.key,
    required this.outlet,
    this.initialCategorySlug,
  });

  final SalonOutlet outlet;
  final String? initialCategorySlug;

  @override
  State<HomeServiceOutletScreen> createState() =>
      _HomeServiceOutletScreenState();
}

class _HomeServiceOutletScreenState extends State<HomeServiceOutletScreen> {
  List<SalonService> _services = [];
  String _filterType = 'All';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.initialCategorySlug != null) {
      _filterType =
          homeServiceCategoryToServiceType(widget.initialCategorySlug!) ?? 'All';
    }
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final services = await AuthService.instance.api.salonServices(
        outletId: widget.outlet.id,
        isAtHomeOnly: true,
        serviceType: _filterType == 'All' ? null : _filterType,
      );
      if (!mounted) return;
      setState(() {
        _services = services;
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

  List<String> get _serviceTypes {
    final types = _services.map((s) => s.serviceType).where((t) => t.isNotEmpty).toSet().toList()
      ..sort();
    return ['All', ...types];
  }

  void _openService(SalonService service) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceServiceDetailScreen(
          outlet: widget.outlet,
          service: service,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final outlet = widget.outlet;
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        title: Text(outlet.name),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            _OutletHeader(outlet: outlet),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                padding: EdgeInsets.all(32),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              Card(
                color: kHomeCard,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_error!),
                      const SizedBox(height: 12),
                      FilledButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                ),
              )
            else if (_services.isEmpty)
              const Card(
                color: kHomeCard,
                child: Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'No home services are available at this salon yet.',
                  ),
                ),
              )
            else ...[
              SizedBox(
                height: 40,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _serviceTypes.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final type = _serviceTypes[index];
                    final selected = _filterType == type;
                    return FilterChip(
                      label: Text(type),
                      selected: selected,
                      onSelected: (_) {
                        setState(() => _filterType = type);
                        _load();
                      },
                      selectedColor: kHomePink.withValues(alpha: 0.25),
                      checkmarkColor: kHomePink,
                    );
                  },
                ),
              ),
              const SizedBox(height: 12),
              ..._services.map(
                (service) => _ServiceCard(
                  service: service,
                  onTap: () => _openService(service),
                  onBook: () => _openService(service),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _OutletHeader extends StatelessWidget {
  const _OutletHeader({required this.outlet});

  final SalonOutlet outlet;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        children: [
          AspectRatio(
            aspectRatio: 16 / 7,
            child: outlet.imageUrl.isEmpty
                ? const ColoredBox(color: kHomeCard)
                : SalonImage(imageUrl: outlet.imageUrl),
          ),
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.85),
                  ],
                ),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 16,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  outlet.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  [
                    if (outlet.distanceKm > 0)
                      '${outlet.distanceKm.toStringAsFixed(1)} km',
                    outlet.city,
                    'Home service available',
                  ].where((part) => part.isNotEmpty).join(' · '),
                  style: const TextStyle(color: kHomeTextSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceCard extends StatelessWidget {
  const _ServiceCard({
    required this.service,
    required this.onTap,
    required this.onBook,
  });

  final SalonService service;
  final VoidCallback onTap;
  final VoidCallback onBook;

  String _priceLabel() {
    final male = service.priceFor('MALE');
    final female = service.priceFor('FEMALE');
    if (male != null && female != null) {
      return 'M ₹${male.sellingPrice.toStringAsFixed(0)} · F ₹${female.sellingPrice.toStringAsFixed(0)}';
    }
    return service.priceLabel;
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: kHomeCard,
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
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
                  child: SalonImage(imageUrl: service.imageUrl),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      service.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 16,
                      ),
                    ),
                    if (service.description.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        service.description.split('\n').first,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: kHomeTextSecondary,
                          fontSize: 13,
                        ),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      '${service.durationMinutes} min · ${_priceLabel()}',
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              FilledButton(
                onPressed: onBook,
                style: FilledButton.styleFrom(
                  minimumSize: const Size(64, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                ),
                child: const Text('Book'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
