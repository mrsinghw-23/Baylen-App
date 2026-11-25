import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/account.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../services/location_service.dart';
import '../utils/home_service_categories.dart';
import 'payment_checkout_screen.dart';

class AtHomeBeautyBookingScreen extends StatefulWidget {
  const AtHomeBeautyBookingScreen({
    super.key,
    this.initialCategory,
    this.initialOutlet,
    required this.outlets,
  });

  final BeautyCategory? initialCategory;
  final SalonOutlet? initialOutlet;
  final List<SalonOutlet> outlets;

  @override
  State<AtHomeBeautyBookingScreen> createState() =>
      _AtHomeBeautyBookingScreenState();
}

class _AtHomeBeautyBookingScreenState extends State<AtHomeBeautyBookingScreen> {
  int _step = 0;
  BeautyCategory? _category;
  SalonOutlet? _outlet;
  SalonService? _service;
  AtHomeServiceSlot? _slot;
  Address? _address;
  AtHomeBookingQuote? _quote;
  AtHomeBooking? _booking;
  List<SalonService> _services = [];
  List<AtHomeServiceSlot> _slots = [];
  List<Address> _addresses = [];
  bool _loading = false;
  String? _error;
  final _line1Controller = TextEditingController();
  final _pincodeController = TextEditingController();
  DateTime _selectedDate = DateTime.now();

  @override
  void initState() {
    super.initState();
    _category = widget.initialCategory;
    _outlet =
        widget.initialOutlet ??
        (widget.outlets.isNotEmpty ? widget.outlets.first : null);
    if (_category != null && _outlet != null) {
      _step = 1;
      _loadServices();
    }
    _loadAddresses();
  }

  @override
  void dispose() {
    _line1Controller.dispose();
    _pincodeController.dispose();
    super.dispose();
  }

  Future<void> _loadAddresses() async {
    try {
      final addresses = await AuthService.instance.api.addresses();
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _address = addresses.cast<Address?>().firstWhere(
          (item) => item?.isDefault == true,
          orElse: () => addresses.isEmpty ? null : addresses.first,
        );
        if (_address != null) {
          _line1Controller.text = _address!.line1;
          _pincodeController.text = _address!.postalCode;
        }
      });
    } catch (_) {}
  }

  Future<void> _loadServices() async {
    if (_outlet == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final serviceType = _category == null
          ? null
          : homeServiceCategoryToServiceType(_category!.slug);
      final services = await AuthService.instance.api.salonServices(
        outletId: _outlet!.id,
        serviceType: serviceType,
        isAtHomeOnly: true,
      );
      final filtered = _category == null
          ? services
          : services
                .where(
                  (service) => salonServiceMatchesCategory(service, _category),
                )
                .toList();
      if (!mounted) return;
      setState(() {
        _services = filtered;
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

  Future<void> _loadSlots() async {
    if (_outlet == null || _service == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final date =
          '${_selectedDate.year.toString().padLeft(4, '0')}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}';
      final slots = await AuthService.instance.api.atHomeSlots(
        outletId: _outlet!.id,
        serviceId: _service!.id,
        slotDate: date,
      );
      if (!mounted) return;
      setState(() {
        _slots = slots.where((slot) => slot.available).toList();
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

  Future<void> _loadQuote() async {
    final location = LocationService.instance.currentLocation.value;
    final resolved = location == null
        ? <String, String>{}
        : await LocationService.instance.reverseGeocode(
            location.latitude,
            location.longitude,
          );
    final body = _bookingBody(resolved);
    final quote = await AuthService.instance.api.atHomeQuote(body);
    if (!mounted) return;
    setState(() => _quote = quote);
  }

  Map<String, dynamic> _bookingBody(Map<String, String> resolved) {
    final location = LocationService.instance.currentLocation.value;
    final date =
        '${_selectedDate.year.toString().padLeft(4, '0')}-${_selectedDate.month.toString().padLeft(2, '0')}-${_selectedDate.day.toString().padLeft(2, '0')}';
    return {
      'outlet_id': _outlet!.id,
      'service_id': _service!.id,
      'category': _category?.slug,
      'service_type': _service!.serviceType,
      'slot_date': date,
      'start_time': _slot!.startTime,
      'address_line1': _line1Controller.text.trim(),
      'city': _address?.city ?? resolved['city'] ?? location?.city ?? '',
      'state': _address?.state ?? resolved['state'] ?? '',
      'pincode': _pincodeController.text.trim().isNotEmpty
          ? _pincodeController.text.trim()
          : (_address?.postalCode ?? resolved['postal_code'] ?? ''),
      'latitude': _address?.latitude ?? location?.latitude,
      'longitude': _address?.longitude ?? location?.longitude,
      if (_address?.id != null) 'address_id': _address!.id,
    };
  }

  Future<void> _confirmBooking() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final location = LocationService.instance.currentLocation.value;
      final resolved = location == null
          ? <String, String>{}
          : await LocationService.instance.reverseGeocode(
              location.latitude,
              location.longitude,
            );
      final booking =
          _booking ??
          await AuthService.instance.api.createAtHomeBooking(
            _bookingBody(resolved),
          );
      _booking = booking;
      if (!mounted) return;
      final payment = await Navigator.of(context).push<PaymentRecord>(
        MaterialPageRoute(
          builder: (_) => PaymentCheckoutScreen(
            referenceType: 'JOB',
            referenceId: booking.id,
          ),
        ),
      );
      if (!mounted) return;
      if (payment?.isConfirmed != true) {
        setState(() => _loading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Payment was not completed. The visit stays unpaid until you pay.',
            ),
          ),
        );
        return;
      }
      final confirmed = await AuthService.instance.api.confirmAtHomePayment(
        bookingId: booking.id,
        paymentId: payment!.id,
      );
      if (!mounted) return;
      setState(() {
        _booking = confirmed;
        _step = 5;
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

  void _nextStep() async {
    if (_step == 0) {
      if (_category == null || _outlet == null) {
        setState(() => _error = 'Select a category and salon.');
        return;
      }
      await _loadServices();
      setState(() => _step = 1);
      return;
    }
    if (_step == 1) {
      if (_service == null) {
        setState(() => _error = 'Select a service.');
        return;
      }
      setState(() => _step = 2);
      return;
    }
    if (_step == 2) {
      if (_line1Controller.text.trim().isEmpty) {
        setState(() => _error = 'Enter your service address.');
        return;
      }
      await _loadSlots();
      setState(() => _step = 3);
      return;
    }
    if (_step == 3) {
      if (_slot == null) {
        setState(() => _error = 'Select a time slot.');
        return;
      }
      await _loadQuote();
      setState(() => _step = 4);
      return;
    }
    if (_step == 4) {
      await _confirmBooking();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Book home service')),
      body: Column(
        children: [
          LinearProgressIndicator(value: (_step + 1) / 6),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null) ...[
                  Card(
                    color: const Color(0xFF2A1515),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(_error!),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else
                  _buildStep(),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  if (_step > 0 && _step < 5 && _booking == null)
                    OutlinedButton(
                      onPressed: _loading
                          ? null
                          : () => setState(() => _step -= 1),
                      child: const Text('Back'),
                    ),
                  const Spacer(),
                  if (_step < 5)
                    FilledButton(
                      onPressed: _loading ? null : _nextStep,
                      child: Text(_step == 4 ? 'Pay & confirm' : 'Continue'),
                    )
                  else
                    FilledButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Done'),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep() {
    switch (_step) {
      case 0:
        return _CategoryOutletStep(
          categories: homeServiceCategories,
          outlets: widget.outlets,
          category: _category,
          outlet: _outlet,
          onCategory: (value) => setState(() => _category = value),
          onOutlet: (value) => setState(() => _outlet = value),
        );
      case 1:
        return _ServiceStep(
          services: _services,
          selected: _service,
          onSelect: (value) => setState(() => _service = value),
        );
      case 2:
        return _AddressStep(
          line1Controller: _line1Controller,
          pincodeController: _pincodeController,
          addresses: _addresses,
          selected: _address,
          onSelect: (value) {
            setState(() {
              _address = value;
              _line1Controller.text = value.line1;
              _pincodeController.text = value.postalCode;
            });
          },
        );
      case 3:
        return _SlotStep(
          selectedDate: _selectedDate,
          slots: _slots,
          selected: _slot,
          onDateChanged: (value) {
            setState(() {
              _selectedDate = value;
              _slot = null;
            });
            _loadSlots();
          },
          onSelect: (value) => setState(() => _slot = value),
        );
      case 4:
        return _ReviewStep(service: _service, quote: _quote, slot: _slot);
      default:
        return _ConfirmationStep(booking: _booking);
    }
  }
}

class _CategoryOutletStep extends StatelessWidget {
  const _CategoryOutletStep({
    required this.categories,
    required this.outlets,
    required this.category,
    required this.outlet,
    required this.onCategory,
    required this.onOutlet,
  });

  final List<BeautyCategory> categories;
  final List<SalonOutlet> outlets;
  final BeautyCategory? category;
  final SalonOutlet? outlet;
  final ValueChanged<BeautyCategory> onCategory;
  final ValueChanged<SalonOutlet> onOutlet;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Choose category', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: categories
              .map(
                (item) => ChoiceChip(
                  label: Text(item.name),
                  selected: category?.slug == item.slug,
                  onSelected: (_) => onCategory(item),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: 16),
        Text('Choose salon', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...outlets.map(
          (item) => RadioListTile<SalonOutlet>(
            value: item,
            groupValue: outlet,
            onChanged: (value) {
              if (value != null) onOutlet(value);
            },
            title: Text(item.name),
            subtitle: Text(item.city),
          ),
        ),
      ],
    );
  }
}

class _ServiceStep extends StatelessWidget {
  const _ServiceStep({
    required this.services,
    required this.selected,
    required this.onSelect,
  });

  final List<SalonService> services;
  final SalonService? selected;
  final ValueChanged<SalonService> onSelect;

  @override
  Widget build(BuildContext context) {
    if (services.isEmpty) {
      return const Text('No home services are available for this salon.');
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Select service', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        ...services.map(
          (service) => RadioListTile<SalonService>(
            value: service,
            groupValue: selected,
            onChanged: (value) {
              if (value != null) onSelect(value);
            },
            title: Text(service.name),
            subtitle: Text(
              '${service.durationMinutes} min · ${service.priceLabel}',
            ),
          ),
        ),
      ],
    );
  }
}

class _AddressStep extends StatelessWidget {
  const _AddressStep({
    required this.line1Controller,
    required this.pincodeController,
    required this.addresses,
    required this.selected,
    required this.onSelect,
  });

  final TextEditingController line1Controller;
  final TextEditingController pincodeController;
  final List<Address> addresses;
  final Address? selected;
  final ValueChanged<Address> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Service address', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (addresses.isNotEmpty) ...[
          ...addresses.map(
            (address) => RadioListTile<Address>(
              value: address,
              groupValue: selected,
              onChanged: (value) {
                if (value != null) onSelect(value);
              },
              title: Text(address.line1),
              subtitle: Text('${address.city}, ${address.postalCode}'),
            ),
          ),
          const Divider(),
        ],
        TextField(
          controller: line1Controller,
          decoration: const InputDecoration(
            labelText: 'Address line',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: pincodeController,
          decoration: const InputDecoration(
            labelText: 'PIN code',
            border: OutlineInputBorder(),
          ),
          keyboardType: TextInputType.number,
        ),
      ],
    );
  }
}

class _SlotStep extends StatelessWidget {
  const _SlotStep({
    required this.selectedDate,
    required this.slots,
    required this.selected,
    required this.onDateChanged,
    required this.onSelect,
  });

  final DateTime selectedDate;
  final List<AtHomeServiceSlot> slots;
  final AtHomeServiceSlot? selected;
  final ValueChanged<DateTime> onDateChanged;
  final ValueChanged<AtHomeServiceSlot> onSelect;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Pick date & time',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: () async {
            final picked = await showDatePicker(
              context: context,
              firstDate: DateTime.now(),
              lastDate: DateTime.now().add(const Duration(days: 21)),
              initialDate: selectedDate,
            );
            if (picked != null) onDateChanged(picked);
          },
          icon: const Icon(Icons.calendar_today_outlined),
          label: Text(
            '${selectedDate.day}/${selectedDate.month}/${selectedDate.year}',
          ),
        ),
        const SizedBox(height: 12),
        if (slots.isEmpty)
          const Text('No slots available for this date.')
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: slots
                .map(
                  (slot) => ChoiceChip(
                    label: Text(slot.startTime),
                    selected: selected?.id == slot.id,
                    onSelected: (_) => onSelect(slot),
                  ),
                )
                .toList(),
          ),
      ],
    );
  }
}

class _ReviewStep extends StatelessWidget {
  const _ReviewStep({
    required this.service,
    required this.quote,
    required this.slot,
  });

  final SalonService? service;
  final AtHomeBookingQuote? quote;
  final AtHomeServiceSlot? slot;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Review & pay', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        ListTile(
          title: Text(service?.name ?? ''),
          subtitle: Text('Scheduled ${slot?.startTime ?? ''}'),
          trailing: Text(
            quote == null ? '' : '₹${quote!.grandTotal.toStringAsFixed(0)}',
            style: const TextStyle(fontWeight: FontWeight.bold),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Your booking is confirmed after payment. A Baylen professional will visit your home.',
        ),
      ],
    );
  }
}

class _ConfirmationStep extends StatelessWidget {
  const _ConfirmationStep({required this.booking});

  final AtHomeBooking? booking;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(
          Icons.check_circle,
          size: 64,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 12),
        Text(
          'Booking confirmed',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text(booking?.displayStatus ?? ''),
        if (booking?.bookingNumber.isNotEmpty == true)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('Reference: ${booking!.bookingNumber}'),
          ),
      ],
    );
  }
}
