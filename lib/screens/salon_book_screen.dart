import 'dart:async';

import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/salon.dart';
import '../widgets/home/_home_constants.dart';
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
  final _search = TextEditingController();
  final _staffSearch = TextEditingController();
  Timer? _serviceSearchDebounce;
  Timer? _staffSearchDebounce;
  int _step = 0;
  List<SalonPackage> _packages = [];
  List<SalonService> _services = [];
  List<SalonStaff> _staff = [];
  List<SalonSlot> _slots = [];
  SalonPackage? _package;
  SalonService? _service;
  SalonStaff? _staffMember;
  SalonSlot? _slot;
  String _serviceType = 'All';
  String _gender = '';
  late String _slotDate;
  bool _loading = true;
  bool _booking = false;
  bool _confirmed = false;
  bool _skipCategoryStep = false;
  SalonAppointment? _appointment;
  bool _whatsappSent = false;
  String? _error;

  static const _filterTypes = ['All', 'Hair', 'Skin', 'Bridal', 'Spa', 'Nails'];

  List<String> get _dates {
    final now = DateTime.now();
    return List.generate(14, (index) {
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

  String _formatDisplayDate(String isoDate) {
    final parts = isoDate.split('-');
    if (parts.length != 3) return isoDate;
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final month = int.tryParse(parts[1]) ?? 1;
    return '${parts[2]} ${months[month.clamp(1, 12) - 1]}';
  }

  String get _genderLabel {
    switch (_gender) {
      case 'MALE':
        return 'Male';
      case 'FEMALE':
        return 'Female';
      default:
        return _gender;
    }
  }

  String get _packageLabel {
    final name = _package?.name ?? widget.outlet.salonCategory;
    if (name.isEmpty) return '';
    return '$name Package';
  }

  SalonServicePrice? get _selectedPrice => _service?.priceFor(_gender);

  String get _priceLabel {
    final price = _selectedPrice?.sellingPrice ?? _service?.sellingPrice ?? 0;
    return '₹${price.toStringAsFixed(0)}';
  }

  List<String> _genderOptions(SalonService service) {
    final options = <String>[];
    if (service.priceFor('MALE') != null) options.add('MALE');
    if (service.priceFor('FEMALE') != null) options.add('FEMALE');
    return options;
  }

  bool _isStaffSelected(SalonStaff member) {
    final selected = _staffMember;
    if (selected == null) return false;
    if (selected.id.isNotEmpty && member.id.isNotEmpty) {
      return selected.id == member.id;
    }
    return selected.name == member.name;
  }

  bool _isSlotSelected(SalonSlot slot) {
    final selected = _slot;
    if (selected == null) return false;
    if (selected.id.isNotEmpty && slot.id.isNotEmpty) {
      return selected.id == slot.id;
    }
    return selected.startTime == slot.startTime &&
        selected.staffId == slot.staffId &&
        selected.slotDate == slot.slotDate;
  }

  String _slotKey(SalonSlot slot) =>
      '${slot.staffId}|${slot.slotDate}|${slot.startTime}|${slot.id}';

  String _rupee(double value) => '₹${value.toStringAsFixed(0)}';

  String _servicePriceLine(SalonService service) {
    final male = service.priceFor('MALE');
    final female = service.priceFor('FEMALE');
    if (male != null && female != null) {
      return 'Male ${_rupee(male.sellingPrice)}  |  Female ${_rupee(female.sellingPrice)}';
    }
    if (female != null) {
      return 'Female Only  ${_rupee(female.sellingPrice)}';
    }
    if (male != null) {
      return 'Male Only  ${_rupee(male.sellingPrice)}';
    }
    return service.priceLabel;
  }

  @override
  void initState() {
    super.initState();
    _slotDate = _dates.first;
    _packages = widget.outlet.packages;
    _skipCategoryStep = widget.outlet.salonCategory.trim().isNotEmpty;
    _loadPackages();
  }

  @override
  void dispose() {
    _serviceSearchDebounce?.cancel();
    _staffSearchDebounce?.cancel();
    _search.dispose();
    _staffSearch.dispose();
    super.dispose();
  }

  void _onServiceSearchChanged(String value) {
    _serviceSearchDebounce?.cancel();
    _serviceSearchDebounce = Timer(
      const Duration(milliseconds: 350),
      _loadServices,
    );
  }

  void _onStaffSearchChanged(String value) {
    _staffSearchDebounce?.cancel();
    _staffSearchDebounce = Timer(const Duration(milliseconds: 350), _loadStaff);
  }

  Future<void> _loadPackages() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      var packages = _packages;
      if (packages.isEmpty) {
        packages = await _api.salonPackages(outletId: widget.outlet.id);
      }
      if (!mounted) return;

      final initial = _initialPackage(packages);
      if (initial != null) {
        _skipCategoryStep = true;
        setState(() => _packages = packages);
        await _selectPackage(initial);
        return;
      }

      setState(() {
        _packages = packages;
        _skipCategoryStep = false;
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

  SalonPackage? _initialPackage(List<SalonPackage> packages) {
    if (packages.isEmpty) return null;

    final category = widget.outlet.salonCategory.trim();
    if (category.isNotEmpty) {
      for (final package in packages) {
        if (package.name.toLowerCase() == category.toLowerCase()) {
          return package;
        }
      }
      for (final package in packages) {
        if (package.slug.toLowerCase() == category.toLowerCase()) {
          return package;
        }
      }
    }

    return packages.length == 1 ? packages.first : null;
  }

  Future<void> _selectPackage(SalonPackage package) async {
    setState(() {
      _package = package;
      _service = null;
      _staffMember = null;
      _slot = null;
      _gender = '';
      _serviceType = 'All';
      _search.clear();
      _staffSearch.clear();
      _services = [];
      _staff = [];
      _slots = [];
      _step = 1;
    });
    await _loadServices();
  }

  Future<void> _loadServices() async {
    final package = _package;
    if (package == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final services = await _api.salonServices(
        outletId: widget.outlet.id,
        packageId: package.id,
        serviceType: _serviceType == 'All' ? '' : _serviceType,
        queryText: _search.text.trim(),
      );
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
    final options = _genderOptions(service);
    setState(() {
      _service = service;
      _staffMember = null;
      _slot = null;
      _staff = [];
      _slots = [];
      _staffSearch.clear();
      _gender = options.length == 1 ? options.first : '';
    });

    if (options.length <= 1) {
      setState(() => _step = 3);
      await _loadStaff();
    } else {
      setState(() => _step = 2);
    }
  }

  void _pickGender(String gender) {
    setState(() => _gender = gender);
  }

  Future<void> _continueFromGender() async {
    if (_gender.isEmpty) return;
    setState(() {
      _staffMember = null;
      _slot = null;
      _staff = [];
      _slots = [];
      _staffSearch.clear();
      _step = 3;
    });
    await _loadStaff();
  }

  void _pickStaff(SalonStaff staff) {
    if (_isStaffSelected(staff)) return;
    setState(() {
      _staffMember = staff;
      _slot = null;
      _slots = [];
    });
    _loadSlots();
  }

  Future<void> _continueFromSchedule() async {
    if (_staffMember == null || _slot == null) return;
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (signedIn != true) return;
    }
    setState(() => _step = 4);
  }

  Future<void> _loadStaff() async {
    final service = _service;
    if (service == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final staff = await _api.salonStaff(
        outletId: widget.outlet.id,
        serviceId: service.id,
        gender: _gender,
        queryText: _staffSearch.text.trim(),
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

  Future<void> _loadSlots() async {
    final staff = _staffMember;
    final service = _service;
    if (staff == null || service == null) return;
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
        serviceId: service.id,
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

  void _pickSlot(SalonSlot slot) {
    setState(() => _slot = slot);
  }

  Future<void> _confirm() async {
    final service = _service;
    final staff = _staffMember;
    final slot = _slot;
    final package = _package;
    if (service == null || staff == null || slot == null || package == null) {
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
      final result = await AuthService.instance.api.bookAppointment(
        slotId: slot.id.isNotEmpty ? slot.id : null,
        serviceId: service.id,
        outletId: widget.outlet.id,
        packageId: package.id,
        staffId: staff.id,
        gender: _gender,
        appointmentDate: _slotDate,
        startTime: slot.startTime,
      );
      await AuthService.instance.recoverAccount();
      if (!mounted) return;
      setState(() {
        _booking = false;
        _confirmed = true;
        _appointment = result.appointment;
        _whatsappSent = result.whatsappSent;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _booking = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  Future<bool> _onWillPop() async {
    if (_confirmed) return true;
    if (_step > 0) {
      if (_skipCategoryStep && _step == 1) return true;
      if (_step == 3 &&
          _service != null &&
          _genderOptions(_service!).length <= 1) {
        setState(() => _step = 1);
        return false;
      }
      setState(() => _step -= 1);
      return false;
    }
    return true;
  }

  String get _stepTitle {
    switch (_step) {
      case 2:
        return _service?.name ?? 'Service';
      case 3:
        return 'Expert & Schedule';
      case 4:
        return 'Booking Summary';
      default:
        return widget.outlet.name;
    }
  }

  String? get _stepSubtitle {
    switch (_step) {
      case 2:
        return _packageLabel;
      case 3:
        final service = _service?.name ?? '';
        final gender = _genderLabel;
        if (service.isEmpty) return null;
        return gender.isEmpty ? service : '$service · $gender';
      default:
        return _step == 1 ? _packageLabel : null;
    }
  }

  Widget? _buildBottomBar() {
    if (_confirmed || _loading && _step == 1 && _services.isEmpty) {
      return null;
    }
    switch (_step) {
      case 2:
        return _SalonBottomBar(
          label: 'Continue',
          enabled: _gender.isNotEmpty,
          onPressed: _continueFromGender,
        );
      case 3:
        return _SalonBottomBar(
          label: 'Continue to Summary',
          enabled: _staffMember != null && _slot != null,
          onPressed: _continueFromSchedule,
        );
      case 4:
        return _SalonBottomBar(
          label: 'Confirm Booking',
          enabled: !_booking,
          loading: _booking,
          onPressed: _confirm,
        );
      default:
        return null;
    }
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _stepTitle,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          if (_stepSubtitle != null && _stepSubtitle!.isNotEmpty)
            Text(
              _stepSubtitle!,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: kHomePink,
              ),
            ),
        ],
      ),
      actions: [
        if (_step == 1)
          IconButton(
            tooltip: 'Share',
            onPressed: () {},
            icon: const Icon(Icons.share_outlined),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _confirmed || (_skipCategoryStep && _step == 1) || _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _onWillPop();
      },
      child: Scaffold(
        appBar: _confirmed ? null : _buildAppBar(),
        bottomNavigationBar: _buildBottomBar(),
        body: Stack(
          children: [
            if (_confirmed && _appointment != null)
              _ConfirmationView(
                outlet: widget.outlet,
                package: _package,
                service: _service,
                gender: _genderLabel,
                staff: _staffMember,
                date: _slotDate,
                time: _slot?.startTime ?? '',
                amount: _appointment!.totalLabel,
                bookingId: _appointment!.appointmentNumber,
                whatsappSent: _whatsappSent,
                bookingStatus: _appointment!.status,
                onBookings: () {
                  Navigator.of(context).pushReplacement(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          BookingsScreen(highlightId: _appointment!.id),
                    ),
                  );
                },
                onHome: () =>
                    Navigator.of(context).popUntil((route) => route.isFirst),
              )
            else
              _buildStepBody(),
            if (_booking)
              const ColoredBox(
                color: Color(0x66000000),
                child: Center(child: CircularProgressIndicator()),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildStepBody() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        if (_step == 1 && widget.outlet.addressLine1.isNotEmpty) ...[
          Text(
            widget.outlet.subtitle,
            style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
          ),
          const SizedBox(height: 12),
        ],
        if (_step == 0 && !_skipCategoryStep) ..._packageStep(context),
        if (_step == 1) ..._serviceStep(context),
        if (_step == 2) ..._genderStep(context),
        if (_step == 3) ..._expertScheduleStep(context),
        if (_step == 4) ..._summaryStep(context),
        if (_loading)
          const Padding(
            padding: EdgeInsets.only(top: 32),
            child: Center(child: CircularProgressIndicator(color: kHomePink)),
          ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(
            _error!.replaceFirst('Exception: ', ''),
            style: const TextStyle(color: kHomeTextSecondary),
          ),
          TextButton(onPressed: _retry, child: const Text('Retry')),
        ],
      ],
    );
  }

  Future<void> _retry() async {
    switch (_step) {
      case 0:
        await _loadPackages();
        break;
      case 1:
        await _loadServices();
        break;
      case 3:
        await _loadStaff();
        break;
      case 4:
        break;
    }
  }

  List<Widget> _packageStep(BuildContext context) {
    return [
      Text('Select category', style: Theme.of(context).textTheme.titleSmall),
      const SizedBox(height: 8),
      if (_packages.isEmpty && !_loading)
        const Text('No categories are configured for this salon yet.')
      else
        ..._packages.map(
          (package) => Card(
            child: ListTile(
              title: Text(package.name),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _selectPackage(package),
            ),
          ),
        ),
    ];
  }

  List<Widget> _serviceStep(BuildContext context) {
    final types =
        <String>{
          ..._filterTypes,
          ..._services
              .map((item) => item.serviceType)
              .where((item) => item.isNotEmpty),
        }.toList()..sort((a, b) {
          final ai = _filterTypes.indexOf(a);
          final bi = _filterTypes.indexOf(b);
          if (ai >= 0 && bi >= 0) return ai.compareTo(bi);
          if (ai >= 0) return -1;
          if (bi >= 0) return 1;
          return a.compareTo(b);
        });

    return [
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: 'Search service',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: kHomeCard,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: const BorderSide(color: kHomeOutline),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: const BorderSide(color: kHomeOutline),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(24),
                  borderSide: const BorderSide(color: kHomePink),
                ),
              ),
              onSubmitted: (_) => _loadServices(),
              onChanged: _onServiceSearchChanged,
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            style: IconButton.styleFrom(
              backgroundColor: kHomePink.withValues(alpha: 0.15),
              foregroundColor: kHomePink,
            ),
            onPressed: _loadServices,
            icon: const Icon(Icons.tune_rounded),
          ),
        ],
      ),
      const SizedBox(height: 12),
      SizedBox(
        height: 36,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: types.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (context, index) {
            final type = types[index];
            final selected = _serviceType == type;
            return _SalonFilterChip(
              label: type,
              selected: selected,
              onTap: () {
                setState(() => _serviceType = type);
                _loadServices();
              },
            );
          },
        ),
      ),
      const SizedBox(height: 8),
      if (_services.isEmpty && !_loading)
        const Padding(
          padding: EdgeInsets.only(top: 24),
          child: Center(
            child: Text(
              'No services match this filter.',
              style: TextStyle(color: kHomeTextSecondary),
            ),
          ),
        )
      else
        ..._services.map(
          (service) => _ServiceListTile(
            service: service,
            priceLine: _servicePriceLine(service),
            onTap: () => _selectService(service),
          ),
        ),
    ];
  }

  List<Widget> _genderStep(BuildContext context) {
    final service = _service;
    if (service == null) return const [];

    final options = _genderOptions(service);
    return [
      ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: AspectRatio(
          aspectRatio: 16 / 9,
          child: service.imageUrl.isEmpty
              ? const ColoredBox(
                  color: kHomeCard,
                  child: Icon(Icons.spa_outlined, size: 48, color: kHomePink),
                )
              : Image.network(
                  service.imageUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => const ColoredBox(
                    color: kHomeCard,
                    child: Icon(Icons.spa_outlined, size: 48, color: kHomePink),
                  ),
                ),
        ),
      ),
      const SizedBox(height: 16),
      ...options.map((gender) {
        final price = service.priceFor(gender);
        final selected = _gender == gender;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: _GenderOptionTile(
            gender: gender,
            price: price == null ? '' : _rupee(price.sellingPrice),
            selected: selected,
            onTap: () => _pickGender(gender),
          ),
        );
      }),
      if (service.description.isNotEmpty) ...[
        const SizedBox(height: 8),
        Text(
          'About Service',
          style: Theme.of(context).textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        Text(
          service.description,
          style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            _MetaChip(icon: Icons.schedule, label: service.durationLabel),
            const SizedBox(width: 12),
            if (service.serviceType.isNotEmpty)
              _MetaChip(
                icon: Icons.category_outlined,
                label: service.serviceType,
              ),
          ],
        ),
      ],
    ];
  }

  List<Widget> _expertScheduleStep(BuildContext context) {
    final expertSelected = _staffMember != null;
    return [
      TextField(
        controller: _staffSearch,
        decoration: InputDecoration(
          hintText: 'Search expert by name',
          prefixIcon: const Icon(Icons.search),
          filled: true,
          fillColor: kHomeCard,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(24),
            borderSide: const BorderSide(color: kHomeOutline),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(24),
            borderSide: const BorderSide(color: kHomeOutline),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(24),
            borderSide: const BorderSide(color: kHomePink),
          ),
        ),
        onChanged: _onStaffSearchChanged,
        onSubmitted: (_) => _loadStaff(),
      ),
      const SizedBox(height: 12),
      if (_staff.isEmpty && !_loading)
        const Padding(
          padding: EdgeInsets.only(top: 12, bottom: 12),
          child: Center(
            child: Text(
              'No service experts available for this service.',
              style: TextStyle(color: kHomeTextSecondary),
            ),
          ),
        )
      else
        ..._staff.map(
          (member) => _ExpertTile(
            staff: member,
            selected: _isStaffSelected(member),
            onTap: () => _pickStaff(member),
          ),
        ),
      if (expertSelected) ...[
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: Text(
                'Select Date',
                style: Theme.of(context).textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            Text(
              _formatDisplayDate(_slotDate),
              style: const TextStyle(
                color: kHomePink,
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 86,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _dates.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (context, index) {
              final date = _dates[index];
              final selected = _slotDate == date;
              final parts = date.split('-');
              final dayNum = parts.length == 3 ? parts[2] : '';
              final month = parts.length == 3
                  ? _formatDisplayDate(date).split(' ').last
                  : '';
              return _DateChip(
                weekday: _weekdayLabel(date),
                day: dayNum,
                month: month,
                selected: selected,
                onTap: () {
                  setState(() {
                    _slotDate = date;
                    _slot = null;
                  });
                  _loadSlots();
                },
              );
            },
          ),
        ),
        const SizedBox(height: 20),
        Text(
          'Select Time Slot',
          style: Theme.of(context).textTheme.titleSmall
              ?.copyWith(fontWeight: FontWeight.w800),
        ),
        if (_staffMember != null) ...[
          const SizedBox(height: 4),
          Text(
            'With ${_staffMember!.name}',
            style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
          ),
        ],
        const SizedBox(height: 10),
        if (_loading && _slots.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: CircularProgressIndicator(color: kHomePink)),
          )
        else if (_slots.isEmpty)
          const Text(
            'No open slots for this date. Try another day.',
            style: TextStyle(color: kHomeTextSecondary),
          )
        else
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: _slots.map((slot) {
              return _TimeSlotChip(
                key: ValueKey(_slotKey(slot)),
                label: slot.startTime,
                selected: _isSlotSelected(slot),
                onTap: () => _pickSlot(slot),
              );
            }).toList(),
          ),
      ],
    ];
  }

  String _weekdayLabel(String isoDate) {
    final parts = isoDate.split('-');
    if (parts.length != 3) return '';
    final date = DateTime(
      int.parse(parts[0]),
      int.parse(parts[1]),
      int.parse(parts[2]),
    );
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days[date.weekday - 1];
  }

  List<Widget> _summaryStep(BuildContext context) {
    return [
      _SummaryCard(
        outlet: widget.outlet,
        package: _package?.name ?? '',
        service: _service?.name ?? '',
        gender: _genderLabel,
        expert: _staffMember?.name ?? '',
        duration: _service?.durationLabel ?? '',
        date: _formatDisplayDate(_slotDate),
        time: _slot?.startTime ?? '',
        amount: _priceLabel,
      ),
    ];
  }
}

class _SalonFilterChip extends StatelessWidget {
  const _SalonFilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          decoration: BoxDecoration(
            color: selected ? kHomePink : kHomeCard,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: selected ? kHomePink : kHomeOutline),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : kHomeTextSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ServiceListTile extends StatelessWidget {
  const _ServiceListTile({
    required this.service,
    required this.priceLine,
    required this.onTap,
  });

  final SalonService service;
  final String priceLine;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final femaleOnly =
        service.priceFor('MALE') == null && service.priceFor('FEMALE') != null;

    return Column(
      children: [
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: SizedBox(
                    width: 56,
                    height: 56,
                    child: service.imageUrl.isEmpty
                        ? const ColoredBox(
                            color: kHomeCard,
                            child: Icon(Icons.spa_outlined, color: kHomePink),
                          )
                        : Image.network(
                            service.imageUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => const ColoredBox(
                              color: kHomeCard,
                              child: Icon(Icons.spa_outlined, color: kHomePink),
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        service.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        priceLine,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: femaleOnly ? kHomePink : kHomeTextSecondary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        service.durationLabel,
                        style: const TextStyle(
                          fontSize: 12,
                          color: kHomeTextSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right, color: kHomeTextSecondary),
              ],
            ),
          ),
        ),
        const Divider(height: 1, color: kHomeOutline),
      ],
    );
  }
}

class _GenderOptionTile extends StatelessWidget {
  const _GenderOptionTile({
    required this.gender,
    required this.price,
    required this.selected,
    required this.onTap,
  });

  final String gender;
  final String price;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isMale = gender == 'MALE';
    final label = isMale ? 'Male' : 'Female';
    final iconColor = isMale ? const Color(0xFF4A90E2) : kHomePink;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          decoration: BoxDecoration(
            color: selected ? kHomePink.withValues(alpha: 0.12) : kHomeCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected ? kHomePink : kHomeOutline,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: iconColor.withValues(alpha: 0.15),
                  child: Icon(
                    isMale ? Icons.man_outlined : Icons.woman_outlined,
                    color: iconColor,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                Text(
                  price,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  selected ? Icons.check_circle : Icons.circle_outlined,
                  color: selected ? kHomePink : kHomeTextSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ExpertTile extends StatelessWidget {
  const _ExpertTile({
    required this.staff,
    required this.selected,
    required this.onTap,
  });

  final SalonStaff staff;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Ink(
            decoration: BoxDecoration(
              color: selected ? kHomePink.withValues(alpha: 0.10) : kHomeCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: selected ? kHomePink : kHomeOutline,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: kHomeSurface,
                    backgroundImage: staff.profilePhotoUrl.isEmpty
                        ? null
                        : (staff.profilePhotoUrl.startsWith('assets/')
                              ? AssetImage(staff.profilePhotoUrl)
                              : NetworkImage(staff.profilePhotoUrl)),
                    child: staff.profilePhotoUrl.isEmpty
                        ? const Icon(Icons.person_outline, color: kHomePink)
                        : null,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          staff.name,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          staff.designation,
                          style: const TextStyle(
                            color: kHomeTextSecondary,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            if (staff.ratingLabel.isNotEmpty) ...[
                              const Icon(
                                Icons.star_rounded,
                                size: 14,
                                color: kHomeStarColor,
                              ),
                              Text(
                                ' ${staff.ratingLabel}',
                                style: const TextStyle(fontSize: 12),
                              ),
                              const SizedBox(width: 8),
                            ],
                            if (staff.experienceYears > 0)
                              Text(
                                '${staff.experienceYears.toStringAsFixed(0)}+ Years Exp.',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: kHomeTextSecondary,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    selected
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    color: selected ? kHomePink : kHomeTextSecondary,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DateChip extends StatelessWidget {
  const _DateChip({
    required this.weekday,
    required this.day,
    required this.month,
    required this.selected,
    required this.onTap,
  });

  final String weekday;
  final String day;
  final String month;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Ink(
          width: 58,
          height: 86,
          decoration: BoxDecoration(
            color: selected ? kHomePink : kHomeCard,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: selected ? kHomePink : kHomeOutline),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                weekday,
                style: TextStyle(
                  fontSize: 11,
                  height: 1.1,
                  color: selected ? Colors.white70 : kHomeTextSecondary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                day,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 18,
                  height: 1.1,
                  color: selected ? Colors.white : null,
                ),
              ),
              Text(
                month,
                style: TextStyle(
                  fontSize: 10,
                  height: 1.1,
                  color: selected ? Colors.white70 : kHomeTextSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TimeSlotChip extends StatelessWidget {
  const _TimeSlotChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Ink(
          decoration: BoxDecoration(
            color: selected ? kHomePink : kHomeCard,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: selected ? kHomePink : kHomeOutline),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: selected ? Colors.white : null,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: kHomeTextSecondary),
        const SizedBox(width: 4),
        Text(
          label,
          style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
        ),
      ],
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.outlet,
    required this.package,
    required this.service,
    required this.gender,
    required this.expert,
    required this.duration,
    required this.date,
    required this.time,
    required this.amount,
  });

  final SalonOutlet outlet;
  final String package;
  final String service;
  final String gender;
  final String expert;
  final String duration;
  final String date;
  final String time;
  final String amount;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: const SizedBox(
                    width: 48,
                    height: 48,
                    child: ColoredBox(
                      color: kHomeSurface,
                      child: Icon(Icons.storefront_outlined, color: kHomePink),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        outlet.name,
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      Text(
                        outlet.locationLabel,
                        style: const TextStyle(
                          color: kHomeTextSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 24, color: kHomeOutline),
            _SummaryRow(
              icon: Icons.spa_outlined,
              label: 'Service',
              value: service,
            ),
            _SummaryRow(
              icon: Icons.layers_outlined,
              label: 'Category',
              value: package,
            ),
            _SummaryRow(
              icon: Icons.person_outline,
              label: 'Gender',
              value: gender,
            ),
            _SummaryRow(
              icon: Icons.badge_outlined,
              label: 'Expert',
              value: expert,
            ),
            _SummaryRow(
              icon: Icons.schedule,
              label: 'Duration',
              value: duration,
            ),
            _SummaryRow(
              icon: Icons.calendar_today_outlined,
              label: 'Date',
              value: date,
            ),
            _SummaryRow(icon: Icons.access_time, label: 'Time', value: time),
            const Divider(height: 24, color: kHomeOutline),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Total Amount',
                  style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16),
                ),
                Text(
                  amount,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 18,
                    color: kHomePink,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  const _SummaryRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(icon, size: 18, color: kHomeTextSecondary),
          const SizedBox(width: 10),
          SizedBox(
            width: 72,
            child: Text(
              label,
              style: const TextStyle(color: kHomeTextSecondary, fontSize: 13),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
            ),
          ),
        ],
      ),
    );
  }
}

class _SalonBottomBar extends StatelessWidget {
  const _SalonBottomBar({
    required this.label,
    required this.enabled,
    required this.onPressed,
    this.loading = false,
  });

  final String label;
  final bool enabled;
  final VoidCallback onPressed;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: FilledButton(
          onPressed: enabled && !loading ? onPressed : null,
          child: loading
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : Text(label),
        ),
      ),
    );
  }
}

class _ConfirmationView extends StatelessWidget {
  const _ConfirmationView({
    required this.outlet,
    required this.package,
    required this.service,
    required this.gender,
    required this.staff,
    required this.date,
    required this.time,
    required this.amount,
    required this.bookingId,
    required this.whatsappSent,
    required this.bookingStatus,
    required this.onBookings,
    required this.onHome,
  });

  final SalonOutlet outlet;
  final SalonPackage? package;
  final SalonService? service;
  final String gender;
  final SalonStaff? staff;
  final String date;
  final String time;
  final String amount;
  final String bookingId;
  final bool whatsappSent;
  final String bookingStatus;
  final VoidCallback onBookings;
  final VoidCallback onHome;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: kHomeCanvas,
      child: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            const SizedBox(height: 24),
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: kHomePink.withValues(alpha: 0.15),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.check_circle_rounded,
                color: kHomePink,
                size: 48,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Booking Confirmed!',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              bookingStatus.toUpperCase() == 'CONFIRMED'
                  ? 'Your booking is confirmed and saved under My Bookings.'
                  : 'Your booking has been placed successfully.',
              style: const TextStyle(color: kHomeTextSecondary),
            ),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SummaryRow(
                      icon: Icons.confirmation_number_outlined,
                      label: 'Booking ID',
                      value: bookingId,
                    ),
                    _SummaryRow(
                      icon: Icons.storefront_outlined,
                      label: 'Salon',
                      value: outlet.name,
                    ),
                    _SummaryRow(
                      icon: Icons.layers_outlined,
                      label: 'Category',
                      value: package?.name ?? '',
                    ),
                    _SummaryRow(
                      icon: Icons.spa_outlined,
                      label: 'Service',
                      value: service?.name ?? '',
                    ),
                    _SummaryRow(
                      icon: Icons.badge_outlined,
                      label: 'Expert',
                      value: staff?.name ?? '',
                    ),
                    _SummaryRow(
                      icon: Icons.calendar_today_outlined,
                      label: 'Date',
                      value: date,
                    ),
                    _SummaryRow(
                      icon: Icons.access_time,
                      label: 'Time',
                      value: time,
                    ),
                    _SummaryRow(
                      icon: Icons.payments_outlined,
                      label: 'Amount',
                      value: amount,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  whatsappSent ? Icons.mark_chat_read_outlined : Icons.info_outline,
                  size: 18,
                  color: whatsappSent ? const Color(0xFF25D366) : kHomeTextSecondary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    whatsappSent
                        ? 'WhatsApp confirmation sent to your registered mobile number.'
                        : 'Booking saved. WhatsApp confirmation will arrive once messaging is configured on your account mobile.',
                    style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: onBookings,
              child: const Text('View My Bookings'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onHome, child: const Text('Go To Home')),
          ],
        ),
      ),
    );
  }
}
