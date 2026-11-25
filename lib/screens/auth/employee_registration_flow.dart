import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../api/catalyst_api.dart';
import '../../constants/employee_qualifications.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../services/pincode_lookup_service.dart';
import '../../auth/professional_onboarding.dart';
import '../../utils/registration_photo_picker.dart';
import 'employee_login_screen.dart';

class EmployeeRegistrationFlow extends StatefulWidget {
  const EmployeeRegistrationFlow({
    super.key,
    this.initialPhase = 0,
    this.onSignedOut,
    this.onRegistrationFinished,
  });

  final int initialPhase;
  final VoidCallback? onSignedOut;
  final VoidCallback? onRegistrationFinished;

  @override
  State<EmployeeRegistrationFlow> createState() => _EmployeeRegistrationFlowState();
}

class _EmployeeRegistrationFlowState extends State<EmployeeRegistrationFlow> {
  late int _step;
  bool _busy = false;
  String? _error;
  EmployeeRegistrationStatus? _status;
  Timer? _pinDebounce;
  bool _pinLoading = false;
  String? _pinMessage;
  late final PincodeLookupService _pincodeLookup = PincodeLookupService(
    DeliveryPartnerAuthService.instance.api,
  );

  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _age = TextEditingController();
  final _dob = TextEditingController();
  final _email = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _district = TextEditingController();
  final _pincode = TextEditingController();
  final _address1 = TextEditingController();
  String _qualification = '';
  final _serviceZone = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  String _gender = '';
  bool _selfieUploaded = false;
  bool _passportUploaded = false;
  bool _obscurePassword = true;
  bool _obscureConfirm = true;

  @override
  void initState() {
    super.initState();
    _step = widget.initialPhase;
    _loadStatus();
  }

  @override
  void dispose() {
    _pinDebounce?.cancel();
    _firstName.dispose();
    _lastName.dispose();
    _age.dispose();
    _dob.dispose();
    _email.dispose();
    _city.dispose();
    _state.dispose();
    _district.dispose();
    _pincode.dispose();
    _address1.dispose();
    _serviceZone.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    try {
      final status =
          await DeliveryPartnerAuthService.instance.api.fetchEmployeeRegistrationStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
        _selfieUploaded = status.selfieUploaded;
        _passportUploaded = status.passportPhotoUploaded;
        _firstName.text = status.firstName;
        _lastName.text = status.lastName;
        _email.text = status.email;
        if (status.qualification.isNotEmpty) {
          _qualification = normalizeEmployeeQualification(status.qualification) ??
              status.qualification;
        }
        if (status.serviceZone.isNotEmpty) _serviceZone.text = status.serviceZone;
        if (status.pincode.isNotEmpty) _pincode.text = status.pincode;
        if (status.city.isNotEmpty) _city.text = status.city;
        if (status.state.isNotEmpty) _state.text = status.state;
        if (status.district.isNotEmpty) _district.text = status.district;
        _step = _phaseToStep(status.registrationPhase);
      });
    } catch (_) {}
  }

  int _phaseToStep(String phase) {
    switch (phase) {
      case 'profile_complete':
      case 'photos_complete':
        return 1;
      case 'password_set':
        return 2;
      case 'registered':
        return 3;
      default:
        return 0;
    }
  }

  bool get _profileStepComplete => _phaseToStep(_status?.registrationPhase ?? '') >= 1;

  void _onPinChanged(String value) {
    _pinDebounce?.cancel();
    final normalized = PincodeLookupService.normalizePin(value);
    if (normalized != value) {
      _pincode.value = TextEditingValue(
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
        if (result.district.isNotEmpty) {
          _district.text = result.district;
        } else if (_district.text.trim().isEmpty && result.city.isNotEmpty) {
          _district.text = result.city;
        }
        if (_address1.text.trim().isEmpty && result.area.isNotEmpty) {
          _address1.text = result.area;
        }
        _pinMessage = 'Location loaded: ${result.city}, ${result.state}';
        _pinLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _pinMessage = error is ApiException
            ? error.message
            : error.toString().replaceFirst('Exception: ', '');
        _pinLoading = false;
      });
    }
  }

  Future<bool> _ensureReadyForPhotos() async {
    try {
      final status =
          await DeliveryPartnerAuthService.instance.api.fetchEmployeeRegistrationStatus();
      if (!mounted) return false;
      setState(() => _status = status);
      if (_phaseToStep(status.registrationPhase) >= 1) {
        return true;
      }
      if (_firstName.text.trim().isNotEmpty &&
          _address1.text.trim().isNotEmpty &&
          _pincode.text.trim().length == 6) {
        await _saveProfile();
        return _profileStepComplete;
      }
      setState(() {
        _error = 'Complete personal details before adding photos.';
        _step = 0;
      });
      return false;
    } catch (error) {
      if (!mounted) return false;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '');
        _step = 0;
      });
      return false;
    }
  }

  Future<void> _saveProfile() async {
    final firstName = _firstName.text.trim();
    final lastName = _lastName.text.trim();
    final dob = _dob.text.trim();
    final email = _email.text.trim();
    final city = _city.text.trim();
    final state = _state.text.trim();
    final district = _district.text.trim();
    final pincode = _pincode.text.trim();
    final address1 = _address1.text.trim();
    final qualification = _qualification.trim();
    final serviceZone = _serviceZone.text.trim();

    if (firstName.isEmpty || lastName.isEmpty) {
      setState(() => _error = 'Enter first and last name.');
      return;
    }
    if (dob.isEmpty) {
      setState(() => _error = 'Select your date of birth.');
      return;
    }
    if (_gender.isEmpty) {
      setState(() => _error = 'Select your gender.');
      return;
    }
    if (email.isEmpty || !email.contains('@')) {
      setState(() => _error = 'Enter a valid email address.');
      return;
    }
    if (state.isEmpty) {
      setState(() => _error = 'Enter pincode to load state or fill it manually.');
      return;
    }
    if (district.isEmpty && city.isEmpty) {
      setState(() => _error = 'Enter pincode to load city/district or fill manually.');
      return;
    }
    if (pincode.length != 6 || int.tryParse(pincode) == null) {
      setState(() => _error = 'Enter a valid 6-digit pincode.');
      return;
    }
    if (address1.isEmpty) {
      setState(() => _error = 'Enter your address.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final status = await DeliveryPartnerAuthService.instance.api
          .saveEmployeeRegistrationProfile({
        'first_name': firstName,
        'last_name': lastName,
        'age': int.tryParse(_age.text.trim()),
        'date_of_birth': dob,
        'gender': _gender,
        'email': email,
        'city': city.isNotEmpty ? city : district,
        'state': state,
        'district': district.isNotEmpty ? district : city,
        'pincode': pincode,
        'address_line1': address1,
        if (qualification.isNotEmpty) 'qualification': qualification,
        if (serviceZone.isNotEmpty) 'service_zone': serviceZone,
      });
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = status;
        _step = _phaseToStep(status.registrationPhase);
        if (_step < 1) {
          _error =
              'Profile could not be confirmed yet. Tap Continue again or sign out and re-register.';
        } else {
          _error = null;
        }
      });
      await DeliveryPartnerAuthService.instance.refreshSessionMeta(
        registrationPhase: status.registrationPhase,
        registrationComplete: status.registrationComplete,
        firstName: status.firstName,
        lastName: status.lastName,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _pickPhoto(String photoType) async {
    setState(() => _error = null);
    if (!await _ensureReadyForPhotos()) {
      return;
    }
    if (!mounted) return;
    try {
      final image = photoType == 'selfie'
          ? await pickRegistrationPhoto(
              useFrontCamera: true,
              context: context,
              title: 'Take Selfie',
            )
          : await _pickPassportPhoto();
      if (image == null || !mounted) {
        return;
      }
      await _uploadPickedPhoto(image, photoType);
    } on RegistrationPhotoException catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.message;
      });
      if (error.message.contains('Settings')) {
        await _showCameraPermissionHelp();
      }
    } catch (error) {
      if (!mounted) return;
      final message = error.toString().replaceFirst('Exception: ', '');
      if (message.contains('previous registration step')) {
        setState(() {
          _busy = false;
          _error = 'Personal details must be saved first. Returning to that step.';
          _step = 0;
        });
        return;
      }
      setState(() {
        _busy = false;
        _error = message.contains('upload')
            ? 'Photo upload failed. Check your connection and try again.'
            : message;
      });
    }
  }

  Future<XFile?> _pickPassportPhoto() async {
    final source = await choosePassportPhotoSource(context);
    if (source == null || !mounted) return null;
    if (source == RegistrationPhotoSource.gallery) {
      return pickRegistrationGalleryPhoto(
        context: context,
        title: 'Passport size photo',
      );
    }
    return pickRegistrationPhoto(
      useFrontCamera: false,
      context: context,
      title: 'Take Passport Photo',
    );
  }

  Future<void> _uploadPickedPhoto(XFile image, String photoType) async {
    final bytes = await image.readAsBytes();
    if (bytes.isEmpty) {
      if (!mounted) return;
      setState(() => _error = 'Could not read the photo. Please try again.');
      return;
    }
    if (bytes.length > 5 * 1024 * 1024) {
      if (!mounted) return;
      setState(
        () => _error = 'Photo must be 5 MB or smaller. Move closer or retry.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final fileName = image.name.isNotEmpty
          ? image.name
          : '${photoType}_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final status = await DeliveryPartnerAuthService.instance.api
          .uploadEmployeeRegistrationPhoto(
        photoType: photoType,
        fileName: fileName,
        contentType: contentTypeForRegistrationPhoto(image),
        base64: base64Encode(bytes),
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = status;
        _selfieUploaded = status.selfieUploaded;
        _passportUploaded = status.passportPhotoUploaded;
        _error = null;
      });
      await DeliveryPartnerAuthService.instance.refreshSessionMeta(
        registrationPhase: status.registrationPhase,
        registrationComplete: status.registrationComplete,
      );
    } catch (error) {
      if (!mounted) return;
      final message = error is ApiException
          ? error.message
          : 'Could not save this photo to your employee record. Please try again.';
      setState(() {
        _busy = false;
        _error = message;
      });
    }
  }

  Future<void> _showCameraPermissionHelp() async {
    final message = await ensureRegistrationCameraPermission();
    if (!mounted) return;
    if (message == null) {
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Camera permission required'),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.of(context).pop();
              await openRegistrationCameraSettings();
            },
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }

  Future<void> _savePassword() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final status = await DeliveryPartnerAuthService.instance.api
          .saveEmployeeRegistrationPassword(
        password: _password.text,
        confirmPassword: _confirmPassword.text,
      );
      if (!mounted) return;
      setState(() {
        _busy = false;
        _status = status;
      });
      await _completeRegistration();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _completeRegistration() async {
    setState(() => _busy = true);
    try {
      final status =
          await DeliveryPartnerAuthService.instance.api.completeEmployeeRegistration();
      await DeliveryPartnerAuthService.instance.refreshSessionMeta(
        registrationPhase: status.registrationPhase,
        registrationComplete: status.registrationComplete,
      );
      if (!mounted) return;
      setState(() => _busy = false);
      if (widget.onRegistrationFinished != null) {
        widget.onRegistrationFinished!();
        return;
      }
      await ProfessionalOnboarding.navigateAfterOtp(context);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 25),
      firstDate: DateTime(now.year - 70),
      lastDate: DateTime(now.year - 18),
    );
    if (picked == null) return;
    final iso =
        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    final age = now.year - picked.year -
        ((now.month < picked.month || (now.month == picked.month && now.day < picked.day))
            ? 1
            : 0);
    setState(() {
      _dob.text = iso;
      _age.text = age.toString();
    });
  }

  @override
  Widget build(BuildContext context) {
    final phone = DeliveryPartnerAuthService.instance.session.value?.phone ?? '';
    return Scaffold(
      appBar: AppBar(
        title: Text(_step == 3 ? 'Registration Submitted' : 'Employee Registration'),
        actions: [
          if (_step < 3 && widget.onSignedOut != null)
            IconButton(
              tooltip: 'Sign out',
              onPressed: _busy
                  ? null
                  : () async {
                      widget.onSignedOut?.call();
                    },
              icon: const Icon(Icons.logout),
            ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            if (_step < 3) _StepBar(step: _step),
            if (_error != null) ...[
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              const SizedBox(height: 12),
            ],
            if (_step == 0) ..._profileStep(),
            if (_step == 1) ..._passwordStep(),
            if (_step == 2 || _step == 3) ..._successStep(phone),
          ],
        ),
      ),
    );
  }

  List<Widget> _profileStep() {
    return [
      Text('Personal Details', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 16),
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: _firstName,
              decoration: const InputDecoration(labelText: 'First Name'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _lastName,
              decoration: const InputDecoration(labelText: 'Last Name'),
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: _age,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Age'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _dob,
              readOnly: true,
              onTap: _pickDob,
              decoration: const InputDecoration(
                labelText: 'Date of Birth',
                suffixIcon: Icon(Icons.calendar_today_outlined),
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Wrap(
        spacing: 8,
        children: ['MALE', 'FEMALE', 'OTHER'].map((gender) {
          final selected = _gender == gender;
          return ChoiceChip(
            label: Text(gender[0] + gender.substring(1).toLowerCase()),
            selected: selected,
            onSelected: (_) => setState(() => _gender = gender),
          );
        }).toList(),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        decoration: const InputDecoration(labelText: 'Email Address'),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _pincode,
        keyboardType: TextInputType.number,
        maxLength: 6,
        onChanged: _onPinChanged,
        decoration: InputDecoration(
          labelText: 'Pincode',
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
      ),
      if (_pinMessage != null) ...[
        const SizedBox(height: 4),
        Text(
          _pinMessage!,
          style: TextStyle(
            color: _pinMessage!.startsWith('Location loaded:')
                ? const Color(0xFF35D07F)
                : Theme.of(context).colorScheme.error,
            fontSize: 12,
          ),
        ),
      ],
      const SizedBox(height: 12),
      TextField(
        controller: _city,
        decoration: const InputDecoration(labelText: 'City'),
      ),
      const SizedBox(height: 12),
      Row(
        children: [
          Expanded(
            child: TextField(
              controller: _state,
              decoration: const InputDecoration(labelText: 'State'),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextField(
              controller: _district,
              decoration: const InputDecoration(labelText: 'District'),
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _address1,
        decoration: const InputDecoration(labelText: 'Address 1'),
      ),
      const SizedBox(height: 12),
      DropdownButtonFormField<String>(
        value: employeeQualificationDropdownValue(_qualification),
        decoration: const InputDecoration(
          labelText: 'Qualification (optional)',
        ),
        items: employeeQualificationDropdownOptions(_qualification)
            .map(
              (value) => DropdownMenuItem(
                value: value,
                child: Text(value),
              ),
            )
            .toList(),
        onChanged: (value) => setState(() => _qualification = value ?? ''),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _serviceZone,
        decoration: const InputDecoration(
          labelText: 'Service Zone (optional)',
          hintText: 'e.g. Zone A, North Ranchi, Sector 12',
        ),
      ),
      if (_status?.outletName.isNotEmpty == true) ...[
        const SizedBox(height: 12),
        Text('Mapped outlet: ${_status!.outletName}'),
      ],
      const SizedBox(height: 20),
      FilledButton(
        onPressed: _busy ? null : _saveProfile,
        child: Text(_busy ? 'Saving...' : 'Continue'),
      ),
    ];
  }

  List<Widget> _passwordStep() {
    return [
      Text('Create Password', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      const Text(
        'Set a password for your account. You will verify Aadhaar and take a passport-size selfie in the next step.',
      ),
      const SizedBox(height: 16),
      TextField(
        controller: _password,
        obscureText: _obscurePassword,
        decoration: InputDecoration(
          labelText: 'Password',
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            tooltip: _obscurePassword ? 'Show password' : 'Hide password',
            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
            icon: Icon(
              _obscurePassword ? Icons.visibility_outlined : Icons.visibility_off_outlined,
            ),
          ),
        ),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _confirmPassword,
        obscureText: _obscureConfirm,
        decoration: InputDecoration(
          labelText: 'Confirm Password',
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            tooltip: _obscureConfirm ? 'Show password' : 'Hide password',
            onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
            icon: Icon(
              _obscureConfirm ? Icons.visibility_outlined : Icons.visibility_off_outlined,
            ),
          ),
        ),
      ),
      const SizedBox(height: 8),
      const Text('At least 8 characters, with a letter, number, and special character.'),
      const SizedBox(height: 20),
      FilledButton(
        onPressed: _busy ? null : _savePassword,
        child: Text(_busy ? 'Saving...' : 'Continue'),
      ),
    ];
  }

  List<Widget> _successStep(String phone) {
    return [
      Icon(Icons.check_circle, color: Theme.of(context).colorScheme.primary, size: 72),
      const SizedBox(height: 16),
      Text('Registration Submitted!', style: Theme.of(context).textTheme.headlineSmall),
      const SizedBox(height: 8),
      const Text('Your employee account has been created successfully.'),
      const SizedBox(height: 16),
      Card(
        child: ListTile(
          title: const Text('Your User ID (Mobile Number)'),
          subtitle: Text(phone.isNotEmpty ? phone : 'Use your registered mobile'),
        ),
      ),
      const SizedBox(height: 20),
      FilledButton(
        onPressed: () {
          if (widget.onRegistrationFinished != null) {
            widget.onRegistrationFinished!();
            return;
          }
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute<void>(builder: (_) => const EmployeeLoginScreen()),
            (route) => route.isFirst,
          );
        },
        child: const Text('Go to Login'),
      ),
    ];
  }
}

class _StepBar extends StatelessWidget {
  const _StepBar({required this.step});
  final int step;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Row(
        children: List.generate(3, (index) {
          final active = index <= step;
          return Expanded(
            child: Container(
              height: 4,
              margin: EdgeInsets.only(right: index == 2 ? 0 : 6),
              decoration: BoxDecoration(
                color: active
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(99),
              ),
            ),
          );
        }),
      ),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({
    required this.title,
    required this.uploaded,
    required this.onTap,
  });

  final String title;
  final bool uploaded;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      child: Row(
        children: [
          Icon(uploaded ? Icons.check_circle : Icons.camera_alt_outlined),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              uploaded
                  ? '$title uploaded'
                  : title == 'Selfie'
                      ? 'Tap to take Selfie'
                      : 'Tap to take Passport size photo',
            ),
          ),
        ],
      ),
    );
  }
}
