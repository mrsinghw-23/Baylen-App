import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/salon.dart';
import '../widgets/offline_account_banner.dart';
import '../widgets/reviews_panel.dart';
import 'login_screen.dart';

class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key, this.highlightId});

  final String? highlightId;

  @override
  State<BookingsScreen> createState() => _BookingsScreenState();
}

class _BookingsScreenState extends State<BookingsScreen> {
  List<SalonAppointment> _appointments = [];
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
        _appointments = [];
      });
      return;
    }
    final cached = AuthService.instance.bootstrap.value?.appointments ?? [];
    setState(() {
      if (cached.isNotEmpty) {
        _appointments = cached;
        _loading = false;
      } else {
        _loading = true;
      }
      _error = null;
    });
    try {
      final appointments = await AuthService.instance.api.appointments();
      AuthService.instance.noteLiveDataReceived();
      if (!mounted) return;
      setState(() {
        _appointments = appointments;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (_appointments.isEmpty) {
          _error = error.toString();
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Bookings')),
          body: Column(
            children: [
              const OfflineAccountBanner(),
              Expanded(
                child: user == null
              ? Center(
                  child: FilledButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<bool>(
                          builder: (_) => const LoginScreen(),
                        ),
                      );
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
                      Text(_error!),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _load,
                        child: const Text('Retry'),
                      ),
                    ],
                  ),
                )
              : _appointments.isEmpty
              ? const Center(child: Text('No salon bookings yet.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _appointments.length,
                    itemBuilder: (context, index) {
                      final appointment = _appointments[index];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: _BookingCard(
                          appointment: appointment,
                          highlighted: appointment.id == widget.highlightId,
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
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.appointment, required this.highlighted});

  final SalonAppointment appointment;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    SalonAppointmentItem? firstReviewable;
    for (final item in appointment.items) {
      if (item.serviceId.isNotEmpty) {
        firstReviewable = item;
        break;
      }
    }

    return Card(
      color: highlighted
          ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.18)
          : null,
      child: ExpansionTile(
        title: Text(appointment.serviceLabel),
        subtitle: Text(
          [
            if (appointment.salonName.isNotEmpty) appointment.salonName,
            appointment.appointmentNumber,
            '${appointment.appointmentDate}  ${appointment.startTime} - ${appointment.endTime}',
            '${appointment.status} / ${appointment.paymentStatus}',
            if (appointment.notificationStatus.toUpperCase() == 'SENT')
              'WhatsApp confirmation sent',
          ].where((line) => line.isNotEmpty).join('\n'),
        ),
        trailing: Text(appointment.totalLabel),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        children: [
          if (appointment.items.isEmpty)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('No service item was returned for this booking.'),
            )
          else
            ...appointment.items.map(
              (item) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  Icons.content_cut_outlined,
                  color: Theme.of(context).colorScheme.primary,
                ),
                title: Text(item.name),
                subtitle: Text('${item.durationMinutes} min'),
              ),
            ),
          if (firstReviewable != null) ...[
            const SizedBox(height: 8),
            ReviewsPanel(
              targetType: 'SERVICE',
              targetId: firstReviewable.serviceId,
              title: 'Review ${firstReviewable.name}',
              framed: false,
            ),
          ],
        ],
      ),
    );
  }
}
