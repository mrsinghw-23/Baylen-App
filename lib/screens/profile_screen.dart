import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../config/app_config.dart';
import 'login_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Profile')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person_outline)),
                title: Text(user?.displayName ?? 'Guest'),
                subtitle: Text(
                  user == null
                      ? 'Sign in with hosted Baylen login'
                      : user.email,
                ),
              ),
              const Divider(),
              if (user == null)
                FilledButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
                    );
                  },
                  child: const Text('Sign in'),
                )
              else
                OutlinedButton(
                  onPressed: () => AuthService.instance.signOut(),
                  child: const Text('Sign out'),
                ),
              const SizedBox(height: 16),
              ListTile(
                title: const Text('API'),
                subtitle: Text(AppConfig.apiBaseUrl),
              ),
              const ListTile(
                title: Text('Account'),
                subtitle: Text('One Baylen account for shop, salon, and home service'),
              ),
            ],
          ),
        );
      },
    );
  }
}
