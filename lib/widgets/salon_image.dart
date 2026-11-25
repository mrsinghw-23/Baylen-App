import 'package:flutter/material.dart';

class SalonImage extends StatelessWidget {
  const SalonImage({
    super.key,
    required this.imageUrl,
    this.fit = BoxFit.cover,
    this.borderRadius,
  });

  final String imageUrl;
  final BoxFit fit;
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    final Widget image;
    if (imageUrl.isEmpty) {
      image = const ColoredBox(color: Color(0xFF21101A));
    } else if (imageUrl.startsWith('assets/')) {
      image = Image.asset(
        imageUrl,
        fit: fit,
        errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFF21101A)),
      );
    } else {
      image = Image.network(
        imageUrl,
        fit: fit,
        errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFF21101A)),
      );
    }
    if (borderRadius == null) return image;
    return ClipRRect(borderRadius: borderRadius!, child: image);
  }
}
