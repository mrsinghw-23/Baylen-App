import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../models/service_job.dart';
import '../services/location_service.dart';
import '../utils/beauty_status_labels.dart';
import '../utils/home_service_categories.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../widgets/location/required_location_panel.dart';
import '../widgets/salon_image.dart';
import 'home_service_category_outlets_screen.dart';
import 'home_service_outlet_screen.dart';
import 'home_service_service_detail_screen.dart';
import 'search_screen.dart';
import 'service_tracking_screen.dart';

class HomeServiceScreen extends StatefulWidget {
  const HomeServiceScreen({super.key});

  @override
  State<HomeServiceScreen> createState() => _HomeServiceScreenState();
}

class _HomeServiceScreenState extends State<HomeServiceScreen> {
  List<SalonOutlet> _outlets = [];
  List<AtHomeBooking> _bookings = [];
  List<ServiceJob> _legacyJobs = [];
  List<SalonService> _homeServices = [];
  final Map<String, SalonOutlet> _nearestOutletForService = {};
  AtHomeServiceability? _serviceability;
  bool _loading = true;
  bool _servicesLoading = false;
  String? _error;
  bool _locationBlocked = false;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() {
      final query = _searchController.text.trim();
      if (query == _searchQuery) return;
      setState(() => _searchQuery = query);
    });
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _ensureLocation() async {
    await LocationService.instance.refreshPermissionStatus();
    await LocationService.instance.fetchCurrentLocation(force: true);
    final loc = LocationService.instance;
    if (loc.isGpsDisabled.value || loc.isPermissionBlocked.value) {
      _locationBlocked = true;
      throw Exception('Location access is required to book home services.');
    }
    final current = loc.currentLocation.value;
    if (current == null || !current.isFromDeviceGps) {
      throw Exception(
        loc.error.value ??
            'Device GPS location is required for home services.',
      );
    }
    _locationBlocked = false;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await _ensureLocation();
      final location = LocationService.instance.currentLocation.value!;
      final resolved = await LocationService.instance.reverseGeocode(
        location.latitude,
        location.longitude,
      );
      final api = AuthService.instance.api;
      final city = resolved['city']?.toString() ?? '';
      final state = resolved['state']?.toString() ?? '';
      final pincode = resolved['postal_code']?.toString() ?? '';

      List<SalonOutlet> allOutlets;
      try {
        allOutlets = await api.salonOutlets(
          lat: location.latitude,
          lng: location.longitude,
          city: city.isNotEmpty ? city : null,
          pincode: pincode.isNotEmpty ? pincode : null,
        );
      } on ApiException catch (error) {
        throw Exception(
          error.message.isNotEmpty
              ? error.message
              : 'Could not load nearby salons.',
        );
      }

      AtHomeServiceability serviceability;
      try {
        serviceability = await api.atHomeServiceability(
          latitude: location.latitude,
          longitude: location.longitude,
          city: city.isNotEmpty ? city : null,
          state: state.isNotEmpty ? state : null,
          pincode: pincode.isNotEmpty ? pincode : null,
        );
      } on ApiException catch (error) {
        if (kDebugMode) {
          debugPrint(
            'Home service serviceability failed (${error.statusCode ?? 'unknown'}): ${error.message}',
          );
        }
        serviceability = AtHomeServiceability(
          serviceable: false,
          city: city,
          state: state,
          pincode: pincode,
          message: error.statusCode == 404
              ? 'Home service availability check is not available yet. Pull to refresh after the app update is deployed.'
              : (error.message.isNotEmpty
                    ? error.message
                    : 'Could not verify home service availability.'),
          eligibleOutletCount: 0,
        );
      }

      final eligibleIds = serviceability.eligibleOutletIds.toSet();
      final outlets = eligibleIds.isEmpty
          ? <SalonOutlet>[]
          : allOutlets
                .where((outlet) => eligibleIds.contains(outlet.id))
                .toList()
            ..sort((a, b) => a.distanceKm.compareTo(b.distanceKm));

      List<AtHomeBooking> bookings = [];
      List<ServiceJob> legacyJobs = [];
      if (AuthService.instance.isSignedIn) {
        try {
          final page = await api.atHomeBookings(limit: 50);
          bookings = page.bookings;
        } catch (error) {
          if (kDebugMode) {
            debugPrint('Home service bookings load failed: $error');
          }
        }
        try {
          legacyJobs = await api.serviceJobs();
        } catch (error) {
          if (kDebugMode) {
            debugPrint('Home service legacy jobs load failed: $error');
          }
        }
      }

      if (!mounted) return;
      setState(() {
        _outlets = outlets;
        _serviceability = serviceability;
        _bookings = bookings;
        _legacyJobs = legacyJobs;
        _loading = false;
      });
      await _loadHomeServices(outlets);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _loadHomeServices(List<SalonOutlet> outlets) async {
    if (outlets.isEmpty) {
      if (!mounted) return;
      setState(() {
        _homeServices = [];
        _nearestOutletForService.clear();
        _servicesLoading = false;
      });
      return;
    }
    setState(() => _servicesLoading = true);
    try {
      final api = AuthService.instance.api;
      final byId = <String, SalonService>{};
      final outletForService = <String, SalonOutlet>{};
      for (final outlet in outlets) {
        try {
          final services = await api.salonServices(
            outletId: outlet.id,
            isAtHomeOnly: true,
          );
          for (final service in services) {
            byId.putIfAbsent(service.id, () => service);
            outletForService.putIfAbsent(service.id, () => outlet);
          }
        } catch (_) {
          continue;
        }
      }
      final services = byId.values.toList()
        ..sort((a, b) => a.name.compareTo(b.name));
      if (!mounted) return;
      setState(() {
        _homeServices = services;
        _nearestOutletForService
          ..clear()
          ..addAll(outletForService);
        _servicesLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _homeServices = [];
        _nearestOutletForService.clear();
        _servicesLoading = false;
      });
    }
  }

  Future<void> _pickLocation() async {
    await LocationPickerSheet.show(
      context,
      onLocationSelected: _load,
    );
  }

  List<SalonService> get _filteredServices {
    if (_searchQuery.isEmpty) return _homeServices;
    final query = _searchQuery.toLowerCase();
    return _homeServices.where((service) {
      return service.name.toLowerCase().contains(query) ||
          service.serviceType.toLowerCase().contains(query) ||
          service.description.toLowerCase().contains(query);
    }).toList();
  }

  void _openService(SalonService service) {
    final outlet = _nearestOutletForService[service.id];
    if (outlet == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No nearby salon offers this service yet.')),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceServiceDetailScreen(
          outlet: outlet,
          service: service,
        ),
      ),
    );
  }

  void _openOutlet(SalonOutlet outlet, {String? categorySlug}) {
    if (_locationBlocked || LocationService.instance.currentLocation.value == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enable location to view salon services.')),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceOutletScreen(
          outlet: outlet,
          initialCategorySlug: categorySlug,
        ),
      ),
    );
  }

  void _openCategoryOutlets(BeautyCategory category) {
    if (_locationBlocked || LocationService.instance.currentLocation.value == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enable location to find nearby salons.')),
      );
      return;
    }
    if (_serviceability?.serviceable != true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _serviceability?.message ??
                'Home service is not available in your area yet.',
          ),
        ),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceCategoryOutletsScreen(
          category: category,
          outlets: _outlets,
          onOutletSelected: (outlet) => _openOutlet(outlet, categorySlug: category.slug),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final location = LocationService.instance.currentLocation.value;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Home Service'),
        actions: [
          IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 80),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_locationBlocked)
              RequiredLocationPanel(
                onLocationReady: _load,
                requireDeviceGps: true,
              )
            else if (_error != null)
              _ErrorPanel(message: _error!, onRetry: _load, blocked: false)
            else ...[
              _HomeServiceHeader(
                locationLabel: location?.formattedAddress ??
                    [
                      location?.area,
                      location?.city,
                    ].where((part) => part != null && part.isNotEmpty).join(', '),
                locationCity: location?.city ?? 'Select location',
                serviceable: _serviceability?.serviceable == true,
                serviceabilityMessage: _serviceability?.message ?? '',
                searchController: _searchController,
                onLocationTap: _pickLocation,
                onSearchTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const SearchScreen()),
                  );
                },
              ),
              const SizedBox(height: 16),
              _CategoriesRow(
                categories: homeServiceCategories,
                onTap: _openCategoryOutlets,
              ),
              const SizedBox(height: 16),
              _HomeServicesSection(
                services: _filteredServices,
                loading: _servicesLoading,
                totalCount: _homeServices.length,
                onBook: _openService,
              ),
              const SizedBox(height: 16),
              _ActiveBookingsPanel(
                bookings: _bookings,
                legacyJobs: _legacyJobs,
                onTrack: (booking) {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => ServiceTrackingScreen(
                        job: ServiceJob(
                          id: booking.id,
                          appointmentId: '',
                          providerId: booking.providerId,
                          status: booking.status,
                          visitLine1: booking.visitLine1,
                          visitCity: booking.visitCity,
                          scheduledAt: booking.scheduledAt,
                          grandTotal: booking.grandTotal,
                          currency: booking.currency,
                        ),
                        bookingId: booking.id,
                      ),
                    ),
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({
    required this.message,
    required this.onRetry,
    required this.blocked,
  });

  final String message;
  final VoidCallback onRetry;
  final bool blocked;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  blocked ? Icons.location_off_outlined : Icons.error_outline,
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    blocked ? 'Location required' : 'Could not load services',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(message),
            const SizedBox(height: 12),
            FilledButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

class _HomeServiceHeader extends StatelessWidget {
  const _HomeServiceHeader({
    required this.locationLabel,
    required this.locationCity,
    required this.serviceable,
    required this.serviceabilityMessage,
    required this.searchController,
    required this.onLocationTap,
    required this.onSearchTap,
  });

  final String? locationLabel;
  final String locationCity;
  final bool serviceable;
  final String serviceabilityMessage;
  final TextEditingController searchController;
  final VoidCallback onLocationTap;
  final VoidCallback onSearchTap;

  @override
  Widget build(BuildContext context) {
    final displayLocation = (locationLabel != null && locationLabel!.isNotEmpty)
        ? locationLabel!
        : locationCity;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Material(
          color: kHomeCard,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: onLocationTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: kHomeOutline),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.location_on_outlined,
                    color: Theme.of(context).colorScheme.primary,
                    size: 22,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Deliver to',
                          style: TextStyle(
                            color: kHomeTextSecondary,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          displayLocation,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.keyboard_arrow_down_rounded),
                ],
              ),
            ),
          ),
        ),
        if (serviceabilityMessage.isNotEmpty) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              Icon(
                serviceable ? Icons.check_circle_outline : Icons.info_outline,
                size: 16,
                color: serviceable ? Colors.greenAccent : Colors.orangeAccent,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  serviceabilityMessage,
                  style: TextStyle(
                    color: kHomeTextSecondary,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 12),
        TextField(
          controller: searchController,
          decoration: InputDecoration(
            hintText: 'Search home services...',
            hintStyle: const TextStyle(color: kHomeTextSecondary, fontSize: 14),
            prefixIcon: const Icon(Icons.search, color: kHomeTextSecondary),
            suffixIcon: IconButton(
              onPressed: onSearchTap,
              icon: const Icon(Icons.tune_rounded, color: kHomePink),
              tooltip: 'Advanced search',
            ),
            filled: true,
            fillColor: kHomeCard,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: kHomeOutline),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: kHomeOutline),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(
                color: Theme.of(context).colorScheme.primary,
              ),
            ),
            contentPadding: const EdgeInsets.symmetric(vertical: 0),
          ),
        ),
      ],
    );
  }
}

class _CategoriesRow extends StatelessWidget {
  const _CategoriesRow({required this.categories, required this.onTap});

  final List<BeautyCategory> categories;
  final void Function(BeautyCategory) onTap;

  IconData _iconFor(String key) {
    switch (key) {
      case 'hair':
        return Icons.face_retouching_natural;
      case 'makeup':
        return Icons.auto_fix_high_outlined;
      case 'nail':
        return Icons.brush_outlined;
      case 'skin':
        return Icons.spa_outlined;
      default:
        return Icons.spa_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Service categories', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        const Text(
          'Tap a category to see nearest salons',
          style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: categories.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final category = categories[index];
              return Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () => onTap(category),
                  borderRadius: BorderRadius.circular(12),
                  splashColor: Theme.of(context)
                      .colorScheme
                      .primary
                      .withValues(alpha: 0.2),
                  highlightColor: Theme.of(context)
                      .colorScheme
                      .primary
                      .withValues(alpha: 0.1),
                  child: SizedBox(
                    width: 72,
                    child: Column(
                      children: [
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: Theme.of(context)
                              .colorScheme
                              .primary
                              .withValues(alpha: 0.15),
                          child: Icon(
                            _iconFor(category.iconKey),
                            color: Theme.of(context).colorScheme.primary,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          category.name,
                          maxLines: 2,
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 11),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _HomeServicesSection extends StatelessWidget {
  const _HomeServicesSection({
    required this.services,
    required this.onBook,
    this.loading = false,
    this.totalCount = 0,
  });

  final List<SalonService> services;
  final void Function(SalonService service) onBook;
  final bool loading;
  final int totalCount;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'All home services',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            if (totalCount > 0)
              Text(
                '$totalCount available',
                style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
              ),
          ],
        ),
        const SizedBox(height: 4),
        const Text(
          'Live services from nearby Baylen salons',
          style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
        ),
        const SizedBox(height: 8),
        if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (services.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                totalCount == 0
                    ? 'No at-home services available near your location yet.'
                    : 'No services match your search.',
              ),
            ),
          )
        else
          ...services.map(
            (service) => Card(
              child: ListTile(
                leading: ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: SizedBox(
                    width: 48,
                    height: 48,
                    child: SalonImage(imageUrl: service.imageUrl),
                  ),
                ),
                title: Text(service.name),
                subtitle: Text(
                  [
                    service.serviceType,
                    '${service.durationMinutes} min',
                    service.priceLabel,
                  ].where((part) => part.isNotEmpty).join(' · '),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => onBook(service),
              ),
            ),
          ),
      ],
    );
  }
}

class _ActiveBookingsPanel extends StatelessWidget {
  const _ActiveBookingsPanel({
    required this.bookings,
    required this.legacyJobs,
    required this.onTrack,
  });

  final List<AtHomeBooking> bookings;
  final List<ServiceJob> legacyJobs;
  final void Function(AtHomeBooking) onTrack;

  @override
  Widget build(BuildContext context) {
    final active = bookings
        .where((b) => b.status.toUpperCase() != 'COMPLETED' && b.status.toUpperCase() != 'CANCELLED')
        .toList();
    if (!AuthService.instance.isSignedIn) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Your bookings', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              const Text('Sign in to view and track your home service bookings.'),
            ],
          ),
        ),
      );
    }
    if (active.isEmpty && legacyJobs.isEmpty) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('No active bookings. Choose a service to get started.'),
        ),
      );
    }
    final items = active.isNotEmpty
        ? active
        : legacyJobs
              .map(
                (job) => AtHomeBooking(
                  id: job.id,
                  bookingNumber: '',
                  status: job.status,
                  customerStatus: beautyStatusLabel(job.status),
                  visitLine1: job.visitLine1,
                  visitCity: job.visitCity,
                  scheduledAt: job.scheduledAt,
                  grandTotal: job.grandTotal,
                  currency: job.currency,
                  paymentStatus: '',
                  canCancel: false,
                  liveTracking: beautyLiveTrackingEnabled(job.status),
                  providerId: job.providerId,
                ),
              )
              .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Your bookings', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...items.take(5).map(
          (booking) => Card(
            child: ListTile(
              leading: Icon(
                booking.liveTracking ? Icons.near_me_outlined : Icons.event_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              title: Text(booking.displayStatus),
              subtitle: Text(
                [
                  booking.visitLine1,
                  booking.visitCity,
                  booking.scheduledAt,
                ].where((part) => part.isNotEmpty).join('\n'),
              ),
              trailing: booking.liveTracking || booking.providerId.isNotEmpty
                  ? const Icon(Icons.chevron_right)
                  : null,
              onTap: () => onTrack(booking),
            ),
          ),
        ),
      ],
    );
  }
}
