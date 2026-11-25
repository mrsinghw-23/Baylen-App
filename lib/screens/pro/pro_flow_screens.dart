import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import '../../auth/delivery_partner_auth_service.dart';
import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import '../../services/professional_tracking_service.dart';
import '../../widgets/at_home_beauty_map.dart';
import '../../widgets/pro/pro_components.dart';
import 'pro_job_flow.dart';

class ProProductDetailScreen extends StatefulWidget {
  const ProProductDetailScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProProductDetailScreen> createState() => _ProProductDetailScreenState();
}

class _ProProductDetailScreenState extends State<ProProductDetailScreen> {
  ProfessionalJobDetail? _detail;
  bool _loading = true;
  bool _accepting = false;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() {
      _detail = detail;
      _loading = false;
    });
  }

  Future<void> _accept() async {
    if (_accepting) return;
    setState(() => _accepting = true);
    final result = await ProfessionalJobScope.of(context).acceptJob(widget.jobId);
    if (!mounted) return;
    setState(() => _accepting = false);
    if (result.success) {
      ProfessionalJobScope.maybeStoreOf(context)?.onJobAccepted(widget.jobId);
      await _load();
      if (!mounted) return;
      await ProJobFlow.openProductPickupFlow(context, widget.jobId);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: ProScreenState.loading());
    }
    final detail = _detail!;
    return Scaffold(
      appBar: AppBar(title: const Text('Order details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(detail.title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text(detail.referenceLabel, style: const TextStyle(color: kProTextSecondary)),
                const SizedBox(height: 8),
                ProStatusBadge(label: '₹${detail.amount.toStringAsFixed(0)}', highlight: true),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Column(
              children: detail.items
                  .map(
                    (item) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(child: Text(item.name, style: const TextStyle(color: Colors.white))),
                          Text('×${item.quantity}', style: const TextStyle(color: kProTextSecondary)),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Column(
              children: [
                ProLocationRow(
                  icon: Icons.storefront_outlined,
                  title: detail.pickupTitle,
                  subtitle: detail.pickupAddress,
                ),
                const Divider(color: kProOutline),
                ProLocationRow(
                  icon: Icons.home_outlined,
                  title: detail.dropTitle,
                  subtitle: detail.dropAddress,
                ),
              ],
            ),
          ),
          if (detail.notes.isNotEmpty) ...[
            const SizedBox(height: 12),
            ProCard(
              child: Text('Notes: ${detail.notes}', style: const TextStyle(color: kProTextSecondary)),
            ),
          ],
          const SizedBox(height: 16),
          if (detail.canAccept)
            ProPrimaryButton(
              label: _accepting ? 'Accepting…' : 'Accept order',
              onPressed: _accepting ? null : _accept,
            ),
          if (detail.canStartPickup || detail.phase == ProfessionalJobPhase.accepted)
            ProPrimaryButton(
              label: 'Start pickup',
              onPressed: () => ProJobFlow.openProductPickupFlow(context, widget.jobId),
            ),
        ],
      ),
    );
  }
}

class ProHomeServiceDetailScreen extends StatefulWidget {
  const ProHomeServiceDetailScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProHomeServiceDetailScreen> createState() => _ProHomeServiceDetailScreenState();
}

class _ProHomeServiceDetailScreenState extends State<ProHomeServiceDetailScreen> {
  ProfessionalJobDetail? _detail;
  bool _loading = true;
  bool _accepting = false;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() {
      _detail = detail;
      _loading = false;
    });
  }

  Future<void> _accept() async {
    if (_accepting) return;
    setState(() => _accepting = true);
    final result = await ProfessionalJobScope.of(context).acceptJob(widget.jobId);
    if (!mounted) return;
    setState(() => _accepting = false);
    if (result.success) {
      ProfessionalJobScope.maybeStoreOf(context)?.onJobAccepted(widget.jobId);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message.isEmpty ? 'Service accepted' : result.message)),
      );
      await _load();
      if (!mounted) return;
      await ProJobFlow.openHomeServicePrep(context, widget.jobId);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message.isEmpty ? 'Could not accept offer' : result.message)),
      );
      await _load();
    }
  }

  Future<void> _reject() async {
    final reason = await showProRejectReasonSheet(context);
    if (reason == null || !mounted) return;
    final result = await ProfessionalJobScope.of(context).rejectJob(widget.jobId, reason: reason);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(result.success ? 'Offer declined' : result.message)),
    );
    if (result.success) {
      Navigator.of(context).pop();
    } else {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: ProScreenState.loading());
    final detail = _detail!;
    return Scaffold(
      appBar: AppBar(title: const Text('Service details')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListenableBuilder(
            listenable: ProfessionalJobScope.storeOf(context),
            builder: (context, _) {
              final store = ProfessionalJobScope.storeOf(context);
              final profile = store.dashboard;
              return ProCard(
                child: Row(
                  children: [
                    ProPartnerAvatar(
                      name: profile?.displayName ?? 'Professional',
                      photoUrl: profile?.profilePhotoUrl ?? '',
                      photoBytes: store.profilePhotoBytes,
                      radius: 24,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            profile?.displayName ?? 'Professional',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const Text(
                            'Assigned professional',
                            style: TextStyle(color: kProTextSecondary, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(detail.title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text(detail.customerName, style: const TextStyle(color: kProTextSecondary)),
                Text(detail.customerPhone, style: const TextStyle(color: kProTextSecondary)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: ProLocationRow(
              icon: Icons.location_on_outlined,
              title: detail.dropTitle,
              subtitle: '${detail.dropAddress}\n${detail.distanceKm.toStringAsFixed(1)} km away',
            ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Service includes', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                ...detail.items.map(
                  (item) => ProChecklistItem(label: item.name, done: true),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (detail.canAccept)
            ProPrimaryButton(
              label: _accepting ? 'Accepting…' : 'Accept service',
              onPressed: _accepting ? null : _accept,
            ),
          if (detail.canReject) ...[
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _accepting ? null : _reject,
              child: const Text('Decline offer'),
            ),
          ],
          if (detail.offerExpired)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                'This offer has expired.',
                style: TextStyle(color: kProTextSecondary),
              ),
            ),
          if (detail.phase == ProfessionalJobPhase.accepted)
            ProPrimaryButton(
              label: 'Continue to prep',
              onPressed: () => ProJobFlow.openHomeServicePrep(context, widget.jobId),
            ),
        ],
      ),
    );
  }
}

class ProProductNavigationScreen extends StatefulWidget {
  const ProProductNavigationScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProProductNavigationScreen> createState() => _ProProductNavigationScreenState();
}

class _ProProductNavigationScreenState extends State<ProProductNavigationScreen> {
  LivePosition? _pos;
  ProfessionalJobDetail? _detail;
  String? _trackingError;
  Timer? _refreshTimer;
  StreamSubscription<Position>? _gpsSub;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_bootstrap);
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _gpsSub?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() => _detail = detail);

    if (detail.canStartPickup || detail.phase == ProfessionalJobPhase.accepted) {
      final result = await ProfessionalJobScope.of(context).startPickup(widget.jobId);
      if (!mounted) return;
      if (!result.success) {
        setState(() => _trackingError = result.message);
        return;
      }
    } else if ((detail.phase == ProfessionalJobPhase.pickup ||
            detail.phase == ProfessionalJobPhase.enRoute) &&
        !ProfessionalTrackingService.instance.isTracking) {
      try {
        await ProfessionalTrackingService.instance.startTracking(
          api: DeliveryPartnerAuthService.instance.api,
          jobId: widget.jobId,
        );
      } on TrackingException catch (error) {
        if (!mounted) return;
        setState(() {
          _trackingError = ProfessionalTrackingService.permissionMessage(error.permissionState);
        });
      }
    }

    await _load();
    _refreshTimer = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    _gpsSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20),
    ).listen((_) {
      if (mounted) {
        _load();
      }
    });
  }

  Future<void> _load() async {
    try {
      final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
      final pos = await ProfessionalJobScope.of(context).fetchLivePosition(widget.jobId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _pos = pos;
        _trackingError = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _trackingError = error.toString());
    }
  }

  Future<void> _advanceFlow() async {
    final detail = _detail;
    if (detail == null) return;
    final scope = ProfessionalJobScope.of(context);
    if (detail.canConfirmPickupArrival) {
      final result = await scope.confirmPickupArrival(widget.jobId);
      if (!mounted) return;
      if (result.success) {
        await ProJobFlow.openProductPickupOtp(context, widget.jobId);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
      }
      return;
    }
    if (detail.canConfirmPickedUp) {
      final result = await scope.confirmPickedUp(widget.jobId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
      await _load();
      return;
    }
    if (detail.canStartDelivery) {
      final result = await scope.startDelivery(widget.jobId);
      if (!mounted) return;
      if (result.success) await _load();
      return;
    }
    if (detail.canConfirmDeliveryArrival) {
      final result = await scope.confirmDeliveryArrival(widget.jobId);
      if (!mounted) return;
      if (result.success) {
        await ProJobFlow.openProductDeliveryOtp(context, widget.jobId);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
      }
      return;
    }
    if (detail.canConfirmDelivered) {
      final result = await scope.confirmDelivered(widget.jobId);
      if (!mounted) return;
      if (result.success) {
        await ProJobFlow.openProductCompletion(context, widget.jobId);
      }
    }
  }

  String _primaryActionLabel(ProfessionalJobDetail detail) {
    if (detail.canConfirmPickupArrival) return 'Confirm pickup arrival';
    if (detail.canConfirmPickedUp) return 'Confirm picked up';
    if (detail.canStartDelivery) return 'Start delivery';
    if (detail.canConfirmDeliveryArrival) return 'Confirm customer arrival';
    if (detail.canConfirmDelivered) return 'Mark delivered';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final trackingActive = ProfessionalTrackingService.instance.isTracking;
    return Scaffold(
      appBar: AppBar(title: const Text('En route')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ProCard(
            child: _pos == null
                ? const SizedBox(
                    height: 240,
                    child: Center(child: CircularProgressIndicator()),
                  )
                : AtHomeBeautyMap(
                    customerLat: detail?.destinationLatitude ?? _pos!.latitude,
                    customerLng: detail?.destinationLongitude ?? _pos!.longitude,
                    outlets: const [],
                    providerLat: _pos!.latitude,
                    providerLng: _pos!.longitude,
                    showProvider: true,
                    height: 240,
                  ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trackingActive ? 'Live location active' : 'Starting live location…',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                ),
                if (_pos != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    '${_pos!.latitude.toStringAsFixed(5)}, ${_pos!.longitude.toStringAsFixed(5)}',
                    style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                  ),
                  if (_pos!.distanceKm > 0)
                    Text(
                      '${_pos!.distanceKm.toStringAsFixed(1)} km • ${_pos!.etaMinutes > 0 ? '${_pos!.etaMinutes} min ETA' : 'ETA unavailable'}',
                      style: const TextStyle(color: kProTextSecondary),
                    ),
                ],
                if (_trackingError != null) ...[
                  const SizedBox(height: 8),
                  Text(_trackingError!, style: const TextStyle(color: Colors.orangeAccent)),
                ],
                if (detail != null) ...[
                  const SizedBox(height: 8),
                  Text(detail.dropAddress, style: const TextStyle(color: kProTextSecondary)),
                ],
                if (detail != null && _primaryActionLabel(detail).isNotEmpty) ...[
                  const SizedBox(height: 16),
                  ProPrimaryButton(
                    label: _primaryActionLabel(detail),
                    onPressed: _advanceFlow,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class ProProductOtpScreen extends StatefulWidget {
  const ProProductOtpScreen({
    super.key,
    required this.jobId,
    required this.pickup,
  });

  final String jobId;
  final bool pickup;

  @override
  State<ProProductOtpScreen> createState() => _ProProductOtpScreenState();
}

class _ProProductOtpScreenState extends State<ProProductOtpScreen> {
  final _otp = TextEditingController();
  String? _error;
  bool _verifying = false;

  @override
  void dispose() {
    _otp.dispose();
    super.dispose();
  }

  Future<void> _verify() async {
    setState(() {
      _verifying = true;
      _error = null;
    });
    final otp = _otp.text.trim();
    if (otp.length != 6) {
      setState(() {
        _verifying = false;
        _error = 'Enter the 6-digit verification code';
      });
      return;
    }
    final scope = ProfessionalJobScope.of(context);
    final result = widget.pickup
        ? await scope.verifyPickupOtp(widget.jobId, otp)
        : await scope.verifyDeliveryOtp(widget.jobId, otp);
    if (!mounted) return;
    if (!result.success) {
      setState(() {
        _verifying = false;
        _error = result.message.isEmpty ? 'Invalid code' : result.message;
      });
      return;
    }
    if (widget.pickup) {
      final picked = await scope.confirmPickedUp(widget.jobId);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(picked.message)));
      Navigator.of(context).popUntil((route) => route.isFirst);
    } else {
      final delivered = await scope.confirmDelivered(widget.jobId);
      if (!mounted) return;
      if (delivered.success) {
        await ProJobFlow.openProductCompletion(context, widget.jobId);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.pickup ? 'Verify pickup' : 'Verify delivery'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.pickup ? 'Enter store pickup code' : 'Enter customer delivery OTP',
              style: const TextStyle(color: kProTextSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _otp,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: InputDecoration(
                labelText: '6-digit code',
                errorText: _error,
              ),
            ),
            const SizedBox(height: 16),
            ProPrimaryButton(
              label: _verifying ? 'Verifying…' : 'Verify',
              onPressed: _verifying ? null : _verify,
            ),
          ],
        ),
      ),
    );
  }
}

class ProDeliveryCompletionScreen extends StatefulWidget {
  const ProDeliveryCompletionScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProDeliveryCompletionScreen> createState() => _ProDeliveryCompletionScreenState();
}

class _ProDeliveryCompletionScreenState extends State<ProDeliveryCompletionScreen> {
  ProfessionalJobDetail? _detail;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() => _detail = detail);
  }

  Future<void> _complete() async {
    final result = await ProfessionalJobScope.of(context).completeJob(widget.jobId);
    if (!mounted) return;
    await ProfessionalJobScope.maybeStoreOf(context)?.onJobCompleted(widget.jobId);
    if (!mounted) return;
    await ProJobFlow.openCompletionEarnings(context, widget.jobId, result: result);
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Scaffold(
      appBar: AppBar(title: const Text('Complete delivery')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (detail != null)
            ProCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Customer: ${detail.customerName}', style: const TextStyle(color: Colors.white)),
                  Text(detail.customerPhone, style: const TextStyle(color: kProTextSecondary)),
                ],
              ),
            ),
          const SizedBox(height: 12),
          ProCard(
            child: Text(
              _detail?.canCompleteDelivery == true
                  ? 'Confirm completion after successful delivery verification.'
                  : 'Complete this delivery once the order is marked delivered.',
              style: const TextStyle(color: kProTextSecondary),
            ),
          ),
          const SizedBox(height: 16),
          ProPrimaryButton(
            label: 'Complete delivery',
            onPressed: _detail?.canCompleteDelivery == true ? _complete : null,
          ),
        ],
      ),
    );
  }
}

class ProServicePrepScreen extends StatefulWidget {
  const ProServicePrepScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProServicePrepScreen> createState() => _ProServicePrepScreenState();
}

class _ProServicePrepScreenState extends State<ProServicePrepScreen> {
  ProfessionalJobDetail? _detail;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() => _detail = detail);
  }

  Future<void> _toggle(String id, bool value) async {
    await ProfessionalJobScope.of(context).updateChecklistItem(widget.jobId, id, value);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Scaffold(
      appBar: AppBar(title: const Text('Before you start')),
      body: detail == null
          ? const ProScreenState.loading()
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'Complete preparation before travel',
                  style: TextStyle(color: kProTextSecondary),
                ),
                const SizedBox(height: 12),
                ...detail.checklist
                    .where((item) => item.id.startsWith('prep-'))
                    .map(
                      (item) => Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: ProChecklistItem(
                          label: item.label,
                          done: item.done,
                          onChanged: (value) => _toggle(item.id, value),
                        ),
                      ),
                    ),
                const SizedBox(height: 16),
                ProPrimaryButton(
                  label: "I'm ready — start travel",
                  onPressed: () async {
                    final result = await ProfessionalJobScope.of(context).startTravel(widget.jobId);
                    if (!context.mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(result.message)),
                    );
                    await ProJobFlow.openHomeServiceNavigation(context, widget.jobId);
                  },
                ),
              ],
            ),
    );
  }
}

class ProServiceNavigationScreen extends StatefulWidget {
  const ProServiceNavigationScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProServiceNavigationScreen> createState() => _ProServiceNavigationScreenState();
}

class _ProServiceNavigationScreenState extends State<ProServiceNavigationScreen> {
  LivePosition? _pos;
  ArrivalPreview? _preview;
  ProfessionalJobDetail? _detail;
  String? _trackingError;
  bool _arriving = false;
  Timer? _refreshTimer;
  StreamSubscription<Position>? _gpsSub;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_bootstrap);
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _gpsSub?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() => _detail = detail);

    if (detail.phase == ProfessionalJobPhase.enRoute &&
        !ProfessionalTrackingService.instance.isTracking) {
      try {
        await ProfessionalTrackingService.instance.startTracking(
          api: DeliveryPartnerAuthService.instance.api,
          jobId: widget.jobId,
        );
      } on TrackingException catch (error) {
        if (!mounted) return;
        setState(() {
          _trackingError = ProfessionalTrackingService.permissionMessage(error.permissionState);
        });
      }
    }

    await _load();
    _refreshTimer = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    _gpsSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 20),
    ).listen((_) {
      if (mounted) {
        _load();
      }
    });
  }

  Future<void> _load() async {
    try {
      final pos = await ProfessionalJobScope.of(context).fetchLivePosition(widget.jobId);
      ArrivalPreview? preview;
      try {
        preview = await ProfessionalJobScope.of(context).fetchArrivalPreview(widget.jobId);
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _pos = pos;
        _preview = preview;
        _trackingError = null;
      });
      final detail = _detail;
      if (detail?.phase == ProfessionalJobPhase.arrived && mounted) {
        await ProJobFlow.openArrivalOtp(context, widget.jobId);
      } else if (detail?.phase == ProfessionalJobPhase.otpVerified && mounted) {
        await ProJobFlow.openServiceVerified(context, widget.jobId);
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _trackingError = error.toString());
    }
  }

  Future<void> _confirmArrival() async {
    if (_arriving) return;
    setState(() => _arriving = true);
    final result = await ProfessionalJobScope.of(context).confirmArrival(widget.jobId);
    if (!mounted) return;
    setState(() => _arriving = false);
    if (!result.success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message.isEmpty ? 'Could not confirm arrival' : result.message)),
      );
      return;
    }
    await ProJobFlow.openArrivalOtp(context, widget.jobId);
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    final preview = _preview;
    final trackingActive = ProfessionalTrackingService.instance.isTracking;
    final distanceLabel = preview != null
        ? '${preview.distanceMeters.round()} m from customer'
        : 'Calculating distance…';
    final canArrive = preview?.eligible == true;
    return Scaffold(
      appBar: AppBar(title: const Text('En route to customer')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (detail != null)
            ProCard(
              child: ProLocationRow(
                icon: Icons.home_outlined,
                title: detail.dropTitle,
                subtitle: detail.dropAddress,
              ),
            ),
          const SizedBox(height: 12),
          ProCard(
            child: _pos == null
                ? const SizedBox(
                    height: 240,
                    child: Center(child: CircularProgressIndicator()),
                  )
                : AtHomeBeautyMap(
                    customerLat: detail?.destinationLatitude ?? _pos!.latitude,
                    customerLng: detail?.destinationLongitude ?? _pos!.longitude,
                    outlets: const [],
                    providerLat: _pos!.latitude,
                    providerLng: _pos!.longitude,
                    showProvider: true,
                    height: 240,
                  ),
          ),
          const SizedBox(height: 16),
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  trackingActive ? 'Live location active' : 'Live location starting…',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 6),
                Text(distanceLabel, style: const TextStyle(color: kProTextSecondary)),
                if (!canArrive && preview != null)
                  const Padding(
                    padding: EdgeInsets.only(top: 6),
                    child: Text(
                      'Move closer to the customer to confirm arrival',
                      style: TextStyle(color: kProTextSecondary, fontSize: 12),
                    ),
                  ),
                if (_pos != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    '${_pos!.latitude.toStringAsFixed(5)}, ${_pos!.longitude.toStringAsFixed(5)}',
                    style: const TextStyle(color: kProTextSecondary, fontSize: 12),
                  ),
                ],
                if (_trackingError != null) ...[
                  const SizedBox(height: 8),
                  Text(_trackingError!, style: const TextStyle(color: Colors.orangeAccent)),
                ],
              ],
            ),
          ),
          const SizedBox(height: 16),
          ProPrimaryButton(
            label: _arriving ? 'Confirming arrival…' : 'I have arrived',
            onPressed: canArrive && !_arriving ? _confirmArrival : null,
          ),
        ],
      ),
    );
  }
}

class ProArrivalOtpScreen extends StatefulWidget {
  const ProArrivalOtpScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProArrivalOtpScreen> createState() => _ProArrivalOtpScreenState();
}

class _ProArrivalOtpScreenState extends State<ProArrivalOtpScreen> {
  final _otp = TextEditingController();
  String? _error;
  bool _verifying = false;
  bool _resending = false;

  @override
  void dispose() {
    _otp.dispose();
    super.dispose();
  }

  Future<void> _resend() async {
    setState(() {
      _resending = true;
      _error = null;
    });
    final result = await ProfessionalJobScope.of(context).resendArrivalOtp(widget.jobId);
    if (!mounted) return;
    setState(() => _resending = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(result.message)),
    );
  }

  Future<void> _verify() async {
    setState(() {
      _verifying = true;
      _error = null;
    });
    final otp = _otp.text.trim();
    if (otp.length != 6) {
      setState(() {
        _verifying = false;
        _error = 'Enter the 6-digit OTP from the customer';
      });
      return;
    }
    final result = await ProfessionalJobScope.of(context).verifyArrivalOtp(widget.jobId, otp);
    if (!mounted) return;
    if (!result.success) {
      setState(() {
        _verifying = false;
        _error = result.message.isEmpty ? 'Invalid OTP' : result.message;
      });
      return;
    }
    await ProJobFlow.openServiceVerified(context, widget.jobId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Verify customer OTP')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'You have arrived',
              style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              'Ask the customer for their 6-digit service verification OTP',
              style: TextStyle(color: kProTextSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            TextField(
              controller: _otp,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: const InputDecoration(
                labelText: '6-digit OTP',
                counterText: '',
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ],
            const Spacer(),
            ProPrimaryButton(
              label: _verifying ? 'Verifying…' : 'Verify & continue',
              onPressed: _verifying ? null : _verify,
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: _resending ? null : _resend,
              child: Text(_resending ? 'Resending…' : 'Resend OTP to customer'),
            ),
          ],
        ),
      ),
    );
  }
}

class ProServiceVerifiedScreen extends StatefulWidget {
  const ProServiceVerifiedScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProServiceVerifiedScreen> createState() => _ProServiceVerifiedScreenState();
}

class _ProServiceVerifiedScreenState extends State<ProServiceVerifiedScreen> {
  ProfessionalJobDetail? _detail;
  bool _loading = true;
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() {
      _detail = detail;
      _loading = false;
    });
    if (detail.phase == ProfessionalJobPhase.inProgress) {
      await ProJobFlow.openServiceInProgress(context, widget.jobId);
    }
  }

  Future<void> _startService() async {
    if (_starting) return;
    setState(() => _starting = true);
    final result = await ProfessionalJobScope.of(context).startService(widget.jobId);
    if (!mounted) return;
    setState(() => _starting = false);
    if (!result.success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result.message.isEmpty ? 'Could not start service' : result.message)),
      );
      await _load();
      return;
    }
    if (!mounted) return;
    await ProJobFlow.openServiceInProgress(context, widget.jobId);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: ProScreenState.loading());
    final detail = _detail!;
    return Scaffold(
      appBar: AppBar(title: const Text('Before you start')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.verified_outlined, size: 72, color: kProPink),
            const SizedBox(height: 16),
            const Text(
              'Customer verified',
              style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            ProCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Service: ${detail.title}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                  if (detail.durationMinutes > 0)
                    Text('Duration: ${detail.durationMinutes} minutes', style: const TextStyle(color: kProTextSecondary)),
                  Text('Location: ${detail.dropAddress}', style: const TextStyle(color: kProTextSecondary)),
                  const SizedBox(height: 8),
                  const Text('✓ Customer verified', style: TextStyle(color: kProPink)),
                  const Text('✓ Correct service', style: TextStyle(color: kProTextSecondary)),
                ],
              ),
            ),
            const Spacer(),
            ProPrimaryButton(
              label: _starting ? 'Starting service…' : 'Start service',
              onPressed: _starting || !detail.canStartService ? null : _startService,
            ),
          ],
        ),
      ),
    );
  }
}

class ProServiceInProgressScreen extends StatefulWidget {
  const ProServiceInProgressScreen({super.key, required this.jobId});

  final String jobId;

  @override
  State<ProServiceInProgressScreen> createState() => _ProServiceInProgressScreenState();
}

class _ProServiceInProgressScreenState extends State<ProServiceInProgressScreen> {
  ProfessionalJobDetail? _detail;
  bool _completing = false;
  Timer? _timer;
  Duration _elapsed = Duration.zero;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tickElapsed());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _tickElapsed() {
    final startedAt = _detail?.serviceStartedAt ?? '';
    if (startedAt.isEmpty) return;
    final parsed = DateTime.tryParse(startedAt.replaceFirst(' ', 'T'));
    if (parsed == null) return;
    final next = DateTime.now().toUtc().difference(parsed.toUtc());
    if (mounted && next != _elapsed) {
      setState(() => _elapsed = next);
    }
  }

  String _formatElapsed(Duration duration) {
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    if (hours > 0) {
      return '${hours.toString().padLeft(2, '0')}:$minutes:$seconds';
    }
    return '$minutes:$seconds';
  }

  Future<void> _load() async {
    final detail = await ProfessionalJobScope.of(context).fetchJobDetail(widget.jobId);
    if (!mounted) return;
    setState(() => _detail = detail);
    _tickElapsed();
  }

  Future<void> _toggle(String id, bool value) async {
    final result = await ProfessionalJobScope.of(context).updateChecklistItem(widget.jobId, id, value);
    if (!mounted) return;
    if (!result.success) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(result.message)));
    }
    await _load();
  }

  Future<void> _complete() async {
    if (_completing) return;
    setState(() => _completing = true);
    try {
      final result = await ProfessionalJobScope.of(context).completeJob(widget.jobId);
      if (!mounted) return;
      await ProfessionalJobScope.maybeStoreOf(context)?.onJobCompleted(widget.jobId);
      if (!mounted) return;
      await ProJobFlow.openCompletionEarnings(context, widget.jobId, result: result);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString().replaceFirst('Bad state: ', ''))),
      );
    } finally {
      if (mounted) setState(() => _completing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    if (detail == null) return const Scaffold(body: ProScreenState.loading());

    return Scaffold(
      appBar: AppBar(title: const Text('Service in progress')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ProCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(detail.title, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                Text('Elapsed: ${_formatElapsed(_elapsed)}', style: const TextStyle(color: kProPink, fontWeight: FontWeight.w700)),
                if (detail.durationMinutes > 0)
                  Text('Estimated duration: ${detail.durationMinutes} min', style: const TextStyle(color: kProTextSecondary)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ProCard(
            child: Row(
              children: [
                SizedBox(
                  width: 72,
                  height: 72,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      CircularProgressIndicator(
                        value: detail.progressPercent / 100,
                        color: kProPink,
                        backgroundColor: kProOutline,
                      ),
                      Text('${detail.progressPercent}%'),
                    ],
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    detail.customerName,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          ...detail.checklist
              .where((item) => item.id.startsWith('svc-'))
              .map(
                (item) => Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ProChecklistItem(
                    label: item.label,
                    done: item.done,
                    onChanged: (value) => _toggle(item.id, value),
                  ),
                ),
              ),
          const SizedBox(height: 16),
          ProPrimaryButton(
            label: _completing ? 'Completing…' : 'Complete service',
            onPressed: _completing || !detail.canCompleteService ? null : _complete,
          ),
        ],
      ),
    );
  }
}

class ProCompletionEarningsScreen extends StatelessWidget {
  const ProCompletionEarningsScreen({
    super.key,
    required this.jobId,
    required this.result,
  });

  final String jobId;
  final CompletionResult result;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Completed')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.check_circle_outline, color: kProPink, size: 64),
            const SizedBox(height: 12),
            const Text(
              'Service completed!',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 24),
            ProCard(
              child: Column(
                children: [
                  _EarnRow(label: 'Service amount', value: result.serviceAmount),
                  if (result.paymentStatus.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Payment', style: TextStyle(color: kProTextSecondary)),
                          Text(result.paymentStatus, style: const TextStyle(color: Colors.white)),
                        ],
                      ),
                    ),
                  const Divider(color: kProOutline),
                  _EarnRow(label: 'Total', value: result.total, bold: true),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text(
              result.reviewHint,
              style: const TextStyle(color: kProTextSecondary),
              textAlign: TextAlign.center,
            ),
            const Spacer(),
            ProPrimaryButton(
              label: 'Done',
              onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
            ),
          ],
        ),
      ),
    );
  }
}

class _EarnRow extends StatelessWidget {
  const _EarnRow({required this.label, required this.value, this.bold = false});
  final String label;
  final double value;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: bold ? Colors.white : kProTextSecondary, fontWeight: bold ? FontWeight.w700 : null)),
          Text('₹${value.toStringAsFixed(0)}', style: TextStyle(color: Colors.white, fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
        ],
      ),
    );
  }
}
