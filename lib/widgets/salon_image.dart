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
    final child = imageUrl.isEmpty
        ? const ColoredBox(color: Color(0xFF21101A))
        : imageUrl.startsWith('assets/')
        ? Image.asset(
            imageUrl,
            fit: fit,
            errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFF21101A)),
          )
        : Image.network(
            imageUrl,
            fit: fit,
            errorBuilder: (_, _, _) => const ColoredBox(color: Color(0xFF21101A)),
          );
    if (borderRadius == null) return child;
    return ClipRRect(borderRadius: borderRadius!, child: child);
  }
}
