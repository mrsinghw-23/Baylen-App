import 'package:flutter/material.dart';

import '_home_constants.dart';

class HomeSearchBar extends StatelessWidget {
  const HomeSearchBar({super.key, required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 46,
        margin: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: kHomeCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: kHomeOutline),
        ),
        child: Row(
          children: [
            const SizedBox(width: 14),
            const Icon(Icons.search, color: kHomeTextSecondary, size: 20),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Search for services, treatments, salons...',
                style: TextStyle(color: kHomeTextSecondary, fontSize: 13),
              ),
            ),
            Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: kHomePink.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: kHomePink.withValues(alpha: 0.3)),
              ),
              child: const Icon(Icons.tune_rounded, color: kHomePink, size: 16),
            ),
          ],
        ),
      ),
    );
  }
}
