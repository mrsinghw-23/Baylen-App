import 'package:flutter/material.dart';

import '../models/salon.dart';
import '../widgets/home/_home_constants.dart';
import '../widgets/salon_image.dart';
import 'home_service_book_screen.dart';

class HomeServiceServiceDetailScreen extends StatefulWidget {
  const HomeServiceServiceDetailScreen({
    super.key,
    required this.outlet,
    required this.service,
  });

  final SalonOutlet outlet;
  final SalonService service;

  @override
  State<HomeServiceServiceDetailScreen> createState() =>
      _HomeServiceServiceDetailScreenState();
}

class _HomeServiceServiceDetailScreenState
    extends State<HomeServiceServiceDetailScreen> {
  String _gender = '';

  List<String> get _genderOptions {
    final options = <String>[];
    if (widget.service.priceFor('MALE') != null) options.add('MALE');
    if (widget.service.priceFor('FEMALE') != null) options.add('FEMALE');
    return options;
  }

  @override
  void initState() {
    super.initState();
    final options = _genderOptions;
    if (options.length == 1) {
      _gender = options.first;
    }
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

  double _priceFor(String gender) {
    return widget.service.priceFor(gender)?.sellingPrice ??
        widget.service.sellingPrice;
  }

  int _durationFor(String gender) {
    return widget.service.priceFor(gender)?.durationMinutes ??
        widget.service.durationMinutes;
  }

  void _continue() {
    if (_genderOptions.isNotEmpty && _gender.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeServiceBookScreen(
          outlet: widget.outlet,
          service: widget.service,
          initialGender: _gender.isNotEmpty ? _gender : null,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final service = widget.service;
    final outlet = widget.outlet;
    final canContinue = _genderOptions.isEmpty || _gender.isNotEmpty;

    return Scaffold(
      backgroundColor: kHomeCanvas,
      appBar: AppBar(
        backgroundColor: kHomeCanvas,
        foregroundColor: Colors.white,
        title: const Text('Select gender'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: SizedBox(
                width: double.infinity,
                height: 140,
                child: SalonImage(imageUrl: service.imageUrl),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              service.name,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              outlet.name,
              style: const TextStyle(color: kHomeTextSecondary),
            ),
            const SizedBox(height: 8),
            const Row(
              children: [
                Icon(Icons.home_outlined, size: 16, color: kHomePink),
                SizedBox(width: 6),
                Text(
                  'At your home',
                  style: TextStyle(color: Colors.white),
                ),
              ],
            ),
            const SizedBox(height: 24),
            const Text(
              'Who is this service for?',
              style: TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            if (_genderOptions.isEmpty)
              Text(
                '₹${service.sellingPrice.toStringAsFixed(0)} · ${service.durationMinutes} mins',
                style: const TextStyle(
                  color: kHomePink,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              )
            else
              ..._genderOptions.map((gender) {
                final selected = _gender == gender;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Material(
                    color: selected ? kHomeSurface : kHomeCard,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(
                        color: selected ? kHomePink : kHomeOutline,
                      ),
                    ),
                    child: InkWell(
                      onTap: () => setState(() => _gender = gender),
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 16,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              gender == 'MALE'
                                  ? Icons.male
                                  : Icons.female,
                              color: selected ? kHomePink : Colors.white,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    _genderLabel(gender),
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w700,
                                      fontSize: 16,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${_durationFor(gender)} mins at home',
                                    style: const TextStyle(
                                      color: kHomeTextSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Text(
                              '₹${_priceFor(gender).toStringAsFixed(0)}',
                              style: const TextStyle(
                                color: kHomePink,
                                fontWeight: FontWeight.w800,
                                fontSize: 18,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Icon(
                              selected
                                  ? Icons.check_circle
                                  : Icons.circle_outlined,
                              color: selected ? kHomePink : kHomeTextSecondary,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
            const SizedBox(height: 16),
            HomeFullWidthButton(
              label: 'Continue',
              onPressed: canContinue ? _continue : null,
            ),
            if (service.description.isNotEmpty) ...[
              const SizedBox(height: 20),
              const Text(
                'About this service',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                service.description,
                style: const TextStyle(color: kHomeTextSecondary, height: 1.5),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
