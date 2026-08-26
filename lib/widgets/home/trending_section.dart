import 'package:flutter/material.dart';

import '_home_constants.dart';

class TrendingSection extends StatelessWidget {
  const TrendingSection({
    super.key,
    required this.items,
    required this.loading,
    required this.onViewAll,
    required this.onItemTap,
  });
  final List<Map<String, dynamic>> items;
  final bool loading;
  final VoidCallback onViewAll;
  final void Function(Map<String, dynamic>) onItemTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SectionHeader(title: "What's Trending", onViewAll: onViewAll),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 130,
          child: loading
              ? _SkeletonList()
              : items.isEmpty
              ? const Center(
                  child: Text(
                    'No trending items.',
                    style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
                  ),
                )
              : ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: items.length,
                  itemBuilder: (context, i) => Padding(
                    padding: const EdgeInsets.only(right: 10),
                    child: _TrendCard(
                      data: items[i],
                      onTap: () => onItemTap(items[i]),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _SkeletonList extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      children: List.generate(
        4,
        (i) => const Padding(
          padding: EdgeInsets.only(right: 10),
          child: SkeletonBox(width: 120, height: 130, radius: 12),
        ),
      ),
    );
  }
}

class _TrendCard extends StatelessWidget {
  const _TrendCard({required this.data, required this.onTap});
  final Map<String, dynamic> data;
  final VoidCallback onTap;

  Color _tagColor(String tag) {
    final t = tag.toLowerCase();
    if (t.contains('off') || t.contains('%')) return const Color(0xFFE53935);
    if (t.contains('trending')) return kHomePink;
    return const Color(0xFF1E88E5);
  }

  @override
  Widget build(BuildContext context) {
    final name = data['name']?.toString() ?? '';
    final tag = data['tag']?.toString() ?? '';
    final imageUrl = data['image_url']?.toString() ?? '';
    return GestureDetector(
      onTap: onTap,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: SizedBox(
          width: 120,
          height: 130,
          child: Stack(
            fit: StackFit.expand,
            children: [
              imageUrl.isNotEmpty
                  ? Image.network(
                      imageUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) =>
                          Container(color: kHomeCard),
                    )
                  : Container(color: kHomeCard),
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      stops: const [0.4, 1.0],
                      colors: [
                        Colors.transparent,
                        Colors.black.withValues(alpha: 0.8),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 8,
                right: 8,
                bottom: 8,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        fontSize: 11,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (tag.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: _tagColor(tag),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          tag,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
