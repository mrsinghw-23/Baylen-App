import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../models/salon.dart';
import '../services/location_service.dart';
import '../widgets/home/_home_constants.dart';
import 'outlet_detail_screen.dart';

enum OutletSortMode { nearest, rating, category, availability, distance }

class NearbyOutletsScreen extends StatefulWidget {
  const NearbyOutletsScreen({super.key, required this.initialOutlets});

  final List<SalonOutlet> initialOutlets;

  @override
  State<NearbyOutletsScreen> createState() => _NearbyOutletsScreenState();
}

class _NearbyOutletsScreenState extends State<NearbyOutletsScreen> {
  final _api = CatalystApi();
  List<SalonOutlet> _outlets = [];
  OutletSortMode _sortMode = OutletSortMode.nearest;
  String _category = 'All';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _outlets = widget.initialOutlets;
    _loading = widget.initialOutlets.isEmpty;
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _outlets.isEmpty;
      _error = null;
    });
    try {
      await LocationService.instance.fetchCurrentLocation();
      final location = LocationService.instance.currentLocation.value;
      final outlets = await _api.nearbyOutlets(
        lat: location?.latitude,
        lng: location?.longitude,
      );
      if (!mounted) return;
      setState(() {
        _outlets = outlets;
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

  List<SalonOutlet> get _visibleOutlets {
    final filtered = _category == 'All'
        ? [..._outlets]
        : _outlets
              .where((outlet) => outlet.salonCategory == _category)
              .toList();
    switch (_sortMode) {
      case OutletSortMode.nearest:
      case OutletSortMode.distance:
        filtered.sort((a, b) => a.distanceKm.compareTo(b.distanceKm));
      case OutletSortMode.rating:
        filtered.sort((a, b) => b.rating.compareTo(a.rating));
      case OutletSortMode.category:
        filtered.sort((a, b) => a.salonCategory.compareTo(b.salonCategory));
      case OutletSortMode.availability:
        filtered.sort((a, b) => a.availability.compareTo(b.availability));
    }
    return filtered;
  }

  List<String> get _categories {
    final categories =
        _outlets
            .map((outlet) => outlet.salonCategory)
            .where((category) => category.isNotEmpty)
            .toSet()
            .toList()
          ..sort();
    return ['All', ...categories];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(title: const Text('Premium Salons Near You')),
      body: RefreshIndicator(
        color: kHomePink,
        backgroundColor: kHomeCard,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
          children: [
            _LocationBanner(onRefresh: _load),
            const SizedBox(height: 14),
            _Controls(
              sortMode: _sortMode,
              categories: _categories,
              category: _category,
              onSortChanged: (mode) => setState(() => _sortMode = mode),
              onCategoryChanged: (category) =>
                  setState(() => _category = category),
            ),
            const SizedBox(height: 16),
            if (_loading && _visibleOutlets.isEmpty)
              ...List.generate(
                4,
                (_) => const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: SkeletonBox(
                    width: double.infinity,
                    height: 128,
                    radius: 8,
                  ),
                ),
              )
            else if (_error != null && _visibleOutlets.isEmpty)
              _StatePanel(
                icon: Icons.location_off_outlined,
                title: 'Location-based salons unavailable',
                message: _error!,
                action: FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh),
                  label: const Text('Retry'),
                ),
              )
            else if (_visibleOutlets.isEmpty)
              const _StatePanel(
                icon: Icons.store_mall_directory_outlined,
                title: 'No nearby salons for this filter',
                message: 'Check Catalyst outlet latitude/longitude, active status, and salon category data.',
              )
            else
              ..._visibleOutlets.map(
                (outlet) => _OutletListCard(
                  outlet: outlet,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => OutletDetailScreen(outlet: outlet),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _LocationBanner extends StatelessWidget {
  const _LocationBanner({required this.onRefresh});

  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<UserLocation?>(
      valueListenable: LocationService.instance.currentLocation,
      builder: (context, location, _) {
        return DecoratedBox(
          decoration: BoxDecoration(
            color: kHomeCard,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: kHomeOutline),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                const Icon(Icons.my_location, color: kHomePink),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    location == null
                        ? 'Using your current GPS location'
                        : '${location.city} - ${location.area}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Refresh location',
                  onPressed: onRefresh,
                  icon: const Icon(Icons.refresh),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Controls extends StatelessWidget {
  const _Controls({
    required this.sortMode,
    required this.categories,
    required this.category,
    required this.onSortChanged,
    required this.onCategoryChanged,
  });

  final OutletSortMode sortMode;
  final List<String> categories;
  final String category;
  final ValueChanged<OutletSortMode> onSortChanged;
  final ValueChanged<String> onCategoryChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 10,
      runSpacing: 10,
      children: [
        DropdownButton<OutletSortMode>(
          value: sortMode,
          dropdownColor: kHomeCard,
          items: const [
            DropdownMenuItem(
              value: OutletSortMode.nearest,
              child: Text('Nearest'),
            ),
            DropdownMenuItem(
              value: OutletSortMode.rating,
              child: Text('Rating'),
            ),
            DropdownMenuItem(
              value: OutletSortMode.category,
              child: Text('Category'),
            ),
            DropdownMenuItem(
              value: OutletSortMode.availability,
              child: Text('Availability'),
            ),
            DropdownMenuItem(
              value: OutletSortMode.distance,
              child: Text('Distance'),
            ),
          ],
          onChanged: (mode) {
            if (mode != null) onSortChanged(mode);
          },
        ),
        DropdownButton<String>(
          value: category,
          dropdownColor: kHomeCard,
          items: categories
              .map((item) => DropdownMenuItem(value: item, child: Text(item)))
              .toList(),
          onChanged: (value) {
            if (value != null) onCategoryChanged(value);
          },
        ),
      ],
    );
  }
}

class _OutletListCard extends StatelessWidget {
  const _OutletListCard({required this.outlet, required this.onTap});

  final SalonOutlet outlet;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 92,
                  height: 92,
                  child: outlet.imageUrl.isEmpty
                      ? const ColoredBox(color: Color(0xFF21101A))
                      : Image.network(
                          outlet.imageUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, _, _) =>
                              const ColoredBox(color: Color(0xFF21101A)),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      outlet.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      outlet.locationLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: kHomeTextSecondary),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        if (outlet.distanceLabel.isNotEmpty)
                          _MiniChip(outlet.distanceLabel),
                        if (outlet.salonCategory.isNotEmpty)
                          _MiniChip(outlet.salonCategory),
                        if (outlet.availability.isNotEmpty)
                          _MiniChip(outlet.availability),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      outlet.rating > 0
                          ? '${outlet.rating.toStringAsFixed(1)} - ${outlet.reviewCount} reviews'
                          : 'No reviews yet',
                      style: const TextStyle(
                        color: kHomeStarColor,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniChip extends StatelessWidget {
  const _MiniChip(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFF21101A),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: kHomeOutline),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _StatePanel extends StatelessWidget {
  const _StatePanel({
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
    return Padding(
      padding: const EdgeInsets.only(top: 44),
      child: Column(
        children: [
          Icon(icon, color: kHomePink, size: 44),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: kHomeTextSecondary),
          ),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}
