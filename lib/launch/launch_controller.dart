import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/launch_content.dart';
import '../services/location_service.dart';
import '../shell/main_shell.dart';
import 'baylen_splash_screen.dart';
import 'launch_experience.dart';
import 'location_permission_screen.dart';

class BaylenLaunchController extends StatefulWidget {
  const BaylenLaunchController({super.key});

  @override
  State<BaylenLaunchController> createState() => _BaylenLaunchControllerState();
}

class _BaylenLaunchControllerState extends State<BaylenLaunchController> {
  static const _splashDuration = Duration(milliseconds: 2300);
  static const _transitionDuration = Duration(milliseconds: 500);
  static const _seenLaunchContentKey = 'baylen_seen_launch_content';

  bool _showHome = false;
  bool _splashDone = false;
  bool _showLocationPermission = false;
  bool _showLaunchExperience = false;
  int _initialTab = MainShell.homeIndex;
  LaunchContent _launchContent = const LaunchContent.empty();

  @override
  void initState() {
    super.initState();
    unawaited(_startLaunchSequence());
  }

  Future<void> _startLaunchSequence() async {
    final stopwatch = Stopwatch()..start();
    LaunchContent launchContent = const LaunchContent.empty();

    // 1. Restore auth session in background (with timeout to prevent freezing)
    try {
      await AuthService.instance.restore().timeout(const Duration(seconds: 4));
    } catch (_) {}

    // 2. Fetch launch content & check seen IDs (with timeout)
    try {
      final apiContent = await CatalystApi().launchContent().timeout(
        const Duration(seconds: 4),
      );
      final prefs = await SharedPreferences.getInstance();
      final seenIds =
          prefs.getStringList(_seenLaunchContentKey)?.toSet() ?? <String>{};
      launchContent = apiContent.withoutSeen(seenIds);
    } catch (_) {
      launchContent = const LaunchContent.empty();
    }

    // 3. Check Location Permission & GPS service
    bool locationReady = false;
    try {
      final permission = await Geolocator.checkPermission();
      final hasPerm =
          permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
      final isGpsEnabled = await Geolocator.isLocationServiceEnabled();
      locationReady = hasPerm && isGpsEnabled;

      if (locationReady) {
        // Silently fetch GPS coordinates in background
        unawaited(LocationService.instance.fetchCurrentLocation());
      }
    } catch (_) {
      locationReady = false;
    }

    // 4. Ensure splash stays for full premium duration
    final elapsed = stopwatch.elapsed;
    final remaining = _splashDuration - elapsed;
    if (remaining > Duration.zero) {
      await Future<void>.delayed(remaining);
    }

    if (!mounted) return;

    _launchContent = launchContent;

    // Remove the forced location block so the app opens properly
    _proceedAfterLocation();
  }

  void _proceedAfterLocation() {
    if (_launchContent.hasContent) {
      setState(() {
        _showLocationPermission = false;
        _splashDone = true;
        _showLaunchExperience = true;
      });
      return;
    }

    // Crossfade to main home screen
    setState(() {
      _showLocationPermission = false;
      _showHome = true;
    });

    Future<void>.delayed(_transitionDuration, () {
      if (mounted) {
        setState(() {
          _splashDone = true;
        });
      }
    });
  }

  Future<void> _markLaunchContentSeen() async {
    final ids = _launchContent.oneTimeIds;
    if (ids.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final existing =
          prefs.getStringList(_seenLaunchContentKey)?.toSet() ?? <String>{};
      await prefs.setStringList(
        _seenLaunchContentKey,
        {...existing, ...ids}.toList(),
      );
    } catch (_) {}
  }

  void _completeLaunchExperience({int? tabIndex}) {
    unawaited(_markLaunchContentSeen());
    setState(() {
      _initialTab = tabIndex ?? _initialTab;
      _showLaunchExperience = false;
      _showHome = true;
    });
  }

  void _handleLaunchAction(LaunchItem item) {
    _completeLaunchExperience(tabIndex: _tabIndexFor(item));
  }

  int _tabIndexFor(LaunchItem item) {
    final type = item.actionType.toLowerCase().trim();
    final value = item.actionValue.toLowerCase().trim();
    final target = '$type $value';

    if (target.contains('shop') || target.contains('product')) {
      return MainShell.shopIndex;
    }
    if (target.contains('service') || target.contains('home_service')) {
      return MainShell.homeServiceIndex;
    }
    if (target.contains('salon') ||
        target.contains('booking') ||
        target.contains('outlet')) {
      return MainShell.salonIndex;
    }
    if (target.contains('profile') || target.contains('account')) {
      return MainShell.profileIndex;
    }
    return MainShell.homeIndex;
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        // 1. Main App Shell (Home)
        AnimatedOpacity(
          opacity: _showHome ? 1.0 : 0.0,
          duration: _transitionDuration,
          curve: Curves.easeInOutCubic,
          child: MainShell(initialIndex: _initialTab),
        ),

        // 2. Mandatory Location Permission Flow
        if (_showLocationPermission)
          LocationPermissionScreen(onLocationReady: _proceedAfterLocation),

        // 3. Promotional Launch Experience / Onboarding
        if (_showLaunchExperience)
          LaunchExperience(
            content: _launchContent,
            onComplete: () => _completeLaunchExperience(),
            onAction: _handleLaunchAction,
          ),

        // 4. Initial Splash Screen
        if (!_splashDone)
          IgnorePointer(
            ignoring: _showHome || _showLocationPermission,
            child: AnimatedOpacity(
              opacity: (_showHome || _showLocationPermission) ? 0.0 : 1.0,
              duration: _transitionDuration,
              curve: Curves.easeInOutCubic,
              child: const BaylenSplashScreen(),
            ),
          ),
      ],
    );
  }
}
