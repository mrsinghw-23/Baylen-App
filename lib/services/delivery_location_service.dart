import '../auth/auth_service.dart';
import '../models/account.dart';
import '../services/location_service.dart';

enum DeliveryCoordinateSource { none, address, gps }

class DeliveryCoordinates {
  const DeliveryCoordinates({
    this.latitude,
    this.longitude,
    this.source = DeliveryCoordinateSource.none,
  });

  final double? latitude;
  final double? longitude;
  final DeliveryCoordinateSource source;

  bool get hasCoordinates => latitude != null && longitude != null;
}

/// Resolves delivery lat/lng from saved addresses first, then device GPS.
class DeliveryLocationService {
  DeliveryLocationService._();
  static final DeliveryLocationService instance = DeliveryLocationService._();

  DeliveryCoordinates? _cached;
  DateTime? _cachedAt;

  Future<DeliveryCoordinates> resolve({bool forceRefresh = false}) async {
    if (!forceRefresh &&
        _cached != null &&
        _cachedAt != null &&
        DateTime.now().difference(_cachedAt!) < const Duration(minutes: 2)) {
      return _cached!;
    }

    if (AuthService.instance.isSignedIn) {
      try {
        final addresses = await AuthService.instance.api.addresses();
        final selected = _pickAddress(addresses);
        if (selected?.latitude != null && selected?.longitude != null) {
          _cached = DeliveryCoordinates(
            latitude: selected!.latitude,
            longitude: selected.longitude,
            source: DeliveryCoordinateSource.address,
          );
          _cachedAt = DateTime.now();
          return _cached!;
        }
      } catch (_) {}
    }

    final gps = LocationService.instance.currentLocation.value;
    if (gps != null && gps.isFromDeviceGps) {
      _cached = DeliveryCoordinates(
        latitude: gps.latitude,
        longitude: gps.longitude,
        source: DeliveryCoordinateSource.gps,
      );
      _cachedAt = DateTime.now();
      return _cached!;
    }

    _cached = const DeliveryCoordinates();
    _cachedAt = DateTime.now();
    return _cached!;
  }

  void invalidate() {
    _cached = null;
    _cachedAt = null;
  }

  Address? _pickAddress(List<Address> addresses) {
    for (final address in addresses) {
      if (address.isDefault) {
        return address;
      }
    }
    return addresses.isEmpty ? null : addresses.first;
  }
}
