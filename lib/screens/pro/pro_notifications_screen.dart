import 'package:flutter/material.dart';

import '../../models/professional_job.dart';
import '../../repositories/professional_job_scope.dart';
import '../../state/professional_dashboard_store.dart';
import '../../widgets/pro/pro_components.dart';
import 'pro_job_flow.dart';

class ProNotificationsScreen extends StatefulWidget {
  const ProNotificationsScreen({super.key});

  @override
  State<ProNotificationsScreen> createState() => _ProNotificationsScreenState();
}

class _ProNotificationsScreenState extends State<ProNotificationsScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    ProfessionalJobScope.scheduleLoad(_load);
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repository = ProfessionalJobScope.of(context);
      final items = await repository.fetchNotifications();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
      final unread = items
          .where((item) => item['read'] != true)
          .map((item) => item['id']?.toString() ?? '')
          .where((id) => id.isNotEmpty)
          .toList();
      if (unread.isNotEmpty) {
        await repository.markNotificationsRead(unread);
        if (!mounted) return;
        await ProfessionalJobScope.maybeStoreOf(context)?.refreshQuiet(
          slices: {ProfessionalDataSlice.dashboard},
        );
      }
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
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: _loading
          ? const ProScreenState.loading()
          : _error != null
              ? ProScreenState.error(message: _error!, onRetry: _load)
              : _items.isEmpty
                  ? const ProScreenState.empty(message: 'No notifications yet')
                  : RefreshIndicator(
                      color: kProPink,
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final item = _items[index];
                          final jobId = item['professional_job_row_id']?.toString() ?? '';
                          return ProCard(
                            onTap: jobId.isEmpty
                                ? null
                                : () => ProJobFlow.openJobDetail(
                                      context,
                                      jobId,
                                      ProfessionalJobType.homeService,
                                    ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item['title']?.toString() ?? 'Update',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  item['body']?.toString() ?? '',
                                  style: const TextStyle(color: kProTextSecondary),
                                ),
                                if ((item['created_at']?.toString() ?? '').isNotEmpty) ...[
                                  const SizedBox(height: 8),
                                  Text(
                                    item['created_at'].toString(),
                                    style: const TextStyle(
                                      color: kProTextSecondary,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}
