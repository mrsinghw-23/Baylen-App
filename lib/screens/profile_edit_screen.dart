import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/account.dart';
import 'login_screen.dart';

class ProfileEditScreen extends StatefulWidget {
  const ProfileEditScreen({super.key});

  @override
  State<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends State<ProfileEditScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullName = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _gender = TextEditingController();
  final _dateOfBirth = TextEditingController();
  final _profilePhotoUrl = TextEditingController();

  UserProfile? _profile;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _fullName.dispose();
    _mobile.dispose();
    _email.dispose();
    _gender.dispose();
    _dateOfBirth.dispose();
    _profilePhotoUrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final profile = await AuthService.instance.api.profile();
      if (!mounted) return;
      _profile = profile;
      _fullName.text = profile.fullName;
      _mobile.text = profile.mobile;
      _email.text = profile.email;
      _gender.text = profile.gender;
      _dateOfBirth.text = profile.dateOfBirth;
      _profilePhotoUrl.text = profile.profilePhotoUrl;
      setState(() => _loading = false);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final valid = _formKey.currentState?.validate() ?? false;
    if (!valid) {
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final profile = await AuthService.instance.api.updateProfile(
        fullName: _fullName.text.trim(),
        mobile: _mobile.text.trim(),
        email: _email.text.trim(),
        gender: _gender.text.trim(),
        dateOfBirth: _dateOfBirth.text.trim(),
        profilePhotoUrl: _profilePhotoUrl.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _profile = profile;
        _saving = false;
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Profile updated')));
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!AuthService.instance.isSignedIn)
            _SignInRequired(onSignedIn: _load)
          else if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 64),
              child: Center(child: CircularProgressIndicator()),
            )
          else
            Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _CompletionCard(profile: _profile),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _fullName,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Full name',
                      hintText: 'Enter your full name',
                      prefixIcon: Icon(Icons.person_outline),
                    ),
                    validator: (value) {
                      if ((value ?? '').trim().isEmpty) {
                        return 'Full name is required';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _mobile,
                    keyboardType: TextInputType.phone,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Mobile number',
                      hintText: 'Enter your mobile number',
                      prefixIcon: Icon(Icons.phone_outlined),
                    ),
                    validator: (value) {
                      final text = (value ?? '').trim();
                      if (text.isEmpty) {
                        return 'Mobile number is required';
                      }
                      if (text.length < 8) {
                        return 'Enter a valid mobile number';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Email address',
                      hintText: 'Enter your email address',
                      prefixIcon: Icon(Icons.email_outlined),
                    ),
                    validator: (value) {
                      final text = (value ?? '').trim();
                      if (text.isEmpty) {
                        return 'Email address is required';
                      }
                      if (!text.contains('@') || !text.contains('.')) {
                        return 'Enter a valid email address';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _gender,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Gender',
                      hintText: 'Enter your gender (e.g. Female, Male, Other)',
                      prefixIcon: Icon(Icons.badge_outlined),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _dateOfBirth,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      labelText: 'Date of birth',
                      hintText: 'Enter date of birth (YYYY-MM-DD)',
                      prefixIcon: Icon(Icons.cake_outlined),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _profilePhotoUrl,
                    textInputAction: TextInputAction.done,
                    decoration: const InputDecoration(
                      labelText: 'Profile photo URL',
                      hintText: 'Enter profile photo URL (optional)',
                      prefixIcon: Icon(Icons.image_outlined),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: Text(_saving ? 'Saving...' : 'Save profile'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _CompletionCard extends StatelessWidget {
  const _CompletionCard({required this.profile});

  final UserProfile? profile;

  @override
  Widget build(BuildContext context) {
    final completed = [
      profile?.fullName.isNotEmpty == true,
      profile?.mobile.isNotEmpty == true,
      profile?.email.isNotEmpty == true,
    ].where((item) => item).length;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.45),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.verified_user_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Account completion',
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text('$completed of 3 required profile fields complete'),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SignInRequired extends StatelessWidget {
  const _SignInRequired({required this.onSignedIn});

  final VoidCallback onSignedIn;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              Icons.lock_outline,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(height: 12),
            Text(
              'Sign in required',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 8),
            const Text('Profile details are protected account data.'),
            const SizedBox(height: 18),
            FilledButton(
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
                );
                onSignedIn();
              },
              child: const Text('Login / Register'),
            ),
          ],
        ),
      ),
    );
  }
}
