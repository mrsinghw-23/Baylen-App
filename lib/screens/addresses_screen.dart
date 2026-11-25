import 'dart:async';

import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
import '../services/location_service.dart';
import '../services/pincode_lookup_service.dart';
import '../widgets/offline_account_banner.dart';
import 'login_screen.dart';

class AddressesScreen extends StatefulWidget {
  const AddressesScreen({super.key});

  @override
  State<AddressesScreen> createState() => _AddressesScreenState();
}

class _AddressesScreenState extends State<AddressesScreen> {
  List<Address> _addresses = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() {
        _loading = false;
        _addresses = [];
      });
      return;
    }
    final cached = AuthService.instance.bootstrap.value?.addresses ?? [];
    setState(() {
      if (cached.isNotEmpty) {
        _addresses = cached;
        _loading = false;
      } else {
        _loading = true;
      }
      _error = null;
    });
    try {
      final addresses = await AuthService.instance.api.addresses();
      AuthService.instance.noteLiveDataReceived();
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (_addresses.isEmpty) {
          _error = error.toString();
        }
        _loading = false;
      });
    }
  }

  Future<void> _saveAddress({Address? existing}) async {
    final result = await showModalBottomSheet<_AddressDraft>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _AddressSheet(existing: existing),
    );
    if (result == null) return;
    setState(() => _loading = true);
    try {
      final addresses = existing == null
          ? await AuthService.instance.api.addAddress(
              label: result.label,
              line1: result.line1,
              line2: result.line2,
              city: result.city,
              state: result.state,
              postalCode: result.postalCode,
              fullName: result.fullName,
              phone: result.phone,
              isDefault: result.isDefault,
              latitude: result.latitude,
              longitude: result.longitude,
              landmark: result.landmark,
            )
          : await AuthService.instance.api.updateAddress(
              addressId: existing.id,
              label: result.label,
              line1: result.line1,
              line2: result.line2,
              city: result.city,
              state: result.state,
              postalCode: result.postalCode,
              fullName: result.fullName,
              phone: result.phone,
              isDefault: result.isDefault,
              latitude: result.latitude,
              longitude: result.longitude,
              landmark: result.landmark,
            );
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _loading = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(existing == null ? 'Address saved' : 'Address updated'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _setDefault(Address address) async {
    setState(() => _loading = true);
    try {
      final addresses = await AuthService.instance.api.setDefaultAddress(
        address.id,
      );
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _remove(Address address) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete address?'),
        content: Text('Remove ${address.label} from your saved addresses?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _loading = true);
    try {
      await AuthService.instance.api.removeAddress(address.id);
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Addresses')),
          floatingActionButton: user == null
              ? null
              : FloatingActionButton.extended(
                  onPressed: () => _saveAddress(),
                  icon: const Icon(Icons.add_location_alt_outlined),
                  label: const Text('Add'),
                ),
          body: Column(
            children: [
              const OfflineAccountBanner(),
              Expanded(
                child: user == null
              ? Center(
                  child: FilledButton(
                    onPressed: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<bool>(
                          builder: (_) => const LoginScreen(),
                        ),
                      );
                    },
                    child: const Text('Sign in'),
                  ),
                )
              : _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? _ErrorState(message: _error!, onRetry: _load)
              : _addresses.isEmpty
              ? _EmptyAddressState(onAdd: () => _saveAddress())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
                    itemCount: _addresses.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final address = _addresses[index];
                      return _AddressCard(
                        address: address,
                        onEdit: () => _saveAddress(existing: address),
                        onRemove: () => _remove(address),
                        onSetDefault: address.isDefault
                            ? null
                            : () => _setDefault(address),
                      );
                    },
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _AddressCard extends StatelessWidget {
  const _AddressCard({
    required this.address,
    required this.onEdit,
    required this.onRemove,
    required this.onSetDefault,
  });

  final Address address;
  final VoidCallback onEdit;
  final VoidCallback onRemove;
  final VoidCallback? onSetDefault;

  @override
  Widget build(BuildContext context) {
    final hasPin = address.latitude != null && address.longitude != null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  _iconFor(address.label),
                  color: Theme.of(context).colorScheme.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    address.label,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (address.isDefault)
                  const Chip(
                    label: Text('Default'),
                    visualDensity: VisualDensity.compact,
                  ),
              ],
            ),
            const SizedBox(height: 8),
            if (address.fullName.isNotEmpty || address.phone.isNotEmpty)
              Text(
                [
                  address.fullName,
                  address.phone,
                ].where((p) => p.isNotEmpty).join(' / '),
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            const SizedBox(height: 4),
            Text(address.summary),
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(
                  hasPin ? Icons.my_location : Icons.location_off_outlined,
                  size: 16,
                  color: hasPin
                      ? const Color(0xFF35D07F)
                      : const Color(0xFFAAA4B6),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    hasPin ? 'Delivery pin saved' : 'Map pin not saved. Add location for accurate delivery.',
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(0xFFAAA4B6),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton.icon(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('Edit'),
                ),
                if (onSetDefault != null)
                  OutlinedButton.icon(
                    onPressed: onSetDefault,
                    icon: const Icon(Icons.check_circle_outline),
                    label: const Text('Set default'),
                  ),
                OutlinedButton.icon(
                  onPressed: onRemove,
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('Delete'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  IconData _iconFor(String label) {
    switch (label.toLowerCase()) {
      case 'home':
        return Icons.home_outlined;
      case 'work':
        return Icons.work_outline;
      case 'office':
        return Icons.apartment_outlined;
      default:
        return Icons.location_on_outlined;
    }
  }
}

class _AddressDraft {
  const _AddressDraft({
    required this.label,
    required this.fullName,
    required this.phone,
    required this.line1,
    required this.line2,
    required this.city,
    required this.state,
    required this.postalCode,
    required this.isDefault,
    this.landmark = '',
    this.latitude,
    this.longitude,
  });

  final String label;
  final String fullName;
  final String phone;
  final String line1;
  final String line2;
  final String landmark;
  final String city;
  final String state;
  final String postalCode;
  final bool isDefault;
  final double? latitude;
  final double? longitude;
}

class _AddressSheet extends StatefulWidget {
  const _AddressSheet({this.existing});

  final Address? existing;

  @override
  State<_AddressSheet> createState() => _AddressSheetState();
}

class _AddressSheetState extends State<_AddressSheet> {
  final _formKey = GlobalKey<FormState>();
  final _customLabel = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _line1 = TextEditingController();
  final _line2 = TextEditingController();
  final _landmark = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _district = TextEditingController();
  final _postal = TextEditingController();
  Timer? _pinDebounce;
  late final PincodeLookupService _pincodeLookup =
      PincodeLookupService(AuthService.instance.api);
  String _selectedType = 'Home';
  bool _customType = false;
  bool _isDefault = true;
  bool _pinLoading = false;
  bool _locationLoading = false;
  String? _pinMessage;
  String? _locationMessage;
  double? _latitude;
  double? _longitude;

  @override
  void initState() {
    super.initState();
    final address = widget.existing;
    if (address != null) {
      final type = ['Home', 'Work', 'Office'].contains(address.label)
          ? address.label
          : 'Custom';
      _selectedType = type == 'Custom' ? 'Home' : type;
      _customType = type == 'Custom';
      _customLabel.text = _customType ? address.label : '';
      _name.text = address.fullName;
      _phone.text = address.phone;
      _line1.text = address.line1;
      _line2.text = address.line2;
      _landmark.text = address.landmark;
      _city.text = address.city;
      _state.text = address.state;
      _postal.text = address.postalCode;
      _isDefault = address.isDefault;
      _latitude = address.latitude;
      _longitude = address.longitude;
    }
  }

  @override
  void dispose() {
    _pinDebounce?.cancel();
    _customLabel.dispose();
    _name.dispose();
    _phone.dispose();
    _line1.dispose();
    _line2.dispose();
    _landmark.dispose();
    _city.dispose();
    _state.dispose();
    _district.dispose();
    _postal.dispose();
    super.dispose();
  }

  String get _label {
    if (_customType) {
      final custom = _customLabel.text.trim();
      return custom.isEmpty ? 'Other' : custom;
    }
    return _selectedType;
  }

  String get _line2Value {
    return [
      _line2.text.trim(),
      if (_landmark.text.trim().isNotEmpty)
        'Landmark: ${_landmark.text.trim()}',
      if (_district.text.trim().isNotEmpty)
        'District: ${_district.text.trim()}',
    ].where((part) => part.isNotEmpty).join(' | ');
  }

  void _onPinChanged(String value) {
    _pinDebounce?.cancel();
    final normalized = PincodeLookupService.normalizePin(value);
    if (normalized != value) {
      _postal.value = TextEditingValue(
        text: normalized,
        selection: TextSelection.collapsed(offset: normalized.length),
      );
    }
    if (normalized.length != 6) {
      setState(() => _pinMessage = null);
      return;
    }
    _pinDebounce = Timer(const Duration(milliseconds: 450), () {
      _lookupPin(normalized);
    });
  }

  Future<void> _lookupPin(String pin) async {
    setState(() {
      _pinLoading = true;
      _pinMessage = null;
    });
    try {
      final result = await _pincodeLookup.lookup(pin);
      if (!mounted) return;
      setState(() {
        if (result.city.isNotEmpty) _city.text = result.city;
        if (result.state.isNotEmpty) _state.text = result.state;
        if (result.district.isNotEmpty) _district.text = result.district;
        if (_line2.text.trim().isEmpty && result.area.isNotEmpty) {
          _line2.text = result.area;
        }
        _pinMessage = 'Location loaded: ${result.city}, ${result.state}';
        _pinLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _pinMessage = error.toString();
        _pinLoading = false;
      });
    }
  }

  Future<void> _useCurrentLocation() async {
    setState(() {
      _locationLoading = true;
      _locationMessage = null;
    });
    try {
      await LocationService.instance.fetchCurrentLocation(force: true);
      final loc = LocationService.instance.currentLocation.value;
      if (loc == null) {
        throw Exception('Unable to detect current location');
      }
      final resolved = await LocationService.instance.reverseGeocode(
        loc.latitude,
        loc.longitude,
      );
      if (!mounted) return;
      setState(() {
        _latitude = loc.latitude;
        _longitude = loc.longitude;
        _city.text = resolved['city']?.isNotEmpty == true
            ? resolved['city']!
            : _city.text;
        _state.text = resolved['state']?.isNotEmpty == true
            ? resolved['state']!
            : _state.text;
        _district.text = resolved['district']?.isNotEmpty == true
            ? resolved['district']!
            : _district.text;
        _postal.text = resolved['postal_code']?.isNotEmpty == true
            ? resolved['postal_code']!
            : _postal.text;
        if (_line2.text.trim().isEmpty) {
          _line2.text = resolved['area']?.isNotEmpty == true
              ? resolved['area']!
              : loc.area;
        }
        _locationMessage = 'Approximate delivery pin captured. Please check and adjust address details before saving.';
        _locationLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _locationMessage = error.toString();
        _locationLoading = false;
      });
    }
  }

  void _save() {
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      _AddressDraft(
        label: _label,
        fullName: _name.text.trim(),
        phone: _phone.text.trim(),
        line1: _line1.text.trim(),
        line2: _line2Value,
        landmark: _landmark.text.trim(),
        city: _city.text.trim(),
        state: _state.text.trim(),
        postalCode: _postal.text.trim(),
        isDefault: _isDefault,
        latitude: _latitude,
        longitude: _longitude,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: Form(
        key: _formKey,
        child: ListView(
          shrinkWrap: true,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    widget.existing == null ? 'Add address' : 'Edit address',
                    style: theme.textTheme.titleLarge,
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('Address type', style: theme.textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final type in const ['Home', 'Work', 'Office'])
                  ChoiceChip(
                    label: Text(type),
                    selected: !_customType && _selectedType == type,
                    onSelected: (_) {
                      setState(() {
                        _customType = false;
                        _selectedType = type;
                      });
                    },
                  ),
                ChoiceChip(
                  label: const Text('Custom'),
                  selected: _customType,
                  onSelected: (_) => setState(() => _customType = true),
                ),
              ],
            ),
            if (_customType) ...[
              const SizedBox(height: 8),
              TextFormField(
                controller: _customLabel,
                decoration: const InputDecoration(
                  labelText: 'Custom label',
                  hintText: 'e.g. Parents, Studio',
                ),
                validator: (value) {
                  if (_customType && (value == null || value.trim().isEmpty)) {
                    return 'Enter a custom address label';
                  }
                  return null;
                },
              ),
            ],
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _locationLoading ? null : _useCurrentLocation,
              icon: _locationLoading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.my_location),
              label: Text(
                _locationLoading ? 'Detecting...' : 'Use Current Location',
              ),
            ),
            if (_locationMessage != null) ...[
              const SizedBox(height: 6),
              Text(
                _locationMessage!,
                style: const TextStyle(color: Color(0xFFAAA4B6), fontSize: 12),
              ),
            ],
            if (_latitude != null && _longitude != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: theme.colorScheme.primary.withValues(alpha: 0.45),
                  ),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.pin_drop_outlined),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Pin: ${_latitude!.toStringAsFixed(5)}, ${_longitude!.toStringAsFixed(5)}',
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            TextFormField(
              controller: _name,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Full name',
                hintText: 'Recipient name',
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Full name is required'
                  : null,
            ),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Phone number',
                hintText: '10-digit mobile number',
              ),
              validator: (value) {
                final phone = value?.trim() ?? '';
                if (!RegExp(r'^[6-9]\d{9}$').hasMatch(phone)) {
                  return 'Enter a valid 10-digit Indian mobile number';
                }
                return null;
              },
            ),
            TextFormField(
              controller: _postal,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.next,
              maxLength: 6,
              onChanged: _onPinChanged,
              decoration: InputDecoration(
                labelText: 'PIN code',
                hintText: '6-digit PIN code',
                counterText: '',
                suffixIcon: _pinLoading
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
              validator: (value) {
                final pin = value?.trim() ?? '';
                if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
                  return 'Enter a valid 6-digit PIN code';
                }
                return null;
              },
            ),
            if (_pinMessage != null)
              Text(
                _pinMessage!,
                style: TextStyle(
                  color: _pinMessage!.startsWith('Location verified')
                      ? const Color(0xFF35D07F)
                      : theme.colorScheme.error,
                  fontSize: 12,
                ),
              ),
            TextFormField(
              controller: _line1,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'House / flat / building',
                hintText: 'Flat number, building, floor',
              ),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'Address detail is required'
                  : null,
            ),
            TextFormField(
              controller: _line2,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Street / area / locality',
                hintText: 'Street, area, locality',
              ),
            ),
            TextFormField(
              controller: _landmark,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(
                labelText: 'Landmark',
                hintText: 'Nearby landmark',
              ),
            ),
            TextFormField(
              controller: _city,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'City'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'City is required'
                  : null,
            ),
            TextFormField(
              controller: _district,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'District'),
            ),
            TextFormField(
              controller: _state,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(labelText: 'State'),
              validator: (value) => value == null || value.trim().isEmpty
                  ? 'State is required'
                  : null,
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _isDefault,
              title: const Text('Default address'),
              subtitle: const Text('Only one saved address can be default.'),
              onChanged: (value) => setState(() => _isDefault = value),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _save,
              child: Text(
                widget.existing == null ? 'Save address' : 'Update address',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyAddressState extends StatelessWidget {
  const _EmptyAddressState({required this.onAdd});

  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.add_location_alt_outlined, size: 48),
            const SizedBox(height: 12),
            const Text('No saved addresses yet.'),
            const SizedBox(height: 16),
            FilledButton(onPressed: onAdd, child: const Text('Add address')),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
