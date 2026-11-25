import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../models/account.dart';
import '../models/at_home_beauty.dart';
import '../models/salon.dart';
import '../services/location_service.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/salon_image.dart';
import 'home_service_confirm_screen.dart';

class HomeServiceBookScreen extends StatefulWidget {
  const HomeServiceBookScreen({
    super.key,
    required this.outlet,
    required this.service,
    this.initialProfessional,
    this.initialGender,
  });

  final SalonOutlet outlet;
  final SalonService service;
  final HomeServiceProfessional? initialProfessional;
  final String? initialGender;

  @override
  State<HomeServiceBookScreen> createState() => _HomeServiceBookScreenState();
}

class _HomeServiceBookScreenState extends State<HomeServiceBookScreen> {
  int _step = 0;
  String _gender = '';
  String? _selectedProfessionalId;
  String? _selectedAddressId;
  HomeServiceProfessional? _professional;
  Address? _address;
  List<HomeServiceProfessional> _professionals = [];
  List<Address> _addresses = [];
  bool _loadingProfessionals = false;
  bool _submitting = false;
  String? _error;
  final _line1Controller = TextEditingController();
  final _pincodeController = TextEditingController();
  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));

  List<String> get _genderOptions {
    final options = <String>[];
    if (widget.service.priceFor('MALE') != null) options.add('MALE');
    if (widget.service.priceFor('FEMALE') != null) options.add('FEMALE');
    return options;
  }

  int get _totalSteps => 4;

  @override
  void initState() {
    super.initState();
    _professional = widget.initialProfessional;
    _selectedProfessionalId = widget.initialProfessional?.id;
    if (widget.initialGender != null && widget.initialGender!.isNotEmpty) {
      _gender = widget.initialGender!.toUpperCase();
    }
    final genders = _genderOptions;
    if (_gender.isNotEmpty) {
      _step = 1;
    } else if (genders.length == 1) {
      _gender = genders.first;
      _step = 1;
    }
    if (_professional != null && _gender.isNotEmpty) {
      _step = 2;
    }
    _loadAddresses();
    if (_step == 1 || _step == 2) {
      _loadProfessionals();
    }
  }

  @override
  void dispose() {
    _line1Controller.dispose();
    _pincodeController.dispose();
    super.dispose();
  }

  Future<void> _loadAddresses() async {
    if (!AuthService.instance.isSignedIn) return;
    try {
      final addresses = await AuthService.instance.api.addresses();
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _address = addresses.cast<Address?>().firstWhere(
          (item) => item?.isDefault == true,
          orElse: () => addresses.isEmpty ? null : addresses.first,
        );
        _selectedAddressId = _address?.id;
        if (_address != null) {
          _line1Controller.text = _address!.line1;
          _pincodeController.text = _address!.postalCode;
        }
      });
    } catch (_) {}
  }

  Future<void> _loadProfessionals() async {
    if (_loadingProfessionals) return;
    setState(() {
      _loadingProfessionals = true;
      _error = null;
    });
    try {
      final professionals = await AuthService.instance.api.atHomeProviders(
        outletId: widget.outlet.id,
        serviceId: widget.service.id,
        city: widget.outlet.city,
        gender: _gender,
      );
      if (!mounted) return;
      setState(() {
        _professionals = professionals;
        _loadingProfessionals = false;
        if (_selectedProfessionalId != null) {
          _professional = professionals.cast<HomeServiceProfessional?>().firstWhere(
            (item) => item?.id == _selectedProfessionalId,
            orElse: () => null,
          );
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _loadingProfessionals = false;
      });
    }
  }

  String _formatDate(DateTime day) {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${weekdays[day.weekday - 1]}, ${day.day} ${months[day.month - 1]} ${day.year}';
  }

  String _isoDate(DateTime day) {
    return '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
  }

  String _genderLabel(String gender) {
    switch (gender) {
      case 'MALE':
        return 'Male';
      case 'FEMALE':
        return 'Female';
      default:
        return gender;
    }
  }

  Future<Map<String, dynamic>> _bookingBody() async {
    final location = LocationService.instance.currentLocation.value;
    final resolved = location == null
        ? <String, String>{}
        : await LocationService.instance.reverseGeocode(
            location.latitude,
            location.longitude,
          );
    return {
      'outlet_id': widget.outlet.id,
      'service_id': widget.service.id,
      'service_type': widget.service.serviceType,
      'gender': _gender,
      if (_professional != null) 'preferred_provider_id': _professional!.id,
      'slot_date': _isoDate(_selectedDate),
      'address_line1': _line1Controller.text.trim(),
      'city': _address?.city ?? resolved['city'] ?? location?.city ?? widget.outlet.city,
      'state': _address?.state ?? resolved['state'] ?? '',
      'pincode': _pincodeController.text.trim().isNotEmpty
          ? _pincodeController.text.trim()
          : (_address?.postalCode ?? resolved['postal_code'] ?? ''),
      'latitude': _address?.latitude ??
          location?.latitude ??
          (widget.outlet.latitude != 0 ? widget.outlet.latitude : null),
      'longitude': _address?.longitude ??
          location?.longitude ??
          (widget.outlet.longitude != 0 ? widget.outlet.longitude : null),
      if (_address?.id != null) 'address_id': _address!.id,
    };
  }

  Future<void> _openConfirm() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final body = await _bookingBody();
      final quote = await AuthService.instance.api.atHomeQuote(body);
      if (!mounted) return;
      if (_professional == null) {
        setState(() {
          _error = 'Select a professional before reviewing your booking.';
          _submitting = false;
        });
        return;
      }
      setState(() => _submitting = false);
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => HomeServiceConfirmScreen(
            outlet: widget.outlet,
            service: widget.service,
            gender: _gender,
            professional: _professional!,
            addressLine1: _line1Controller.text.trim(),
            addressCity: body['city']?.toString() ?? '',
            addressState: body['state']?.toString() ?? '',
            pincode: body['pincode']?.toString() ?? '',
            selectedDate: _selectedDate,
            quote: quote,
            bookingBody: body,
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _submitting = false;
      });
    }
  }

  Future<void> _nextStep() async {
    if (_step == 0) {
      if (_gender.isEmpty) {
        setState(() => _error = 'Select Male or Female.');
        return;
      }
      setState(() {
        _error = null;
        _step = 1;
      });
      await _loadProfessionals();
      return;
    }
    if (_step == 1) {
      if (_professional == null) {
        setState(() => _error = 'Select a professional.');
        return;
      }
      setState(() {
        _error = null;
        _step = 2;
      });
      return;
    }
    if (_step == 2) {
      if (_line1Controller.text.trim().isEmpty) {
        setState(() => _error = 'Enter your home address.');
        return;
      }
      setState(() {
        _error = null;
        _step = 3;
      });
      return;
    }
    if (_step == 3) {
      await _openConfirm();
    }
  }

  void _selectProfessional(HomeServiceProfessional pro) {
    setState(() {
      _selectedProfessionalId = pro.id;
      _professional = pro;
      _error = null;
    });
  }

  void _selectAddress(Address item) {
    setState(() {
      _selectedAddressId = item.id;
      _address = item;
      _line1Controller.text = item.line1;
      _pincodeController.text = item.postalCode;
      _error = null;
    });
  }

  bool get _actionBusy => _submitting || (_step == 1 && _loadingProfessionals);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        foregroundColor: Colors.white,
        title: Text(_stepTitle()),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            _StepProgressBar(step: _step, totalSteps: _totalSteps),
            const SizedBox(height: 16),
            _SummaryCard(
              outlet: widget.outlet,
              service: widget.service,
              gender: _gender,
              professional: _professional,
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              _ErrorBanner(message: _error!),
              const SizedBox(height: 12),
            ],
            if (_step == 1 && _loadingProfessionals)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(child: CircularProgressIndicator()),
              )
            else
              ..._buildStepWidgets(),
            const SizedBox(height: 24),
            _ActionBar(
              step: _step,
              busy: _actionBusy,
              submitting: _submitting,
              onBack: _step > 0
                  ? () => setState(() {
                      _error = null;
                      _step -= 1;
                    })
                  : null,
              onContinue: _actionBusy ? null : _nextStep,
              continueLabel: _step == 3 ? 'Review booking' : 'Continue',
            ),
          ],
        ),
      ),
    );
  }

  String _stepTitle() {
    switch (_step) {
      case 0:
        return 'Select gender';
      case 1:
        return 'Choose professional';
      case 2:
        return 'Service address';
      default:
        return 'Select date';
    }
  }

  List<Widget> _buildStepWidgets() {
    switch (_step) {
      case 0:
        return [
          const _StepHeading('Who is this service for?'),
          const SizedBox(height: 12),
          ..._genderOptions.map((gender) {
            final selected = _gender == gender;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _SelectableCard(
                selected: selected,
                onTap: () => setState(() => _gender = gender),
                title: _genderLabel(gender),
                subtitle:
                    '₹${widget.service.priceFor(gender)?.sellingPrice.toStringAsFixed(0) ?? widget.service.sellingPrice.toStringAsFixed(0)} · ${widget.service.durationMinutes} mins',
              ),
            );
          }),
        ];
      case 1:
        if (_professionals.isEmpty) {
          return [
            const Text(
              'No professionals are available for this service at your location right now.',
              style: TextStyle(color: kHomeTextSecondary, height: 1.4),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _loadProfessionals,
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
            ),
          ];
        }
        return [
          const _StepHeading('Available professionals'),
          const SizedBox(height: 12),
          ..._professionals.map((pro) {
            final selected = _selectedProfessionalId == pro.id;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _SelectableCard(
                selected: selected,
                onTap: () => _selectProfessional(pro),
                title: pro.name,
                subtitle: [
                  pro.designation,
                  if (pro.ratingLabel.isNotEmpty) '★ ${pro.ratingLabel}',
                ].where((part) => part.isNotEmpty).join(' · '),
                leading: pro.profilePhotoUrl.startsWith('http')
                    ? CircleAvatar(
                        backgroundColor: kHomeSurface,
                        backgroundImage: NetworkImage(pro.profilePhotoUrl),
                      )
                    : CircleAvatar(
                        backgroundColor: kHomeSurface,
                        child: Text(
                          pro.name.isNotEmpty ? pro.name[0].toUpperCase() : '?',
                          style: const TextStyle(color: Colors.white),
                        ),
                      ),
              ),
            );
          }),
        ];
      case 2:
        return [
          const _StepHeading('Where should we visit?'),
          const SizedBox(height: 12),
          ..._addresses.map((item) {
            final selected = _selectedAddressId == item.id;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _SelectableCard(
                selected: selected,
                onTap: () => _selectAddress(item),
                title: item.label.isNotEmpty ? item.label : 'Home',
                subtitle: item.summary,
              ),
            );
          }),
          TextField(
            controller: _line1Controller,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(labelText: 'Address line'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _pincodeController,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(labelText: 'Pincode'),
            keyboardType: TextInputType.number,
          ),
        ];
      default:
        return [
          const _StepHeading('When do you need the service?'),
          const SizedBox(height: 8),
          const Text(
            'Pick a preferred date. Our team will confirm the visit window after assigning your professional.',
            style: TextStyle(color: kHomeTextSecondary, height: 1.4),
          ),
          const SizedBox(height: 16),
          Card(
            color: kHomeCard,
            child: ListTile(
              leading: Icon(
                Icons.calendar_month_outlined,
                color: Theme.of(context).colorScheme.primary,
              ),
              title: Text(
                _formatDate(_selectedDate),
                style: const TextStyle(color: Colors.white),
              ),
              subtitle: const Text(
                'Preferred service date',
                style: TextStyle(color: kHomeTextSecondary),
              ),
              trailing: TextButton(
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _selectedDate,
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 30)),
                  );
                  if (picked != null) {
                    setState(() => _selectedDate = picked);
                  }
                },
                child: const Text('Change'),
              ),
            ),
          ),
        ];
    }
  }
}

class _StepProgressBar extends StatelessWidget {
  const _StepProgressBar({required this.step, required this.totalSteps});

  final int step;
  final int totalSteps;

  @override
  Widget build(BuildContext context) {
    final progress = (step + 1) / totalSteps;
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        height: 4,
        width: double.infinity,
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: kHomeOutline),
            FractionallySizedBox(
              widthFactor: progress.clamp(0.0, 1.0),
              alignment: Alignment.centerLeft,
              child: const ColoredBox(color: kHomePink),
            ),
          ],
        ),
      ),
    );
  }
}

class _StepHeading extends StatelessWidget {
  const _StepHeading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        color: Colors.white,
        fontSize: 16,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF2A1515),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Text(message, style: const TextStyle(color: Colors.white)),
      ),
    );
  }
}

class _SelectableCard extends StatelessWidget {
  const _SelectableCard({
    required this.selected,
    required this.onTap,
    required this.title,
    required this.subtitle,
    this.leading,
  });

  final bool selected;
  final VoidCallback onTap;
  final String title;
  final String subtitle;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? kHomeSurface : kHomeCard,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: selected ? kHomePink : kHomeOutline),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
          child: Row(
            children: [
              if (leading != null) ...[
                leading!,
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (subtitle.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: const TextStyle(color: kHomeTextSecondary),
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                selected ? Icons.check_circle : Icons.circle_outlined,
                color: selected ? kHomePink : kHomeTextSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.step,
    required this.busy,
    required this.submitting,
    required this.onContinue,
    required this.continueLabel,
    this.onBack,
  });

  final int step;
  final bool busy;
  final bool submitting;
  final VoidCallback? onBack;
  final VoidCallback? onContinue;
  final String continueLabel;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (onBack != null)
          OutlinedButton(
            style: OutlinedButton.styleFrom(minimumSize: const Size(88, 48)),
            onPressed: busy ? null : onBack,
            child: const Text('Back'),
          ),
        if (onBack != null) const SizedBox(width: 12),
        Expanded(
          child: HomeFullWidthButton(
            label: continueLabel,
            onPressed: onContinue,
            loading: submitting,
          ),
        ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.outlet,
    required this.service,
    required this.gender,
    required this.professional,
  });

  final SalonOutlet outlet;
  final SalonService service;
  final String gender;
  final HomeServiceProfessional? professional;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: kHomeCard,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 56,
                height: 56,
                child: SalonImage(imageUrl: service.imageUrl),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    service.name,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    outlet.name,
                    style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
                  ),
                  if (gender.isNotEmpty)
                    Text(
                      'For $gender',
                      style: const TextStyle(fontSize: 12, color: kHomeTextSecondary),
                    ),
                  if (professional != null)
                    Text(
                      professional!.name,
                      style: const TextStyle(fontSize: 12, color: kHomeTextSecondary),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
