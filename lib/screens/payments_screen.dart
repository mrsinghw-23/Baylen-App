import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
import 'login_screen.dart';
import 'payment_checkout_screen.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  List<PaymentRecord> _payments = [];
  bool _loading = true;
  String? _error;
  List<Map<String, dynamic>> _refunds = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() {
        _loading = false;
        _payments = [];
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final payments = await AuthService.instance.api.payments();
      final refunds = await AuthService.instance.api.paymentRefunds();
      if (!mounted) return;
      setState(() {
        _payments = payments;
        _refunds = refunds;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _refund(PaymentRecord payment) async {
    var enteredReason = '';
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Request refund'),
        content: TextField(
          onChanged: (value) => enteredReason = value,
          maxLength: 255,
          maxLines: 3,
          decoration: const InputDecoration(labelText: 'Reason'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (enteredReason.trim().isNotEmpty) {
                Navigator.pop(dialogContext, enteredReason.trim());
              }
            },
            child: const Text('Submit'),
          ),
        ],
      ),
    );
    if (reason == null || !mounted) return;
    try {
      await AuthService.instance.api.requestRefund(
        paymentId: payment.id,
        reason: reason,
      );
      await _load();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Refund request could not be submitted. Please retry.',
            ),
          ),
        );
      }
    }
  }

  Future<void> _resume(PaymentRecord payment) async {
    await Navigator.of(context).push<PaymentRecord>(
      MaterialPageRoute(
        builder: (_) => PaymentCheckoutScreen(
          referenceType: payment.referenceType,
          referenceId: payment.referenceId,
          payment: payment,
        ),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Payments')),
          body: user == null
              ? Center(
                  child: FilledButton(
                    onPressed: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute<bool>(
                          builder: (_) => const LoginScreen(),
                        ),
                      );
                      if (mounted) _load();
                    },
                    child: const Text('Sign in'),
                  ),
                )
              : _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: TextButton.icon(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Could not load payments. Retry'),
                  ),
                )
              : _payments.isEmpty
              ? const Center(child: Text('No payments yet.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _payments.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final payment = _payments[index];
                      final refunds = _refunds
                          .where(
                            (r) => r['payment_id']?.toString() == payment.id,
                          )
                          .toList();
                      return Card(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            ListTile(
                              leading: const Icon(Icons.payments_outlined),
                              title: Text(payment.amountLabel),
                              subtitle: Text(
                                '${payment.referenceType} ${payment.referenceId}\n${payment.status.replaceAll('_', ' ')}',
                              ),
                            ),
                            for (final refund in refunds)
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 16,
                                  vertical: 8,
                                ),
                                child: Text('Refund: ${refund['status']}'),
                              ),
                            Padding(
                              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                              child: Wrap(
                                spacing: 8,
                                children: [
                                  if (payment.canResume ||
                                      payment.status == 'SUCCESS')
                                    TextButton.icon(
                                      onPressed: () => _resume(payment),
                                      icon: const Icon(Icons.refresh),
                                      label: Text(
                                        payment.canResume
                                            ? 'Pay / check status'
                                            : 'Check status',
                                      ),
                                    ),
                                  if (payment.canRequestRefund)
                                    TextButton.icon(
                                      onPressed: () => _refund(payment),
                                      icon: const Icon(
                                        Icons.assignment_return_outlined,
                                      ),
                                      label: const Text('Request refund'),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
        );
      },
    );
  }
}
