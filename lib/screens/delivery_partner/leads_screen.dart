import 'package:flutter/material.dart';

import '../../api/catalyst_api.dart';
import '../../auth/delivery_partner_auth_service.dart';
import '../../auth/role_switch_dialog.dart';
import '../../models/delivery_partner_session.dart';

class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key});

  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  List<DeliveryPartnerLead> _leads = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _leads.isEmpty;
      _error = null;
    });
    try {
      final leads = await DeliveryPartnerAuthService.instance.api
          .deliveryPartnerLeads(status: 'available');
      if (!mounted) return;
      setState(() {
        _leads = leads;
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
    if (_leads.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'No available leads yet.\nNew bookings for your outlet will appear here.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: _leads.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final lead = _leads[index];
          return Card(
            child: ListTile(
              title: Text(lead.serviceName.isEmpty ? 'Home service' : lead.serviceName),
              subtitle: Text(
                '${lead.visitLine1}\n${lead.visitCity} · ${lead.scheduledAt}',
              ),
              isThreeLine: true,
              trailing: Text('₹${lead.grandTotal.toStringAsFixed(0)}'),
            ),
          );
        },
      ),
    );
  }
}
