import 'dart:convert';
import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../utils/location_status.dart';

class UserLocation {
  const UserLocation({
    required this.latitude,
    required this.longitude,
    required this.city,
    required this.area,
    this.formattedAddress,
    this.source = LocationSource.unknown,
    this.capturedAt,
    this.accuracyMeters,
  });
  final double latitude;
  final double longitude;
  final String city;
  final String area;
  final String? formattedAddress;
  final LocationSource source;
  final DateTime? capturedAt;
  final double? accuracyMeters;

  bool get isFromDeviceGps => source == LocationSource.gps;
}

class LocationService {
  // Singleton
  static final LocationService instance = LocationService._internal();
  LocationService._internal();

  final ValueNotifier<UserLocation?> currentLocation = ValueNotifier(null);
  final ValueNotifier<bool> isLoading = ValueNotifier(false);
  final ValueNotifier<String?> error = ValueNotifier(null);
  final ValueNotifier<bool> isGpsDisabled = ValueNotifier(false);
  final ValueNotifier<bool> isPermissionBlocked = ValueNotifier(false);
  final ValueNotifier<DeviceLocationStatus> permissionStatus =
      ValueNotifier(DeviceLocationStatus.unknown);
  StreamSubscription<Position>? _positionSubscription;

  static const Duration gpsFreshness = Duration(minutes: 10);

  bool get hasValidDeviceGps {
    final loc = currentLocation.value;
    if (loc == null || !loc.isFromDeviceGps) {
      return false;
    }
    final capturedAt = loc.capturedAt;
    if (capturedAt == null) {
      return true;
    }
    return DateTime.now().difference(capturedAt) <= gpsFreshness;
  }

  bool get hasAnyLocation => currentLocation.value != null;

  Future<DeviceLocationStatus> refreshPermissionStatus() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        isGpsDisabled.value = true;
        permissionStatus.value = DeviceLocationStatus.gpsDisabled;
        return permissionStatus.value;
      }
      isGpsDisabled.value = false;

      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.deniedForever) {
        isPermissionBlocked.value = true;
        permissionStatus.value = DeviceLocationStatus.permanentlyDenied;
        return permissionStatus.value;
      }
      if (permission == LocationPermission.denied) {
        isPermissionBlocked.value = true;
        permissionStatus.value = DeviceLocationStatus.denied;
        return permissionStatus.value;
      }
      isPermissionBlocked.value = false;
      permissionStatus.value = DeviceLocationStatus.granted;
      return permissionStatus.value;
    } catch (_) {
      permissionStatus.value = DeviceLocationStatus.error;
      return permissionStatus.value;
    }
  }

  Future<void> fetchCurrentLocation({bool force = false}) async {
    if (currentLocation.value != null &&
        currentLocation.value!.isFromDeviceGps &&
        !force) {
      return;
    }

    isLoading.value = true;
    error.value = null;
    permissionStatus.value = DeviceLocationStatus.requesting;

    try {
      // 1. Check if device location service (GPS) is turned on.
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        isGpsDisabled.value = true;
        permissionStatus.value = DeviceLocationStatus.gpsDisabled;
        throw Exception('Device GPS / Location service is turned off.');
      }

      isGpsDisabled.value = false;

      // 2. Check & request permission
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          isPermissionBlocked.value = true;
          permissionStatus.value = DeviceLocationStatus.denied;
          throw Exception('Location permissions are denied.');
        }
      }
      if (permission == LocationPermission.deniedForever) {
        isPermissionBlocked.value = true;
        permissionStatus.value = DeviceLocationStatus.permanentlyDenied;
        throw Exception('Location permissions are permanently denied.');
      }
      isPermissionBlocked.value = false;
      permissionStatus.value = DeviceLocationStatus.granted;

      Position? position;
      try {
        position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 8),
          ),
        );
      } catch (_) {
        position = await Geolocator.getLastKnownPosition();
      }

      position ??= await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 6),
        ),
      );

      final resolved = await reverseGeocode(
        position.latitude,
        position.longitude,
      );

      currentLocation.value = _locationFromPosition(
        position,
        resolved,
        source: LocationSource.gps,
      );
      _startLocationStream();
    } catch (e) {
      error.value = e.toString();
      if (permissionStatus.value == DeviceLocationStatus.requesting) {
        permissionStatus.value = DeviceLocationStatus.error;
      }
    } finally {
      isLoading.value = false;
    }
  }

  /// Reverse geocoding with Google Maps Geocoding API + Multi-platform fallback
  Future<Map<String, String>> reverseGeocode(double lat, double lng) async {
    String city = '';
    String state = '';
    String district = '';
    String postalCode = '';
    String area = '';
    String formattedAddress = '';

    // 1. If Google Maps API key is configured, use Google Geocoding API
    if (AppConfig.googleMapsApiKey.isNotEmpty) {
      try {
        final url = Uri.parse(
          'https://maps.googleapis.com/maps/api/geocode/json?latlng=$lat,$lng&key=${AppConfig.googleMapsApiKey}',
        );
        final res = await http.get(url).timeout(const Duration(seconds: 5));
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (data['status'] == 'OK' && (data['results'] as List).isNotEmpty) {
            final firstResult = data['results'][0];
            formattedAddress = firstResult['formatted_address'] ?? '';
            final components = firstResult['address_components'] as List;

            for (final comp in components) {
              final types = List<String>.from(comp['types'] ?? []);
              if (types.contains('locality')) {
                city = comp['long_name'] ?? '';
              } else if (city.isEmpty &&
                  types.contains('administrative_area_level_2')) {
                city = comp['long_name'] ?? '';
              }
              if (types.contains('administrative_area_level_1')) {
                state = comp['long_name'] ?? '';
              }
              if (types.contains('administrative_area_level_2')) {
                district = comp['long_name'] ?? '';
              }
              if (types.contains('postal_code')) {
                postalCode = comp['long_name'] ?? '';
              }
              if (types.contains('sublocality') ||
                  types.contains('sublocality_level_1')) {
                area = comp['long_name'] ?? '';
              } else if (area.isEmpty && types.contains('neighborhood')) {
                area = comp['long_name'] ?? '';
              }
            }
          }
        }
      } catch (_) {
        // Fallback if Google API times out or fails
      }
    }

    // 2. Fallback: OpenStreetMap Nominatim
    if (city.isEmpty) {
      try {
        final url = Uri.parse(
          'https://nominatim.openstreetmap.org/reverse?lat=$lat&lon=$lng&format=json&addressdetails=1',
        );
        final res = await http
            .get(
              url,
              headers: {
                'User-Agent': 'BaylenApp/1.0',
                'Accept': 'application/json',
              },
            )
            .timeout(const Duration(seconds: 5));

        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (data is Map && data['address'] is Map) {
            final addr = data['address'] as Map;
            formattedAddress = data['display_name'] ?? '';
            city =
                addr['city']?.toString() ??
                addr['town']?.toString() ??
                addr['village']?.toString() ??
                addr['municipality']?.toString() ??
                addr['state_district']?.toString() ??
                addr['state']?.toString() ??
                '';

            area =
                addr['suburb']?.toString() ??
                addr['neighbourhood']?.toString() ??
                addr['residential']?.toString() ??
                addr['commercial']?.toString() ??
                addr['road']?.toString() ??
                addr['county']?.toString() ??
                '';
            state = addr['state']?.toString() ?? state;
            district =
                addr['state_district']?.toString() ??
                addr['county']?.toString() ??
                district;
            postalCode = addr['postcode']?.toString() ?? postalCode;
          }
        }
      } catch (_) {}
    }

    if (city.isEmpty) {
      city = 'Current location';
      area = '${lat.toStringAsFixed(4)}, ${lng.toStringAsFixed(4)}';
    } else if (area.isEmpty) {
      area = city;
    }

    return {
      'city': city,
      'state': state,
      'district': district,
      'postal_code': postalCode,
      'area': area,
      'formatted_address': formattedAddress,
    };
  }

  /// Search locations/addresses by text query
  Future<List<UserLocation>> searchLocations(String query) async {
    if (query.trim().isEmpty) return [];

    final results = <UserLocation>[];

    // 1. Google Places / Geocode if configured
    if (AppConfig.googleMapsApiKey.isNotEmpty) {
      try {
        final url = Uri.parse(
          'https://maps.googleapis.com/maps/api/geocode/json?address=${Uri.encodeComponent(query)}&key=${AppConfig.googleMapsApiKey}',
        );
        final res = await http.get(url).timeout(const Duration(seconds: 5));
        if (res.statusCode == 200) {
          final data = jsonDecode(res.body);
          if (data['status'] == 'OK') {
            for (final item in data['results'] as List) {
              final loc = item['geometry']['location'];
              final double lat = (loc['lat'] as num).toDouble();
              final double lng = (loc['lng'] as num).toDouble();
              String city = '';
              String area = '';

              for (final comp in item['address_components'] as List) {
                final types = List<String>.from(comp['types'] ?? []);
                if (types.contains('locality') ||
                    types.contains('administrative_area_level_2')) {
                  city = comp['long_name'] ?? '';
                }
                if (types.contains('sublocality') ||
                    types.contains('neighborhood')) {
                  area = comp['long_name'] ?? '';
                }
              }

              results.add(
                UserLocation(
                  latitude: lat,
                  longitude: lng,
                  city: city.isNotEmpty ? city : query,
                  area: area.isNotEmpty
                      ? area
                      : item['formatted_address'] ?? '',
                  formattedAddress: item['formatted_address'],
                ),
              );
            }
            if (results.isNotEmpty) return results;
          }
        }
      } catch (_) {}
    }

    // 2. OpenStreetMap Search Fallback
    try {
      final url = Uri.parse(
        'https://nominatim.openstreetmap.org/search?q=${Uri.encodeComponent(query)}&format=json&addressdetails=1&limit=6',
      );
      final res = await http
          .get(
            url,
            headers: {
              'User-Agent': 'BaylenApp/1.0',
              'Accept': 'application/json',
            },
          )
          .timeout(const Duration(seconds: 5));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data is List) {
          for (final item in data) {
            final lat = double.tryParse(item['lat']?.toString() ?? '') ?? 0.0;
            final lng = double.tryParse(item['lon']?.toString() ?? '') ?? 0.0;
            final addr = item['address'] as Map? ?? {};

            final city =
                addr['city']?.toString() ??
                addr['town']?.toString() ??
                addr['village']?.toString() ??
                addr['state_district']?.toString() ??
                addr['state']?.toString() ??
                query;

            final area =
                addr['suburb']?.toString() ??
                addr['neighbourhood']?.toString() ??
                addr['road']?.toString() ??
                addr['county']?.toString() ??
                item['display_name']?.toString() ??
                '';

            results.add(
              UserLocation(
                latitude: lat,
                longitude: lng,
                city: city,
                area: area,
                formattedAddress: item['display_name'],
              ),
            );
          }
        }
      }
    } catch (_) {}

    return results;
  }

  // Allow manual override (e.g., from a location picker)
  void setManualLocation(UserLocation location) {
    currentLocation.value = UserLocation(
      latitude: location.latitude,
      longitude: location.longitude,
      city: location.city,
      area: location.area,
      formattedAddress: location.formattedAddress,
      source: LocationSource.manual,
      capturedAt: DateTime.now(),
      accuracyMeters: location.accuracyMeters,
    );
    error.value = null;
    permissionStatus.value = DeviceLocationStatus.granted;
  }

  void _startLocationStream() {
    if (!kIsWeb &&
        (defaultTargetPlatform == TargetPlatform.windows ||
            defaultTargetPlatform == TargetPlatform.macOS ||
            defaultTargetPlatform == TargetPlatform.linux)) {
      return;
    }
    if (_positionSubscription != null) return;
    _positionSubscription =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 250,
          ),
        ).listen(
          (position) async {
            final current = currentLocation.value;
            if (current != null) {
              final movedMeters = Geolocator.distanceBetween(
                current.latitude,
                current.longitude,
                position.latitude,
                position.longitude,
              );
              if (movedMeters < 250) return;
            }

            final resolved = await reverseGeocode(
              position.latitude,
              position.longitude,
            );
            currentLocation.value = _locationFromPosition(
              position,
              resolved,
              source: LocationSource.gps,
            );
          },
          onError: (Object streamError) {
            error.value = streamError.toString();
          },
        );
  }

  UserLocation _locationFromPosition(
    Position position,
    Map<String, String> resolved, {
    LocationSource source = LocationSource.gps,
  }) {
    return UserLocation(
      latitude: position.latitude,
      longitude: position.longitude,
      city: resolved['city'] ?? 'Current location',
      area: resolved['area']?.isNotEmpty == true
          ? resolved['area']!
          : '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}',
      formattedAddress: resolved['formatted_address'],
      source: source,
      capturedAt: DateTime.now(),
      accuracyMeters: position.accuracy,
    );
  }
}
