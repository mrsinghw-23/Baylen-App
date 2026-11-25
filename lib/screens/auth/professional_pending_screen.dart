import 'package:flutter/material.dart';

import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/professional_auth_exit.dart';
import '../../auth/professional_onboarding.dart';
import '../../models/delivery_partner_kyc.dart';
import '../../widgets/pro/pro_components.dart';
import '../delivery_partner/delivery_partner_kyc_screen.dart';

/// Shown when KYC is submitted and awaiting admin approval.
class ProfessionalPendingScreen extends StatefulWidget {
  const ProfessionalPendingScreen({
    super.key,
    required this.kyc,
    this.onSignedOut,
  });

  final DeliveryPartnerKyc kyc;
  final VoidCallback? onSignedOut;

  @override
  State<ProfessionalPendingScreen> createState() =>
      _ProfessionalPendingScreenState();
}

class _ProfessionalPendingScreenState extends State<ProfessionalPendingScreen> {
  bool _refreshing = false;
  DeliveryPartnerKyc? _kyc;

  @override
  void initState() {
    super.initState();
    _kyc = widget.kyc;
  }

  Future<void> _refreshStatus() async {
    setState(() => _refreshing = true);
    try {
      final kyc =
          await DeliveryPartnerAuthService.instance.api.fetchDeliveryPartnerKyc();
      if (!mounted) return;
      setState(() {
        _kyc = kyc;
        _refreshing = false;
      });
      if (kyc.operational) {
        await ProfessionalOnboarding.navigateAfterOtp(context);
      }
    } catch (_) {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final kyc = _kyc ?? widget.kyc;
    final rejected = kyc.isRejected;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Verification status'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            onPressed: () async {
              if (widget.onSignedOut != null) {
                widget.onSignedOut!();
                return;
              }
              await ProfessionalAuthExit.signOutAndReturnToLogin(context);
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      rejected ? Icons.error_outline : Icons.hourglass_top,
                      color: rejected ? Colors.redAccent : kProPink,
                      size: 32,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        rejected ? 'Verification rejected' : 'Under review',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                ProStatusBadge(label: kyc.partnerStatusLabel),
                const SizedBox(height: 12),
                Text(
                  rejected
                      ? 'Your documents need updates before you can receive jobs.'
                      : 'Your KYC has been submitted. An admin will review your documents before activating your Professional account.',
                  style: const TextStyle(color: kProTextSecondary),
                ),
                if (kyc.rejectionReason.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Text(
                    'Reason: ${kyc.rejectionReason}',
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                ],
                if (kyc.submittedAt.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Submitted ${kyc.submittedAt}',
                    style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (rejected)
            ProPrimaryButton(
              label: 'Update KYC documents',
              onPressed: () {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute<void>(
                    builder: (_) => const DeliveryPartnerKycScreen(),
                  ),
                );
              },
            )
          else
            ProPrimaryButton(
              label: _refreshing ? 'Checking status…' : 'Refresh status',
              loading: _refreshing,
              onPressed: _refreshing ? null : _refreshStatus,
            ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const DeliveryPartnerKycScreen(),
                ),
              );
            },
            child: const Text('View submitted KYC'),
          ),
        ],
      ),
    );
  }
}
