import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../models/account.dart';
import '../widgets/home/_home_constants.dart';
import 'home_service_booking_confirmed_screen.dart';
import 'login_screen.dart';
import 'payment_checkout_screen.dart';

class HomeServicePaymentScreen extends StatefulWidget {
  const HomeServicePaymentScreen({
    super.key,
    required this.outlet,
    required this.service,
    required this.quote,
    required this.bookingBody,
    required this.professionalName,
    required this.selectedDate,
  });

  final SalonOutlet outlet;
  final SalonService service;
  final AtHomeBookingQuote quote;
  final Map<String, dynamic> bookingBody;
  final String professionalName;
  final DateTime selectedDate;

  @override
  State<HomeServicePaymentScreen> createState() =>
      _HomeServicePaymentScreenState();
}

class _HomeServicePaymentScreenState extends State<HomeServicePaymentScreen> {
  AtHomeBooking? _createdBooking;
  bool _loading = false;
  String? _error;
  late final String _idempotencyKey = _buildIdempotencyKey(widget.bookingBody);

  String _buildIdempotencyKey(Map<String, dynamic> body) {
    final keys = body.keys.toList()..sort();
    final canonical = <String, dynamic>{for (final key in keys) key: body[key]};
    return 'hs-${canonical.hashCode}-${body['slot_date'] ?? ''}';
  }

  Future<void> _pay() async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (signedIn != true || !mounted) return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = AuthService.instance.api;
      _createdBooking ??= await api.createAtHomeBooking(
        widget.bookingBody,
        idempotencyKey: _idempotencyKey,
      );
      if (!mounted) return;
      final paid = await Navigator.of(context).push<PaymentRecord>(
        MaterialPageRoute(
          builder: (_) => PaymentCheckoutScreen(
            referenceType: 'JOB',
            referenceId: _createdBooking!.id,
          ),
        ),
      );
      if (!mounted) return;
      if (paid?.isConfirmed != true) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Payment was not completed. The visit stays unpaid until you pay.',
            ),
          ),
        );
        return;
      }
      final result = await api.finalizeAtHomeBooking(_createdBooking!.id);
      if (!mounted) return;
      await Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => HomeServiceBookingConfirmedScreen(
            booking: result.booking,
            outletName: widget.outlet.name,
            serviceName: widget.service.name,
            selectedDate: widget.selectedDate,
            whatsappSent: result.whatsappSent,
            whatsappReason: result.notificationReason,
          ),
        ),
        (route) => route.isFirst,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final amount = widget.quote.grandTotal.toStringAsFixed(0);
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        foregroundColor: Colors.white,
        title: const Text('Payment'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            Card(
              color: kHomeCard,
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Total Amount',
                      style: TextStyle(color: kHomeTextSecondary),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '₹$amount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.account_balance_outlined),
              title: Text('Pay securely with Razorpay'),
              subtitle: Text('UPI, cards, net banking and supported wallets'),
            ),
            const SizedBox(height: 16),
            const Row(
              children: [
                Icon(Icons.lock_outline, color: kHomeStarColor, size: 18),
                SizedBox(width: 8),
                Text(
                  '100% Secure Payment',
                  style: TextStyle(
                    color: kHomeStarColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Card(
                color: const Color(0xFF2A1515),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 24),
            HomeFullWidthButton(
              label: 'Pay ₹$amount',
              onPressed: _loading ? null : _pay,
              loading: _loading,
            ),
          ],
        ),
      ),
    );
  }
}
