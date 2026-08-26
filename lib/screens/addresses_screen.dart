import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/account.dart';
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final addresses = await AuthService.instance.api.addresses();
      if (!mounted) return;
      setState(() {
        _addresses = addresses;
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

  Future<void> _addAddress() async {
    final result = await showModalBottomSheet<_AddressDraft>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _AddressSheet(),
    );
    if (result == null) {
      return;
    }
    setState(() => _loading = true);
    try {
      final addresses = await AuthService.instance.api.addAddress(
        label: result.label,
        line1: result.line1,
        city: result.city,
        state: result.state,
        postalCode: result.postalCode,
        fullName: result.fullName,
        phone: result.phone,
        isDefault: result.isDefault,
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
    await AuthService.instance.api.removeAddress(address.id);
    await _load();
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
              : FloatingActionButton(
                  onPressed: _addAddress,
                  child: const Icon(Icons.add),
                ),
          body: user == null
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
              ? Center(child: Text(_error!))
              : _addresses.isEmpty
              ? const Center(child: Text('No saved addresses yet.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _addresses.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final address = _addresses[index];
                      return Card(
                        child: ListTile(
                          leading: const Icon(Icons.location_on_outlined),
                          title: Text(address.label),
                          subtitle: Text(address.summary),
                          trailing: IconButton(
                            tooltip: 'Remove',
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => _remove(address),
                          ),
                        ),
                      );
                    },
                  ),
                ),
        );
      },
    );
  }
}

class _AddressDraft {
  const _AddressDraft({
    required this.label,
    required this.fullName,
    required this.phone,
    required this.line1,
    required this.city,
    required this.state,
    required this.postalCode,
    required this.isDefault,
  });

  final String label;
  final String fullName;
  final String phone;
  final String line1;
  final String city;
  final String state;
  final String postalCode;
  final bool isDefault;
}

class _AddressSheet extends StatefulWidget {
  const _AddressSheet();

  @override
  State<_AddressSheet> createState() => _AddressSheetState();
}

class _AddressSheetState extends State<_AddressSheet> {
  final _label = TextEditingController();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _line1 = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _postal = TextEditingController();
  bool _isDefault = true;

  @override
  void dispose() {
    _label.dispose();
    _name.dispose();
    _phone.dispose();
    _line1.dispose();
    _city.dispose();
    _state.dispose();
    _postal.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: ListView(
        shrinkWrap: true,
        children: [
          Text('Add address', style: Theme.of(context).textTheme.titleMedium),
          TextField(
            controller: _label,
            decoration: const InputDecoration(
              labelText: 'Label',
              hintText: 'e.g. Home, Work, Studio',
            ),
          ),
          TextField(
            controller: _name,
            decoration: const InputDecoration(
              labelText: 'Full name',
              hintText: 'Enter recipient full name',
            ),
          ),
          TextField(
            controller: _phone,
            decoration: const InputDecoration(
              labelText: 'Phone',
              hintText: 'Enter contact phone number',
            ),
          ),
          TextField(
            controller: _line1,
            decoration: const InputDecoration(
              labelText: 'Address',
              hintText: 'Enter flat, building, street address',
            ),
          ),
          TextField(
            controller: _city,
            decoration: const InputDecoration(
              labelText: 'City',
              hintText: 'Enter city',
            ),
          ),
          TextField(
            controller: _state,
            decoration: const InputDecoration(
              labelText: 'State',
              hintText: 'Enter state',
            ),
          ),
          TextField(
            controller: _postal,
            decoration: const InputDecoration(
              labelText: 'PIN code',
              hintText: 'Enter 6-digit PIN code',
            ),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _isDefault,
            title: const Text('Default address'),
            onChanged: (value) => setState(() => _isDefault = value),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop(
                _AddressDraft(
                  label: _label.text.trim(),
                  fullName: _name.text.trim(),
                  phone: _phone.text.trim(),
                  line1: _line1.text.trim(),
                  city: _city.text.trim(),
                  state: _state.text.trim(),
                  postalCode: _postal.text.trim(),
                  isDefault: _isDefault,
                ),
              );
            },
            child: const Text('Save address'),
          ),
        ],
      ),
    );
  }
}
