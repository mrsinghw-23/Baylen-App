import 'package:flutter_test/flutter_test.dart';

import 'package:baylen_app/config/tracking_config.dart';

void main() {
  test('tracking intervals are ordered far to near', () {
    expect(TrackingConfig.farInterval.inSeconds, greaterThan(TrackingConfig.mediumInterval.inSeconds));
    expect(TrackingConfig.mediumInterval.inSeconds, greaterThan(TrackingConfig.nearInterval.inSeconds));
  });

  test('tracking displacement filter is positive', () {
    expect(TrackingConfig.minDisplacementMeters, greaterThan(0));
    expect(TrackingConfig.maxAccuracyMeters, greaterThan(0));
  });
}
