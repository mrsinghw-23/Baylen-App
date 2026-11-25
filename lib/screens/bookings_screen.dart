import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../auth/present_auth_flow.dart';
import '../models/account.dart';
import '../models/my_booking.dart';
import '../models/service_job.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/offline_account_banner.dart';
import '../widgets/reviews_panel.dart';
import 'payment_checkout_screen.dart';
import 'service_tracking_screen.dart';

class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key, this.highlightId});

  final String? highlightId;

  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  List<MyBookingEntry> _entries = [];
  MyBookingFilter _filter = MyBookingFilter.all;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() {
        _loading = false;
        _error = null;
        _entries = [];
      });
      return;
    }

    setState(() {
      _loading = _entries.isEmpty;
      _error = null;
    });

    try {
      final api = AuthService.instance.api;
      final salonAppointments = await api.appointments();
      final homePage = await api.atHomeBookings(filter: _filter, limit: 50);

      final merged = mergeMyBookings(
        salonAppointments: salonAppointments,
        homeBookings: homePage.bookings,
      ).where((entry) => entry.matchesFilter(_filter)).toList();

      AuthService.instance.noteLiveDataReceived();
      if (!mounted) return;
      setState(() {
        _entries = merged;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_entries.isEmpty) {
          _error = error.toString().replaceFirst('Exception: ', '');
        }
      });
    }
  }

  void _setFilter(MyBookingFilter filter) {
    if (_filter == filter) return;
    setState(() => _filter = filter);
    _load();
  }

  Future<void> _payEntry(MyBookingEntry entry) async {
    final paid = await Navigator.of(context).push<PaymentRecord>(
      MaterialPageRoute(
        builder: (_) => PaymentCheckoutScreen(
          referenceType: entry.paymentReferenceType,
          referenceId: entry.id,
        ),
      ),
    );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          paid?.isConfirmed == true
              ? 'Payment received. The booking is confirmed.'
              : 'Payment was not completed. The time stays held until you pay.',
        ),
      ),
    );
    await _load();
  }

  void _openEntry(MyBookingEntry entry) {
    if (entry.kind == MyBookingKind.homeService && entry.home != null) {
      final booking = entry.home!;
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ServiceTrackingScreen(
            bookingId: booking.id,
            job: ServiceJob(
              id: booking.id,
              appointmentId: '',
              providerId: booking.providerId,
              status: booking.status,
              visitLine1: booking.visitLine1,
              visitCity: booking.visitCity,
              scheduledAt: booking.scheduledAt,
              grandTotal: booking.grandTotal,
              currency: booking.currency,
            ),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          backgroundColor: kHomeCanvas,
          appBar: AppBar(
            backgroundColor: kHomeCanvas,
            foregroundColor: Colors.white,
            title: const Text('My Bookings'),
          ),
          body: Column(
            children: [
              const OfflineAccountBanner(),
              SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: MyBookingFilter.values.map((filter) {
                    final selected = _filter == filter;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(filter.label),
                        selected: selected,
                        onSelected: (_) => _setFilter(filter),
                        selectedColor: kHomePink.withValues(alpha: 0.25),
                        checkmarkColor: kHomePink,
                        labelStyle: TextStyle(
                          color: selected ? Colors.white : kHomeTextSecondary,
                          fontWeight:
                              selected ? FontWeight.w700 : FontWeight.w500,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
              Expanded(
                child: user == null
                    ? Center(
                        child: FilledButton(
                          onPressed: () async {
                            final signedIn = await presentAuthFlow(context);
                            if (signedIn && mounted) {
                              _load();
                            }
                          },
                          child: const Text('Sign in'),
                        ),
                      )
                    : _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_error!, textAlign: TextAlign.center),
                            const SizedBox(height: 12),
                            FilledButton(
                              onPressed: _load,
                              child: const Text('Retry'),
                            ),
                          ],
                        ),
                      )
                    : _entries.isEmpty
                    ? Center(
                        child: Text(
                          _emptyMessage(),
                          style: const TextStyle(color: kHomeTextSecondary),
                          textAlign: TextAlign.center,
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: _entries.length,
                          itemBuilder: (context, index) {
                            final entry = _entries[index];
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _MyBookingCard(
                                entry: entry,
                                highlighted: entry.id == widget.highlightId,
                                onTap: () => _openEntry(entry),
                                onPay: () => _payEntry(entry),
                              ),
                            );
                          },
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }

  String _emptyMessage() {
    switch (_filter) {
      case MyBookingFilter.upcoming:
        return 'No upcoming bookings yet.';
      case MyBookingFilter.completed:
        return 'No completed bookings yet.';
      case MyBookingFilter.cancelled:
        return 'No cancelled bookings yet.';
      case MyBookingFilter.all:
        return 'No bookings yet. Salon and home service bookings will appear here.';
    }
  }
}

class _MyBookingCard extends StatelessWidget {
  const _MyBookingCard({
    required this.entry,
    required this.highlighted,
    required this.onTap,
    required this.onPay,
  });

  final MyBookingEntry entry;
  final bool highlighted;
  final VoidCallback onTap;
  final VoidCallback onPay;

  @override
  Widget build(BuildContext context) {
    final isHome = entry.kind == MyBookingKind.homeService;
    final salon = entry.salon;

    return Card(
      color: highlighted ? kHomeSurface : kHomeCard,
      child: InkWell(
        onTap: isHome ? onTap : null,
        borderRadius: BorderRadius.circular(8),
        child: ExpansionTile(
          initiallyExpanded: highlighted,
          title: Row(
            children: [
              Expanded(
                child: Text(
                  entry.title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: isHome
                      ? kHomePink.withValues(alpha: 0.18)
                      : kHomeOutline,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  isHome ? 'Home Service' : 'Salon',
                  style: TextStyle(
                    color: isHome ? kHomePink : kHomeTextSecondary,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          subtitle: Text(
            [
              entry.subtitle,
              entry.displayStatus,
              if (entry.gender.isNotEmpty) 'For ${entry.gender}',
              entry.amountLabel,
            ].where((line) => line.isNotEmpty).join('\n'),
            style: const TextStyle(color: kHomeTextSecondary, height: 1.35),
          ),
          trailing: isHome && entry.canTrack
              ? TextButton(onPressed: onTap, child: const Text('Track'))
              : Text(entry.amountLabel, style: const TextStyle(color: Colors.white)),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          children: [
            if (entry.location.isNotEmpty)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.place_outlined, color: kHomePink),
                title: const Text('Location', style: TextStyle(color: Colors.white)),
                subtitle: Text(
                  entry.location,
                  style: const TextStyle(color: kHomeTextSecondary),
                ),
              ),
            if (entry.referenceLabel.isNotEmpty)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.confirmation_number_outlined,
                    color: kHomePink),
                title: const Text('Reference', style: TextStyle(color: Colors.white)),
                subtitle: Text(
                  entry.referenceLabel,
                  style: const TextStyle(color: kHomeTextSecondary),
                ),
              ),
            if (salon != null && salon.items.isNotEmpty)
              ...salon.items.map(
                (item) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    Icons.content_cut_outlined,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  title: Text(item.name, style: const TextStyle(color: Colors.white)),
                  subtitle: Text(
                    '${item.durationMinutes} min',
                    style: const TextStyle(color: kHomeTextSecondary),
                  ),
                ),
              ),
            if (salon != null && salon.items.isNotEmpty)
              ReviewsPanel(
                targetType: 'SERVICE',
                targetId: salon.items.first.serviceId,
                title: 'Review ${salon.items.first.name}',
                framed: false,
              ),
            if (entry.needsOnlinePayment)
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton.icon(
                  onPressed: onPay,
                  icon: const Icon(Icons.payment),
                  label: const Text('Pay with Razorpay'),
                ),
              ),
            if (isHome)
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton(
                  onPressed: onTap,
                  child: Text(entry.canTrack ? 'Track booking' : 'View booking'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
