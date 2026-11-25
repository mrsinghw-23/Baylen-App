import 'package:flutter/material.dart';

import '../models/at_home_beauty.dart';
import '../models/service_job.dart';
import '../widgets/home/_home_constants.dart';
import 'service_tracking_screen.dart';

class HomeServiceBookingConfirmedScreen extends StatelessWidget {
  const HomeServiceBookingConfirmedScreen({
    super.key,
    required this.booking,
    required this.outletName,
    required this.serviceName,
    required this.selectedDate,
    this.whatsappSent = false,
    this.whatsappReason = '',
  });

  final AtHomeBooking booking;
  final String outletName;
  final String serviceName;
  final DateTime selectedDate;
  final bool whatsappSent;
  final String whatsappReason;

  String _formatDate(DateTime day) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${weekdays[day.weekday - 1]}, ${day.day} ${months[day.month - 1]} ${day.year}';
  }

  void _viewBooking(BuildContext context) {
    Navigator.of(context).pushAndRemoveUntil(
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
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 32, 24, 24),
          child: Column(
            children: [
              const Spacer(),
              SizedBox(
                width: 140,
                height: 140,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Positioned(
                      top: 12,
                      left: 18,
                      child: _dot(const Color(0xFF5EEAD4), 8),
                    ),
                    Positioned(
                      top: 28,
                      right: 16,
                      child: _dot(const Color(0xFFFFB86B), 7),
                    ),
                    Positioned(
                      bottom: 22,
                      left: 22,
                      child: _dot(kHomePink, 8),
                    ),
                    Positioned(
                      bottom: 18,
                      right: 28,
                      child: _dot(const Color(0xFF7DD3FC), 6),
                    ),
                    const Icon(
                      Icons.check_circle,
                      color: Color(0xFF22C55E),
                      size: 92,
                    ),
                  ],
                ),
              ),
              const Text(
                'Booking Confirmed!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                serviceName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _formatDate(selectedDate),
                style: const TextStyle(color: kHomeTextSecondary),
              ),
              const SizedBox(height: 8),
              Text(
                outletName,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Home Service',
                style: TextStyle(color: kHomeTextSecondary),
              ),
              if (booking.bookingNumber.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  'Booking #${booking.bookingNumber}',
                  style: const TextStyle(color: kHomeTextSecondary),
                ),
              ],
              const SizedBox(height: 16),
              Text(
                whatsappSent
                    ? 'Confirmation sent on WhatsApp.\nWe are assigning a professional for your service.'
                    : 'We are assigning a professional for your service.',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, height: 1.4),
              ),
              if (!whatsappSent && whatsappReason.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  whatsappReason,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
                ),
              ],
              const Spacer(),
              HomeFullWidthButton(
                label: 'View Booking',
                onPressed: () => _viewBooking(context),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _dot(Color color, double size) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
