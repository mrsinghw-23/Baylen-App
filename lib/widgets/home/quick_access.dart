import 'package:flutter/material.dart';

import '_home_constants.dart';

class QuickAccess extends StatelessWidget {
  const QuickAccess({
    super.key,
    required this.onBrowseServices,
    required this.onOffers,
    required this.onShopping,
    required this.onProducts,
    required this.onFindSalon,
  });
  final VoidCallback onBrowseServices;
  final VoidCallback onOffers;
  final VoidCallback onShopping;
  final VoidCallback onProducts;
  final VoidCallback onFindSalon;

  @override
  Widget build(BuildContext context) {
    final items = [
      (Icons.content_cut_outlined, 'Browse\nServices', onBrowseServices),
      (Icons.local_offer_outlined, 'Offers', onOffers),
      (Icons.shopping_bag_outlined, 'Shopping', onShopping),
      (Icons.inventory_2_outlined, 'Products', onProducts),
      (Icons.store_mall_directory_outlined, 'Find\nSalon', onFindSalon),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: items
            .map(
              (item) =>
                  _QuickItem(icon: item.$1, label: item.$2, onTap: item.$3),
            )
            .toList(),
      ),
    );
  }
}

class _QuickItem extends StatelessWidget {
  const _QuickItem({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: kHomeCard,
              shape: BoxShape.circle,
              border: Border.all(color: kHomeOutline),
            ),
            child: Icon(icon, color: kHomePink, size: 22),
          ),
          const SizedBox(height: 6),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 10.5,
              fontWeight: FontWeight.w500,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }
}
