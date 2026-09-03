import 'package:flutter/material.dart';

import '../theme/shop_theme.dart';

class ProductContainedImage extends StatelessWidget {
  const ProductContainedImage({
    super.key,
    required this.url,
    this.compact = false,
    this.backgroundColor = const Color(0xFFF3F7FC),
    this.placeholder,
  });

  final String url;
  final bool compact;
  final Color backgroundColor;
  final Widget? placeholder;

  @override
  Widget build(BuildContext context) {
    final fallback =
        placeholder ??
        Icon(
          Icons.image_outlined,
          color: kShopMuted,
          size: compact ? 18 : 40,
        );
    if (url.trim().isEmpty) {
      return ColoredBox(color: backgroundColor, child: Center(child: fallback));
    }
    return ColoredBox(
      color: backgroundColor,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final logicalWidth = constraints.maxWidth.isFinite &&
                  constraints.maxWidth > 0
              ? constraints.maxWidth
              : MediaQuery.sizeOf(context).width;
          final cacheWidth =
              (logicalWidth * MediaQuery.devicePixelRatioOf(context))
                  .clamp(64, 1600)
                  .round();
          return Image.network(
            url,
            fit: BoxFit.contain,
            alignment: Alignment.center,
            width: double.infinity,
            height: double.infinity,
            cacheWidth: cacheWidth,
            filterQuality: FilterQuality.medium,
            gaplessPlayback: true,
            loadingBuilder: (context, child, progress) {
              if (progress == null) {
                return child;
              }
              return Center(
                child: SizedBox(
                  width: compact ? 18 : 28,
                  height: compact ? 18 : 28,
                  child: const CircularProgressIndicator(strokeWidth: 2),
                ),
              );
            },
            errorBuilder: (_, _, _) => Center(child: fallback),
          );
        },
      ),
    );
  }
}
