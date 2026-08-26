import 'package:flutter/material.dart';

import '_home_constants.dart';

class HomeHeader extends StatelessWidget {
  const HomeHeader({
    super.key,
    required this.locationCity,
    required this.locationArea,
    this.notificationCount = 0,
    this.cartCount = 0,
    this.locationLoading = false,
    required this.onLocationTap,
    required this.onNotificationTap,
    required this.onCartTap,
  });

  final String locationCity;
  final String locationArea;
  final int notificationCount;
  final int cartCount;
  final bool locationLoading;
  final VoidCallback onLocationTap;
  final VoidCallback onNotificationTap;
  final VoidCallback onCartTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: kHomeCanvas,
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: GestureDetector(
              onTap: onLocationTap,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Padding(
                    padding: EdgeInsets.only(top: 1),
                    child: Icon(
                      Icons.location_on_outlined,
                      color: kHomePink,
                      size: 18,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Flexible(
                    child: locationLoading
                        ? const Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              SkeletonBox(width: 100, height: 13),
                              SizedBox(height: 4),
                              SkeletonBox(width: 70, height: 11),
                            ],
                          )
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Flexible(
                                    child: Text(
                                      locationCity.isEmpty
                                          ? 'Select Location'
                                          : locationCity,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 13,
                                      ),
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const Icon(
                                    Icons.keyboard_arrow_down_rounded,
                                    color: kHomeTextSecondary,
                                    size: 16,
                                  ),
                                ],
                              ),
                              if (locationArea.isNotEmpty)
                                Text(
                                  locationArea,
                                  style: const TextStyle(
                                    color: kHomeTextSecondary,
                                    fontSize: 11,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                            ],
                          ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Center(
              child: Image.asset(
                'assets/branding/baylen-de-louis-logo.png',
                height: 52,
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) => const Text(
                  'BAYLEN',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 20,
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                _BadgeIcon(
                  icon: Icons.notifications_outlined,
                  count: notificationCount,
                  onTap: onNotificationTap,
                ),
                const SizedBox(width: 6),
                _BadgeIcon(
                  icon: Icons.shopping_bag_outlined,
                  count: cartCount,
                  onTap: onCartTap,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BadgeIcon extends StatelessWidget {
  const _BadgeIcon({
    required this.icon,
    required this.count,
    required this.onTap,
  });
  final IconData icon;
  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: kHomeCard,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: kHomeOutline),
            ),
            child: Icon(icon, color: Colors.white, size: 20),
          ),
          if (count > 0)
            Positioned(
              top: -4,
              right: -4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: kHomePink,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  count > 99 ? '99+' : count.toString(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
