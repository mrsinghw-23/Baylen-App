import 'package:flutter/material.dart';

import '../../api/catalyst_api.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/role_switch_dialog.dart';
import '../../models/delivery_partner_session.dart';

class MyJobsScreen extends StatefulWidget {
  const MyJobsScreen({super.key});

  @override
  State<MyJobsScreen> createState() => _MyJobsScreenState();
}

class _MyJobsScreenState extends State<MyJobsScreen> {
  List<DeliveryPartnerLead> _jobs = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _jobs.isEmpty;
      _error = null;
    });
    try {
      final jobs = await DeliveryPartnerAuthService.instance.api
          .deliveryPartnerLeads(status: 'accepted');
      if (!mounted) return;
      setState(() {
        _jobs = jobs;
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      if (error.isForbiddenRole) {
        await showRoleSwitchDialog(context, error: error);
      }
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_jobs.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No accepted jobs yet.\nAccepted bookings will show up here.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _jobs.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final job = _jobs[index];
          return Card(
            child: ListTile(
              title: Text(job.serviceName.isEmpty ? 'Home service' : job.serviceName),
              subtitle: Text(
                '${job.visitLine1}\n${job.visitCity} · ${job.status}',
              ),
              isThreeLine: true,
              trailing: Text('₹${job.grandTotal.toStringAsFixed(0)}'),
            ),
          );
        },
      ),
    );
  }
}
