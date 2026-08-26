import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../services/location_service.dart';
import '_home_constants.dart';

class LocationPickerSheet extends StatefulWidget {
  const LocationPickerSheet({super.key, required this.onLocationSelected});

  final VoidCallback onLocationSelected;

  static Future<void> show(
    BuildContext context, {
    required VoidCallback onLocationSelected,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) =>
          LocationPickerSheet(onLocationSelected: onLocationSelected),
    );
  }

  @override
  State<LocationPickerSheet> createState() => _LocationPickerSheetState();
}

class _LocationPickerSheetState extends State<LocationPickerSheet> {
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;
  bool _isSearching = false;
  bool _isLocating = false;
  String? _locationError;
  List<UserLocation> _searchResults = [];

  static const List<Map<String, dynamic>> _popularCities = [
    {'city': 'Mumbai', 'area': 'Bandra West', 'lat': 19.0596, 'lng': 72.8295},
    {'city': 'Ranchi', 'area': 'Lālpur', 'lat': 23.3687, 'lng': 85.3395},
    {
      'city': 'Delhi NCR',
      'area': 'Connaught Place',
      'lat': 28.6315,
      'lng': 77.2167,
    },
    {
      'city': 'Bengaluru',
      'area': 'Indiranagar',
      'lat': 12.9784,
      'lng': 77.6408,
    },
    {'city': 'Pune', 'area': 'Koregaon Park', 'lat': 18.5362, 'lng': 73.8939},
    {
      'city': 'Hyderabad',
      'area': 'Jubilee Hills',
      'lat': 17.4319,
      'lng': 78.4074,
    },
    {'city': 'Kolkata', 'area': 'Park Street', 'lat': 22.5515, 'lng': 88.3524},
  ];

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    if (query.trim().isEmpty) {
      setState(() {
        _searchResults = [];
        _isSearching = false;
      });
      return;
    }

    _debounce = Timer(const Duration(milliseconds: 400), () async {
      setState(() => _isSearching = true);
      final results = await LocationService.instance.searchLocations(query);
      if (mounted) {
        setState(() {
          _searchResults = results;
          _isSearching = false;
        });
      }
    });
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _isLocating = true;
      _locationError = null;
    });
    await LocationService.instance.fetchCurrentLocation(force: true);
    if (mounted) {
      setState(() => _isLocating = false);
      if (LocationService.instance.currentLocation.value != null) {
        widget.onLocationSelected();
        Navigator.pop(context);
      } else {
        setState(() {
          _locationError =
              LocationService.instance.error.value ??
              'Unable to detect current location.';
        });
      }
    }
  }

  Future<void> _openSettings() async {
    if (LocationService.instance.isPermissionBlocked.value) {
      await Geolocator.openAppSettings();
    } else {
      await Geolocator.openLocationSettings();
    }
  }

  void _selectLocation(UserLocation location) {
    LocationService.instance.setManualLocation(location);
    widget.onLocationSelected();
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      padding: EdgeInsets.only(bottom: bottomInset),
      decoration: const BoxDecoration(
        color: kHomeCanvas,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        border: Border(top: BorderSide(color: kHomeOutline, width: 1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 12, bottom: 16),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: kHomeOutline,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Title
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Text(
              'Select Location',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 18,
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Search bar
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Container(
              height: 46,
              decoration: BoxDecoration(
                color: kHomeCard,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: kHomeOutline),
              ),
              child: Row(
                children: [
                  const SizedBox(width: 12),
                  const Icon(Icons.search, color: kHomeTextSecondary, size: 20),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      onChanged: _onSearchChanged,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                      decoration: const InputDecoration(
                        hintText: 'Search city, area, or landmark...',
                        hintStyle: TextStyle(
                          color: kHomeTextSecondary,
                          fontSize: 13,
                        ),
                        border: InputBorder.none,
                        isDense: true,
                      ),
                    ),
                  ),
                  if (_searchController.text.isNotEmpty)
                    IconButton(
                      icon: const Icon(
                        Icons.close,
                        color: kHomeTextSecondary,
                        size: 18,
                      ),
                      onPressed: () {
                        _searchController.clear();
                        _onSearchChanged('');
                      },
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),

          // Use Current Location Button
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: InkWell(
              onTap: _isLocating ? null : _useCurrentLocation,
              borderRadius: BorderRadius.circular(12),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  vertical: 12,
                  horizontal: 16,
                ),
                decoration: BoxDecoration(
                  color: kHomeCard,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: kHomePink.withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: kHomePink.withValues(alpha: 0.15),
                        shape: BoxShape.circle,
                      ),
                      child: _isLocating
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: kHomePink,
                              ),
                            )
                          : const Icon(
                              Icons.my_location,
                              color: kHomePink,
                              size: 18,
                            ),
                    ),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Use Current Device Location',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Using GPS & Maps Geocoding',
                            style: TextStyle(
                              color: kHomeTextSecondary,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: kHomeTextSecondary),
                  ],
                ),
              ),
            ),
          ),
          if (_locationError != null) ...[
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: Colors.amber.withValues(alpha: 0.35),
                  ),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.info_outline,
                      color: Colors.amber,
                      size: 18,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _locationError!,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                        ),
                      ),
                    ),
                    TextButton(
                      onPressed: _openSettings,
                      style: TextButton.styleFrom(
                        foregroundColor: Colors.amber,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                      ),
                      child: const Text('Settings'),
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 16),

          const Divider(color: kHomeOutline, height: 1),

          // Search results or Popular Cities
          Expanded(
            child: _isSearching
                ? const Center(
                    child: CircularProgressIndicator(color: kHomePink),
                  )
                : _searchResults.isNotEmpty
                ? ListView.separated(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 12,
                    ),
                    itemCount: _searchResults.length,
                    separatorBuilder: (context, index) =>
                        const Divider(color: kHomeOutline, height: 1),
                    itemBuilder: (context, index) {
                      final loc = _searchResults[index];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(
                          Icons.location_on_outlined,
                          color: kHomePink,
                        ),
                        title: Text(
                          loc.city,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          loc.formattedAddress ?? loc.area,
                          style: const TextStyle(
                            color: kHomeTextSecondary,
                            fontSize: 12,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onTap: () => _selectLocation(loc),
                      );
                    },
                  )
                : ListView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 12,
                    ),
                    children: [
                      const Text(
                        'Popular Cities',
                        style: TextStyle(
                          color: kHomeTextSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.5,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: _popularCities.map((item) {
                          return InkWell(
                            onTap: () => _selectLocation(
                              UserLocation(
                                city: item['city'] as String,
                                area: item['area'] as String,
                                latitude: item['lat'] as double,
                                longitude: item['lng'] as double,
                              ),
                            ),
                            borderRadius: BorderRadius.circular(20),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 8,
                              ),
                              decoration: BoxDecoration(
                                color: kHomeCard,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: kHomeOutline),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(
                                    Icons.location_city,
                                    color: kHomePink,
                                    size: 14,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    item['city'] as String,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 13,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}
