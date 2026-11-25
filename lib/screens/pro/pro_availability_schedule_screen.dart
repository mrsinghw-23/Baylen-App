import 'dart:convert';

import 'package:flutter/material.dart';

import '../../repositories/professional_job_scope.dart';
import '../../widgets/pro/pro_components.dart';

class ProAvailabilityScheduleScreen extends StatefulWidget {
  const ProAvailabilityScheduleScreen({super.key});

  @override
  State<ProAvailabilityScheduleScreen> createState() =>
      _ProAvailabilityScheduleScreenState();
}

class _DaySchedule {
  _DaySchedule({
    required this.key,
    required this.label,
    this.enabled = false,
    this.start = const TimeOfDay(hour: 9, minute: 0),
    this.end = const TimeOfDay(hour: 18, minute: 0),
  });

  final String key;
  final String label;
  bool enabled;
  TimeOfDay start;
  TimeOfDay end;
}

class _ProAvailabilityScheduleScreenState extends State<ProAvailabilityScheduleScreen> {
  static const _days = [
    ('mon', 'Monday'),
    ('tue', 'Tuesday'),
    ('wed', 'Wednesday'),
    ('thu', 'Thursday'),
    ('fri', 'Friday'),
    ('sat', 'Saturday'),
    ('sun', 'Sunday'),
  ];

  late final List<_DaySchedule> _rows;
  bool _busy = false;
  bool _loadedExisting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _rows = _days
        .map(
          (entry) => _DaySchedule(key: entry.$1, label: entry.$2),
        )
        .toList(growable: false);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loadedExisting) return;
    _loadedExisting = true;
    _loadExisting();
  }

  void _loadExisting() {
    final scheduleJson =
        ProfessionalJobScope.storeOf(context).dashboard?.availabilitySchedule ?? '';
    if (scheduleJson.isEmpty) return;
    try {
      final decoded = jsonDecode(scheduleJson);
      if (decoded is! Map<String, dynamic>) return;
      for (final row in _rows) {
        final intervals = decoded[row.key];
        if (intervals is! List || intervals.isEmpty) continue;
        final first = intervals.first;
        if (first is! Map) continue;
        final start = _parseTime(first['start']?.toString());
        final end = _parseTime(first['end']?.toString());
        if (start == null || end == null) continue;
        row.enabled = true;
        row.start = start;
        row.end = end;
      }
    } catch (_) {}
  }

  TimeOfDay? _parseTime(String? value) {
    final parts = (value ?? '').split(':');
    if (parts.length != 2) return null;
    final hour = int.tryParse(parts[0]);
    final minute = int.tryParse(parts[1]);
    if (hour == null || minute == null) return null;
    return TimeOfDay(hour: hour, minute: minute);
  }

  String _formatTime(TimeOfDay time) {
    final hour = time.hour.toString().padLeft(2, '0');
    final minute = time.minute.toString().padLeft(2, '0');
    return '$hour:$minute';
  }

  Future<void> _pickTime(_DaySchedule row, {required bool start}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: start ? row.start : row.end,
    );
    if (picked == null || !mounted) return;
    setState(() {
      if (start) {
        row.start = picked;
      } else {
        row.end = picked;
      }
    });
  }

  Map<String, dynamic> _buildPayload() {
    final payload = <String, dynamic>{};
    for (final row in _rows.where((row) => row.enabled)) {
      payload[row.key] = [
        {
          'start': _formatTime(row.start),
          'end': _formatTime(row.end),
        },
      ];
    }
    return payload;
  }

  Future<void> _save() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final store = ProfessionalJobScope.storeOf(context);
    final ok = await store.saveAvailabilitySchedule(_buildPayload());
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = ok ? null : (store.availabilityError ?? 'Could not save schedule.');
    });
    if (ok) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kProCanvas,
      appBar: AppBar(
        backgroundColor: kProCanvas,
        foregroundColor: Colors.white,
        title: const Text('Weekly Availability'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Set the days and hours when you are available for home service jobs. '
            'Jobs outside these hours will not be assigned to you.',
            style: TextStyle(color: kProTextSecondary, height: 1.4),
          ),
          const SizedBox(height: 16),
          ..._rows.map((row) {
            return ProCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(row.label, style: const TextStyle(color: Colors.white)),
                    value: row.enabled,
                    activeThumbColor: kProPink,
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => row.enabled = value),
                  ),
                  if (row.enabled) ...[
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: _busy ? null : () => _pickTime(row, start: true),
                            child: Text('Start ${_formatTime(row.start)}'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: _busy ? null : () => _pickTime(row, start: false),
                            child: Text('End ${_formatTime(row.end)}'),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            );
          }),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 16),
          ProPrimaryButton(
            label: _busy ? 'Saving...' : 'Save schedule',
            onPressed: _busy ? null : _save,
          ),
        ],
      ),
    );
  }
}
