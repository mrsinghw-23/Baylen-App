import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'launch_assets.dart';

class BaylenSplashScreen extends StatefulWidget {
  const BaylenSplashScreen({
    super.key,
    this.assets = const BaylenLaunchAssets(),
  });

  final BaylenLaunchAssets assets;

  @override
  State<BaylenSplashScreen> createState() => _BaylenSplashScreenState();
}

class _BaylenSplashScreenState extends State<BaylenSplashScreen>
    with TickerProviderStateMixin {
  late final AnimationController _entranceController;
  late final AnimationController _hairFlowController;
  late final Animation<double> _fadeIn;
  late final Animation<double> _scaleIn;

  @override
  void initState() {
    super.initState();

    _entranceController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );

    _fadeIn = CurvedAnimation(
      parent: _entranceController,
      curve: Curves.easeOutCubic,
    );

    _scaleIn = Tween<double>(begin: 0.94, end: 1.0).animate(
      CurvedAnimation(parent: _entranceController, curve: Curves.easeOutCubic),
    );

    _hairFlowController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 2600),
    )..repeat();

    _entranceController.forward();
  }

  @override
  void dispose() {
    _entranceController.dispose();
    _hairFlowController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: FadeTransition(
        opacity: _fadeIn,
        child: ScaleTransition(
          scale: _scaleIn,
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isCompact = constraints.maxHeight < 680;
              final ladySize = isCompact ? 190.0 : 250.0;
              final logoWidth = isCompact ? 200.0 : 250.0;
              final logoHeight = isCompact ? 90.0 : 115.0;
              final spacing = isCompact ? 16.0 : 28.0;

              return Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _LadyHairFlowLogo(
                        assetPath: widget.assets.ladyLogo,
                        size: ladySize,
                        controller: _hairFlowController,
                      ),
                      SizedBox(height: spacing),
                      _StaticBrandLogo(
                        assetPath: widget.assets.brandLogo,
                        width: logoWidth,
                        height: logoHeight,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _LadyHairFlowLogo extends StatelessWidget {
  const _LadyHairFlowLogo({
    required this.assetPath,
    required this.size,
    required this.controller,
  });

  final String assetPath;
  final double size;
  final AnimationController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, child) {
        final wavePhase = math.sin(controller.value * math.pi * 2);
        final microScale = 1.0 + (wavePhase * 0.008);
        final microRotate = wavePhase * 0.005;
        final shimmerOffset = (controller.value * 2.6) - 0.8;

        return Transform.scale(
          scale: microScale,
          child: Transform.rotate(
            angle: microRotate,
            child: SizedBox(
              width: size,
              height: size,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Image.asset(
                    assetPath,
                    width: size,
                    height: size,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                    isAntiAlias: true,
                    errorBuilder: (context, error, stackTrace) =>
                        _LadyFallback(size: size),
                  ),
                  Positioned.fill(
                    child: ShaderMask(
                      blendMode: BlendMode.srcATop,
                      shaderCallback: (Rect bounds) {
                        return LinearGradient(
                          begin: Alignment(
                            -1.2 + shimmerOffset,
                            -1.2 + shimmerOffset,
                          ),
                          end: Alignment(
                            0.4 + shimmerOffset,
                            0.4 + shimmerOffset,
                          ),
                          stops: const [0.0, 0.38, 0.5, 0.62, 1.0],
                          colors: [
                            Colors.transparent,
                            Colors.transparent,
                            const Color(0xFFFFD4E8).withValues(alpha: 0.52),

                            Colors.transparent,
                            Colors.transparent,
                          ],
                        ).createShader(bounds);
                      },
                      child: Image.asset(
                        assetPath,
                        width: size,
                        height: size,
                        fit: BoxFit.contain,
                        filterQuality: FilterQuality.high,
                        isAntiAlias: true,
                        errorBuilder: (context, error, stackTrace) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _LadyFallback extends StatelessWidget {
  const _LadyFallback({required this.size});
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: Color(0xFF140710),
      ),
      child: const Center(
        child: Icon(
          Icons.face_retouching_natural,
          color: Color(0xFFFF3377),
          size: 72,
        ),
      ),
    );
  }
}

class _StaticBrandLogo extends StatelessWidget {
  const _StaticBrandLogo({
    required this.assetPath,
    required this.width,
    required this.height,
  });

  final String assetPath;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      assetPath,
      width: width,
      height: height,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      isAntiAlias: true,
      errorBuilder: (context, error, stackTrace) =>
          _BrandFallback(width: width, height: height),
    );
  }
}

class _BrandFallback extends StatelessWidget {
  const _BrandFallback({required this.width, required this.height});
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: height,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(color: const Color(0xFFFF3377), width: 2),
            ),
            child: const Center(
              child: Text(
                'B',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'BAYLEN DE LOUIS',
            style: TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.bold,
              letterSpacing: 2.0,
            ),
          ),
        ],
      ),
    );
  }
}
