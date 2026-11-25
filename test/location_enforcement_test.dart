import 'package:baylen_app/services/location_service.dart';
import 'package:baylen_app/utils/location_status.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('device location status messages cover blocked states', () {
    expect(
      deviceLocationStatusMessage(DeviceLocationStatus.denied),
      'Location permission is required',
    );
    expect(
      deviceLocationStatusMessage(DeviceLocationStatus.permanentlyDenied),
      'Location permission is blocked',
    );
    expect(
      deviceLocationStatusMessage(DeviceLocationStatus.gpsDisabled),
      'Turn on your location',
    );
  });

  test('manual location is not treated as device GPS', () {
    const manual = UserLocation(
      latitude: 23.3687,
      longitude: 85.3395,
      city: 'Ranchi',
      area: 'Lalpur',
      source: LocationSource.manual,
      capturedAt: null,
    );
    expect(manual.isFromDeviceGps, isFalse);
  });

  test('GPS location is recognized for delivery eligibility checks', () {
    const gps = UserLocation(
      latitude: 23.3782,
      longitude: 85.3315,
      city: 'Ranchi',
      area: 'Test',
      source: LocationSource.gps,
      capturedAt: null,
    );
    expect(gps.isFromDeviceGps, isTrue);
  });
}
