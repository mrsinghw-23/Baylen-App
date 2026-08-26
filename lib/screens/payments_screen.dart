import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
import 'login_screen.dart';

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});

  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  List<PaymentRecord> _payments = [];
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
      if (!mounted) return;
      setState(() {
        _payments = payments;
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
              ? Center(child: Text(_error!))
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
                      return Card(
                        child: ListTile(
                          leading: const Icon(Icons.payments_outlined),
                          title: Text(payment.amountLabel),
                          subtitle: Text(
                            '${payment.referenceType} ${payment.referenceId}',
                          ),
                          trailing: Text(payment.status),
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
