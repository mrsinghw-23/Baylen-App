import 'package:flutter/material.dart';

import '_home_constants.dart';

class BrandCollection extends StatelessWidget {
  const BrandCollection({
    super.key,
    required this.brands,
    required this.loading,
    required this.onViewAll,
    required this.onBrandTap,
  });
  final List<Map<String, dynamic>> brands;
  final bool loading;
  final VoidCallback onViewAll;
  final void Function(Map<String, dynamic>) onBrandTap;

  static const _fallback = [
    'L\u2019OR\u00c9AL',
    'WELLA',
    'K\u00c9RASTASE',
    'SCHWARZKOPF',
    'OLAPLEX',
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SectionHeader(title: 'Brand Collection', onViewAll: onViewAll),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 56,
          child: loading
              ? _SkeletonRow()
              : ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: brands.isNotEmpty
                      ? brands.length
                      : _fallback.length,
                  itemBuilder: (context, i) {
                    if (brands.isNotEmpty) {
                      final b = brands[i];
                      return Padding(
                        padding: const EdgeInsets.only(right: 12),
                        child: _BrandCard(
                          name: b['name']?.toString() ?? '',
                          logoUrl: b['logo_url']?.toString() ?? '',
                          onTap: () => onBrandTap(b),
                        ),
                      );
                    }
                    return Padding(
                      padding: const EdgeInsets.only(right: 12),
                      child: _BrandCard(
                        name: _fallback[i],
                        logoUrl: '',
                        onTap: () {},
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
        5,
        (i) => const Padding(
          padding: EdgeInsets.only(right: 12),
          child: SkeletonBox(width: 90, height: 56, radius: 10),
        ),
      ),
    );
  }
}

class _BrandCard extends StatelessWidget {
  const _BrandCard({
    required this.name,
    required this.logoUrl,
    required this.onTap,
  });
  final String name;
  final String logoUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: kHomeCard,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: kHomeOutline),
        ),
        child: logoUrl.isNotEmpty
            ? Image.network(
                logoUrl,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) => _nameWidget(),
              )
            : _nameWidget(),
      ),
    );
  }

  Widget _nameWidget() {
    return Center(
      child: Text(
        name,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w700,
          fontSize: 11,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
