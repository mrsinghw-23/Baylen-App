import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

import '../api/catalyst_api.dart';
import '../config/tracking_config.dart';

enum TrackingPermissionState {
  notRequested,
  granted,
  denied,
  deniedForever,
  servicesDisabled,
}

class TrackingException implements Exception {
  TrackingException(this.permissionState);

  final TrackingPermissionState permissionState;

  @override
  String toString() => 'TrackingException($permissionState)';
}

class ProfessionalTrackingService {
  ProfessionalTrackingService._();

  static final ProfessionalTrackingService instance = ProfessionalTrackingService._();

  StreamSubscription<Position>? _positionSub;
  Timer? _heartbeatTimer;
  Timer? _availabilityTimer;
  String? _activeJobId;
  CatalystApi? _api;
  CatalystApi? _availabilityApi;
  Position? _lastSent;
  Position? _lastAvailabilitySent;
  Position? _lastPosition;
  double? _destinationLat;
  double? _destinationLng;

  static const _availabilityInterval = Duration(seconds: 45);

  bool get isTracking => _activeJobId != null;
  bool get isAvailabilityPinging => _availabilityTimer != null;
  String? get activeJobId => _activeJobId;
  Position? get lastPosition => _lastPosition;

  /// Fresh GPS for go-online — used so dispatch can match nearby orders immediately.
  Future<Position?> currentPositionForGoOnline() async {
    final permission = await ensurePermission();
    if (permission != TrackingPermissionState.granted) {
      return null;
    }
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      _lastPosition = position;
      return position;
    } catch (_) {
      return _lastPosition;
    }
  }

  Future<TrackingPermissionState> ensurePermission() async {
    final enabled = await Geolocator.isLocationServiceEnabled();
    if (!enabled) {
      return TrackingPermissionState.servicesDisabled;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return TrackingPermissionState.deniedForever;
    }
    if (permission == LocationPermission.denied) {
      return TrackingPermissionState.denied;
    }
    return TrackingPermissionState.granted;
  }

  LocationSettings _locationSettings() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: TrackingConfig.minDisplacementMeters.round(),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Baylen Pro',
          notificationText: 'Sharing live location for your active job',
          enableWakeLock: true,
        ),
      );
    }
    if (Platform.isIOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: TrackingConfig.minDisplacementMeters.round(),
        activityType: ActivityType.automotiveNavigation,
        pauseLocationUpdatesAutomatically: false,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 15,
    );
  }

  Duration _intervalForDistance(double? distanceKm) {
    if (distanceKm == null) {
      return TrackingConfig.farInterval;
    }
    if (distanceKm <= TrackingConfig.nearDistanceKm) {
      return TrackingConfig.nearInterval;
    }
    if (distanceKm <= TrackingConfig.mediumDistanceKm) {
      return TrackingConfig.mediumInterval;
    }
    return TrackingConfig.farInterval;
  }

  Future<void> startTracking({
    required CatalystApi api,
    required String jobId,
    double? destinationLat,
    double? destinationLng,
  }) async {
    final permission = await ensurePermission();
    if (permission != TrackingPermissionState.granted) {
      throw TrackingException(permission);
    }

    if (_activeJobId == jobId && _positionSub != null) {
      return;
    }

    await stopTracking();
    _api = api;
    _activeJobId = jobId;
    _destinationLat = destinationLat;
    _destinationLng = destinationLng;

    await _sendCurrentPosition(force: true);

    _positionSub = Geolocator.getPositionStream(
      locationSettings: _locationSettings(),
    ).listen((position) {
      _lastPosition = position;
      unawaited(_maybeSend(position));
    });

    _scheduleHeartbeat();
  }

  void _scheduleHeartbeat() {
    _heartbeatTimer?.cancel();
    final interval = _intervalForDistance(_distanceToDestinationKm());
    _heartbeatTimer = Timer(interval, () async {
      if (_activeJobId == null) {
        return;
      }
      if (_lastPosition != null) {
        await _maybeSend(_lastPosition!, forceFreshness: true);
      } else {
        await _sendCurrentPosition(forceFreshness: true);
      }
      _scheduleHeartbeat();
    });
  }

  double? _distanceToDestinationKm() {
    if (_lastPosition == null || _destinationLat == null || _destinationLng == null) {
      return null;
    }
    final meters = Geolocator.distanceBetween(
      _lastPosition!.latitude,
      _lastPosition!.longitude,
      _destinationLat!,
      _destinationLng!,
    );
    return meters / 1000;
  }

  Future<void> _sendCurrentPosition({bool force = false, bool forceFreshness = false}) async {
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: _locationSettings(),
      );
      _lastPosition = position;
      await _maybeSend(position, force: force, forceFreshness: forceFreshness);
    } catch (_) {}
  }

  Future<void> _maybeSend(
    Position position, {
    bool force = false,
    bool forceFreshness = false,
  }) async {
    final api = _api;
    final jobId = _activeJobId;
    if (api == null || jobId == null) {
      return;
    }

    if (position.accuracy > TrackingConfig.maxAccuracyMeters && !force) {
      return;
    }

    if (!force && !forceFreshness && _lastSent != null) {
      final moved = Geolocator.distanceBetween(
        _lastSent!.latitude,
        _lastSent!.longitude,
        position.latitude,
        position.longitude,
      );
      if (moved < TrackingConfig.minDisplacementMeters) {
        return;
      }
    }

    try {
      await api.sendPartnerJobLocation(
        jobId: jobId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: position.accuracy,
        speedMps: position.speed >= 0 ? position.speed : null,
        heading: position.heading >= 0 ? position.heading : null,
        capturedAt: DateTime.now().toUtc(),
      );
      _lastSent = position;
    } catch (_) {}
  }

  Future<void> startAvailabilityTracking({required CatalystApi api}) async {
    final permission = await ensurePermission();
    if (permission != TrackingPermissionState.granted) {
      throw TrackingException(permission);
    }
    if (_availabilityApi != null && identical(_availabilityApi, api)) {
      return;
    }
    await stopAvailabilityTracking();
    _availabilityApi = api;
    await _sendAvailabilityPing(force: true);
    _availabilityTimer = Timer.periodic(_availabilityInterval, (_) {
      unawaited(_sendAvailabilityPing());
    });
  }

  Future<void> stopAvailabilityTracking() async {
    _availabilityTimer?.cancel();
    _availabilityTimer = null;
    _availabilityApi = null;
    _lastAvailabilitySent = null;
  }

  Future<void> _sendAvailabilityPing({bool force = false}) async {
    final api = _availabilityApi;
    if (api == null) return;
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      _lastPosition = position;
      if (position.accuracy > TrackingConfig.maxAccuracyMeters && !force) {
        return;
      }
      if (!force && _lastAvailabilitySent != null) {
        final moved = Geolocator.distanceBetween(
          _lastAvailabilitySent!.latitude,
          _lastAvailabilitySent!.longitude,
          position.latitude,
          position.longitude,
        );
        if (moved < TrackingConfig.minDisplacementMeters) {
          return;
        }
      }
      await api.sendPartnerAvailabilityLocation(
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: position.accuracy,
        capturedAt: DateTime.now().toUtc(),
      );
      _lastAvailabilitySent = position;
    } catch (_) {}
  }

  Future<void> stopTracking() async {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    await _positionSub?.cancel();
    _positionSub = null;
    _activeJobId = null;
    _api = null;
    _lastSent = null;
    _lastPosition = null;
    _destinationLat = null;
    _destinationLng = null;
  }

  static String permissionMessage(TrackingPermissionState state) {
    switch (state) {
      case TrackingPermissionState.servicesDisabled:
        return 'Enable location services to share live GPS.';
      case TrackingPermissionState.deniedForever:
        return 'Location permission denied. Open system settings to allow location.';
      case TrackingPermissionState.denied:
        return 'Location permission is required for live tracking.';
      case TrackingPermissionState.notRequested:
      case TrackingPermissionState.granted:
        return '';
    }
  }
}
