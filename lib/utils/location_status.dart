enum LocationSource {
  unknown,
  gps,
  manual,
}

enum DeviceLocationStatus {
  unknown,
  requesting,
  granted,
  denied,
  permanentlyDenied,
  gpsDisabled,
  unavailable,
  error,
}

String deviceLocationStatusMessage(DeviceLocationStatus status) {
  switch (status) {
    case DeviceLocationStatus.denied:
      return 'Location permission is required';
    case DeviceLocationStatus.permanentlyDenied:
      return 'Location permission is blocked';
    case DeviceLocationStatus.gpsDisabled:
      return 'Turn on your location';
    case DeviceLocationStatus.unavailable:
      return 'Location is temporarily unavailable';
    case DeviceLocationStatus.error:
      return 'Could not detect your location';
    case DeviceLocationStatus.requesting:
      return 'Detecting your location...';
    case DeviceLocationStatus.granted:
    case DeviceLocationStatus.unknown:
      return 'Turn on your location';
  }
}

String deviceLocationStatusDescription(DeviceLocationStatus status) {
  switch (status) {
    case DeviceLocationStatus.denied:
      return 'Baylen needs your current location to show nearby salons, home services, quick delivery, and accurate availability.';
    case DeviceLocationStatus.permanentlyDenied:
      return 'Location access is blocked in system settings. Open Settings and allow location for Baylen to continue.';
    case DeviceLocationStatus.gpsDisabled:
      return 'Your device location service is turned off. Enable GPS so Baylen can use your real current location.';
    case DeviceLocationStatus.unavailable:
      return 'We could not read a GPS fix right now. Check signal and try again.';
    case DeviceLocationStatus.error:
      return 'Something went wrong while reading your location. Please try again.';
    case DeviceLocationStatus.requesting:
      return 'Please wait while Baylen reads your current location.';
    case DeviceLocationStatus.granted:
    case DeviceLocationStatus.unknown:
      return 'Baylen needs your current location to show nearby salons, home services, quick delivery, and accurate availability.';
  }
}

String deviceLocationPrimaryActionLabel(DeviceLocationStatus status) {
  switch (status) {
    case DeviceLocationStatus.permanentlyDenied:
      return 'Open Settings';
    case DeviceLocationStatus.gpsDisabled:
      return 'Turn On Location';
    case DeviceLocationStatus.denied:
      return 'Allow Location';
    default:
      return 'Turn On Location';
  }
}
