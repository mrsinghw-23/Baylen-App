/// PP-005 adaptive GPS upload intervals (single source of truth).
class TrackingConfig {
  TrackingConfig._();

  static const farInterval = Duration(seconds: 15);
  static const mediumInterval = Duration(seconds: 10);
  static const nearInterval = Duration(seconds: 6);

  static const minDisplacementMeters = 8.0;
  static const maxAccuracyMeters = 100.0;

  static const mediumDistanceKm = 3.0;
  static const nearDistanceKm = 0.5;
}
