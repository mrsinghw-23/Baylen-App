import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/salon.dart';
import 'bookings_screen.dart';
import 'login_screen.dart';

class SalonBookScreen extends StatefulWidget {
  const SalonBookScreen({super.key, required this.outlet});

  final SalonOutlet outlet;

  @override
  State<SalonBookScreen> createState() => _SalonBookScreenState();
}

class _SalonBookScreenState extends State<SalonBookScreen> {
  final _api = CatalystApi();
  List<SalonService> _services = [];
  List<SalonStaff> _staff = [];
  List<SalonSlot> _slots = [];
  SalonService? _service;
  SalonStaff? _staffMember;
  late String _slotDate;
  bool _loading = true;
  bool _booking = false;
  String? _error;

  List<String> get _dates {
    final now = DateTime.now();
    return List.generate(7, (index) {
      final day = DateTime(
        now.year,
        now.month,
        now.day,
      ).add(Duration(days: index));
      return _formatDate(day);
    });
  }

  String _formatDate(DateTime day) {
    final month = day.month.toString().padLeft(2, '0');
    final date = day.day.toString().padLeft(2, '0');
    return '${day.year}-$month-$date';
  }

  @override
  void initState() {
    super.initState();
    _slotDate = _dates.first;
    _loadServices();
  }

  Future<void> _loadServices() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final services = await _api.salonServices();
      if (!mounted) return;
      setState(() {
        _services = services;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _selectService(SalonService service) async {
    setState(() {
      _service = service;
      _staffMember = null;
      _staff = [];
      _slots = [];
      _loading = true;
      _error = null;
    });
    try {
      final staff = await _api.salonStaff(
        outletId: widget.outlet.id,
        serviceId: service.id,
      );
      if (!mounted) return;
      setState(() {
        _staff = staff;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _selectStaff(SalonStaff staff) async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (signedIn != true) return;
    }
    setState(() => _staffMember = staff);
    await _loadSlots();
  }

  Future<void> _loadSlots() async {
    final staff = _staffMember;
    final service = _service;
    if (staff == null || service == null) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _slots = [];
    });
    try {
      final slots = await _api.salonSlots(
        outletId: widget.outlet.id,
        slotDate: _slotDate,
        staffId: staff.id,
      );
      final unique = <String, SalonSlot>{};
      for (final slot in slots) {
        unique.putIfAbsent(slot.startTime, () => slot);
      }
      final ordered = unique.values.toList()
        ..sort((a, b) => a.startTime.compareTo(b.startTime));
      if (!mounted) return;
      setState(() {
        _slots = ordered;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _book(SalonSlot slot) async {
    final service = _service;
    if (service == null) {
      return;
    }
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (signedIn != true) return;
    }
    setState(() => _booking = true);
    try {
      final appointment = await AuthService.instance.api.bookAppointment(
        slotId: slot.id,
        serviceId: service.id,
      );
      if (!mounted) return;
      setState(() => _booking = false);
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => BookingsScreen(highlightId: appointment.id),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _booking = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _retryCurrentStep() async {
    if (_staffMember != null) {
      await _loadSlots();
      return;
    }
    final service = _service;
    if (service != null) {
      await _selectService(service);
      return;
    }
    await _loadServices();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.outlet.name)),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(widget.outlet.subtitle),
              const SizedBox(height: 16),
              Text('1. Service', style: Theme.of(context).textTheme.titleSmall),
              const SizedBox(height: 8),
              if (_services.isEmpty && !_loading && _error == null)
                const _BookingEmptyState(
                  icon: Icons.spa_outlined,
                  title: 'No services yet',
                  message: 'Services added in Catalyst will appear here automatically.',
                )
              else
                ..._services.map(
                  (service) => Card(
                    child: ListTile(
                      selected: _service?.id == service.id,
                      title: Text(service.name),
                      subtitle: Text(
                        '${service.durationLabel} - ${service.description}',
                      ),
                      trailing: Text(service.priceLabel),
                      onTap: () => _selectService(service),
                    ),
                  ),
                ),
              if (_service != null) ...[
                const SizedBox(height: 16),
                Text(
                  '2. Professional',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                if (_staff.isEmpty && !_loading)
                  const _BookingEmptyState(
                    icon: Icons.person_off_outlined,
                    title: 'No professional available',
                    message: 'Staff availability added in Catalyst will appear here.',
                  )
                else
                  ..._staff.map(
                    (staff) => Card(
                      child: ListTile(
                        selected: _staffMember?.id == staff.id,
                        leading: const Icon(Icons.person_outline),
                        title: Text(staff.name),
                        subtitle: Text(staff.designation),
                        onTap: () => _selectStaff(staff),
                      ),
                    ),
                  ),
              ],
              if (_staffMember != null) ...[
                const SizedBox(height: 16),
                Text(
                  '3. Date and time',
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                const SizedBox(height: 8),
                SizedBox(
                  height: 40,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    children: _dates
                        .map(
                          (date) => Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(date),
                              selected: _slotDate == date,
                              onSelected: (_) {
                                setState(() => _slotDate = date);
                                _loadSlots();
                              },
                            ),
                          ),
                        )
                        .toList(),
                  ),
                ),
                const SizedBox(height: 12),
                if (_slots.isEmpty && !_loading)
                  const _BookingEmptyState(
                    icon: Icons.event_busy_outlined,
                    title: 'No open slots',
                    message: 'Choose another date or update availability in Catalyst.',
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _slots
                        .map(
                          (slot) => ActionChip(
                            label: Text(slot.timeLabel),
                            onPressed: _booking ? null : () => _book(slot),
                          ),
                        )
                        .toList(),
                  ),
              ],
              if (_loading)
                const Padding(
                  padding: EdgeInsets.only(top: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                _BookingErrorState(
                  message: _error!,
                  onRetry: _retryCurrentStep,
                ),
              ],
            ],
          ),
          if (_booking)
            const ColoredBox(
              color: Color(0x66000000),
              child: Center(child: CircularProgressIndicator()),
            ),
        ],
      ),
    );
  }
}

class _BookingErrorState extends StatelessWidget {
  const _BookingErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return _BookingPanel(
      icon: Icons.cloud_off_outlined,
      title: 'Could not load live booking data',
      message: message.replaceFirst('Exception: ', ''),
      action: FilledButton.icon(
        onPressed: onRetry,
        icon: const Icon(Icons.refresh),
        label: const Text('Retry'),
      ),
    );
  }
}

class _BookingEmptyState extends StatelessWidget {
  const _BookingEmptyState({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return _BookingPanel(icon: icon, title: title, message: message);
  }
}

class _BookingPanel extends StatelessWidget {
  const _BookingPanel({
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          children: [
            Icon(icon, size: 42, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 10),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(message, textAlign: TextAlign.center),
            if (action != null) ...[const SizedBox(height: 14), action!],
          ],
        ),
      ),
    );
  }
}
