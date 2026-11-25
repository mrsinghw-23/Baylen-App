import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import '../../state/professional_dashboard_store.dart';
import '../../widgets/pro/pro_components.dart';
import 'pro_job_flow.dart';

/// Product orders — third-party integration placeholder (no dummy orders).
class ProOrdersTabScreen extends StatelessWidget {
  const ProOrdersTabScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ProCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: kProPink.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.hub_outlined, color: kProPink, size: 28),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'No Product Orders Yet',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text(
                'Product orders will appear here when the order integration is connected.',
                style: TextStyle(color: kProTextSecondary, height: 1.4),
              ),
              const SizedBox(height: 20),
              ProPrimaryButton(
                label: 'Connect Order Integration',
                onPressed: () => _showIntegrationSheet(context),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () {
                  Clipboard.setData(
                    const ClipboardData(
                      text: 'POST /v1/integrations/orders/webhook',
                    ),
                  );
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Webhook path copied')),
                  );
                },
                child: const Text('Copy webhook endpoint'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const ProCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Architecture notes',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 8),
              Text(
                '• Supports third-party and future internal order sources\n'
                '• Orders route through Professional_Jobs when dispatched\n'
                '• Location-based partner matching applies automatically',
                style: TextStyle(color: kProTextSecondary, height: 1.5, fontSize: 13),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showIntegrationSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: kProCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Connect order source',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const Text(
              'Contact your Baylen administrator to enable a third-party commerce or OMS webhook. '
              'Once connected, eligible delivery orders will appear here for professionals in the matching state and district.',
              style: TextStyle(color: kProTextSecondary, height: 1.4),
            ),
            const SizedBox(height: 20),
            ProPrimaryButton(
              label: 'Got it',
              onPressed: () => Navigator.of(context).pop(),
            ),
          ],
        ),
      ),
    );
  }
}

class ProServicesTabScreen extends StatefulWidget {
  const ProServicesTabScreen({super.key, required this.enabled});

  final bool enabled;

  @override
  State<ProServicesTabScreen> createState() => _ProServicesTabScreenState();
}

class _ProServicesTabScreenState extends State<ProServicesTabScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging) {
        setState(() {});
      }
    });
    if (widget.enabled) {
      ProfessionalJobScope.scheduleLoad(() {
        ProfessionalJobScope.storeOf(context).ensureLoaded();
      });
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _accept(ProfessionalJobOffer offer) async {
    final store = ProfessionalJobScope.storeOf(context);
    if (store.busyJobId != null) return;
    final result = await store.acceptHomeService(offer);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          result.success
              ? (result.message.isEmpty ? 'Service accepted' : result.message)
              : (result.message.isEmpty ? 'Could not accept offer' : result.message),
        ),
      ),
    );
    if (result.success) {
      await ProJobFlow.openOfferDetail(context, offer);
    }
  }

  Future<void> _reject(ProfessionalJobOffer offer) async {
    final store = ProfessionalJobScope.storeOf(context);
    if (store.busyJobId != null) return;
    final reason = await showProRejectReasonSheet(context);
    if (reason == null || !mounted) return;
    final result = await store.rejectHomeService(offer, reason: reason);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(result.success ? 'Offer declined' : result.message)),
    );
  }

  bool _isBusy(String jobId, String action) {
    final store = ProfessionalJobScope.storeOf(context);
    return store.busyJobId == jobId && store.busyAction == action;
  }

  List<ProfessionalJobOffer> _visibleOffers(ProfessionalDashboardStore store) =>
      _tabs.index == 1 ? store.offeredHome : const <ProfessionalJobOffer>[];

  List<ProfessionalJobSummary> _visibleSummaries(ProfessionalDashboardStore store) {
    if (_tabs.index == 0) return store.activeHome;
    if (_tabs.index == 2) return store.completedHome;
    if (_tabs.index == 3) return store.cancelledHome;
    return const <ProfessionalJobSummary>[];
  }

  String get _emptyMessage {
    switch (_tabs.index) {
      case 0:
        return 'No Active Services';
      case 1:
        return 'No upcoming service assignments.';
      case 2:
        return 'No completed home service jobs yet';
      default:
        return 'No cancelled services';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled) {
      return const ProScreenState.empty(message: 'Complete KYC to receive home service jobs');
    }
    final store = ProfessionalJobScope.storeOf(context);
    if (store.initialLoading && store.offeredHome.isEmpty && store.activeHome.isEmpty) {
      return const ProScreenState.loading();
    }
    if (store.error != null && store.offeredHome.isEmpty && store.activeHome.isEmpty) {
      return ProScreenState.error(
        message: store.error!,
        onRetry: () => store.refreshQuiet(),
      );
    }
    final offers = _visibleOffers(store);
    final summaries = _visibleSummaries(store);

    return Column(
      children: [
        TabBar(
          controller: _tabs,
          isScrollable: true,
          indicatorColor: kProPink,
          labelColor: kProPink,
          unselectedLabelColor: kProTextSecondary,
          tabs: [
            Tab(text: 'Active (${store.activeHome.length})'),
            Tab(text: 'Upcoming (${store.offeredHome.length})'),
            Tab(text: 'Completed (${store.completedHome.length})'),
            Tab(text: 'Cancelled (${store.cancelledHome.length})'),
          ],
        ),
        Expanded(
          child: RefreshIndicator(
            color: kProPink,
            onRefresh: () => store.refreshQuiet(),
            child: offers.isEmpty && summaries.isEmpty
                ? ListView(
                    physics: const AlwaysScrollableScrollPhysics(),
                    children: [
                      const SizedBox(height: 48),
                      ProScreenState.empty(
                        message: _emptyMessage,
                        onRetry: () => store.refreshQuiet(),
                      ),
                    ],
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _tabs.index == 1 ? offers.length : summaries.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      if (_tabs.index == 1) {
                        final offer = offers[index];
                        return _ServiceJobCard(
                          title: offer.title,
                          customerName: offer.customerName,
                          subtitle: offer.subtitle,
                          distanceKm: offer.distanceKm,
                          amount: offer.amount,
                          showActions: true,
                          busyAccept: _isBusy(offer.id, 'accept'),
                          busyReject: _isBusy(offer.id, 'reject'),
                          onAccept: () => _accept(offer),
                          onReject: () => _reject(offer),
                          onDetails: () => ProJobFlow.openOfferDetail(context, offer),
                        );
                      }
                      final job = summaries[index];
                      return _ServiceJobCard(
                        title: job.title,
                        customerName: '',
                        subtitle: job.subtitle,
                        distanceKm: job.distanceKm,
                        amount: job.amount,
                        showActions: false,
                        busyAccept: false,
                        busyReject: false,
                        onAccept: () {},
                        onReject: () {},
                        onDetails: () => ProJobFlow.openJobDetail(
                          context,
                          job.id,
                          ProfessionalJobType.homeService,
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}

class _ServiceJobCard extends StatelessWidget {
  const _ServiceJobCard({
    required this.title,
    required this.customerName,
    required this.subtitle,
    required this.distanceKm,
    required this.amount,
    required this.showActions,
    required this.busyAccept,
    required this.busyReject,
    required this.onAccept,
    required this.onReject,
    required this.onDetails,
  });

  final String title;
  final String customerName;
  final String subtitle;
  final double distanceKm;
  final double amount;
  final bool showActions;
  final bool busyAccept;
  final bool busyReject;
  final VoidCallback onAccept;
  final VoidCallback onReject;
  final VoidCallback onDetails;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              ListenableBuilder(
                listenable: ProfessionalJobScope.storeOf(context),
                builder: (context, _) {
                  final store = ProfessionalJobScope.storeOf(context);
                  final profile = store.dashboard;
                  if (profile != null && (profile.hasProfilePhoto || store.profilePhotoBytes != null)) {
                    return ProPartnerAvatar(
                      name: profile.displayName,
                      photoUrl: profile.profilePhotoUrl,
                      photoBytes: store.profilePhotoBytes,
                      radius: 20,
                    );
                  }
                  return CircleAvatar(
                    backgroundColor: kProSurface,
                    child: Text(
                      customerName.isNotEmpty ? customerName[0] : 'S',
                    ),
                  );
                },
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                    if (customerName.isNotEmpty)
                      Text(customerName, style: const TextStyle(color: kProTextSecondary)),
                    Text(
                      subtitle,
                      style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      '${distanceKm.toStringAsFixed(1)} km • ₹${amount.toStringAsFixed(0)}',
                      style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (showActions) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(onPressed: onDetails, child: const Text('Details')),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    onPressed: busyReject ? null : onReject,
                    child: busyReject
                        ? const SizedBox(
                            height: 16,
                            width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2, color: kProPink),
                          )
                        : const Text('Decline'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ProPrimaryButton(
                    label: busyAccept ? 'Accepting…' : 'Accept',
                    fullWidth: true,
                    onPressed: busyAccept ? null : onAccept,
                  ),
                ),
              ],
            ),
          ] else ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(onPressed: onDetails, child: const Text('View job')),
            ),
          ],
        ],
      ),
    );
  }
}
