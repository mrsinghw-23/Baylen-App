import 'package:flutter/material.dart';

import '../../models/salon.dart';
import '_home_constants.dart';

class NearbySalons extends StatelessWidget {
  const NearbySalons({
    super.key,
    required this.outlets,
    required this.loading,
    required this.error,
    required this.onViewAll,
    required this.onRetry,
    required this.onOutletTap,
  });

  final List<SalonOutlet> outlets;
  final bool loading;
  final String? error;
  final VoidCallback onViewAll;
  final VoidCallback onRetry;
  final void Function(SalonOutlet) onOutletTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SectionHeader(
            title: 'Our Premium Salons Near You',
            onViewAll: onViewAll,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 216,
          child: loading && outlets.isEmpty
              ? _SkeletonList()
              : error != null && outlets.isEmpty
              ? _ErrorState(message: error!, onRetry: onRetry)
              : outlets.isEmpty
              ? _EmptyState(onRetry: onRetry)
              : ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: outlets.length,
                  itemBuilder: (context, i) => Padding(
                    padding: const EdgeInsets.only(right: 12),
                    child: _SalonCard(
                      data: outlets[i],
                      onTap: () => onOutletTap(outlets[i]),
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
        3,
        (i) => const Padding(
          padding: EdgeInsets.only(right: 12),
          child: SkeletonBox(width: 174, height: 216, radius: 12),
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.store_mall_directory_outlined, color: kHomePink),
            const SizedBox(height: 8),
            const Text(
              'No nearby outlets match your current location yet.',
              textAlign: TextAlign.center,
              style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.my_location),
              label: const Text('Refresh Location'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 22),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.location_off_outlined, color: kHomePink),
            const SizedBox(height: 8),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SalonCard extends StatelessWidget {
  const _SalonCard({required this.data, required this.onTap});

  final SalonOutlet data;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final name = data.name.isEmpty ? 'Baylen Salon' : data.name;
    final category = data.salonCategory.isEmpty ? 'Salon' : data.salonCategory;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 174,
        height: 216,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: kHomeCard,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: kHomeOutline),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.22),
              blurRadius: 14,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Center(
              child: _SalonLogo(
                imageUrl: 'assets/icon/logo.png',
              ),
            ),
            const SizedBox(height: 12),
            Text(
              name,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: 13,
                height: 1.15,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 6),
            if (data.distanceLabel.isNotEmpty)
              Text(
                data.distanceLabel,
                style: const TextStyle(
                  color: kHomeTextSecondary,
                  fontSize: 11,
                  height: 1.2,
                ),
              ),
            if (data.locationLabel.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                data.locationLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: kHomeTextSecondary,
                  fontSize: 11,
                  height: 1.2,
                ),
              ),
            ],
            const Spacer(),
            Row(
              children: [
                Flexible(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: kHomePink.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: kHomePink.withValues(alpha: 0.28),
                      ),
                    ),
                    child: Text(
                      category,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: kHomePink,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                if (data.rating > 0)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.star_rounded,
                        color: kHomeStarColor,
                        size: 14,
                      ),
                      const SizedBox(width: 3),
                      Text(
                        data.rating.toStringAsFixed(1),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SalonLogo extends StatelessWidget {
  const _SalonLogo({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 82,
      height: 82,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.black,
        border: Border.all(
          color: kHomePink.withValues(alpha: 0.38),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(color: kHomePink.withValues(alpha: 0.18), blurRadius: 18),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: imageUrl.isNotEmpty
          ? imageUrl.startsWith('assets/')
                ? Image.asset(
                    imageUrl,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                    errorBuilder: (context, error, stackTrace) =>
                        const _FallbackSalonIcon(),
                  )
                : Image.network(
                    imageUrl,
                    fit: BoxFit.contain,
                    errorBuilder: (context, error, stackTrace) =>
                        const _FallbackSalonIcon(),
                  )
          : const Icon(
              Icons.store_mall_directory_outlined,
              color: kHomePink,
              size: 34,
            ),
    );
  }
}

class _FallbackSalonIcon extends StatelessWidget {
  const _FallbackSalonIcon();

  @override
  Widget build(BuildContext context) {
    return const Icon(
      Icons.store_mall_directory_outlined,
      color: kHomePink,
      size: 34,
    );
  }
}
