import 'package:flutter/material.dart';

import '_home_constants.dart';

class BeautyServices extends StatelessWidget {
  const BeautyServices({
    super.key,
    required this.categories,
    required this.loading,
    required this.onViewAll,
    required this.onCategoryTap,
  });
  final List<Map<String, dynamic>> categories;
  final bool loading;
  final VoidCallback onViewAll;
  final void Function(Map<String, dynamic>) onCategoryTap;

  static IconData _iconFor(String key) {
    switch (key) {
      case 'hair':
        return Icons.face_retouching_natural;
      case 'skin':
        return Icons.spa_outlined;
      case 'nail':
        return Icons.brush_outlined;
      case 'makeup':
        return Icons.auto_fix_high_outlined;
      case 'spa':
        return Icons.self_improvement_outlined;
      default:
        return Icons.more_horiz_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SectionHeader(
            title: 'Explore Our Beauty Services',
            onViewAll: onViewAll,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 90,
          child: loading
              ? _SkeletonRow()
              : categories.isEmpty
              ? const Center(
                  child: Text(
                    'No beauty categories available.',
                    style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
                  ),
                )
              : ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: categories.length,
                  itemBuilder: (context, i) {
                    final cat = categories[i];
                    final name = cat['name']?.toString() ?? '';
                    final iconKey = cat['icon_key']?.toString() ?? 'more';
                    final imgUrl = cat['image_url']?.toString() ?? '';
                    return Padding(
                      padding: const EdgeInsets.only(right: 16),
                      child: _CategoryCircle(
                        name: name,
                        icon: _iconFor(iconKey),
                        imageUrl: imgUrl,
                        onTap: () => onCategoryTap(cat),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _SkeletonRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      children: List.generate(
        6,
        (i) => const Padding(
          padding: EdgeInsets.only(right: 16),
          child: Column(
            children: [
              SkeletonBox(width: 54, height: 54, radius: 27),
              SizedBox(height: 6),
              SkeletonBox(width: 40, height: 10),
            ],
          ),
        ),
      ),
    );
  }
}

class _CategoryCircle extends StatelessWidget {
  const _CategoryCircle({
    required this.name,
    required this.icon,
    required this.imageUrl,
    required this.onTap,
  });
  final String name;
  final IconData icon;
  final String imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: kHomeCard,
              border: Border.all(
                color: kHomePink.withValues(alpha: 0.4),
                width: 1.5,
              ),
            ),
            child: imageUrl.isNotEmpty
                ? ClipOval(
                    child: Image.network(
                      imageUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) =>
                          Icon(icon, color: kHomePink, size: 22),
                    ),
                  )
                : Icon(icon, color: kHomePink, size: 22),
          ),
          const SizedBox(height: 6),
          Text(
            name,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 11,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
