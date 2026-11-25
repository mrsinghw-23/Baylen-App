import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../services/location_service.dart';
import '../../utils/location_status.dart';

class RequiredLocationPanel extends StatefulWidget {
  const RequiredLocationPanel({
    super.key,
    required this.onLocationReady,
    this.compact = false,
    this.requireDeviceGps = true,
  });

  final VoidCallback onLocationReady;
  final bool compact;
  final bool requireDeviceGps;

  @override
  State<RequiredLocationPanel> createState() => _RequiredLocationPanelState();
}

class _RequiredLocationPanelState extends State<RequiredLocationPanel>
    with WidgetsBindingObserver {
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refreshStatus());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_retryAfterResume());
    }
  }

  Future<void> _refreshStatus() async {
    await LocationService.instance.refreshPermissionStatus();
    if (!mounted) return;
    setState(() {});
  }

  Future<void> _retryAfterResume() async {
    final status = await LocationService.instance.refreshPermissionStatus();
    if (!mounted) return;
    setState(() {});
    if (status == DeviceLocationStatus.granted) {
      await _fetchLocation();
    }
  }

  Future<void> _fetchLocation() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await LocationService.instance.fetchCurrentLocation(force: true);
      if (!mounted) return;
      if (widget.requireDeviceGps &&
          !LocationService.instance.hasValidDeviceGps) {
        throw Exception('Device GPS location is required.');
      }
      setState(() => _loading = false);
      widget.onLocationReady();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _handlePrimaryAction() async {
    final status = LocationService.instance.permissionStatus.value;
    if (status == DeviceLocationStatus.permanentlyDenied) {
      await Geolocator.openAppSettings();
      return;
    }
    if (status == DeviceLocationStatus.gpsDisabled) {
      await Geolocator.openLocationSettings();
      return;
    }
    if (status == DeviceLocationStatus.denied) {
      final permission = await Geolocator.requestPermission();
      await LocationService.instance.refreshPermissionStatus();
      if (!mounted) return;
      setState(() {});
      if (permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse) {
        await _fetchLocation();
      }
      return;
    }
    await _fetchLocation();
  }

  @override
  Widget build(BuildContext context) {
    final status = LocationService.instance.permissionStatus.value;
    final title = deviceLocationStatusMessage(status);
    final description = deviceLocationStatusDescription(status);
    final actionLabel = deviceLocationPrimaryActionLabel(status);
    final theme = Theme.of(context);

    if (widget.compact) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(Icons.location_on_outlined, color: theme.colorScheme.primary),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(description, style: theme.textTheme.bodySmall),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(
                  _error!,
                  style: TextStyle(color: theme.colorScheme.error, fontSize: 12),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _loading ? null : _handlePrimaryAction,
                child: Text(_loading ? 'Detecting location...' : actionLabel),
              ),
            ],
          ),
        ),
      );
    }

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                status == DeviceLocationStatus.gpsDisabled
                    ? Icons.location_off_outlined
                    : Icons.my_location_outlined,
                size: 56,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 18),
              Text(
                title,
                textAlign: TextAlign.center,
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                description,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium,
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: theme.colorScheme.error),
                ),
              ],
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _loading ? null : _handlePrimaryAction,
                  child: Text(_loading ? 'Detecting location...' : actionLabel),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
