import 'package:flutter/material.dart';

import '../auth/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  String? _error;
  bool _opening = false;

  Future<void> _signIn() async {
    setState(() {
      _opening = true;
      _error = null;
    });
    try {
      await AuthService.instance.startHostedLogin();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _opening = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _openHostedPage() async {
    try {
      await AuthService.instance.openHostedLoginPage();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign in')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 24),
            Text(
              'Baylen',
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Use the hosted Baylen login. One account for shop, salon, and home service.',
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _opening ? null : _signIn,
              child: Text(_opening ? 'Opening login…' : 'Continue with Baylen'),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: _openHostedPage,
              child: const Text('Open hosted sign-up page'),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}
