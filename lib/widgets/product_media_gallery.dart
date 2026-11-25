import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../models/catalog.dart';
import '../theme/shop_theme.dart';
import 'product_contained_image.dart';

class ProductMediaGallery extends StatefulWidget {
  const ProductMediaGallery({
    super.key,
    required this.media,
    this.fallbackImageUrl = '',
  });

  final List<CatalogProductMedia> media;
  final String fallbackImageUrl;

  @override
  State<ProductMediaGallery> createState() => _ProductMediaGalleryState();
}

class _ProductMediaGalleryState extends State<ProductMediaGallery> {
  final PageController _pages = PageController();
  int _index = 0;
  VideoPlayerController? _video;
  int? _videoIndex;
  bool _muted = true;
  bool _videoReady = false;
  bool _videoFailed = false;
  bool _videoPlaying = false;
  late List<CatalogProductMedia> _slides;

  @override
  void initState() {
    super.initState();
    _slides = _buildSlides();
    _prepareCurrentMedia();
  }

  @override
  void didUpdateWidget(ProductMediaGallery oldWidget) {
    super.didUpdateWidget(oldWidget);
    final next = _buildSlides();
    final changed =
        next.length != _slides.length ||
        next.asMap().entries.any(
          (entry) =>
              entry.value.id != _slides[entry.key].id ||
              entry.value.fileUrl != _slides[entry.key].fileUrl,
        );
    if (changed) {
      _slides = next;
      _index = 0;
      if (_pages.hasClients) {
        _pages.jumpToPage(0);
      }
      _disposeVideo();
      _prepareCurrentMedia();
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    _disposeVideo();
    super.dispose();
  }

  List<CatalogProductMedia> _buildSlides() {
    return mediaForSelectedVariant(
      widget.media,
      fallbackImageUrl: widget.fallbackImageUrl,
    );
  }

  void _disposeVideo() {
    _video?.dispose();
    _video = null;
    _videoIndex = null;
    _videoReady = false;
    _videoFailed = false;
    _videoPlaying = false;
  }

  Future<void> _prepareCurrentMedia() async {
    if (_slides.isEmpty || _index >= _slides.length) {
      return;
    }
    final current = _slides[_index];
    if (!current.isVideo) {
      if (_video != null) {
        await _video!.pause();
        if (mounted) setState(() => _videoPlaying = false);
      }
      return;
    }
    await _loadVideo(_index);
  }

  Future<void> _loadVideo(int index) async {
    if (index < 0 || index >= _slides.length || !_slides[index].isVideo) {
      return;
    }
    if (_videoIndex == index && _video != null) {
      return;
    }
    _disposeVideo();
    final url = _slides[index].fileUrl;
    final controller = VideoPlayerController.networkUrl(Uri.parse(url));
    _video = controller;
    _videoIndex = index;
    try {
      await controller.initialize();
      if (!mounted || _videoIndex != index) {
        await controller.dispose();
        return;
      }
      await controller.setLooping(true);
      await controller.setVolume(0);
      if (!mounted || _videoIndex != index) {
        return;
      }
      final reduceMotion = MediaQuery.disableAnimationsOf(context);
      if (!reduceMotion) {
        await controller.play();
      }
      if (!mounted || _videoIndex != index) {
        return;
      }
      setState(() {
        _videoReady = true;
        _videoFailed = false;
        _muted = true;
        _videoPlaying = !reduceMotion && controller.value.isPlaying;
      });
    } catch (_) {
      if (!mounted || _videoIndex != index) {
        return;
      }
      setState(() {
        _videoFailed = true;
        _videoReady = false;
        _videoPlaying = false;
      });
    }
  }

  Future<void> _onPageChanged(int index) async {
    setState(() => _index = index);
    await _prepareCurrentMedia();
  }

  Duration _motion(BuildContext context) {
    return MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : const Duration(milliseconds: 240);
  }

  Future<void> _goTo(int index) async {
    if (index < 0 || index >= _slides.length) {
      return;
    }
    if (!_pages.hasClients) {
      setState(() => _index = index);
      await _prepareCurrentMedia();
      return;
    }
    await _pages.animateToPage(
      index,
      duration: _motion(context),
      curve: Curves.easeOutCubic,
    );
  }

  Future<void> _toggleMute() async {
    final controller = _video;
    if (controller == null || !_videoReady) {
      return;
    }
    final nextMuted = !_muted;
    await controller.setVolume(nextMuted ? 0 : 1);
    if (!mounted) return;
    setState(() => _muted = nextMuted);
  }

  Future<void> _togglePlay() async {
    final controller = _video;
    if (controller == null || !_videoReady) {
      return;
    }
    if (controller.value.isPlaying) {
      await controller.pause();
      if (mounted) setState(() => _videoPlaying = false);
    } else {
      await controller.play();
      if (mounted) setState(() => _videoPlaying = true);
    }
  }

  void _openZoom(CatalogProductMedia item) {
    if (item.isVideo) {
      return;
    }
    Navigator.of(context).push(
      PageRouteBuilder<void>(
        opaque: false,
        barrierColor: Colors.black.withValues(alpha: 0.92),
        pageBuilder: (_, _, _) => _ImageZoomView(url: item.fileUrl),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_slides.isEmpty) {
      return const AspectRatio(
        aspectRatio: 1,
        child: ColoredBox(
          color: Color(0xFFF3F7FC),
          child: Center(
            child: Icon(Icons.image_outlined, size: 48, color: kShopMuted),
          ),
        ),
      );
    }

    final current = _slides[_index];
    final showControls = _slides.length > 1;
    final size = MediaQuery.sizeOf(context);
    final maxHeight = (size.height * 0.5).clamp(240.0, 520.0);
    final height = math.min(size.width >= 840 ? size.width * 0.42 : size.width, maxHeight);
    final showChevrons = showControls && size.width >= 720;

    return Column(
      children: [
        SizedBox(
          height: height,
          width: double.infinity,
          child: Stack(
            fit: StackFit.expand,
            clipBehavior: Clip.hardEdge,
            children: [
              ColoredBox(
                color: const Color(0xFFF3F7FC),
                child: PageView.builder(
                  controller: _pages,
                  itemCount: _slides.length,
                  onPageChanged: _onPageChanged,
                  itemBuilder: (context, index) {
                    final item = _slides[index];
                    if (item.isVideo) {
                      return GestureDetector(
                        onTap: _togglePlay,
                        child: _VideoSlide(
                          controller: _videoIndex == index ? _video : null,
                          ready: _videoIndex == index && _videoReady,
                          failed: _videoIndex == index && _videoFailed,
                          active: _index == index,
                        ),
                      );
                    }
                    return GestureDetector(
                      onTap: () => _openZoom(item),
                      child: ProductContainedImage(url: item.fileUrl),
                    );
                  },
                ),
              ),
              if (showChevrons) ...[
                Align(
                  alignment: Alignment.centerLeft,
                  child: _NavButton(
                    icon: Icons.chevron_left,
                    onTap: _index == 0 ? null : () => _goTo(_index - 1),
                  ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: _NavButton(
                    icon: Icons.chevron_right,
                    onTap: _index == _slides.length - 1
                        ? null
                        : () => _goTo(_index + 1),
                  ),
                ),
              ],
              if (current.isVideo && _videoReady)
                Positioned(
                  left: 12,
                  bottom: 12,
                  child: Row(
                    children: [
                      _RoundMediaButton(
                        icon: _videoPlaying ? Icons.pause : Icons.play_arrow,
                        onTap: _togglePlay,
                      ),
                      const SizedBox(width: 8),
                      _RoundMediaButton(
                        icon: _muted ? Icons.volume_off : Icons.volume_up,
                        onTap: _toggleMute,
                      ),
                    ],
                  ),
                ),
              if (current.isVideo)
                const Positioned(
                  left: 12,
                  top: 12,
                  child: _VideoBadge(),
                ),
              if (!current.isVideo)
                Positioned(
                  right: 12,
                  bottom: 12,
                  child: _RoundMediaButton(
                    icon: Icons.zoom_in,
                    onTap: () => _openZoom(current),
                  ),
                ),
              if (showControls)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 10,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var i = 0; i < _slides.length; i++)
                        AnimatedContainer(
                          duration: _motion(context),
                          width: i == _index ? 16 : 7,
                          height: 7,
                          margin: const EdgeInsets.symmetric(horizontal: 3),
                          decoration: BoxDecoration(
                            color: i == _index
                                ? kShopBlue
                                : Colors.black.withValues(alpha: 0.22),
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        if (showControls)
          SizedBox(
            height: 78,
            child: ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
              scrollDirection: Axis.horizontal,
              itemCount: _slides.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final item = _slides[index];
                final selected = index == _index;
                return GestureDetector(
                  onTap: () => _goTo(index),
                  child: AnimatedContainer(
                    duration: _motion(context),
                    width: 64,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: selected ? kShopBlue : const Color(0xFFE6EEF8),
                        width: selected ? 2 : 1,
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: item.isVideo
                        ? const ColoredBox(
                            color: Color(0xFF10233F),
                            child: Center(
                              child: Icon(
                                Icons.play_circle_fill,
                                color: Colors.white,
                                size: 26,
                              ),
                            ),
                          )
                        : ProductContainedImage(
                            url: item.fileUrl,
                            compact: true,
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

class _VideoSlide extends StatelessWidget {
  const _VideoSlide({
    required this.controller,
    required this.ready,
    required this.failed,
    required this.active,
  });

  final VideoPlayerController? controller;
  final bool ready;
  final bool failed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    if (failed) {
      return const ColoredBox(
        color: Color(0xFF10233F),
        child: Center(
          child: Icon(Icons.videocam_off_outlined, size: 48, color: Colors.white70),
        ),
      );
    }
    if (!ready || controller == null || !controller!.value.isInitialized) {
      return ColoredBox(
        color: const Color(0xFF10233F),
        child: Center(
          child: active
              ? const CircularProgressIndicator()
              : const Icon(
                  Icons.play_circle_fill,
                  color: Colors.white70,
                  size: 56,
                ),
        ),
      );
    }
    final size = controller!.value.size;
    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: AspectRatio(
          aspectRatio: size.width <= 0 || size.height <= 0
              ? 16 / 9
              : size.width / size.height,
          child: VideoPlayer(controller!),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Material(
        color: Colors.white.withValues(alpha: 0.92),
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 44,
            height: 44,
            child: Icon(
              icon,
              color: onTap == null ? kShopMuted : kShopInk,
            ),
          ),
        ),
      ),
    );
  }
}

class _RoundMediaButton extends StatelessWidget {
  const _RoundMediaButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black54,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: SizedBox(
          width: 44,
          height: 44,
          child: Icon(icon, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}

class _VideoBadge extends StatelessWidget {
  const _VideoBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.play_arrow, size: 14, color: Colors.white),
          SizedBox(width: 4),
          Text(
            'VIDEO',
            style: TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ImageZoomView extends StatelessWidget {
  const _ImageZoomView({required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: Stack(
        children: [
          InteractiveViewer(
            minScale: 1,
            maxScale: 4,
            child: Center(
              child: Image.network(
                url,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => const Icon(
                  Icons.broken_image_outlined,
                  color: Colors.white,
                  size: 48,
                ),
              ),
            ),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topRight,
              child: IconButton(
                tooltip: 'Close',
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.close, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
