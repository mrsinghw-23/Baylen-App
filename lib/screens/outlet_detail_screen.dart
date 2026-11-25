import 'package:flutter/material.dart';

import '../models/salon.dart';
import '../services/maps_service.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/salon_image.dart';
import 'salon_book_screen.dart';

class OutletDetailScreen extends StatelessWidget {
  const OutletDetailScreen({super.key, required this.outlet});

  final SalonOutlet outlet;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(title: Text(outlet.name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
        children: [
          _OutletHero(outlet: outlet),
          const SizedBox(height: 18),
          _InfoPanel(outlet: outlet),
          const SizedBox(height: 14),
          _MapPanel(outlet: outlet),
          const SizedBox(height: 14),
          _ServicesPanel(outlet: outlet),
          const SizedBox(height: 88),
        ],
      ),
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.fromLTRB(16, 8, 16, 16),
        child: FilledButton.icon(
          onPressed: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => SalonBookScreen(outlet: outlet),
              ),
            );
          },
          icon: const Icon(Icons.calendar_month_outlined),
          label: const Text('Book Now'),
        ),
      ),
    );
  }
}

class _OutletHero extends StatelessWidget {
  const _OutletHero({required this.outlet});

  final SalonOutlet outlet;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: AspectRatio(
        aspectRatio: 16 / 9,
        child: Stack(
          fit: StackFit.expand,
          children: [
            outlet.imageUrl.isEmpty
                ? const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Color(0xFF21101A), Color(0xFF070507)],
                      ),
                    ),
                  )
                : SalonImage(imageUrl: outlet.imageUrl),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.86),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 14,
              right: 14,
              bottom: 14,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    outlet.name,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (outlet.salonCategory.isNotEmpty)
                        _Chip(label: outlet.salonCategory),
                      if (outlet.distanceLabel.isNotEmpty)
                        _Chip(label: outlet.distanceLabel),
                      if (outlet.availability.isNotEmpty)
                        _Chip(label: outlet.availability),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.outlet});

  final SalonOutlet outlet;

  Future<void> _openMaps(BuildContext context) async {
    final opened = await MapsService.openOutletLocation(outlet.directionsUrl);
    if (!context.mounted || opened) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Map location is not available yet')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        children: [
          _InfoRow(
            icon: Icons.location_on_outlined,
            title: 'Address',
            value: [
              outlet.addressLine1,
              outlet.locationLabel,
            ].where((part) => part.isNotEmpty).join(', '),
            actionLabel: outlet.directionsUrl.isEmpty ? null : 'Open in Maps',
            onTap: outlet.directionsUrl.isEmpty
                ? null
                : () => _openMaps(context),
          ),
          _InfoRow(
            icon: Icons.schedule_outlined,
            title: 'Opening Hours',
            value: outlet.hoursLabel.isEmpty
                ? 'Available hours not added'
                : outlet.hoursLabel,
          ),
          _InfoRow(
            icon: Icons.call_outlined,
            title: 'Contact',
            value: outlet.phone.isEmpty ? 'Contact not added' : outlet.phone,
          ),
          _InfoRow(
            icon: Icons.star_rate_rounded,
            title: 'Rating',
            value: outlet.rating > 0
                ? '${outlet.rating.toStringAsFixed(1)} (${outlet.reviewCount} reviews)'
                : 'No reviews yet',
          ),
        ],
      ),
    );
  }
}

class _MapPanel extends StatelessWidget {
  const _MapPanel({required this.outlet});

  final SalonOutlet outlet;

  Future<void> _openMaps(BuildContext context) async {
    final opened = await MapsService.openOutletLocation(outlet.directionsUrl);
    if (!context.mounted || opened) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Map location is not available yet')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Location',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          AspectRatio(
            aspectRatio: 16 / 8,
            child: InkWell(
              borderRadius: BorderRadius.circular(8),
              onTap: outlet.directionsUrl.isEmpty
                  ? null
                  : () => _openMaps(context),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  color: const Color(0xFF151318),
                  border: Border.all(color: kHomeOutline),
                ),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.map_outlined,
                        color: kHomePink,
                        size: 34,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        outlet.latitude != 0 && outlet.longitude != 0
                            ? '${outlet.latitude.toStringAsFixed(5)}, ${outlet.longitude.toStringAsFixed(5)}'
                            : 'Map coordinates not added',
                        style: const TextStyle(color: kHomeTextSecondary),
                      ),
                      if (outlet.directionsUrl.isNotEmpty) ...[
                        const SizedBox(height: 10),
                        const Text(
                          'Tap to open walking directions',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ServicesPanel extends StatelessWidget {
  const _ServicesPanel({required this.outlet});

  final SalonOutlet outlet;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Relevant Services',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          if (outlet.relevantServices.isEmpty)
            const Text(
              'Services added in Catalyst will appear here automatically.',
              style: TextStyle(color: kHomeTextSecondary),
            )
          else
            ...outlet.relevantServices.map(
              (service) => ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  service.name,
                  style: const TextStyle(color: Colors.white),
                ),
                subtitle: Text(
                  '${service.durationMinutes} min',
                  style: const TextStyle(color: kHomeTextSecondary),
                ),
                trailing: Text(
                  service.priceLabel,
                  style: const TextStyle(
                    color: kHomePink,
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

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: kHomeCard,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: kHomeOutline),
      ),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.title,
    required this.value,
    this.actionLabel,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String value;
  final String? actionLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: kHomePink, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: kHomeTextSecondary,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value.isEmpty ? 'Not available' : value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (actionLabel != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    actionLabel!,
                    style: const TextStyle(
                      color: kHomePink,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (onTap != null)
            const Icon(Icons.open_in_new, color: kHomeTextSecondary, size: 18),
        ],
      ),
    );

    if (onTap == null) {
      return content;
    }

    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: onTap,
      child: content,
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.62),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: kHomeOutline),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
