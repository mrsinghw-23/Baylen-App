import 'dart:async';

import 'package:flutter/material.dart';

import '_home_constants.dart';

class HeroBanner extends StatefulWidget {
  const HeroBanner({
    super.key,
    required this.banners,
    required this.loading,
    required this.onBookNow,
    this.onBannerTap,
  });

  final List<Map<String, dynamic>> banners;
  final bool loading;
  final VoidCallback onBookNow;
  final ValueChanged<Map<String, dynamic>>? onBannerTap;

  @override
  State<HeroBanner> createState() => _HeroBannerState();
}

class _HeroBannerState extends State<HeroBanner> {
  final PageController _controller = PageController();
  final Map<String, double> _imageAspectRatios = {};
  int _currentPage = 0;
  Timer? _timer;

  // Default August 2026 Promotional Posters
  static const List<Map<String, dynamic>> _augustGalleryPosters = [
    {
      'id': 'gallery_aug_1',
      'title': 'STRAIGHTENING DAY',
      'subtitle': 'Flat 30% OFF • Every 24th of the Month',
      'cta_label': 'Book Straightening',
      'image_url': 'assets/gallery/2026/August/straightening-day.png',
      'action_type': 'SALON',
    },
    {
      'id': 'gallery_aug_2',
      'title': 'HAIR SPA DAY',
      'subtitle': '30% OFF • Nourish, Repair & Revive',
      'cta_label': 'Book Hair Spa',
      'image_url': 'assets/gallery/2026/August/hair-spa-day.png',
      'action_type': 'SALON',
    },
    {
      'id': 'gallery_aug_3',
      'title': 'FEEL LIKE YOURSELF',
      'subtitle': 'Premium Hair, Beauty, Makeup & Nails',
      'cta_label': 'Explore Services',
      'image_url': 'assets/gallery/2026/August/feel-like-yourself.jpg',
      'action_type': 'SERVICE',
    },
  ];

  @override
  void initState() {
    super.initState();
    _startAutoScroll();
    WidgetsBinding.instance.addPostFrameCallback((_) => _resolveActiveImages());
  }

  @override
  void didUpdateWidget(covariant HeroBanner oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.banners != widget.banners ||
        oldWidget.loading != widget.loading) {
      final items = _getActiveItems();
      if (_currentPage >= items.length) {
        _currentPage = 0;
      }
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => _resolveActiveImages(),
      );
    }
  }

  void _startAutoScroll() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 4), (timer) {
      if (!mounted) return;
      final items = _getActiveItems();
      if (items.length <= 1 || !_controller.hasClients) return;
      final next = (_currentPage + 1) % items.length;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeInOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _getActiveItems() {
    if (widget.banners.isNotEmpty) {
      final hasCustomBanners = widget.banners.any((b) {
        final url = b['image_url']?.toString() ?? '';
        return url.isNotEmpty && !url.contains('placehold.co');
      });
      if (hasCustomBanners) {
        return widget.banners;
      }
    }
    return _augustGalleryPosters;
  }

  double _heightForCurrentItem(BuildContext context, double screenWidth) {
    final items = _getActiveItems();
    final currentIndex = items.isEmpty
        ? 0
        : _currentPage.clamp(0, items.length - 1).toInt();
    final item = items.isEmpty ? null : items[currentIndex];
    final imageUrl = item?['image_url']?.toString() ?? '';
    final aspectRatio = _imageAspectRatios[imageUrl] ?? 1.05;
    final cardWidth = (screenWidth - 32).clamp(260.0, 720.0);
    final maxHeight = (MediaQuery.of(context).size.height * 0.62)
        .clamp(320.0, 620.0)
        .toDouble();
    return (cardWidth / aspectRatio).clamp(230.0, maxHeight).toDouble();
  }

  void _resolveActiveImages() {
    if (!mounted) return;
    for (final item in _getActiveItems()) {
      final imageUrl = item['image_url']?.toString() ?? '';
      if (imageUrl.isEmpty || _imageAspectRatios.containsKey(imageUrl)) {
        continue;
      }
      final ImageProvider provider = imageUrl.startsWith('assets/')
          ? AssetImage(imageUrl)
          : NetworkImage(imageUrl);
      final stream = provider.resolve(createLocalImageConfiguration(context));
      late ImageStreamListener listener;
      listener = ImageStreamListener(
        (info, _) {
          final width = info.image.width;
          final height = info.image.height;
          if (width > 0 && height > 0 && mounted) {
            setState(() {
              _imageAspectRatios[imageUrl] = width / height;
            });
          }
          stream.removeListener(listener);
        },
        onError: (_, _) {
          stream.removeListener(listener);
        },
      );
      stream.addListener(listener);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final responsiveHeight = _heightForCurrentItem(context, screenWidth);

    if (widget.loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: SkeletonBox(height: responsiveHeight, radius: 18),
      );
    }

    final items = _getActiveItems();

    return Column(
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOutCubic,
          height: responsiveHeight,
          child: PageView.builder(
            controller: _controller,
            itemCount: items.length,
            onPageChanged: (i) => setState(() => _currentPage = i),
            itemBuilder: (context, i) {
              final item = items[i];
              return _ResponsivePosterCard(
                data: item,
                onTap: () {
                  if (widget.onBannerTap != null) {
                    widget.onBannerTap!(item);
                  } else {
                    widget.onBookNow();
                  }
                },
              );
            },
          ),
        ),
        const SizedBox(height: 10),
        // Smooth Dot Indicators
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(items.length, (i) {
            final active = i == _currentPage;
            return AnimatedContainer(
              duration: const Duration(milliseconds: 260),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: active ? 22 : 6,
              height: 5,
              decoration: BoxDecoration(
                color: active ? kHomePink : kHomeOutline,
                borderRadius: BorderRadius.circular(99),
              ),
            );
          }),
        ),
      ],
    );
  }
}

class _ResponsivePosterCard extends StatelessWidget {
  const _ResponsivePosterCard({required this.data, required this.onTap});

  final Map<String, dynamic> data;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final imageUrl = data['image_url']?.toString() ?? '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GestureDetector(
        onTap: onTap,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(18),
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF0F0F14),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: kHomeOutline.withValues(alpha: 0.8),
                width: 1,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.4),
                  blurRadius: 14,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                // 1. Soft premium surface. The real poster below is never cropped.
                if (imageUrl.isNotEmpty)
                  Positioned.fill(
                    child: Opacity(
                      opacity: 0.08,
                      child: imageUrl.startsWith('assets/')
                          ? Image.asset(
                              imageUrl,
                              fit: BoxFit.contain,
                              errorBuilder: (context, error, stackTrace) =>
                                  const SizedBox.shrink(),
                            )
                          : Image.network(
                              imageUrl,
                              fit: BoxFit.contain,
                              errorBuilder: (context, error, stackTrace) =>
                                  const SizedBox.shrink(),
                            ),
                    ),
                  ),

                // Dark vignette over ambient backdrop
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          const Color(0xFF0F0F14).withValues(alpha: 0.28),
                          const Color(0xFF0F0F14).withValues(alpha: 0.42),
                        ],
                      ),
                    ),
                  ),
                ),

                // 2. Exact Original Composition (ZERO cropping, ZERO stretching, ZERO distortion)
                if (imageUrl.isNotEmpty)
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.all(10),
                      child: imageUrl.startsWith('assets/')
                          ? Image.asset(
                              imageUrl,
                              fit: BoxFit.contain,
                              alignment: Alignment.center,
                              filterQuality: FilterQuality.high,
                              errorBuilder: (context, error, stackTrace) =>
                                  const _FallbackCard(),
                            )
                          : Image.network(
                              imageUrl,
                              fit: BoxFit.contain,
                              alignment: Alignment.center,
                              filterQuality: FilterQuality.high,
                              loadingBuilder:
                                  (context, child, loadingProgress) {
                                    if (loadingProgress == null) return child;
                                    return const Center(
                                      child: CircularProgressIndicator(
                                        color: kHomePink,
                                        strokeWidth: 2,
                                      ),
                                    );
                                  },
                              errorBuilder: (context, error, stackTrace) =>
                                  const _FallbackCard(),
                            ),
                    ),
                  )
                else
                  const _FallbackCard(),

                // 3. Subtle full-card press highlight. No controls cover the uploaded photo.
                Positioned.fill(
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      onTap: onTap,
                      borderRadius: BorderRadius.circular(18),
                      splashColor: kHomePink.withValues(alpha: 0.15),
                      highlightColor: kHomePink.withValues(alpha: 0.05),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FallbackCard extends StatelessWidget {
  const _FallbackCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1E0A16), Color(0xFF280B1E), Color(0xFF190612)],
        ),
      ),
      child: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.photo_library_outlined, color: kHomePink, size: 42),
            SizedBox(height: 10),
            Text(
              'Baylen Beauty Picks',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
