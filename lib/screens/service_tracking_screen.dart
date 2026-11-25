import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/at_home_beauty.dart';
import '../models/service_job.dart';
import '../utils/beauty_status_labels.dart';
import '../widgets/at_home_beauty_map.dart';
import '../widgets/profile_photo_avatar.dart';

class ServiceTrackingScreen extends StatefulWidget {
  const ServiceTrackingScreen({
    super.key,
    required this.job,
    this.bookingId,
  });

  final ServiceJob job;
  final String? bookingId;

  @override
  State<ServiceTrackingScreen> createState() => _ServiceTrackingScreenState();
}

class _ServiceTrackingScreenState extends State<ServiceTrackingScreen> {
  AtHomeBookingTracking? _tracking;
  bool _loading = true;
  String? _error;
  Timer? _pollTimer;

  String get _jobId => widget.bookingId ?? widget.job.id;

  @override
  void initState() {
    super.initState();
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 12), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = _tracking == null;
        _error = null;
      });
    }
    try {
      final tracking = await AuthService.instance.api.atHomeBookingTracking(_jobId);
      if (!mounted) return;
      setState(() {
        _tracking = tracking;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  Future<void> _respondExtra({required bool approve}) async {
    try {
      await AuthService.instance.api.respondAtHomeExtraService(
        bookingId: _jobId,
        approve: approve,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(approve ? 'Add-on approved' : 'Add-on declined'),
        ),
      );
      _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  Future<void> _submitReview() async {
    var rating = 5;
    final reviewController = TextEditingController();
    final submitted = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rate your experience'),
        content: StatefulBuilder(
          builder: (context, setLocal) => Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(5, (index) {
                  final star = index + 1;
                  return IconButton(
                    onPressed: () => setLocal(() => rating = star),
                    icon: Icon(
                      star <= rating ? Icons.star : Icons.star_border,
                      color: Colors.amber,
                    ),
                  );
                }),
              ),
              TextField(
                controller: reviewController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Optional feedback',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Later')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Submit')),
        ],
      ),
    );
    final reviewText = reviewController.text.trim();
    reviewController.dispose();
    if (submitted != true) return;
    try {
      await AuthService.instance.api.submitJobReview(
        jobId: _jobId,
        rating: rating,
        review: reviewText.isEmpty ? null : reviewText,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Thank you for your feedback')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString())),
      );
    }
  }

  String _screenTitle(AtHomeBookingTracking? tracking) {
    final status = (tracking?.booking.status ?? widget.job.status).toUpperCase();
    switch (status) {
      case 'ASSIGNED':
      case 'ACCEPTED':
        return 'Professional Assigned';
      case 'EN_ROUTE':
        return tracking?.providerName.isNotEmpty == true
            ? '${tracking!.providerName.split(' ').first} is on the way'
            : 'On the way';
      case 'ARRIVED':
        return 'Professional arrived';
      case 'STARTED':
        return 'Service in Progress';
      case 'COMPLETED':
        return 'Service Completed';
      default:
        return 'Your service';
    }
  }

  @override
  Widget build(BuildContext context) {
    final tracking = _tracking;
    final status = tracking?.customerStatus.isNotEmpty == true
        ? tracking!.customerStatus
        : beautyStatusLabel(widget.job.status);
    final live = tracking?.liveTracking ?? beautyLiveTrackingEnabled(widget.job.status);

    return Scaffold(
      appBar: AppBar(title: Text(_screenTitle(tracking))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_loading)
              const Padding(
                padding: EdgeInsets.only(top: 64),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null && tracking == null)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(_error!),
                ),
              )
            else ...[
              AtHomeBeautyMap(
                customerLat: tracking?.visitLat,
                customerLng: tracking?.visitLng,
                outlets: const [],
                providerLat: live ? tracking?.providerLat : null,
                providerLng: live ? tracking?.providerLng : null,
                showProvider: live,
                height: 280,
              ),
              const SizedBox(height: 12),
              _StatusCard(
                status: status,
                etaLabel: tracking?.route.etaLabel,
                distanceKm: tracking?.route.distanceKm,
                liveTracking: live,
              ),
              const SizedBox(height: 12),
              _ProviderCard(
                bookingId: _jobId,
                name: tracking?.providerName ?? '',
                phone: tracking?.providerPhone ?? '',
                rating: tracking?.providerRating ?? 0,
                amount: tracking?.booking.amountLabel ?? widget.job.amountLabel,
                photoUrl: tracking?.providerPhotoUrl ?? '',
                photoFetchUrl: tracking?.providerPhotoFetchUrl ?? '',
                hasPhoto: tracking?.providerHasPhoto ?? false,
              ),
              if (tracking?.arrivalOtpRequired == true) ...[
                const SizedBox(height: 12),
                _OtpCard(
                  code: tracking!.arrivalOtpCode ?? '',
                  message: tracking.arrivalOtpMessage,
                ),
              ],
              if (tracking?.extraServiceName?.isNotEmpty == true) ...[
                const SizedBox(height: 12),
                _ExtraServiceCard(
                  name: tracking!.extraServiceName!,
                  price: tracking.extraServicePrice ?? 0,
                  onApprove: () => _respondExtra(approve: true),
                  onDecline: () => _respondExtra(approve: false),
                ),
              ],
              const SizedBox(height: 12),
              _ProgressTimeline(status: tracking?.booking.status ?? widget.job.status),
              if ((tracking?.booking.status ?? widget.job.status).toUpperCase() ==
                  'COMPLETED') ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: _submitReview,
                  icon: const Icon(Icons.rate_review_outlined),
                  label: const Text('Rate this service'),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.status,
    required this.etaLabel,
    required this.distanceKm,
    required this.liveTracking,
  });

  final String status;
  final String? etaLabel;
  final double? distanceKm;
  final bool liveTracking;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(status, style: Theme.of(context).textTheme.titleMedium),
            if (liveTracking && etaLabel != null) ...[
              const SizedBox(height: 6),
              Text(etaLabel!),
            ],
            if (liveTracking && distanceKm != null) ...[
              const SizedBox(height: 4),
              Text('${distanceKm!.toStringAsFixed(1)} km away'),
            ],
            if (!liveTracking) ...[
              const SizedBox(height: 6),
              const Text('Live map appears when your professional starts travel.'),
            ],
          ],
        ),
      ),
    );
  }
}

class _ProviderCard extends StatelessWidget {
  const _ProviderCard({
    required this.bookingId,
    required this.name,
    required this.phone,
    required this.rating,
    required this.amount,
    required this.photoUrl,
    required this.photoFetchUrl,
    required this.hasPhoto,
  });

  final String bookingId;
  final String name;
  final String phone;
  final double rating;
  final String amount;
  final String photoUrl;
  final String photoFetchUrl;
  final bool hasPhoto;

  @override
  Widget build(BuildContext context) {
    Widget leading;
    if (hasPhoto && (photoUrl.startsWith('http') || photoFetchUrl.isNotEmpty)) {
      leading = AuthenticatedProfilePhotoAvatar(
        name: name,
        photoUrl: photoUrl,
        radius: 24,
        backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
        fetchPhoto: () => AuthService.instance.api.fetchAtHomeProfessionalPhoto(bookingId),
      );
    } else if (photoUrl.startsWith('http')) {
      leading = ProfilePhotoAvatar(
        name: name,
        photoUrl: photoUrl,
        radius: 24,
        backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
      );
    } else {
      leading = CircleAvatar(
        backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
        child: Icon(Icons.person_outline, color: Theme.of(context).colorScheme.primary),
      );
    }
    return Card(
      child: ListTile(
        leading: leading,
        title: Text(name.isNotEmpty ? name : 'Professional will be assigned soon'),
        subtitle: Text(
          [
            if (rating > 0) 'Rating ${rating.toStringAsFixed(1)}',
            if (phone.isNotEmpty) phone,
          ].join(' · '),
        ),
        trailing: Text(amount, style: const TextStyle(fontWeight: FontWeight.bold)),
      ),
    );
  }
}

class _OtpCard extends StatelessWidget {
  const _OtpCard({required this.code, required this.message});

  final String code;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.35),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Your arrival code', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(
              code,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                letterSpacing: 6,
                fontWeight: FontWeight.bold,
              ),
            ),
            if (message.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(message),
            ],
          ],
        ),
      ),
    );
  }
}

class _ExtraServiceCard extends StatelessWidget {
  const _ExtraServiceCard({
    required this.name,
    required this.price,
    required this.onApprove,
    required this.onDecline,
  });

  final String name;
  final double price;
  final VoidCallback onApprove;
  final VoidCallback onDecline;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Additional service requested', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text('$name · ₹${price.toStringAsFixed(0)}'),
            const SizedBox(height: 10),
            Row(
              children: [
                OutlinedButton(onPressed: onDecline, child: const Text('Decline')),
                const SizedBox(width: 8),
                FilledButton(onPressed: onApprove, child: const Text('Approve')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _ProgressTimeline extends StatelessWidget {
  const _ProgressTimeline({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final steps = [
      'Booking confirmed',
      'Professional assigned',
      'Professional confirmed',
      'On the way',
      'Arrived',
      'Service in progress',
      'Completed',
    ];
    final statusKeys = [
      'CONFIRMED',
      'ASSIGNED',
      'ACCEPTED',
      'EN_ROUTE',
      'ARRIVED',
      'STARTED',
      'COMPLETED',
    ];
    final active = statusKeys.indexOf(status.toUpperCase());
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Progress', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            for (var i = 0; i < steps.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Icon(
                      i <= active ? Icons.check_circle : Icons.radio_button_unchecked,
                      color: i <= active
                          ? Theme.of(context).colorScheme.primary
                          : const Color(0xFFAAA4B6),
                      size: 20,
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(steps[i])),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
