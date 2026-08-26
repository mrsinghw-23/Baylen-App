import 'package:flutter/material.dart';

const kHomePink = Color(0xFFFF1B78);
const kHomeCanvas = Color(0xFF070708);
const kHomeCard = Color(0xFF1A1A21);
const kHomeSurface = Color(0xFF121216);
const kHomeOutline = Color(0xFF2B2B34);
const kHomeTextSecondary = Color(0xFFAAA4B6);
const kHomeStarColor = Color(0xFFFFB800);

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.width, this.height = 16, this.radius = 6});
  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: kHomeCard,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({super.key, required this.title, this.onViewAll});
  final String title;
  final VoidCallback? onViewAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
            fontSize: 16,
          ),
        ),
        if (onViewAll != null)
          GestureDetector(
            onTap: onViewAll,
            child: const Text(
              'View All',
              style: TextStyle(
                color: kHomePink,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
      ],
    );
  }
}

class NetImage extends StatelessWidget {
  const NetImage({
    super.key,
    required this.url,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
    this.fallbackIcon = Icons.image_outlined,
  });
  final String url;
  final double? width;
  final double? height;
  final BoxFit fit;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return _fallback();
    return Image.network(
      url,
      width: width,
      height: height,
      fit: fit,
      errorBuilder: (context, error, stackTrace) => _fallback(),
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Container(color: kHomeCard, width: width, height: height);
      },
    );
  }

  Widget _fallback() {
    return Container(
      width: width,
      height: height,
      color: kHomeCard,
      child: Icon(fallbackIcon, color: kHomeTextSecondary, size: 28),
    );
  }
}
