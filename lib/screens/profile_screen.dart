import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../config/app_config.dart';
import '../widgets/offline_account_banner.dart';
import 'addresses_screen.dart';
import 'admin_screen.dart';
import 'bookings_screen.dart';
import 'cart_screen.dart';
import '../screens/auth/role_picker_screen.dart';
import 'notification_preferences_screen.dart';
import 'notifications_screen.dart';
import 'orders_screen.dart';
import 'payments_screen.dart';
import 'profile_edit_screen.dart';
import 'profile_setup_screen.dart';
import 'provider_screen.dart';
import 'wishlist_screen.dart';

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
              const OfflineAccountBanner(),
              _ProfileHeader(user: user),
              const SizedBox(height: 14),
              if (user == null)
                FilledButton.icon(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const RolePickerScreen(),
                      ),
                    );
                  },
                  icon: const Icon(Icons.login),
                  label: const Text('Login / Register'),
                )
              else ...[
                if (!user.isProfileComplete)
                  Container(
                    margin: const EdgeInsets.only(bottom: 14),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFF1B78).withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: const Color(0xFFFF1B78).withValues(alpha: 0.4),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Row(
                          children: [
                            Icon(
                              Icons.warning_amber_rounded,
                              color: Color(0xFFFF1B78),
                              size: 20,
                            ),
                            SizedBox(width: 8),
                            Text(
                              'Profile Registration Incomplete',
                              style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text(
                          'Complete your profile to unlock orders, appointments, cart, and exclusive membership benefits.',
                          style: TextStyle(
                            color: Color(0xFFAAA4B6),
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 10),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: const Color(0xFFFF1B78),
                            ),
                            onPressed: () {
                              Navigator.of(context).push(
                                MaterialPageRoute<bool>(
                                  builder: (_) => ProfileSetupScreen(
                                    mobile: user.mobile,
                                    initialFirstName: user.firstName,
                                    initialLastName: user.lastName,
                                    initialEmail: user.email,
                                  ),
                                ),
                              );
                            },
                            child: const Text('Complete Profile Now'),
                          ),
                        ),
                      ],
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: () => AuthService.instance.signOut(),
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                ),
              ],
              const SizedBox(height: 18),
              _ProfileGroup(
                title: 'Account center',
                children: [
                  _ProfileAction(
                    icon: Icons.manage_accounts_outlined,
                    label: 'Profile details',
                    onTap: () => _open(context, const ProfileEditScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.shopping_bag_outlined,
                    label: 'My orders',
                    onTap: () => _open(context, const OrdersScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.event_available_outlined,
                    label: 'My bookings',
                    onTap: () => _open(context, const BookingsScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.location_on_outlined,
                    label: 'My addresses',
                    onTap: () => _open(context, const AddressesScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.favorite_border,
                    label: 'Wishlist',
                    onTap: () => _open(context, const WishlistScreen()),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _ProfileGroup(
                title: 'Payments and alerts',
                children: [
                  _ProfileAction(
                    icon: Icons.payments_outlined,
                    label: 'Payments',
                    onTap: () => _open(context, const PaymentsScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.notifications_outlined,
                    label: 'Notifications',
                    onTap: () => _open(context, const NotificationsScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.tune_outlined,
                    label: 'Alert preferences',
                    onTap: () =>
                        _open(context, const NotificationPreferencesScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.shopping_cart_outlined,
                    label: 'Cart',
                    onTap: () => _open(context, const CartScreen()),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _ProfileGroup(
                title: 'Business management',
                children: [
                  _ProfileAction(
                    icon: Icons.engineering_outlined,
                    label: 'Technician / Provider portal',
                    onTap: () => _open(context, const ProviderScreen()),
                  ),
                  _ProfileAction(
                    icon: Icons.admin_panel_settings_outlined,
                    label: 'Admin panel',
                    onTap: () => _open(context, const AdminScreen()),
                  ),
                ],
              ),

              const SizedBox(height: 14),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'API',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        AppConfig.apiBaseUrl,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: const Color(0xFFAAA4B6)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  static void _open(BuildContext context, Widget screen) {
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }
}

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.user});

  final AuthUser? user;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.45),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: Theme.of(context).colorScheme.primary
                .withValues(alpha: 0.18),
            child: Icon(
              Icons.person_outline,
              color: Theme.of(context).colorScheme.primary,
              size: 30,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  user?.displayName ?? 'Guest',
                  style: Theme.of(context).textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                Text(
                  user == null
                      ? 'Browse Home, Shop, Salon, and Service as guest.'
                      : user!.email,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodyMedium
                      ?.copyWith(color: const Color(0xFFAAA4B6)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileGroup extends StatelessWidget {
  const _ProfileGroup({required this.title, required this.children});

  final String title;
  final List<_ProfileAction> children;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 6),
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: Theme.of(context).colorScheme.primary,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          for (var i = 0; i < children.length; i++) ...[
            children[i],
            if (i != children.length - 1) const Divider(height: 1),
          ],
        ],
      ),
    );
  }
}

class _ProfileAction extends StatelessWidget {
  const _ProfileAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: Theme.of(context).colorScheme.primary),
      title: Text(label),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}
