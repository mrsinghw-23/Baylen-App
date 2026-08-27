import 'package:flutter/material.dart';

import '../../services/cart_service.dart';
import '../../services/location_service.dart';
import '../../services/notification_service.dart';
import '../../theme/shop_theme.dart';

class ShopLocationHeader extends StatelessWidget {
  const ShopLocationHeader({
    super.key,
    required this.onAddressTap,
    required this.onNotifyTap,
    required this.onWishlistTap,
    required this.onCartTap,
  });

  final VoidCallback onAddressTap;
  final VoidCallback onNotifyTap;
  final VoidCallback onWishlistTap;
  final VoidCallback onCartTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: ValueListenableBuilder<UserLocation?>(
              valueListenable: LocationService.instance.currentLocation,
              builder: (context, loc, _) {
                final hasLocation =
                    loc != null && (loc.city.isNotEmpty || loc.area.isNotEmpty);
                return GestureDetector(
                  onTap: onAddressTap,
                  child: Row(
                    children: [
                      const Icon(
                        Icons.location_on,
                        color: Colors.white,
                        size: 20,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    hasLocation
                                        ? (loc.city.isNotEmpty
                                              ? loc.city
                                              : loc.area)
                                        : 'Add Address',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                                const Icon(
                                  Icons.keyboard_arrow_down_rounded,
                                  color: Colors.white,
                                  size: 18,
                                ),
                              ],
                            ),
                            Text(
                              hasLocation
                                  ? (loc.area.isNotEmpty
                                        ? loc.area
                                        : loc.formattedAddress ??
                                              'Deliver to this location')
                                  : 'for faster delivery',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          ValueListenableBuilder<int>(
            valueListenable: NotificationService.instance.unreadCount,
            builder: (context, count, _) {
              return ShopHeaderIcon(
                icon: Icons.notifications_outlined,
                count: count,
                onTap: onNotifyTap,
              );
            },
          ),
          ShopHeaderIcon(icon: Icons.favorite_border, onTap: onWishlistTap),
          ValueListenableBuilder(
            valueListenable: CartService.instance.cartState,
            builder: (context, cart, _) {
              return ShopHeaderIcon(
                icon: Icons.shopping_bag_outlined,
                count: cart?.itemCount ?? 0,
                onTap: onCartTap,
              );
            },
          ),
        ],
      ),
    );
  }
}

class ShopHeaderIcon extends StatelessWidget {
  const ShopHeaderIcon({
    super.key,
    required this.icon,
    required this.onTap,
    this.count = 0,
    this.color = Colors.white,
  });

  final IconData icon;
  final VoidCallback onTap;
  final int count;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      visualDensity: VisualDensity.compact,
      icon: Stack(
        clipBehavior: Clip.none,
        children: [
          Icon(icon, color: color),
          if (count > 0)
            Positioned(
              right: -4,
              top: -4,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                decoration: BoxDecoration(
                  color: kShopCyan,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  count > 99 ? '99+' : '$count',
                  style: const TextStyle(
                    color: kShopInk,
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
