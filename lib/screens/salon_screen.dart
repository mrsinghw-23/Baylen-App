import 'dart:async';

import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../models/salon.dart';
import '../services/location_service.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../widgets/salon_image.dart';
import 'salon_book_screen.dart';

class SalonScreen extends StatefulWidget {
  const SalonScreen({super.key});

  @override
  State<SalonScreen> createState() => _SalonScreenState();
}

class _SalonScreenState extends State<SalonScreen> {
  final _api = CatalystApi();
  final _search = TextEditingController();
  Timer? _searchDebounce;
  List<SalonOutlet> _outlets = [];
  List<SalonLocation> _availableLocations = [];
  bool _loading = true;
  String? _error;

  UserLocation? get _location => LocationService.instance.currentLocation.value;

  String get _cityLabel {
    final loc = _location;
    if (loc == null) return '';
    if (loc.city.isNotEmpty) return loc.city;
    if (loc.area.isNotEmpty) return loc.area;
    return 'your location';
  }

  @override
  void initState() {
    super.initState();
    LocationService.instance.currentLocation.addListener(_onLocationChanged);
    _loadAvailableLocations();
    _load();
  }

  @override
  void dispose() {
    LocationService.instance.currentLocation.removeListener(_onLocationChanged);
    _searchDebounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onLocationChanged() {
    _load();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 350), _load);
  }

  Future<void> _pickLocation() async {
    await LocationPickerSheet.show(context, onLocationSelected: () {});
  }

  Future<void> _loadAvailableLocations() async {
    try {
      final locations = await _api.salonLocations();
      if (!mounted) return;
      setState(() => _availableLocations = locations);
    } catch (_) {
      // The salon list still works without the helper location chips.
    }
  }

  void _selectAvailableLocation(SalonLocation location) {
    LocationService.instance.setManualLocation(
      UserLocation(
        latitude: location.latitude,
        longitude: location.longitude,
        city: location.city,
        area: location.state,
        formattedAddress: location.label,
      ),
    );
  }

  Future<void> _load() async {
    final loc = _location;
    if (loc == null || (loc.city.isEmpty && loc.latitude == 0)) {
      setState(() {
        _outlets = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final outlets = await _api.salonOutlets(
        city: loc.city,
        lat: loc.latitude,
        lng: loc.longitude,
        queryText: _search.text.trim(),
      );
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
      appBar: AppBar(
        title: const Text('Salon'),
        actions: [
          TextButton.icon(
            onPressed: _pickLocation,
            icon: const Icon(Icons.place_outlined),
            label: Text(_cityLabel.isEmpty ? 'Location' : _cityLabel),
          ),
        ],
      ),
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
            Text(
              _cityLabel.isEmpty
                  ? 'Select a location to see salons available there.'
                  : 'Salons in $_cityLabel',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            if (_availableLocations.isNotEmpty) ...[
              _AvailableSalonLocations(
                locations: _availableLocations,
                selectedCity: _location?.city ?? '',
                onSelected: _selectAvailableLocation,
              ),
              const SizedBox(height: 16),
            ],
            if (_location != null) ...[
              TextField(
                controller: _search,
                decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search),
                  hintText: 'Search salon, area, or city',
                ),
                onChanged: _onSearchChanged,
                onSubmitted: (_) => _load(),
              ),
              const SizedBox(height: 16),
            ],
            if (_location == null)
              _SalonPanel(
                icon: Icons.place_outlined,
                title: 'Select your location',
                message: 'Choose a city or use current location. Only salons that operate in that location will appear.',
                action: FilledButton.icon(
                  onPressed: _pickLocation,
                  icon: const Icon(Icons.my_location),
                  label: const Text('Select location'),
                ),
              )
            else if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 48),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              _SalonErrorState(message: _error!, onRetry: _load)
            else if (_outlets.isEmpty)
              _SalonPanel(
                icon: Icons.store_mall_directory_outlined,
                title: 'No salons in this location',
                message: 'No salons are currently available in this location. Try another city or area.',
                action: OutlinedButton(
                  onPressed: _pickLocation,
                  child: const Text('Change location'),
                ),
              )
            else
              ..._outlets.map((outlet) => _SalonOutletCard(outlet: outlet)),
          ],
        ),
      ),
    );
  }
}

class _SalonOutletCard extends StatelessWidget {
  const _SalonOutletCard({required this.outlet});

  final SalonOutlet outlet;

  String get _logoUrl {
    if (outlet.imageUrl.isNotEmpty && outlet.imageUrl.startsWith('assets/')) {
      return outlet.imageUrl;
    }
    return 'assets/icon/logo.png';
  }

  String get _categoryLabel {
    if (outlet.salonCategory.isNotEmpty) return outlet.salonCategory;
    if (outlet.packages.isNotEmpty) return outlet.packages.first.name;
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final category = _categoryLabel;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => SalonBookScreen(outlet: outlet),
            ),
          );
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              ClipOval(
                child: SizedBox(
                  width: 40,
                  height: 40,
                  child: SalonImage(imageUrl: _logoUrl, fit: BoxFit.cover),
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
                      style: Theme.of(context).textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    if (outlet.locationLabel.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        outlet.locationLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              if (category.isNotEmpty) ...[
                const SizedBox(width: 8),
                Text(
                  category,
                  style: Theme.of(context).textTheme.labelLarge
                      ?.copyWith(fontWeight: FontWeight.w600),
                ),
              ],
              const SizedBox(width: 4),
              Icon(
                Icons.chevron_right,
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvailableSalonLocations extends StatelessWidget {
  const _AvailableSalonLocations({
    required this.locations,
    required this.selectedCity,
    required this.onSelected,
  });

  final List<SalonLocation> locations;
  final String selectedCity;
  final ValueChanged<SalonLocation> onSelected;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Available salon locations',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: locations.map((location) {
                final selected =
                    selectedCity.toLowerCase() == location.city.toLowerCase();
                return ChoiceChip(
                  selected: selected,
                  label: Text(
                    location.outletCount > 0
                        ? '${location.city} (${location.outletCount})'
                        : location.city,
                  ),
                  onSelected: (_) => onSelected(location),
                );
              }).toList(),
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
