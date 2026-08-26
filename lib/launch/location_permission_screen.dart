import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../services/location_service.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/home/location_picker_sheet.dart';

class LocationPermissionScreen extends StatefulWidget {
  const LocationPermissionScreen({super.key, required this.onLocationReady});

  final VoidCallback onLocationReady;

  @override
  State<LocationPermissionScreen> createState() =>
      _LocationPermissionScreenState();
}

class _LocationPermissionScreenState extends State<LocationPermissionScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  bool _isLoading = false;
  bool _isGpsDisabled = false;
  bool _isPermissionDeniedForever = false;
  String? _errorMessage;

  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.92, end: 1.08).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _checkInitialStatus();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pulseController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // When returning to app after changing settings, re-check automatically
    if (state == AppLifecycleState.resumed) {
      _checkAndAutoFetch();
    }
  }

  Future<void> _checkInitialStatus() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      final permission = await Geolocator.checkPermission();

      if (mounted) {
        setState(() {
          _isGpsDisabled = !serviceEnabled;
          _isPermissionDeniedForever =
              permission == LocationPermission.deniedForever;
        });
      }
    } catch (_) {}
  }

  Future<void> _checkAndAutoFetch() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      final permission = await Geolocator.checkPermission();

      setState(() {
        _isGpsDisabled = !serviceEnabled;
        _isPermissionDeniedForever =
            permission == LocationPermission.deniedForever;
      });

      if (serviceEnabled &&
          (permission == LocationPermission.always ||
              permission == LocationPermission.whileInUse)) {
        await _fetchLocationAndProceed();
      }
    } catch (_) {}
  }

  Future<void> _requestAndFetchLocation() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      // 1. Check & Request permission
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }

      if (permission == LocationPermission.deniedForever) {
        setState(() {
          _isLoading = false;
          _isPermissionDeniedForever = true;
          _errorMessage = 'Location permission is permanently denied. Please tap below to enable it in Settings or select your city manually.';
        });
        await Geolocator.openAppSettings();
        return;
      }

      if (permission == LocationPermission.denied) {
        setState(() {
          _isLoading = false;
          _errorMessage =
              'Location access is required to show nearby salons and services.';
        });
        return;
      }

      // 2. Check if device GPS is enabled
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        setState(() {
          _isLoading = false;
          _isGpsDisabled = true;
          _errorMessage = 'Device location (GPS) is turned off. Please turn it on to continue.';
        });
        await Geolocator.openLocationSettings();
        return;
      }

      // 3. Fetch location
      await _fetchLocationAndProceed();
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = 'Could not fetch location: $e';
        });
      }
    }
  }

  Future<void> _fetchLocationAndProceed() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      await LocationService.instance.fetchCurrentLocation(force: true);
      if (mounted) {
        setState(() => _isLoading = false);
        widget.onLocationReady();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _errorMessage = 'Could not detect location: $e';
        });
      }
    }
  }

  void _openManualPicker() {
    LocationPickerSheet.show(
      context,
      onLocationSelected: () {
        widget.onLocationReady();
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = _isGpsDisabled
        ? 'Turn On Device Location'
        : _isPermissionDeniedForever
        ? 'Enable Location in Settings'
        : 'Find Salons & Services\nNear You';

    final description = _isGpsDisabled
        ? 'Your phone\'s GPS / Location service is turned off. Please turn on location services so Baylen can find salons near you.'
        : _isPermissionDeniedForever
        ? 'Location permission was denied. Please open Settings and allow location access to discover nearby outlets.'
        : 'To show nearby Baylen luxury salons, real-time technician availability, and doorstep beauty services, please grant location access.';

    final buttonLabel = _isGpsDisabled
        ? 'Turn On Location (GPS)'
        : _isPermissionDeniedForever
        ? 'Open App Settings'
        : 'Enable Location Access';

    return Scaffold(
      backgroundColor: kHomeCanvas,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            children: [
              const Spacer(flex: 2),

              // Animated Glowing Location Pin
              AnimatedBuilder(
                animation: _pulseAnimation,
                builder: (context, child) {
                  return Transform.scale(
                    scale: _pulseAnimation.value,
                    child: child,
                  );
                },
                child: Container(
                  width: 110,
                  height: 110,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _isGpsDisabled
                        ? Colors.amber.withValues(alpha: 0.12)
                        : kHomePink.withValues(alpha: 0.12),
                    border: Border.all(
                      color: _isGpsDisabled
                          ? Colors.amber.withValues(alpha: 0.35)
                          : kHomePink.withValues(alpha: 0.35),
                      width: 2,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: _isGpsDisabled
                            ? Colors.amber.withValues(alpha: 0.3)
                            : kHomePink.withValues(alpha: 0.35),
                        blurRadius: 32,
                        spreadRadius: 4,
                      ),
                    ],
                  ),
                  child: Icon(
                    _isGpsDisabled
                        ? Icons.location_off_rounded
                        : Icons.location_on_rounded,
                    color: _isGpsDisabled ? Colors.amber : kHomePink,
                    size: 56,
                  ),
                ),
              ),
              const SizedBox(height: 36),

              // Headline & Description
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 26,
                  height: 1.2,
                  letterSpacing: -0.5,
                ),
              ),
              const SizedBox(height: 14),
              Text(
                description,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: kHomeTextSecondary,
                  fontSize: 14,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 32),

              // Feature Highlights
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color: kHomeCard,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: kHomeOutline),
                ),
                child: const Column(
                  children: [
                    _FeatureRow(
                      icon: Icons.storefront_outlined,
                      title: 'Nearby Outlets',
                      subtitle: 'Find the closest Baylen celebrity salon in your city',
                    ),
                    SizedBox(height: 14),
                    _FeatureRow(
                      icon: Icons.home_repair_service_outlined,
                      title: 'Doorstep Services',
                      subtitle:
                          'Book verified beauty experts to your exact location',
                    ),
                    SizedBox(height: 14),
                    _FeatureRow(
                      icon: Icons.local_offer_outlined,
                      title: 'Area-Specific Offers',
                      subtitle:
                          'Unlock exclusive packages and discount vouchers',
                    ),
                  ],
                ),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.red.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: Colors.red.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.info_outline,
                        color: Colors.redAccent,
                        size: 18,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _errorMessage!,
                          style: const TextStyle(
                            color: Colors.redAccent,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const Spacer(flex: 3),

              // Primary Button: Enable Location / Open Settings
              SizedBox(
                width: double.infinity,
                height: 52,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _requestAndFetchLocation,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _isGpsDisabled
                        ? Colors.amber[700]
                        : kHomePink,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                    elevation: 4,
                    shadowColor: (_isGpsDisabled ? Colors.amber : kHomePink)
                        .withValues(alpha: 0.5),
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2.5,
                          ),
                        )
                      : Text(
                          buttonLabel,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.3,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 12),

              // Secondary Button: Select Manually
              SizedBox(
                width: double.infinity,
                height: 48,
                child: TextButton(
                  onPressed: _isLoading ? null : _openManualPicker,
                  style: TextButton.styleFrom(
                    foregroundColor: kHomeTextSecondary,
                  ),
                  child: const Text(
                    'Select Location Manually',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(7),
          decoration: BoxDecoration(
            color: kHomePink.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: kHomePink, size: 18),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: kHomeTextSecondary,
                  fontSize: 11.5,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
