import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../api/catalyst_api.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../shell/main_shell.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/home/beauty_services.dart';
import '../widgets/home/brand_collection.dart';
import '../widgets/home/consultation_book_row.dart';
import '../widgets/home/cut_color_videos_row.dart';
import '../widgets/home/hero_banner.dart';
import '../widgets/home/home_header.dart';
import '../widgets/home/home_search_bar.dart';
import '../widgets/home/nearby_salons.dart';
import '../widgets/home/quick_access.dart';
import '../widgets/home/trending_section.dart';
import '../widgets/home/location_picker_sheet.dart';
import '../auth/auth_service.dart';
import '../services/location_service.dart';
import '../utils/location_status.dart';
import '../services/cart_service.dart';
import '../services/notification_service.dart';
import 'nearby_outlets_screen.dart';
import 'notifications_screen.dart';
import 'outlet_detail_screen.dart';
import 'home_service_category_outlets_screen.dart';
import 'home_service_outlet_screen.dart';
import 'product_detail_screen.dart';
import 'search_screen.dart';
import 'shop_brand_page.dart';
import 'cart_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  bool _loading = true;
  String? _error;

  Map<String, dynamic> _homeData = {};
  List<SalonOutlet> _nearbyOutlets = [];
  bool _nearbyLoading = true;
  String? _nearbyError;
  double? _lastNearbyLat;
  double? _lastNearbyLng;
  bool _locationPromptShowing = false;
  bool _locationPromptShownOnce = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    AuthService.instance.user.addListener(_onAuthChanged);
    LocationService.instance.currentLocation.addListener(_onLocationChanged);
    LocationService.instance.isGpsDisabled.addListener(_onLocationStateChanged);
    LocationService.instance.isPermissionBlocked.addListener(
      _onLocationStateChanged,
    );
    _initServices();
    _loadData();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    AuthService.instance.user.removeListener(_onAuthChanged);
    LocationService.instance.currentLocation.removeListener(_onLocationChanged);
    LocationService.instance.isGpsDisabled.removeListener(
      _onLocationStateChanged,
    );
    LocationService.instance.isPermissionBlocked.removeListener(
      _onLocationStateChanged,
    );
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      LocationService.instance.fetchCurrentLocation(force: true);
      _fetchNearbyOutlets(forceLocation: false);
    }
  }

  void _onAuthChanged() {
    if (AuthService.instance.user.value == null) {
      NotificationService.instance.unreadCount.value = 0;
    } else {
      NotificationService.instance.refreshUnreadCount();
    }
  }

  Future<void> _initServices() async {
    LocationService.instance.fetchCurrentLocation();
    CartService.instance.fetchCart();
    NotificationService.instance.refreshUnreadCount();
  }

  void _onLocationChanged() {
    final loc = LocationService.instance.currentLocation.value;
    if (loc == null) return;
    if (_lastNearbyLat != null && _lastNearbyLng != null) {
      final latDiff = (loc.latitude - _lastNearbyLat!).abs();
      final lngDiff = (loc.longitude - _lastNearbyLng!).abs();
      if (latDiff < 0.002 && lngDiff < 0.002) return;
    }
    _fetchNearbyOutlets(forceLocation: false);
  }

  void _onLocationStateChanged() {
    final service = LocationService.instance;
    final needsPrompt =
        service.isGpsDisabled.value || service.isPermissionBlocked.value;
    if (!mounted ||
        !needsPrompt ||
        _locationPromptShowing ||
        _locationPromptShownOnce) {
      return;
    }
    _locationPromptShownOnce = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _showEnableLocationPrompt();
    });
  }

  Future<void> _showEnableLocationPrompt() async {
    if (_locationPromptShowing) return;
    _locationPromptShowing = true;
    final service = LocationService.instance;
    final permissionBlocked = service.isPermissionBlocked.value;
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) {
        return AlertDialog(
          backgroundColor: kHomeCard,
          surfaceTintColor: Colors.transparent,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: BorderSide(color: kHomePink.withValues(alpha: 0.35)),
          ),
          title: const Row(
            children: [
              Icon(Icons.my_location_rounded, color: kHomePink),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Enable Location',
                  style: TextStyle(color: Colors.white),
                ),
              ),
            ],
          ),
          content: Text(
            permissionBlocked
                ? 'Allow location permission so Baylen can show nearby salons and accurate distance.'
                : 'Turn on device location so Baylen can find the closest salons near you.',
            style: const TextStyle(color: kHomeTextSecondary, height: 1.4),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                LocationPickerSheet.show(
                  context,
                  onLocationSelected: _fetchNearbyOutlets,
                );
              },
              child: const Text('Select Manually'),
            ),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: kHomePink,
                foregroundColor: Colors.white,
              ),
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                if (permissionBlocked) {
                  await Geolocator.openAppSettings();
                } else {
                  await Geolocator.openLocationSettings();
                }
              },
              child: Text(permissionBlocked ? 'Open Settings' : 'Turn On'),
            ),
          ],
        );
      },
    );
    _locationPromptShowing = false;
  }

  Future<void> _openLocationSettingsAndRefresh() async {
    final permissionBlocked =
        LocationService.instance.isPermissionBlocked.value;
    if (permissionBlocked) {
      await Geolocator.openAppSettings();
    } else {
      await Geolocator.openLocationSettings();
    }
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;
    await LocationService.instance.fetchCurrentLocation(force: true);
    await _fetchNearbyOutlets(forceLocation: false);
  }

  Future<void> _fetchNearbyOutlets({bool forceLocation = false}) async {
    if (!mounted) return;
    setState(() {
      _nearbyLoading = true;
      _nearbyError = null;
    });
    try {
      await LocationService.instance.refreshPermissionStatus();
      await LocationService.instance.fetchCurrentLocation(force: forceLocation);
      final loc = LocationService.instance.currentLocation.value;
      if (loc == null) {
        final status = LocationService.instance.permissionStatus.value;
        throw Exception(deviceLocationStatusMessage(status));
      }
      final selectedLocation = loc;
      final outlets = await CatalystApi().nearbyOutlets(
        lat: selectedLocation.latitude,
        lng: selectedLocation.longitude,
        city: selectedLocation.city,
      );
      if (mounted) {
        setState(() {
          _nearbyOutlets = outlets;
          _nearbyLoading = false;
          _lastNearbyLat = selectedLocation.latitude;
          _lastNearbyLng = selectedLocation.longitude;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _nearbyError = error.toString().replaceFirst('Exception: ', '');
          _nearbyLoading = false;
        });
      }
    }
  }

  Future<void> _loadData() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final api = CatalystApi();
      final homeFuture = api.homeFeed();
      final nearbyFuture = _fetchNearbyOutlets(forceLocation: false);
      _homeData = await homeFuture;
      await nearbyFuture;
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error =
              'Live home data is temporarily unavailable. Pull to refresh or tap Retry.';
          _loading = false;
        });
      }
      await _fetchNearbyOutlets(forceLocation: false);
    }
  }

  BeautyCategory _beautyCategoryFromFeed(Map<String, dynamic> cat) {
    final slug = cat['slug']?.toString().trim() ?? '';
    final iconKey = cat['icon_key']?.toString().trim() ?? 'more';
    final name = cat['name']?.toString().trim() ?? '';
    if (slug.isNotEmpty) {
      return BeautyCategory(slug: slug, name: name, iconKey: iconKey);
    }
    final normalized = iconKey.toLowerCase();
    return BeautyCategory(
      slug: normalized == 'nail' ? 'nails' : normalized,
      name: name.isNotEmpty ? name : iconKey,
      iconKey: iconKey,
    );
  }

  void _openBeautyCategory(Map<String, dynamic> cat) {
    final category = _beautyCategoryFromFeed(cat);
    final location = LocationService.instance.currentLocation.value;
    if (location == null || _nearbyOutlets.isEmpty) {
      widget.onOpenTab(MainShell.homeServiceIndex);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceCategoryOutletsScreen(
          category: category,
          outlets: _nearbyOutlets,
          onOutletSelected: (outlet) {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => HomeServiceOutletScreen(
                  outlet: outlet,
                  initialCategorySlug: category.slug,
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _openTrendingItem(Map<String, dynamic> item) async {
    final type = item['type']?.toString().toLowerCase() ?? '';
    final refId = item['reference_id']?.toString() ?? '';
    if (type == 'product' && refId.isNotEmpty) {
      try {
        final detail = await CatalystApi().productDetail(refId);
        if (!mounted) return;
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => ProductDetailScreen(product: detail.product),
          ),
        );
      } catch (_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not open this product.')),
        );
      }
      return;
    }
    if (type == 'service') {
      widget.onOpenTab(MainShell.salonIndex);
      return;
    }
    widget.onOpenTab(MainShell.shopIndex);
  }

  void _openBrand(Map<String, dynamic> brand) {
    final slug = brand['slug']?.toString().trim() ?? '';
    if (slug.isEmpty) {
      widget.onOpenTab(MainShell.shopIndex);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ShopBrandPage(slug: slug),
      ),
    );
  }

  List<Map<String, dynamic>> _getList(String key) {
    final list = _homeData[key];
    if (list is List) return list.whereType<Map<String, dynamic>>().toList();
    return [];
  }

  @override
  Widget build(BuildContext context) {
    final visibleNearbyOutlets = _nearbyOutlets;

    return Scaffold(
      backgroundColor: kHomeCanvas,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            NotificationService.instance.refreshUnreadCount();
            CartService.instance.fetchCart();
            await _loadData();
          },
          color: kHomePink,
          backgroundColor: kHomeCard,
          child: CustomScrollView(
            slivers: [
              // 1. Header (Location, Logo, Badges) globally bound
              SliverToBoxAdapter(
                child: ValueListenableBuilder<UserLocation?>(
                  valueListenable: LocationService.instance.currentLocation,
                  builder: (context, loc, _) {
                    return ValueListenableBuilder<int>(
                      valueListenable: NotificationService.instance.unreadCount,
                      builder: (context, notifCount, _) {
                        return ValueListenableBuilder(
                          valueListenable: CartService.instance.cartState,
                          builder: (context, cart, _) {
                            return ValueListenableBuilder<bool>(
                              valueListenable: LocationService.instance.isLoading,
                              builder: (context, locationLoading, _) {
                                return HomeHeader(
                                  locationCity: loc?.city ?? 'Select Location',
                                  locationArea: loc?.area ?? '',
                                  notificationCount: notifCount,
                                  cartCount: cart?.itemCount ?? 0,
                                  locationLoading: locationLoading,
                                  onLocationTap: () {
                                    LocationPickerSheet.show(
                                      context,
                                      onLocationSelected: _fetchNearbyOutlets,
                                    );
                                  },
                                  onNotificationTap: () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute<void>(
                                        builder: (_) =>
                                            const NotificationsScreen(),
                                      ),
                                    );
                                  },
                                  onCartTap: () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute<void>(
                                        builder: (_) => const CartScreen(),
                                      ),
                                    );
                                  },
                                );
                              },
                            );
                          },
                        );
                      },
                    );
                  },
                ),
              ),

              // 2. GPS Disabled Warning Banner
              SliverToBoxAdapter(
                child: ValueListenableBuilder<bool>(
                  valueListenable: LocationService.instance.isGpsDisabled,
                  builder: (context, gpsDisabled, _) {
                    if (!gpsDisabled) return const SizedBox.shrink();
                    return Container(
                      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.amber.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: Colors.amber.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.location_off,
                            color: Colors.amber,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          const Expanded(
                            child: Text(
                              'Device location is off. Turn on GPS to see nearby salons.',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                              ),
                            ),
                          ),
                          TextButton(
                            onPressed: _openLocationSettingsAndRefresh,
                            style: TextButton.styleFrom(
                              backgroundColor: Colors.amber,
                              foregroundColor: Colors.black,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              minimumSize: Size.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: const Text(
                              'Turn On',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 11,
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),

              // 3. Unified Search Bar
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 20),
                  child: HomeSearchBar(
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => const SearchScreen()),
                      );
                    },
                  ),
                ),
              ),

              if (_error != null)
                SliverToBoxAdapter(
                  child: Container(
                    margin: const EdgeInsets.fromLTRB(16, 0, 16, 18),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: kHomePink.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: kHomePink.withValues(alpha: 0.32),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.cloud_off_outlined,
                          color: kHomePink,
                          size: 20,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _error!,
                            style: const TextStyle(
                              color: kHomeTextSecondary,
                              fontSize: 12,
                              height: 1.35,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: _loadData,
                          style: TextButton.styleFrom(
                            foregroundColor: kHomePink,
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            minimumSize: Size.zero,
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
                  ),
                ),

              SliverList(
                delegate: SliverChildListDelegate([
                  HeroBanner(
                    banners: _getList('banners'),
                    loading: _loading,
                    onBookNow: () => widget.onOpenTab(MainShell.salonIndex),
                    onBannerTap: (banner) {
                      final actionType =
                          banner['action_type']?.toString().toUpperCase() ??
                          'TAB';
                      final actionVal =
                          banner['action_value']?.toString() ?? '0';

                      if (actionType == 'SHOP') {
                        widget.onOpenTab(MainShell.shopIndex);
                      } else if (actionType == 'SALON' ||
                          actionType == 'BOOKING') {
                        widget.onOpenTab(MainShell.salonIndex);
                      } else if (actionType == 'SERVICE') {
                        widget.onOpenTab(MainShell.homeServiceIndex);
                      } else {
                        final tabIndex =
                            int.tryParse(actionVal) ?? MainShell.salonIndex;
                        widget.onOpenTab(tabIndex);
                      }
                    },
                  ),
                  const SizedBox(height: 24),
                  QuickAccess(
                    onBrowseServices: () =>
                        widget.onOpenTab(MainShell.salonIndex),
                    onOffers: () => widget.onOpenTab(MainShell.shopIndex),
                    onShopping: () => widget.onOpenTab(MainShell.shopIndex),
                    onProducts: () => widget.onOpenTab(MainShell.shopIndex),
                    onFindSalon: () => widget.onOpenTab(MainShell.salonIndex),
                  ),
                  const SizedBox(height: 32),
                  NearbySalons(
                    outlets: visibleNearbyOutlets,
                    loading:
                        _loading ||
                        (_nearbyLoading && visibleNearbyOutlets.isEmpty),
                    error: visibleNearbyOutlets.isEmpty ? _nearbyError : null,
                    onRetry: () => _fetchNearbyOutlets(forceLocation: true),
                    onViewAll: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => NearbyOutletsScreen(
                            initialOutlets: visibleNearbyOutlets,
                          ),
                        ),
                      );
                    },
                    onOutletTap: (outlet) {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => OutletDetailScreen(outlet: outlet),
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 32),
                  ConsultationBookRow(
                    onConsultation: () =>
                        widget.onOpenTab(MainShell.salonIndex),
                    onBookAppointment: () =>
                        widget.onOpenTab(MainShell.salonIndex),
                  ),
                  const SizedBox(height: 32),
                  BeautyServices(
                    categories: _getList('beauty_categories'),
                    loading: _loading,
                    onViewAll: () =>
                        widget.onOpenTab(MainShell.homeServiceIndex),
                    onCategoryTap: _openBeautyCategory,
                  ),
                  const SizedBox(height: 32),
                  TrendingSection(
                    items: _getList('trending'),
                    loading: _loading,
                    onViewAll: () => widget.onOpenTab(MainShell.shopIndex),
                    onItemTap: _openTrendingItem,
                  ),
                  const SizedBox(height: 32),
                  CutColorVideosRow(
                    onCutColor: () => widget.onOpenTab(MainShell.salonIndex),
                    onVideos: () => widget.onOpenTab(MainShell.shopIndex),
                  ),
                  const SizedBox(height: 32),
                  BrandCollection(
                    brands: _getList('brands'),
                    loading: _loading,
                    onViewAll: () => widget.onOpenTab(MainShell.shopIndex),
                    onBrandTap: _openBrand,
                  ),
                  const SizedBox(height: 48),
                ]),
              ),
            ],
          ),
        ),
      ),
    );
  }

}
