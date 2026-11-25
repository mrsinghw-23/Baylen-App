import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../config/app_config.dart';
import '../models/account.dart';

class PaymentCheckoutScreen extends StatefulWidget {
  const PaymentCheckoutScreen({
    super.key,
    required this.referenceType,
    required this.referenceId,
    this.payment,
  });

  final String referenceType;
  final String referenceId;
  final PaymentRecord? payment;

  @override
  State<PaymentCheckoutScreen> createState() => _PaymentCheckoutScreenState();
}

class _PaymentCheckoutScreenState extends State<PaymentCheckoutScreen>
    with WidgetsBindingObserver {
  PaymentRecord? _payment;
  Uri? _checkout;
  bool _busy = false;
  bool _opened = false;
  bool _finished = false;
  String? _error;
  Timer? _poll;
  DateTime? _openedAt;
  DateTime? _linkCreatedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _payment = widget.payment;
    _prepare();
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _opened) _check();
  }

  void _accept(PaymentRecord payment) {
    _payment = payment;
    if (payment.isConfirmed && !_finished && mounted) {
      _finished = true;
      _poll?.cancel();
      Navigator.of(context).pop(payment);
    }
  }

  Future<void> _prepare() async {
    if (_busy || _finished) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = AuthService.instance.api;
      final payment =
          _payment ??
          await api.createPaymentIntent(
            referenceType: widget.referenceType,
            referenceId: widget.referenceId,
            provider: 'RAZORPAY',
          );
      _payment = payment;
      final session = await api.paymentCheckoutSession(payment.id);
      if (!mounted) return;
      _accept(
        PaymentRecord.fromJson(session['payment'] as Map<String, dynamic>),
      );
      final path = session['checkout_path'];
      if (path is! String || path.isEmpty) {
        throw ApiException('Payment link was not returned. Please retry.');
      }
      final origin = Uri.parse(AppConfig.apiBaseUrl);
      final uri = origin.resolve(path);
      if (uri.origin != origin.origin || uri.scheme != 'https') {
        throw ApiException('Payment link could not be verified.');
      }
      _checkout = uri;
      _linkCreatedAt = DateTime.now();
    } catch (error) {
      if (mounted) {
        final status = error is ApiException ? error.statusCode ?? 0 : 0;
        final detail = error is ApiException ? error.message.trim() : '';
        _error = status >= 400 && status < 500 && detail.isNotEmpty
            ? detail
            : 'Payment could not be prepared. Please retry. Your booking or order is still saved.';
      }
    } finally {
      if (mounted && !_finished) setState(() => _busy = false);
    }
  }

  Future<void> _open() async {
    final uri = _checkout;
    if (uri == null || _busy) return;
    if (_linkCreatedAt == null ||
        DateTime.now().difference(_linkCreatedAt!).inMinutes >= 14) {
      await _prepare();
      return;
    }
    // Launch directly from the tap so browsers allow the new checkout tab.
    try {
      final opened = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
        webOnlyWindowName: '_blank',
      );
      if (!mounted) return;
      if (!opened) throw Exception('Checkout unavailable');
      setState(() {
        _opened = true;
        _openedAt = DateTime.now();
        _error = null;
      });
      _poll?.cancel();
      _poll = Timer.periodic(const Duration(seconds: 8), (_) {
        if (_openedAt != null &&
            DateTime.now().difference(_openedAt!).inMinutes >= 16) {
          _poll?.cancel();
          if (mounted) {
            setState(
              () => _error = 'Payment confirmation is taking longer. Check status before retrying.',
            );
          }
        } else {
          _check();
        }
      });
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not open checkout. Allow the payment tab and retry.',
        );
      }
    }
  }

  Future<void> _check() async {
    final payment = _payment;
    if (payment == null || _busy || _finished || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await AuthService.instance.api.reconcilePayment(
        payment.id,
      );
      if (mounted) _accept(updated);
    } catch (_) {
      if (mounted) _error = 'Unable to confirm payment right now. Do not pay again until you check its status.';
    } finally {
      if (mounted && !_finished) setState(() => _busy = false);
    }
  }

  String get _status {
    switch (_payment?.status) {
      case 'FAILED':
        return 'Payment attempt failed. You can retry the same payment.';
      case 'REFUND_REQUESTED':
        return 'Refund requested. Your payment is under review.';
      case 'REFUND_PROCESSING':
        return 'Your refund is being processed.';
      case 'REFUNDED':
        return 'Payment refunded.';
      case 'PARTIALLY_REFUNDED':
        return 'Payment partially refunded.';
      case 'SUCCESS':
        return 'Payment received. Confirming your purchase...';
      default:
        return _opened
            ? 'Waiting for payment confirmation'
            : 'Ready for secure payment';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.lock_outline, size: 40),
              const SizedBox(height: 20),
              if (_payment != null)
                Text(
                  _payment!.amountLabel,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
              const SizedBox(height: 16),
              Text(_status, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              if (_busy) const LinearProgressIndicator(),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (_checkout != null && (_payment?.canResume ?? false))
                FilledButton.icon(
                  onPressed: _busy ? null : _open,
                  icon: const Icon(Icons.open_in_new),
                  label: Text(_opened ? 'Reopen checkout' : 'Pay securely'),
                ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy
                    ? null
                    : (_payment == null || _checkout == null
                          ? _prepare
                          : _check),
                icon: const Icon(Icons.refresh),
                label: Text(
                  _payment == null ? 'Retry' : 'Check payment status',
                ),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Return to app'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
