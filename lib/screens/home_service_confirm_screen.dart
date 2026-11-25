import 'package:flutter/material.dart';

import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/salon_image.dart';
import 'home_service_payment_screen.dart';

class HomeServiceConfirmScreen extends StatelessWidget {
  const HomeServiceConfirmScreen({
    super.key,
    required this.outlet,
    required this.service,
    required this.gender,
    required this.professional,
    required this.addressLine1,
    required this.addressCity,
    required this.addressState,
    required this.pincode,
    required this.selectedDate,
    required this.quote,
    required this.bookingBody,
  });

  final SalonOutlet outlet;
  final SalonService service;
  final String gender;
  final HomeServiceProfessional professional;
  final String addressLine1;
  final String addressCity;
  final String addressState;
  final String pincode;
  final DateTime selectedDate;
  final AtHomeBookingQuote quote;
  final Map<String, dynamic> bookingBody;

  String _formatDate(DateTime day) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${weekdays[day.weekday - 1]}, ${day.day} ${months[day.month - 1]} ${day.year}';
  }

  String get _addressText {
    return [
      addressLine1,
      addressCity,
      addressState,
      pincode,
    ].where((part) => part.isNotEmpty).join(', ');
  }

  double get _servicePrice {
    if (quote.subtotal > 0) {
      return quote.subtotal - quote.addonsTotal;
    }
    return service.priceFor(gender)?.sellingPrice ?? service.sellingPrice;
  }

  void _goToPayment(BuildContext context) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServicePaymentScreen(
          outlet: outlet,
          service: service,
          quote: quote,
          bookingBody: bookingBody,
          professionalName: professional.name,
          selectedDate: selectedDate,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        foregroundColor: Colors.white,
        title: const Text('Confirm Booking'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Card(
              color: kHomeCard,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: SizedBox(
                        width: 72,
                        height: 72,
                        child: SalonImage(imageUrl: service.imageUrl),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            service.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            outlet.name,
                            style: const TextStyle(color: kHomeTextSecondary),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '₹${_servicePrice.toStringAsFixed(0)}  ·  ${service.durationMinutes} mins',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            _InfoRow(
              icon: Icons.calendar_month_outlined,
              title: _formatDate(selectedDate),
              subtitle: 'Time will be confirmed after assignment',
            ),
            _InfoRow(
              icon: Icons.home_outlined,
              title: 'Home',
              subtitle: _addressText,
              actionLabel: 'Change',
              onAction: () => Navigator.of(context).pop(),
            ),
            _InfoRow(
              icon: Icons.person_outline,
              title: professional.name,
              subtitle: 'Preferred',
            ),
            if (quote.addonsTotal > 0)
              _InfoRow(
                icon: Icons.note_add_outlined,
                title: 'Add-ons',
                subtitle: 'Extra items',
                trailing: '₹${quote.addonsTotal.toStringAsFixed(0)}',
              ),
            const SizedBox(height: 12),
            Card(
              color: kHomeCard,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                child: Column(
                  children: [
                    _PriceRow(label: 'Service Price', amount: _servicePrice),
                    if (quote.addonsTotal > 0)
                      _PriceRow(label: 'Add-ons', amount: quote.addonsTotal),
                    if (quote.convenienceFee > 0)
                      _PriceRow(
                        label: 'Convenience Fee',
                        amount: quote.convenienceFee,
                      ),
                    const Divider(height: 22, color: kHomeOutline),
                    _PriceRow(
                      label: 'Total',
                      amount: quote.grandTotal,
                      bold: true,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
            HomeFullWidthButton(
              label: 'Proceed to Payment',
              onPressed: () => _goToPayment(context),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.actionLabel,
    this.trailing,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String? actionLabel;
  final String? trailing;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
                ),
              ],
            ),
          ),
          if (actionLabel != null)
            TextButton(
              onPressed: onAction,
              child: Text(
                actionLabel!,
                style: const TextStyle(
                  color: kHomePink,
                  fontWeight: FontWeight.w700,
                ),
              ),
            )
          else if (trailing != null)
            Text(
              trailing!,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
              ),
            )
          else
            const Icon(Icons.chevron_right, color: kHomeTextSecondary),
        ],
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({
    required this.label,
    required this.amount,
    this.bold = false,
  });

  final String label;
  final double amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.w800 : FontWeight.w500,
      fontSize: bold ? 18 : 14,
      color: Colors.white,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: style),
          Text('₹${amount.toStringAsFixed(0)}', style: style),
        ],
      ),
    );
  }
}
