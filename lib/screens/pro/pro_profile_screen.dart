import 'dart:async';

import 'package:flutter/material.dart';

import '../../repositories/professional_job_scope.dart';
import '../../widgets/pro/pro_components.dart';
import '../delivery_partner/delivery_partner_kyc_screen.dart';
import 'pro_availability_schedule_screen.dart';
import 'pro_map_tab_screen.dart';

class ProProfileScreen extends StatelessWidget {
  const ProProfileScreen({
    super.key,
    this.onOpenEarnings,
    this.onSignOut,
    this.signingOut = false,
  });

  final VoidCallback? onOpenEarnings;
  final Future<void> Function()? onSignOut;
  final bool signingOut;

  @override
  Widget build(BuildContext context) {
    final store = ProfessionalJobScope.storeOf(context);
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        if (store.initialLoading && store.dashboard == null) {
          return const ProScreenState.loading();
        }
        final data = store.dashboard;
        if (data == null) {
          return ProScreenState.error(
            message: store.error ?? 'Unable to load profile',
            onRetry: store.ensureLoaded,
          );
        }

        return RefreshIndicator(
          color: kProPink,
          onRefresh: () => store.refreshQuiet(),
          child: ListView(
            padding: const EdgeInsets.all(16),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              ProCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      data.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Professional Partner',
                      style: TextStyle(color: kProTextSecondary, fontSize: 13),
                    ),
                    const SizedBox(height: 8),
                    ProStatusBadge(
                      label: data.kycRequired
                          ? (data.verificationStatus.isEmpty
                              ? 'Verification pending'
                              : data.verificationStatus)
                          : 'Verified',
                      highlight: !data.kycRequired,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              ProCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _InfoRow(label: 'Mobile', value: data.phone.isEmpty ? '—' : data.phone),
                    _InfoRow(
                      label: 'Email',
                      value: data.email.isEmpty ? '—' : data.email,
                    ),
                    _InfoRow(
                      label: 'Service zone',
                      value: data.serviceZoneLabel.isEmpty ? '—' : data.serviceZoneLabel,
                    ),
                    if (data.pincode.isNotEmpty)
                      _InfoRow(label: 'Pincode', value: data.pincode),
                    if (data.qualification.isNotEmpty)
                      _InfoRow(label: 'Qualification', value: data.qualification),
                    _InfoRow(
                      label: 'Online status',
                      value: data.isOnline
                          ? (data.isBusy ? 'Online • on a job' : 'Available for jobs')
                          : 'Offline',
                    ),
                    _InfoRow(
                      label: 'Weekly schedule',
                      value: data.availabilityScheduleConfigured
                          ? 'Configured'
                          : 'Not set',
                    ),
                    _InfoRow(label: 'Rating', value: data.rating.toStringAsFixed(1)),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              ProCard(
                onTap: () async {
                  final saved = await Navigator.of(context).push<bool>(
                    MaterialPageRoute<bool>(
                      builder: (_) => ProfessionalJobScope.wrapRoute(
                        context,
                        const ProAvailabilityScheduleScreen(),
                      ),
                    ),
                  );
                  if (saved == true && context.mounted) {
                    await store.refreshQuiet();
                  }
                },
                child: const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.schedule_outlined, color: kProPink),
                  title: Text('Weekly availability', style: TextStyle(color: Colors.white)),
                  trailing: Icon(Icons.chevron_right, color: kProTextSecondary),
                ),
              ),
              const SizedBox(height: 10),
              ProCard(
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => const DeliveryPartnerKycScreen(),
                    ),
                  );
                },
                child: const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.verified_user_outlined, color: kProPink),
                  title: Text('KYC & documents', style: TextStyle(color: Colors.white)),
                  trailing: Icon(Icons.chevron_right, color: kProTextSecondary),
                ),
              ),
              const SizedBox(height: 10),
              ProCard(
                onTap: onOpenEarnings,
                child: const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.payments_outlined, color: kProPink),
                  title: Text('Earnings', style: TextStyle(color: Colors.white)),
                  trailing: Icon(Icons.chevron_right, color: kProTextSecondary),
                ),
              ),
              const SizedBox(height: 10),
              ProCard(
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (ctx) => ProfessionalJobScope.wrapRoute(
                        context,
                        const ProMapTabScreen(enabled: true),
                      ),
                    ),
                  );
                },
                child: const ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.map_outlined, color: kProPink),
                  title: Text('Live map', style: TextStyle(color: Colors.white)),
                  trailing: Icon(Icons.chevron_right, color: kProTextSecondary),
                ),
              ),
              const SizedBox(height: 20),
              ProPrimaryButton(
                label: signingOut ? 'Signing out…' : 'Sign out',
                onPressed: signingOut || onSignOut == null
                    ? null
                    : () => unawaited(onSignOut!()),
              ),
              if (store.error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(store.error!, style: const TextStyle(color: Colors.redAccent)),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(label, style: const TextStyle(color: kProTextSecondary)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }
}
