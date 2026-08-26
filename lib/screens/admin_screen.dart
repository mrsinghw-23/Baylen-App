import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api/admin_api.dart';
import '../models/admin.dart';

const _maxAdminImageBytes = 5 * 1024 * 1024;
const _orderStatuses = [
  'PLACED',
  'CONFIRMED',
  'PROCESSING',
  'PACKED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURN_APPROVED',
  'REFUNDED',
];
const _bookingStatuses = [
  'CONFIRMED',
  'RESCHEDULED',
  'CANCELLED',
  'CHECKED_IN',
  'IN_PROGRESS',
  'COMPLETED',
  'NO_SHOW',
];

Future<bool> _confirmAdminAction(
  BuildContext context, {
  required String title,
  required String message,
  required String actionLabel,
  required bool destructive,
}) async {
  final colorScheme = Theme.of(context).colorScheme;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          style: destructive
              ? FilledButton.styleFrom(
                  backgroundColor: colorScheme.error,
                  foregroundColor: colorScheme.onError,
                )
              : null,
          onPressed: () => Navigator.of(context).pop(true),
          icon: Icon(
            destructive
                ? Icons.visibility_off_outlined
                : Icons.visibility_outlined,
          ),
          label: Text(actionLabel),
        ),
      ],
    ),
  );
  return confirmed ?? false;
}

class AdminScreen extends StatefulWidget {
  const AdminScreen({super.key});

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  final _adminKey = TextEditingController();
  AdminSummary? _summary;
  List<AdminInventoryItem> _inventory = [];
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _adminKey.dispose();
    super.dispose();
  }

  AdminApi? get _api {
    final key = _adminKey.text.trim();
    if (key.isEmpty) {
      return null;
    }
    return AdminApi(adminKey: key);
  }

  Future<void> _refresh() async {
    final api = _api;
    if (api == null) {
      setState(() => _error = 'Enter the Catalyst admin API key first.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final summary = await api.summary();
      final inventory = await api.inventory();
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _inventory = inventory;
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

  Future<T?> _withApi<T>(
    Future<T> Function(AdminApi api) action, {
    bool refresh = true,
  }) async {
    final api = _api;
    if (api == null) {
      setState(() => _error = 'Enter the Catalyst admin API key first.');
      return null;
    }
    setState(() => _error = null);
    try {
      final result = await action(api);
      if (refresh) {
        await _refresh();
      }
      return result;
    } catch (error) {
      if (!mounted) return null;
      setState(() => _error = error.toString());
      return null;
    }
  }

  Future<AdminUploadedFile?> _uploadMedia(
    String mediaType,
    PlatformFile file,
  ) async {
    final bytes = file.bytes;
    if (bytes == null || bytes.isEmpty) {
      setState(() => _error = 'Selected image could not be read.');
      return null;
    }
    if (bytes.length > _maxAdminImageBytes) {
      setState(() => _error = 'Image must be 5 MB or smaller.');
      return null;
    }
    final uploaded = await _withApi(
      (api) => api.uploadMedia(
        mediaType: mediaType,
        fileName: file.name,
        contentType: _contentTypeForFile(file.name),
        bytes: Uint8List.fromList(bytes),
      ),
      refresh: false,
    );
    if (uploaded != null) {
      _showSaved('Image uploaded', uploaded.fileId);
    }
    return uploaded;
  }

  Future<List<AdminMediaAsset>?> _loadMedia(String mediaType) async {
    return _withApi((api) => api.media(mediaType: mediaType), refresh: false);
  }

  Future<AdminMediaAsset?> _mapMedia({
    required String assetId,
    required String targetId,
  }) async {
    final mapped = await _withApi(
      (api) => api.mapMedia(assetId: assetId, targetId: targetId),
      refresh: true,
    );
    if (mapped != null) {
      _showSaved('Image mapped', mapped.mappedEntityId);
    }
    return mapped;
  }

  Future<List<AdminMediaTarget>?> _searchMediaTargets({
    required String mediaType,
    required String query,
  }) async {
    return _withApi(
      (api) => api.searchMediaTargets(mediaType: mediaType, query: query),
      refresh: false,
    );
  }

  Future<List<AdminProductRecord>?> _loadProducts(String query) async {
    return _withApi((api) => api.products(query: query), refresh: false);
  }

  Future<List<AdminServiceRecord>?> _loadServices(String query) async {
    return _withApi((api) => api.services(query: query), refresh: false);
  }

  Future<List<AdminOutletRecord>?> _loadOutlets(String query) async {
    return _withApi((api) => api.outlets(query: query), refresh: false);
  }

  Future<List<AdminSchemaCheckRecord>?> _loadSchemaChecks() async {
    return _withApi((api) => api.schemaCheck(), refresh: false);
  }

  Future<List<AdminOrderRecord>?> _loadAdminOrders(String query) async {
    return _withApi((api) => api.orders(query: query), refresh: false);
  }

  Future<AdminOrderRecord?> _setAdminOrderStatus(
    String id,
    String status,
    String note,
  ) async {
    final updated = await _withApi(
      (api) => api.setOrderStatus(id: id, status: status, note: note),
      refresh: true,
    );
    if (updated != null) {
      _showSaved('Order updated', updated.id);
    }
    return updated;
  }

  Future<List<AdminBookingRecord>?> _loadAdminBookings(String query) async {
    return _withApi((api) => api.bookings(query: query), refresh: false);
  }

  Future<AdminBookingRecord?> _setAdminBookingStatus(
    String id,
    String status,
  ) async {
    final updated = await _withApi(
      (api) => api.setBookingStatus(id: id, status: status),
      refresh: true,
    );
    if (updated != null) {
      _showSaved('Booking updated', updated.id);
    }
    return updated;
  }

  Future<List<AdminStockMovementRecord>?> _loadStockMovements() async {
    return _withApi((api) => api.inventoryMovements(), refresh: false);
  }

  Future<List<AdminAuditLogRecord>?> _loadAuditLogs() async {
    return _withApi((api) => api.auditLogs(), refresh: false);
  }

  Future<AdminProductRecord?> _setProductActive(String id, bool active) async {
    final updated = await _withApi(
      (api) => api.setProductActive(id, active),
      refresh: true,
    );
    if (updated != null) {
      _showSaved(
        active ? 'Product activated' : 'Product deactivated',
        updated.id,
      );
    }
    return updated;
  }

  Future<AdminServiceRecord?> _setServiceActive(String id, bool active) async {
    final updated = await _withApi(
      (api) => api.setServiceActive(id, active),
      refresh: true,
    );
    if (updated != null) {
      _showSaved(
        active ? 'Service activated' : 'Service deactivated',
        updated.id,
      );
    }
    return updated;
  }

  Future<AdminOutletRecord?> _setOutletActive(String id, bool active) async {
    final updated = await _withApi(
      (api) => api.setOutletActive(id, active),
      refresh: true,
    );
    if (updated != null) {
      _showSaved(
        active ? 'Outlet activated' : 'Outlet deactivated',
        updated.id,
      );
    }
    return updated;
  }

  Future<List<AdminServiceJobRecord>?> _loadAdminServiceJobs(
    String query,
  ) async {
    return _withApi((api) => api.serviceJobs(query: query), refresh: false);
  }

  Future<List<AdminProviderRecord>?> _loadAdminProviders() async {
    return _withApi((api) => api.providers(), refresh: false);
  }

  Future<bool> _dispatchAdminJob(String jobId, String providerId) async {
    final result = await _withApi(
      (api) => api.dispatchJob(jobId: jobId, providerId: providerId),
      refresh: true,
    );
    if (result != null) {
      _showSaved(
        'Job dispatched to provider',
        result['provider_name']?.toString() ?? '',
      );
      return true;
    }
    return false;
  }

  void _showSaved(String label, String id) {
    if (!mounted) return;
    final message = id.isEmpty ? '$label saved' : '$label saved: $id';
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 9,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Admin'),
          bottom: const TabBar(
            isScrollable: true,
            tabs: [
              Tab(icon: Icon(Icons.dashboard_outlined), text: 'Overview'),
              Tab(icon: Icon(Icons.manage_search_outlined), text: 'Ops'),
              Tab(icon: Icon(Icons.near_me_outlined), text: 'Dispatch'),
              Tab(icon: Icon(Icons.upload_file_outlined), text: 'Bulk'),
              Tab(icon: Icon(Icons.image_outlined), text: 'Media'),
              Tab(icon: Icon(Icons.inventory_2_outlined), text: 'Products'),
              Tab(icon: Icon(Icons.warehouse_outlined), text: 'Inventory'),
              Tab(icon: Icon(Icons.content_cut_outlined), text: 'Services'),
              Tab(
                icon: Icon(Icons.store_mall_directory_outlined),
                text: 'Outlets',
              ),
            ],
          ),
        ),
        body: Column(
          children: [
            _AdminAccessBar(
              controller: _adminKey,
              loading: _loading,
              error: _error,
              onRefresh: _refresh,
            ),
            Expanded(
              child: TabBarView(
                children: [
                  _OverviewTab(
                    summary: _summary,
                    inventory: _inventory,
                    onRefresh: _refresh,
                  ),
                  _OperationsTab(
                    onLoadSchemaChecks: _loadSchemaChecks,
                    onLoadOrders: _loadAdminOrders,
                    onSetOrderStatus: _setAdminOrderStatus,
                    onLoadBookings: _loadAdminBookings,
                    onSetBookingStatus: _setAdminBookingStatus,
                    onLoadMovements: _loadStockMovements,
                    onLoadAuditLogs: _loadAuditLogs,
                  ),
                  _DispatchTab(
                    onLoadJobs: _loadAdminServiceJobs,
                    onLoadProviders: _loadAdminProviders,
                    onDispatchJob: _dispatchAdminJob,
                  ),
                  _BulkImportTab(
                    onProducts: (csvText) async {
                      final result = await _withApi(
                        (api) => api.bulkProducts(csvText),
                      );
                      if (result != null) {
                        _showSaved('Products import', result.summary);
                      }
                      return result;
                    },
                    onServices: (csvText) async {
                      final result = await _withApi(
                        (api) => api.bulkServices(csvText),
                      );
                      if (result != null) {
                        _showSaved('Services import', result.summary);
                      }
                      return result;
                    },
                  ),
                  _MediaUploadTab(
                    onUpload: _uploadMedia,
                    onLoad: _loadMedia,
                    onMap: _mapMedia,
                    onSearchTargets: _searchMediaTargets,
                  ),
                  _ProductTab(
                    onUpload: _uploadMedia,
                    onLoad: _loadProducts,
                    onSetActive: _setProductActive,
                    onSave: (payload) async {
                      final id = await _withApi(
                        (api) => api.upsertProduct(payload),
                      );
                      if (id != null) {
                        _showSaved('Product', id);
                      }
                    },
                  ),
                  _InventoryTab(
                    inventory: _inventory,
                    onRefresh: _refresh,
                    onSave: (payload) async {
                      final saved = await _withApi((api) async {
                        await api.updateInventory(payload);
                        return true;
                      });
                      if (saved == true) {
                        _showSaved(
                          'Inventory',
                          payload['inventory_id']?.toString() ?? '',
                        );
                      }
                    },
                  ),
                  _ServiceTab(
                    onUpload: _uploadMedia,
                    onLoad: _loadServices,
                    onSetActive: _setServiceActive,
                    onSave: (payload) async {
                      final id = await _withApi(
                        (api) => api.upsertService(payload),
                      );
                      if (id != null) {
                        _showSaved('Service', id);
                      }
                    },
                  ),
                  _OutletTab(
                    onUpload: _uploadMedia,
                    onLoad: _loadOutlets,
                    onSetActive: _setOutletActive,
                    onSave: (payload) async {
                      final id = await _withApi(
                        (api) => api.upsertOutlet(payload),
                      );
                      if (id != null) {
                        _showSaved('Outlet', id);
                      }
                    },
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

class _AdminAccessBar extends StatelessWidget {
  const _AdminAccessBar({
    required this.controller,
    required this.loading,
    required this.error,
    required this.onRefresh,
  });

  final TextEditingController controller;
  final bool loading;
  final String? error;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          bottom: BorderSide(
            color: Theme.of(context).colorScheme.outlineVariant,
          ),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: controller,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Admin API key',
                    prefixIcon: Icon(Icons.key_outlined),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              IconButton.filled(
                tooltip: 'Refresh admin data',
                onPressed: loading ? null : () => onRefresh(),
                icon: loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ],
          ),
          if (error != null) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _OverviewTab extends StatelessWidget {
  const _OverviewTab({
    required this.summary,
    required this.inventory,
    required this.onRefresh,
  });

  final AdminSummary? summary;
  final List<AdminInventoryItem> inventory;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) {
    final summary = this.summary;
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (summary == null)
            const _EmptyAdminState(
              icon: Icons.admin_panel_settings_outlined,
              title: 'Admin console ready',
              body: 'Enter the admin key and refresh to load Catalyst management data.',
            )
          else
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _MetricTile(label: 'Products', value: summary.products),
                _MetricTile(label: 'Services', value: summary.services),
                _MetricTile(label: 'Outlets', value: summary.outlets),
                _MetricTile(label: 'Orders', value: summary.orders),
                _MetricTile(label: 'Bookings', value: summary.appointments),
                _MetricTile(label: 'FSM Jobs', value: summary.jobs),
                _MetricTile(label: 'Low stock', value: summary.lowStockItems),
              ],
            ),
          const SizedBox(height: 18),
          Text('Lowest stock', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (inventory.isEmpty)
            const Text('No inventory rows loaded yet.')
          else
            ...inventory.take(5).map((item) => _InventoryListTile(item: item)),
        ],
      ),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 150,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 6),
              Text(
                '$value',
                style: Theme.of(context).textTheme.headlineSmall
                    ?.copyWith(fontWeight: FontWeight.w900),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _OperationsTab extends StatefulWidget {
  const _OperationsTab({
    required this.onLoadSchemaChecks,
    required this.onLoadOrders,
    required this.onSetOrderStatus,
    required this.onLoadBookings,
    required this.onSetBookingStatus,
    required this.onLoadMovements,
    required this.onLoadAuditLogs,
  });

  final Future<List<AdminSchemaCheckRecord>?> Function() onLoadSchemaChecks;
  final Future<List<AdminOrderRecord>?> Function(String query) onLoadOrders;
  final Future<AdminOrderRecord?> Function(
    String id,
    String status,
    String note,
  )
  onSetOrderStatus;
  final Future<List<AdminBookingRecord>?> Function(String query) onLoadBookings;
  final Future<AdminBookingRecord?> Function(String id, String status)
  onSetBookingStatus;
  final Future<List<AdminStockMovementRecord>?> Function() onLoadMovements;
  final Future<List<AdminAuditLogRecord>?> Function() onLoadAuditLogs;

  @override
  State<_OperationsTab> createState() => _OperationsTabState();
}

class _OperationsTabState extends State<_OperationsTab> {
  final _orderSearch = TextEditingController();
  final _bookingSearch = TextEditingController();
  final _orderNote = TextEditingController();
  List<AdminOrderRecord> _orders = [];
  List<AdminSchemaCheckRecord> _schemaChecks = [];
  List<AdminBookingRecord> _bookings = [];
  List<AdminStockMovementRecord> _movements = [];
  List<AdminAuditLogRecord> _auditLogs = [];
  AdminOrderRecord? _selectedOrder;
  AdminBookingRecord? _selectedBooking;
  String _orderStatus = 'CONFIRMED';
  String _bookingStatus = 'CONFIRMED';
  bool _loadingOrders = false;
  bool _loadingSchema = false;
  bool _loadingBookings = false;
  bool _loadingMovements = false;
  bool _loadingAudit = false;
  bool _savingOrder = false;
  bool _savingBooking = false;

  @override
  void dispose() {
    _orderSearch.dispose();
    _bookingSearch.dispose();
    _orderNote.dispose();
    super.dispose();
  }

  Future<void> _loadOrders() async {
    setState(() => _loadingOrders = true);
    final orders = await widget.onLoadOrders(_orderSearch.text.trim());
    if (!mounted) return;
    setState(() {
      _orders = orders ?? [];
      _loadingOrders = false;
    });
  }

  Future<void> _loadSchemaChecks() async {
    setState(() => _loadingSchema = true);
    final checks = await widget.onLoadSchemaChecks();
    if (!mounted) return;
    setState(() {
      _schemaChecks = checks ?? [];
      _loadingSchema = false;
    });
  }

  Future<void> _loadBookings() async {
    setState(() => _loadingBookings = true);
    final bookings = await widget.onLoadBookings(_bookingSearch.text.trim());
    if (!mounted) return;
    setState(() {
      _bookings = bookings ?? [];
      _loadingBookings = false;
    });
  }

  Future<void> _loadMovements() async {
    setState(() => _loadingMovements = true);
    final movements = await widget.onLoadMovements();
    if (!mounted) return;
    setState(() {
      _movements = movements ?? [];
      _loadingMovements = false;
    });
  }

  Future<void> _loadAuditLogs() async {
    setState(() => _loadingAudit = true);
    final logs = await widget.onLoadAuditLogs();
    if (!mounted) return;
    setState(() {
      _auditLogs = logs ?? [];
      _loadingAudit = false;
    });
  }

  Future<void> _updateOrder() async {
    final order = _selectedOrder;
    if (order == null || _savingOrder) return;
    setState(() => _savingOrder = true);
    final updated = await widget.onSetOrderStatus(
      order.id,
      _orderStatus,
      _orderNote.text,
    );
    if (!mounted) return;
    if (updated != null) {
      setState(() {
        _selectedOrder = updated;
        _orders = [
          for (final item in _orders) item.id == updated.id ? updated : item,
        ];
      });
    }
    setState(() => _savingOrder = false);
  }

  Future<void> _updateBooking() async {
    final booking = _selectedBooking;
    if (booking == null || _savingBooking) return;
    setState(() => _savingBooking = true);
    final updated = await widget.onSetBookingStatus(booking.id, _bookingStatus);
    if (!mounted) return;
    if (updated != null) {
      setState(() {
        _selectedBooking = updated;
        _bookings = [
          for (final item in _bookings) item.id == updated.id ? updated : item,
        ];
      });
    }
    setState(() => _savingBooking = false);
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Operations',
      subtitle: 'Manage orders, bookings, stock history, and admin audit logs.',
      child: Column(
        children: [
          _OpsSection(
            title: 'Data Store schema',
            icon: Icons.fact_check_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OutlinedButton.icon(
                  onPressed: _loadingSchema ? null : _loadSchemaChecks,
                  icon: _loadingSchema
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.playlist_add_check_outlined),
                  label: const Text('Run schema check'),
                ),
                const SizedBox(height: 10),
                if (_schemaChecks.isNotEmpty)
                  Text(
                    '${_schemaChecks.where((item) => item.ok).length}/${_schemaChecks.length} tables passed',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                const SizedBox(height: 6),
                ..._schemaChecks
                    .where((item) => !item.ok)
                    .take(12)
                    .map(
                      (check) => ListTile(
                        dense: true,
                        leading: Icon(
                          check.status == 'MISSING_TABLE'
                              ? Icons.table_chart_outlined
                              : Icons.view_column_outlined,
                          color: Theme.of(context).colorScheme.error,
                        ),
                        title: Text('${check.table} - ${check.status}'),
                        subtitle: Text(
                          check.missingColumns.isNotEmpty
                              ? 'Missing: ${check.missingColumns.join(', ')}'
                              : check.missingHint,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                if (_schemaChecks.where((item) => !item.ok).length > 12)
                  Text(
                    'Showing first 12 missing items. Continue fixing them in Catalyst Data Store, then run again.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                if (_schemaChecks.isNotEmpty &&
                    _schemaChecks.every((item) => item.ok))
                  const ListTile(
                    dense: true,
                    leading: Icon(Icons.check_circle_outline),
                    title: Text('All required tables and columns passed'),
                  ),
              ],
            ),
          ),
          _OpsSection(
            title: 'Orders',
            icon: Icons.receipt_long_outlined,
            child: Column(
              children: [
                _AdminEntitySearchBox(
                  controller: _orderSearch,
                  label: 'Search order number, status, customer, city',
                  loading: _loadingOrders,
                  onSearch: _loadOrders,
                ),
                const SizedBox(height: 10),
                ..._orders
                    .take(8)
                    .map(
                      (order) => Card(
                        child: ListTile(
                          leading: const Icon(Icons.local_shipping_outlined),
                          selected: _selectedOrder?.id == order.id,
                          title: Text(
                            order.orderNumber.isEmpty
                                ? 'Order ${order.id}'
                                : order.orderNumber,
                          ),
                          subtitle: Text(
                            '${order.status} / ${order.paymentStatus} / ${_moneyLabel(order.currency, order.grandTotal)} / ${order.shippingCity}',
                          ),
                          onTap: () => setState(() {
                            _selectedOrder = order;
                            _orderStatus = order.status.isEmpty
                                ? 'CONFIRMED'
                                : order.status;
                          }),
                        ),
                      ),
                    ),
                if (_selectedOrder != null) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _orderStatus,
                    decoration: const InputDecoration(
                      labelText: 'Order status',
                    ),
                    items: _orderStatuses
                        .map(
                          (status) => DropdownMenuItem(
                            value: status,
                            child: Text(status),
                          ),
                        )
                        .toList(),
                    onChanged: (value) =>
                        setState(() => _orderStatus = value ?? 'CONFIRMED'),
                  ),
                  const SizedBox(height: 10),
                  _AdminTextField(
                    controller: _orderNote,
                    label: 'Status note',
                    maxLines: 2,
                  ),
                  _SaveButton(
                    label: 'Update order status',
                    saving: _savingOrder,
                    onPressed: _updateOrder,
                  ),
                ],
              ],
            ),
          ),
          _OpsSection(
            title: 'Bookings',
            icon: Icons.event_available_outlined,
            child: Column(
              children: [
                _AdminEntitySearchBox(
                  controller: _bookingSearch,
                  label: 'Search booking number, date, status, outlet, staff',
                  loading: _loadingBookings,
                  onSearch: _loadBookings,
                ),
                const SizedBox(height: 10),
                ..._bookings
                    .take(8)
                    .map(
                      (booking) => Card(
                        child: ListTile(
                          leading: const Icon(Icons.content_cut_outlined),
                          selected: _selectedBooking?.id == booking.id,
                          title: Text(
                            booking.appointmentNumber.isEmpty
                                ? 'Booking ${booking.id}'
                                : booking.appointmentNumber,
                          ),
                          subtitle: Text(
                            '${booking.appointmentDate} ${booking.startTime} / ${booking.status} / ${booking.paymentStatus}',
                          ),
                          onTap: () => setState(() {
                            _selectedBooking = booking;
                            _bookingStatus = booking.status.isEmpty
                                ? 'CONFIRMED'
                                : booking.status;
                          }),
                        ),
                      ),
                    ),
                if (_selectedBooking != null) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _bookingStatus,
                    decoration: const InputDecoration(
                      labelText: 'Booking status',
                    ),
                    items: _bookingStatuses
                        .map(
                          (status) => DropdownMenuItem(
                            value: status,
                            child: Text(status),
                          ),
                        )
                        .toList(),
                    onChanged: (value) =>
                        setState(() => _bookingStatus = value ?? 'CONFIRMED'),
                  ),
                  const SizedBox(height: 10),
                  _SaveButton(
                    label: 'Update booking status',
                    saving: _savingBooking,
                    onPressed: _updateBooking,
                  ),
                ],
              ],
            ),
          ),
          _OpsSection(
            title: 'Inventory movements',
            icon: Icons.history_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OutlinedButton.icon(
                  onPressed: _loadingMovements ? null : _loadMovements,
                  icon: _loadingMovements
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.sync),
                  label: const Text('Load movements'),
                ),
                const SizedBox(height: 10),
                ..._movements
                    .take(12)
                    .map(
                      (movement) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.swap_vert_circle_outlined),
                        title: Text(
                          '${movement.movementType} x ${movement.quantity}',
                        ),
                        subtitle: Text(
                          'Product ${movement.productId} / Inventory ${movement.inventoryId} / ${movement.referenceType} ${movement.referenceId}',
                        ),
                      ),
                    ),
              ],
            ),
          ),
          _OpsSection(
            title: 'Audit logs',
            icon: Icons.verified_user_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                OutlinedButton.icon(
                  onPressed: _loadingAudit ? null : _loadAuditLogs,
                  icon: _loadingAudit
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.sync),
                  label: const Text('Load audit logs'),
                ),
                const SizedBox(height: 10),
                ..._auditLogs
                    .take(12)
                    .map(
                      (log) => ListTile(
                        dense: true,
                        leading: const Icon(
                          Icons.admin_panel_settings_outlined,
                        ),
                        title: Text(
                          '${log.action} ${log.entityType} ${log.entityId}',
                        ),
                        subtitle: Text(
                          '${log.actorType} / ${log.ipAddress} / ${log.createdTime}',
                        ),
                      ),
                    ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OpsSection extends StatelessWidget {
  const _OpsSection({
    required this.title,
    required this.icon,
    required this.child,
  });

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ExpansionTile(
        leading: Icon(icon),
        title: Text(title),
        childrenPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
        children: [child],
      ),
    );
  }
}

class _BulkImportTab extends StatefulWidget {
  const _BulkImportTab({required this.onProducts, required this.onServices});

  final Future<AdminBulkImportResult?> Function(String csvText) onProducts;
  final Future<AdminBulkImportResult?> Function(String csvText) onServices;

  @override
  State<_BulkImportTab> createState() => _BulkImportTabState();
}

class _BulkImportTabState extends State<_BulkImportTab> {
  final _productsCsv = TextEditingController(text: _sampleProductsCsv);
  final _servicesCsv = TextEditingController(text: _sampleServicesCsv);
  AdminBulkImportResult? _productResult;
  AdminBulkImportResult? _serviceResult;
  String? _error;
  bool _importingProducts = false;
  bool _importingServices = false;

  @override
  void dispose() {
    _productsCsv.dispose();
    _servicesCsv.dispose();
    super.dispose();
  }

  Future<void> _importProducts() async {
    final csvText = _productsCsv.text.trim();
    if (csvText.isEmpty) {
      setState(() => _error = 'Paste product CSV first.');
      return;
    }
    setState(() {
      _error = null;
      _importingProducts = true;
    });
    final result = await widget.onProducts(csvText);
    if (!mounted) return;
    setState(() {
      _productResult = result;
      _importingProducts = false;
    });
  }

  Future<void> _importServices() async {
    final csvText = _servicesCsv.text.trim();
    if (csvText.isEmpty) {
      setState(() => _error = 'Paste service CSV first.');
      return;
    }
    setState(() {
      _error = null;
      _importingServices = true;
    });
    final result = await widget.onServices(csvText);
    if (!mounted) return;
    setState(() {
      _serviceResult = result;
      _importingServices = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Bulk CSV import',
      subtitle: 'Paste up to 500 product rows or 500 service rows, then import to Catalyst.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (_error != null) ...[
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 10),
          ],
          _BulkCsvBox(
            title: 'Products CSV',
            controller: _productsCsv,
            sample: _sampleProductsCsv,
            result: _productResult,
            importing: _importingProducts,
            buttonLabel: 'Import products',
            onImport: _importProducts,
          ),
          const SizedBox(height: 16),
          _BulkCsvBox(
            title: 'Services CSV',
            controller: _servicesCsv,
            sample: _sampleServicesCsv,
            result: _serviceResult,
            importing: _importingServices,
            buttonLabel: 'Import services',
            onImport: _importServices,
          ),
        ],
      ),
    );
  }
}

class _BulkCsvBox extends StatelessWidget {
  const _BulkCsvBox({
    required this.title,
    required this.controller,
    required this.sample,
    required this.result,
    required this.importing,
    required this.buttonLabel,
    required this.onImport,
  });

  final String title;
  final TextEditingController controller;
  final String sample;
  final AdminBulkImportResult? result;
  final bool importing;
  final String buttonLabel;
  final VoidCallback onImport;

  @override
  Widget build(BuildContext context) {
    final result = this.result;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.w900),
              ),
            ),
            TextButton.icon(
              onPressed: () => controller.text = sample,
              icon: const Icon(Icons.restore_page_outlined),
              label: const Text('Sample'),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          minLines: 8,
          maxLines: 12,
          style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          decoration: const InputDecoration(
            alignLabelWithHint: true,
            labelText: 'CSV text',
            prefixIcon: Icon(Icons.table_chart_outlined),
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: importing ? null : onImport,
            icon: importing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cloud_upload_outlined),
            label: Text(importing ? 'Importing...' : buttonLabel),
          ),
        ),
        if (result != null) ...[
          const SizedBox(height: 10),
          _BulkResultView(result: result),
        ],
      ],
    );
  }
}

class _BulkResultView extends StatelessWidget {
  const _BulkResultView({required this.result});

  final AdminBulkImportResult result;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            result.summary,
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
          if (result.errors.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...result.errors
                .take(5)
                .map((error) => Text('Row ${error.row}: ${error.error}')),
          ],
        ],
      ),
    );
  }
}

class _MediaUploadTab extends StatefulWidget {
  const _MediaUploadTab({
    required this.onUpload,
    required this.onLoad,
    required this.onMap,
    required this.onSearchTargets,
  });

  final Future<AdminUploadedFile?> Function(String mediaType, PlatformFile file)
  onUpload;
  final Future<List<AdminMediaAsset>?> Function(String mediaType) onLoad;
  final Future<AdminMediaAsset?> Function({
    required String assetId,
    required String targetId,
  })
  onMap;
  final Future<List<AdminMediaTarget>?> Function({
    required String mediaType,
    required String query,
  })
  onSearchTargets;

  @override
  State<_MediaUploadTab> createState() => _MediaUploadTabState();
}

class _MediaUploadTabState extends State<_MediaUploadTab> {
  AdminUploadedFile? _productFile;
  AdminUploadedFile? _serviceFile;
  AdminUploadedFile? _outletFile;
  final _targetQuery = TextEditingController();
  String _mediaType = 'product';
  List<AdminMediaAsset> _items = [];
  List<AdminMediaTarget> _targets = [];
  AdminMediaAsset? _selected;
  AdminMediaTarget? _selectedTarget;
  String? _error;
  bool _loading = false;
  bool _targetLoading = false;
  bool _mapping = false;

  @override
  void dispose() {
    _targetQuery.dispose();
    super.dispose();
  }

  String get _targetLabel {
    if (_mediaType == 'product') {
      return 'Product ID';
    }
    if (_mediaType == 'service') {
      return 'Service ID';
    }
    return 'Outlet ID';
  }

  String get _targetField {
    if (_mediaType == 'product') {
      return 'Products.thumbnail_url';
    }
    if (_mediaType == 'service') {
      return 'Salon_Services.image_url';
    }
    return 'Outlets.image_url';
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final items = await widget.onLoad(_mediaType);
    if (!mounted) {
      return;
    }
    AdminMediaAsset? selected;
    for (final item in items ?? <AdminMediaAsset>[]) {
      if (item.id == _selected?.id) {
        selected = item;
        break;
      }
    }
    setState(() {
      _items = items ?? [];
      _selected = selected;
      _loading = false;
    });
  }

  Future<void> _searchTargets() async {
    setState(() {
      _targetLoading = true;
      _error = null;
    });
    final targets = await widget.onSearchTargets(
      mediaType: _mediaType,
      query: _targetQuery.text.trim(),
    );
    if (!mounted) {
      return;
    }
    AdminMediaTarget? selected;
    for (final target in targets ?? <AdminMediaTarget>[]) {
      if (target.id == _selectedTarget?.id) {
        selected = target;
        break;
      }
    }
    setState(() {
      _targets = targets ?? [];
      _selectedTarget = selected;
      _targetLoading = false;
    });
  }

  Future<void> _upload(String mediaType) async {
    final result = await _pickAdminImage();
    if (result == null) {
      return;
    }
    final uploaded = await widget.onUpload(mediaType, result);
    if (!mounted || uploaded == null) {
      return;
    }
    setState(() {
      if (mediaType == 'product') {
        _productFile = uploaded;
      } else if (mediaType == 'service') {
        _serviceFile = uploaded;
      } else {
        _outletFile = uploaded;
      }
    });
    if (_mediaType == mediaType) {
      await _load();
    }
  }

  Future<void> _mapSelected() async {
    final selected = _selected;
    final selectedTarget = _selectedTarget;
    if (selected == null) {
      setState(() => _error = 'Select an uploaded image first.');
      return;
    }
    if (selectedTarget == null) {
      setState(() => _error = 'Search and select $_targetLabel first.');
      return;
    }
    setState(() {
      _mapping = true;
      _error = null;
    });
    final mapped = await widget.onMap(
      assetId: selected.id,
      targetId: selectedTarget.id,
    );
    if (!mounted) {
      return;
    }
    setState(() {
      _mapping = false;
      if (mapped != null) {
        _selected = mapped;
        _items = _items
            .map((item) => item.id == mapped.id ? mapped : item)
            .toList();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'File Store media',
      subtitle:
          'Upload, list, preview, and map File Store images to Baylen records.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _MediaUploadCard(
            title: 'Product image',
            body: 'Use for product thumbnails and product detail images.',
            icon: Icons.shopping_bag_outlined,
            uploaded: _productFile,
            onUpload: () => _upload('product'),
          ),
          const SizedBox(height: 12),
          _MediaUploadCard(
            title: 'Service image',
            body: 'Use for salon, treatment, and at-home service visuals.',
            icon: Icons.content_cut_outlined,
            uploaded: _serviceFile,
            onUpload: () => _upload('service'),
          ),
          const SizedBox(height: 12),
          _MediaUploadCard(
            title: 'Outlet image',
            body: 'Use for salon outlet cards, banners, and location details.',
            icon: Icons.store_mall_directory_outlined,
            uploaded: _outletFile,
            onUpload: () => _upload('outlet'),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  initialValue: _mediaType,
                  decoration: const InputDecoration(labelText: 'Media type'),
                  items: const [
                    DropdownMenuItem(value: 'product', child: Text('Products')),
                    DropdownMenuItem(value: 'service', child: Text('Services')),
                    DropdownMenuItem(value: 'outlet', child: Text('Outlets')),
                  ],
                  onChanged: (value) {
                    setState(() {
                      _mediaType = value ?? 'product';
                      _selected = null;
                      _selectedTarget = null;
                      _targetQuery.clear();
                      _items = [];
                      _targets = [];
                      _error = null;
                    });
                  },
                ),
              ),
              const SizedBox(width: 10),
              IconButton.filled(
                tooltip: 'Load uploaded media',
                onPressed: _loading ? null : _load,
                icon: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_error != null) ...[
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
            const SizedBox(height: 10),
          ],
          _MediaMappingPanel(
            selected: _selected,
            targetController: _targetQuery,
            targetLabel: _targetLabel,
            targetField: _targetField,
            targets: _targets,
            selectedTarget: _selectedTarget,
            loadingTargets: _targetLoading,
            mapping: _mapping,
            onSearchTargets: _searchTargets,
            onSelectTarget: (target) {
              setState(() {
                _selectedTarget = target;
                _targetQuery.text = target.title;
                _error = null;
              });
            },
            onMap: _mapSelected,
          ),
          const SizedBox(height: 12),
          if (_items.isEmpty)
            _EmptyAdminState(
              icon: Icons.image_search_outlined,
              title: _loading ? 'Loading media' : 'No uploaded media loaded',
              body:
                  'Use refresh after uploading images, then select one to map.',
            )
          else
            ..._items.map(
              (item) => _MediaLibraryTile(
                item: item,
                selected: item.id == _selected?.id,
                onTap: () {
                  setState(() {
                    _selected = item;
                    _selectedTarget = null;
                    _targetQuery.text = item.mappedEntityId;
                    _error = null;
                  });
                },
              ),
            ),
        ],
      ),
    );
  }
}

class _MediaMappingPanel extends StatelessWidget {
  const _MediaMappingPanel({
    required this.selected,
    required this.targetController,
    required this.targetLabel,
    required this.targetField,
    required this.targets,
    required this.selectedTarget,
    required this.loadingTargets,
    required this.mapping,
    required this.onSearchTargets,
    required this.onSelectTarget,
    required this.onMap,
  });

  final AdminMediaAsset? selected;
  final TextEditingController targetController;
  final String targetLabel;
  final String targetField;
  final List<AdminMediaTarget> targets;
  final AdminMediaTarget? selectedTarget;
  final bool loadingTargets;
  final bool mapping;
  final VoidCallback onSearchTargets;
  final ValueChanged<AdminMediaTarget> onSelectTarget;
  final VoidCallback onMap;

  @override
  Widget build(BuildContext context) {
    final selected = this.selected;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Map selected image',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            selected == null
                ? 'Select an image from the library below.'
                : '${selected.fileName} will update $targetField.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: targetController,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) => onSearchTargets(),
                  decoration: InputDecoration(
                    labelText: 'Search $targetLabel',
                    prefixIcon: const Icon(Icons.search),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              IconButton.filledTonal(
                tooltip: 'Search records',
                onPressed: loadingTargets ? null : onSearchTargets,
                icon: loadingTargets
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.search),
              ),
            ],
          ),
          if (selectedTarget != null) ...[
            const SizedBox(height: 10),
            _MediaTargetTile(
              target: selectedTarget!,
              selected: true,
              onTap: () {},
            ),
          ],
          if (targets.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              'Search results',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            const SizedBox(height: 6),
            ...targets
                .take(6)
                .map(
                  (target) => _MediaTargetTile(
                    target: target,
                    selected: target.id == selectedTarget?.id,
                    onTap: () => onSelectTarget(target),
                  ),
                ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: mapping ? null : onMap,
              icon: mapping
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.link_outlined),
              label: Text(mapping ? 'Mapping...' : 'Map image'),
            ),
          ),
        ],
      ),
    );
  }
}

class _MediaTargetTile extends StatelessWidget {
  const _MediaTargetTile({
    required this.target,
    required this.selected,
    required this.onTap,
  });

  final AdminMediaTarget target;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: selected ? 1 : 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: selected
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.outlineVariant,
          width: selected ? 1.5 : 1,
        ),
      ),
      child: ListTile(
        onTap: onTap,
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 54,
            height: 54,
            child: target.imageUrl.isEmpty
                ? const ColoredBox(
                    color: Color(0x14000000),
                    child: Icon(Icons.image_outlined),
                  )
                : Image.network(
                    target.imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const ColoredBox(
                          color: Color(0x14000000),
                          child: Icon(Icons.broken_image_outlined),
                        ),
                  ),
          ),
        ),
        title: Text(target.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(
          [
            'ID ${target.id}',
            target.subtitle,
            target.status,
          ].where((part) => part.isNotEmpty).join(' / '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: selected
            ? const Icon(Icons.check_circle)
            : const Icon(Icons.chevron_right),
      ),
    );
  }
}

class _MediaUploadCard extends StatelessWidget {
  const _MediaUploadCard({
    required this.title,
    required this.body,
    required this.icon,
    required this.uploaded,
    required this.onUpload,
  });

  final String title;
  final String body;
  final IconData icon;
  final AdminUploadedFile? uploaded;
  final VoidCallback onUpload;

  @override
  Widget build(BuildContext context) {
    final uploaded = this.uploaded;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 2),
                    Text(body, style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              FilledButton.icon(
                onPressed: onUpload,
                icon: const Icon(Icons.cloud_upload_outlined),
                label: const Text('Upload'),
              ),
            ],
          ),
          if (uploaded != null) ...[
            const SizedBox(height: 12),
            _UploadedFilePreview(file: uploaded),
          ],
        ],
      ),
    );
  }
}

class _UploadedFilePreview extends StatelessWidget {
  const _UploadedFilePreview({required this.file});

  final AdminUploadedFile file;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 76,
            height: 76,
            child: Image.network(
              file.fileUrl,
              fit: BoxFit.cover,
              errorBuilder: (context, error, stackTrace) => const ColoredBox(
                color: Color(0x14000000),
                child: Icon(Icons.broken_image_outlined),
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(file.fileName, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Text(
                'File ID ${file.fileId}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 4),
              SelectableText(
                file.fileUrl,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MediaLibraryTile extends StatelessWidget {
  const _MediaLibraryTile({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final AdminMediaAsset item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: selected ? 1 : 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: selected
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.outlineVariant,
          width: selected ? 1.5 : 1,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: SizedBox(
                  width: 82,
                  height: 82,
                  child: Image.network(
                    item.fileUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const ColoredBox(
                          color: Color(0x14000000),
                          child: Center(
                            child: Icon(Icons.broken_image_outlined),
                          ),
                        ),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.fileName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w900),
                          ),
                        ),
                        if (selected) const Icon(Icons.check_circle, size: 18),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Asset ${item.id} / File ${item.fileId}',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.mappedLabel,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    const SizedBox(height: 4),
                    SelectableText(
                      item.fileUrl,
                      maxLines: 2,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AdminEntitySearchBox extends StatelessWidget {
  const _AdminEntitySearchBox({
    required this.controller,
    required this.label,
    required this.loading,
    required this.onSearch,
  });

  final TextEditingController controller;
  final String label;
  final bool loading;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextField(
            controller: controller,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => onSearch(),
            decoration: InputDecoration(
              labelText: label,
              prefixIcon: const Icon(Icons.search),
            ),
          ),
        ),
        const SizedBox(width: 10),
        IconButton.filled(
          tooltip: 'Search',
          onPressed: loading ? null : onSearch,
          icon: loading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.search),
        ),
      ],
    );
  }
}

class _AdminEntityTile extends StatelessWidget {
  const _AdminEntityTile({
    required this.title,
    required this.subtitle,
    required this.status,
    required this.imageUrl,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final String status;
  final String imageUrl;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
            width: 54,
            height: 54,
            child: imageUrl.isEmpty
                ? const ColoredBox(
                    color: Color(0x14000000),
                    child: Icon(Icons.inventory_2_outlined),
                  )
                : Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const ColoredBox(
                          color: Color(0x14000000),
                          child: Icon(Icons.broken_image_outlined),
                        ),
                  ),
          ),
        ),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(status, style: Theme.of(context).textTheme.labelSmall),
            const Icon(Icons.edit_outlined, size: 18),
          ],
        ),
      ),
    );
  }
}

class _ProductTab extends StatefulWidget {
  const _ProductTab({
    required this.onSave,
    required this.onUpload,
    required this.onLoad,
    required this.onSetActive,
  });

  final Future<void> Function(Map<String, dynamic> payload) onSave;
  final Future<AdminUploadedFile?> Function(String mediaType, PlatformFile file)
  onUpload;
  final Future<List<AdminProductRecord>?> Function(String query) onLoad;
  final Future<AdminProductRecord?> Function(String id, bool active)
  onSetActive;

  @override
  State<_ProductTab> createState() => _ProductTabState();
}

class _ProductTabState extends State<_ProductTab> {
  final _formKey = GlobalKey<FormState>();
  final _id = TextEditingController();
  final _name = TextEditingController();
  final _slug = TextEditingController();
  final _sku = TextEditingController();
  final _brandId = TextEditingController();
  final _categoryId = TextEditingController();
  final _shortDescription = TextEditingController();
  final _description = TextEditingController();
  final _mrp = TextEditingController();
  final _sellingPrice = TextEditingController();
  final _taxPercent = TextEditingController(text: '0');
  final _thumbnailUrl = TextEditingController();
  final _search = TextEditingController();
  List<AdminProductRecord> _records = [];
  bool _hasVariants = false;
  bool _isFeatured = false;
  String _status = 'ACTIVE';
  bool _loadingRecords = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final controller in [
      _id,
      _name,
      _slug,
      _sku,
      _brandId,
      _categoryId,
      _shortDescription,
      _description,
      _mrp,
      _sellingPrice,
      _taxPercent,
      _thumbnailUrl,
      _search,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRecords() async {
    setState(() => _loadingRecords = true);
    final records = await widget.onLoad(_search.text.trim());
    if (!mounted) {
      return;
    }
    setState(() {
      _records = records ?? [];
      _loadingRecords = false;
    });
  }

  void _select(AdminProductRecord record) {
    setState(() {
      _id.text = record.id;
      _name.text = record.name;
      _slug.text = record.slug;
      _sku.text = record.sku;
      _brandId.text = record.brandId;
      _categoryId.text = record.categoryId;
      _shortDescription.text = record.shortDescription;
      _description.text = record.description;
      _mrp.text = _moneyText(record.mrp);
      _sellingPrice.text = _moneyText(record.sellingPrice);
      _taxPercent.text = _moneyText(record.taxPercent);
      _thumbnailUrl.text = record.thumbnailUrl;
      _hasVariants = record.hasVariants;
      _isFeatured = record.isFeatured;
      _status = record.status.isEmpty ? 'ACTIVE' : record.status;
    });
  }

  void _replaceRecord(AdminProductRecord record) {
    final index = _records.indexWhere((item) => item.id == record.id);
    setState(() {
      if (index == -1) {
        _records = [record, ..._records];
      } else {
        _records = [
          for (final item in _records) item.id == record.id ? record : item,
        ];
      }
    });
  }

  void _clear() {
    setState(() {
      for (final controller in [
        _id,
        _name,
        _slug,
        _sku,
        _brandId,
        _categoryId,
        _shortDescription,
        _description,
        _mrp,
        _sellingPrice,
        _thumbnailUrl,
      ]) {
        controller.clear();
      }
      _taxPercent.text = '0';
      _hasVariants = false;
      _isFeatured = false;
      _status = 'ACTIVE';
    });
  }

  Future<void> _toggleActive() async {
    final id = _text(_id);
    if (id.isEmpty || _saving) {
      return;
    }
    final nextActive = _status.toUpperCase() != 'ACTIVE';
    final deactivate = !nextActive;
    final confirmed = await _confirmAdminAction(
      context,
      title: deactivate ? 'Deactivate product?' : 'Activate product?',
      message: deactivate
          ? 'This product will stop appearing as an active item, but existing orders and history will remain safe.'
          : 'This product will become active again for admin and customer flows.',
      actionLabel: deactivate ? 'Deactivate' : 'Activate',
      destructive: deactivate,
    );
    if (!confirmed) {
      return;
    }
    setState(() => _saving = true);
    final updated = await widget.onSetActive(id, nextActive);
    if (!mounted) {
      return;
    }
    if (updated != null) {
      _replaceRecord(updated);
      _select(updated);
    }
    setState(() => _saving = false);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _saving = true);
    await widget.onSave({
      if (_text(_id).isNotEmpty) 'id': _text(_id),
      'name': _text(_name),
      if (_text(_slug).isNotEmpty) 'slug': _text(_slug),
      if (_text(_sku).isNotEmpty) 'sku': _text(_sku),
      if (_text(_brandId).isNotEmpty) 'brand_id': _text(_brandId),
      if (_text(_categoryId).isNotEmpty) 'category_id': _text(_categoryId),
      if (_text(_shortDescription).isNotEmpty)
        'short_description': _text(_shortDescription),
      if (_text(_description).isNotEmpty) 'description': _text(_description),
      'mrp': _number(_mrp),
      'selling_price': _number(_sellingPrice),
      'currency': 'INR',
      'tax_percent': _number(_taxPercent),
      if (_text(_thumbnailUrl).isNotEmpty)
        'thumbnail_url': _text(_thumbnailUrl),
      'has_variants': _hasVariants,
      'is_featured': _isFeatured,
      'status': _status,
    });
    if (mounted) {
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Product management',
      subtitle:
          'Create or update beauty products that appear in Shop and Home.',
      child: Column(
        children: [
          _AdminEntitySearchBox(
            controller: _search,
            label: 'Search products by name, SKU, ID',
            loading: _loadingRecords,
            onSearch: _loadRecords,
          ),
          const SizedBox(height: 10),
          if (_records.isEmpty)
            const Text('Search products to edit existing records.')
          else
            ..._records
                .take(8)
                .map(
                  (record) => _AdminEntityTile(
                    title: record.name,
                    subtitle: 'ID ${record.id} / SKU ${record.sku}',
                    status: record.status,
                    imageUrl: record.thumbnailUrl,
                    onTap: () => _select(record),
                  ),
                ),
          const Divider(height: 28),
          Row(
            children: [
              Expanded(
                child: Text(
                  _id.text.isEmpty
                      ? 'Create product'
                      : 'Edit product ${_id.text}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Wrap(
                spacing: 8,
                children: [
                  if (_id.text.isNotEmpty)
                    _StatusActionButton(
                      active: _status == 'ACTIVE',
                      saving: _saving,
                      entityLabel: 'product',
                      onPressed: _toggleActive,
                    ),
                  TextButton.icon(
                    onPressed: _clear,
                    icon: const Icon(Icons.add_circle_outline),
                    label: const Text('New'),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Form(
            key: _formKey,
            child: Column(
              children: [
                _AdminTextField(
                  controller: _id,
                  label: 'Product ID for update',
                ),
                _AdminTextField(
                  controller: _name,
                  label: 'Product name',
                  isRequired: true,
                ),
                _AdminTextField(controller: _slug, label: 'Slug'),
                _AdminTextField(controller: _sku, label: 'SKU'),
                _AdminTextField(controller: _brandId, label: 'Brand ID'),
                _AdminTextField(controller: _categoryId, label: 'Category ID'),
                _AdminTextField(
                  controller: _shortDescription,
                  label: 'Short description',
                  maxLines: 2,
                ),
                _AdminTextField(
                  controller: _description,
                  label: 'Description',
                  maxLines: 4,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _mrp,
                        label: 'MRP',
                        keyboardType: TextInputType.number,
                        isRequired: true,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _sellingPrice,
                        label: 'Selling price',
                        keyboardType: TextInputType.number,
                        isRequired: true,
                      ),
                    ),
                  ],
                ),
                _AdminTextField(
                  controller: _taxPercent,
                  label: 'Tax percent',
                  keyboardType: TextInputType.number,
                ),
                _AdminImageUploadField(
                  controller: _thumbnailUrl,
                  label: 'Thumbnail image URL',
                  mediaType: 'product',
                  onUpload: widget.onUpload,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminSwitch(
                        label: 'Has variants',
                        value: _hasVariants,
                        onChanged: (value) =>
                            setState(() => _hasVariants = value),
                      ),
                    ),
                    Expanded(
                      child: _AdminSwitch(
                        label: 'Featured',
                        value: _isFeatured,
                        onChanged: (value) =>
                            setState(() => _isFeatured = value),
                      ),
                    ),
                  ],
                ),
                _StatusDropdown(
                  value: _status,
                  onChanged: (value) => setState(() => _status = value),
                ),
                const SizedBox(height: 12),
                _SaveButton(
                  label: 'Save product',
                  saving: _saving,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InventoryTab extends StatefulWidget {
  const _InventoryTab({
    required this.inventory,
    required this.onRefresh,
    required this.onSave,
  });

  final List<AdminInventoryItem> inventory;
  final Future<void> Function() onRefresh;
  final Future<void> Function(Map<String, dynamic> payload) onSave;

  @override
  State<_InventoryTab> createState() => _InventoryTabState();
}

class _InventoryTabState extends State<_InventoryTab> {
  final _formKey = GlobalKey<FormState>();
  final _inventoryId = TextEditingController();
  final _quantityOnHand = TextEditingController();
  final _quantityReserved = TextEditingController(text: '0');
  final _notes = TextEditingController();
  String _status = 'ACTIVE';
  bool _isActive = true;
  bool _saving = false;

  @override
  void dispose() {
    _inventoryId.dispose();
    _quantityOnHand.dispose();
    _quantityReserved.dispose();
    _notes.dispose();
    super.dispose();
  }

  void _select(AdminInventoryItem item) {
    setState(() {
      _inventoryId.text = item.id;
      _quantityOnHand.text = '${item.quantityOnHand}';
      _quantityReserved.text = '${item.quantityReserved}';
      _status = item.status.isEmpty ? 'ACTIVE' : item.status;
      _isActive = item.isActive;
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _saving = true);
    await widget.onSave({
      'inventory_id': _text(_inventoryId),
      'quantity_on_hand': _intNumber(_quantityOnHand),
      'quantity_reserved': _intNumber(_quantityReserved),
      'status': _status,
      'is_active': _isActive,
      if (_text(_notes).isNotEmpty) 'notes': _text(_notes),
    });
    if (mounted) {
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Inventory management',
      subtitle: 'Select a stock row, adjust on-hand/reserved quantity, and write movement logs.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          OutlinedButton.icon(
            onPressed: () => widget.onRefresh(),
            icon: const Icon(Icons.sync),
            label: const Text('Load inventory'),
          ),
          const SizedBox(height: 10),
          if (widget.inventory.isEmpty)
            const Text('No inventory rows loaded.')
          else
            ...widget.inventory
                .take(12)
                .map(
                  (item) => _InventoryListTile(
                    item: item,
                    onTap: () => _select(item),
                  ),
                ),
          const Divider(height: 28),
          Form(
            key: _formKey,
            child: Column(
              children: [
                _AdminTextField(
                  controller: _inventoryId,
                  label: 'Inventory ID',
                  isRequired: true,
                  keyboardType: TextInputType.number,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _quantityOnHand,
                        label: 'On hand',
                        isRequired: true,
                        keyboardType: TextInputType.number,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _quantityReserved,
                        label: 'Reserved',
                        keyboardType: TextInputType.number,
                      ),
                    ),
                  ],
                ),
                _StatusDropdown(
                  value: _status,
                  onChanged: (value) => setState(() => _status = value),
                ),
                _AdminSwitch(
                  label: 'Inventory active',
                  value: _isActive,
                  onChanged: (value) => setState(() => _isActive = value),
                ),
                _AdminTextField(
                  controller: _notes,
                  label: 'Movement notes',
                  maxLines: 2,
                ),
                const SizedBox(height: 12),
                _SaveButton(
                  label: 'Update inventory',
                  saving: _saving,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ServiceTab extends StatefulWidget {
  const _ServiceTab({
    required this.onSave,
    required this.onUpload,
    required this.onLoad,
    required this.onSetActive,
  });

  final Future<void> Function(Map<String, dynamic> payload) onSave;
  final Future<AdminUploadedFile?> Function(String mediaType, PlatformFile file)
  onUpload;
  final Future<List<AdminServiceRecord>?> Function(String query) onLoad;
  final Future<AdminServiceRecord?> Function(String id, bool active)
  onSetActive;

  @override
  State<_ServiceTab> createState() => _ServiceTabState();
}

class _ServiceTabState extends State<_ServiceTab> {
  final _formKey = GlobalKey<FormState>();
  final _id = TextEditingController();
  final _name = TextEditingController();
  final _slug = TextEditingController();
  final _description = TextEditingController();
  final _categoryId = TextEditingController();
  final _imageUrl = TextEditingController();
  final _duration = TextEditingController(text: '30');
  final _mrp = TextEditingController();
  final _sellingPrice = TextEditingController();
  final _search = TextEditingController();
  List<AdminServiceRecord> _records = [];
  String _gender = 'UNISEX';
  String _status = 'ACTIVE';
  bool _isActive = true;
  bool _loadingRecords = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final controller in [
      _id,
      _name,
      _slug,
      _description,
      _categoryId,
      _imageUrl,
      _duration,
      _mrp,
      _sellingPrice,
      _search,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRecords() async {
    setState(() => _loadingRecords = true);
    final records = await widget.onLoad(_search.text.trim());
    if (!mounted) {
      return;
    }
    setState(() {
      _records = records ?? [];
      _loadingRecords = false;
    });
  }

  void _select(AdminServiceRecord record) {
    setState(() {
      _id.text = record.id;
      _name.text = record.name;
      _slug.text = record.slug;
      _description.text = record.description;
      _categoryId.text = record.categoryId;
      _imageUrl.text = record.imageUrl;
      _duration.text = '${record.durationMinutes}';
      _mrp.text = _moneyText(record.mrp);
      _sellingPrice.text = _moneyText(record.sellingPrice);
      _gender = record.gender.isEmpty ? 'UNISEX' : record.gender;
      _status = record.status.isEmpty ? 'ACTIVE' : record.status;
      _isActive = record.isActive;
    });
  }

  void _replaceRecord(AdminServiceRecord record) {
    final index = _records.indexWhere((item) => item.id == record.id);
    setState(() {
      if (index == -1) {
        _records = [record, ..._records];
      } else {
        _records = [
          for (final item in _records) item.id == record.id ? record : item,
        ];
      }
    });
  }

  void _clear() {
    setState(() {
      for (final controller in [
        _id,
        _name,
        _slug,
        _description,
        _categoryId,
        _imageUrl,
        _mrp,
        _sellingPrice,
      ]) {
        controller.clear();
      }
      _duration.text = '30';
      _gender = 'UNISEX';
      _status = 'ACTIVE';
      _isActive = true;
    });
  }

  Future<void> _toggleActive() async {
    final id = _text(_id);
    if (id.isEmpty || _saving) {
      return;
    }
    final nextActive = !_isActive || _status.toUpperCase() != 'ACTIVE';
    final deactivate = !nextActive;
    final confirmed = await _confirmAdminAction(
      context,
      title: deactivate ? 'Deactivate service?' : 'Activate service?',
      message: deactivate
          ? 'This service will stop appearing as bookable, but old bookings, reviews, and history will remain safe.'
          : 'This service will become bookable again wherever active services are shown.',
      actionLabel: deactivate ? 'Deactivate' : 'Activate',
      destructive: deactivate,
    );
    if (!confirmed) {
      return;
    }
    setState(() => _saving = true);
    final updated = await widget.onSetActive(id, nextActive);
    if (!mounted) {
      return;
    }
    if (updated != null) {
      _replaceRecord(updated);
      _select(updated);
    }
    setState(() => _saving = false);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _saving = true);
    await widget.onSave({
      if (_text(_id).isNotEmpty) 'id': _text(_id),
      'name': _text(_name),
      if (_text(_slug).isNotEmpty) 'slug': _text(_slug),
      if (_text(_description).isNotEmpty) 'description': _text(_description),
      if (_text(_categoryId).isNotEmpty) 'category_id': _text(_categoryId),
      if (_text(_imageUrl).isNotEmpty) 'image_url': _text(_imageUrl),
      'duration_minutes': _intNumber(_duration),
      'gender': _gender,
      'mrp': _number(_mrp),
      'selling_price': _number(_sellingPrice),
      'currency': 'INR',
      'status': _status,
      'is_active': _isActive,
    });
    if (mounted) {
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Service management',
      subtitle: 'Create and update salon or at-home service definitions.',
      child: Column(
        children: [
          _AdminEntitySearchBox(
            controller: _search,
            label: 'Search services by name, ID, slug',
            loading: _loadingRecords,
            onSearch: _loadRecords,
          ),
          const SizedBox(height: 10),
          if (_records.isEmpty)
            const Text('Search services to edit existing records.')
          else
            ..._records
                .take(8)
                .map(
                  (record) => _AdminEntityTile(
                    title: record.name,
                    subtitle:
                        'ID ${record.id} / ${record.durationMinutes} min / ${record.gender}',
                    status: record.isActive ? record.status : 'INACTIVE',
                    imageUrl: record.imageUrl,
                    onTap: () => _select(record),
                  ),
                ),
          const Divider(height: 28),
          Row(
            children: [
              Expanded(
                child: Text(
                  _id.text.isEmpty
                      ? 'Create service'
                      : 'Edit service ${_id.text}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Wrap(
                spacing: 8,
                children: [
                  if (_id.text.isNotEmpty)
                    _StatusActionButton(
                      active: _isActive && _status == 'ACTIVE',
                      saving: _saving,
                      entityLabel: 'service',
                      onPressed: _toggleActive,
                    ),
                  TextButton.icon(
                    onPressed: _clear,
                    icon: const Icon(Icons.add_circle_outline),
                    label: const Text('New'),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Form(
            key: _formKey,
            child: Column(
              children: [
                _AdminTextField(
                  controller: _id,
                  label: 'Service ID for update',
                ),
                _AdminTextField(
                  controller: _name,
                  label: 'Service name',
                  isRequired: true,
                ),
                _AdminTextField(controller: _slug, label: 'Slug'),
                _AdminTextField(
                  controller: _categoryId,
                  label: 'Service category ID',
                ),
                _AdminTextField(
                  controller: _description,
                  label: 'Description',
                  maxLines: 3,
                ),
                _AdminImageUploadField(
                  controller: _imageUrl,
                  label: 'Service image URL',
                  mediaType: 'service',
                  onUpload: widget.onUpload,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _duration,
                        label: 'Duration minutes',
                        keyboardType: TextInputType.number,
                        isRequired: true,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _gender,
                        decoration: const InputDecoration(labelText: 'Gender'),
                        items: const [
                          DropdownMenuItem(
                            value: 'UNISEX',
                            child: Text('Unisex'),
                          ),
                          DropdownMenuItem(
                            value: 'FEMALE',
                            child: Text('Female'),
                          ),
                          DropdownMenuItem(value: 'MALE', child: Text('Male')),
                        ],
                        onChanged: (value) =>
                            setState(() => _gender = value ?? 'UNISEX'),
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _mrp,
                        label: 'MRP',
                        keyboardType: TextInputType.number,
                        isRequired: true,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _sellingPrice,
                        label: 'Selling price',
                        keyboardType: TextInputType.number,
                        isRequired: true,
                      ),
                    ),
                  ],
                ),
                _StatusDropdown(
                  value: _status,
                  onChanged: (value) => setState(() => _status = value),
                ),
                _AdminSwitch(
                  label: 'Service active',
                  value: _isActive,
                  onChanged: (value) => setState(() => _isActive = value),
                ),
                const SizedBox(height: 12),
                _SaveButton(
                  label: 'Save service',
                  saving: _saving,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OutletTab extends StatefulWidget {
  const _OutletTab({
    required this.onSave,
    required this.onUpload,
    required this.onLoad,
    required this.onSetActive,
  });

  final Future<void> Function(Map<String, dynamic> payload) onSave;
  final Future<AdminUploadedFile?> Function(String mediaType, PlatformFile file)
  onUpload;
  final Future<List<AdminOutletRecord>?> Function(String query) onLoad;
  final Future<AdminOutletRecord?> Function(String id, bool active) onSetActive;

  @override
  State<_OutletTab> createState() => _OutletTabState();
}

class _OutletTabState extends State<_OutletTab> {
  final _formKey = GlobalKey<FormState>();
  final _id = TextEditingController();
  final _name = TextEditingController();
  final _slug = TextEditingController();
  final _code = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _postalCode = TextEditingController();
  final _phone = TextEditingController();
  final _latitude = TextEditingController();
  final _longitude = TextEditingController();
  final _openingTime = TextEditingController(text: '10:00');
  final _closingTime = TextEditingController(text: '21:00');
  final _imageUrl = TextEditingController();
  final _videoUrl = TextEditingController();
  final _search = TextEditingController();
  List<AdminOutletRecord> _records = [];
  String _salonCategory = 'Gold';
  bool _isActive = true;
  bool _loadingRecords = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final controller in [
      _id,
      _name,
      _slug,
      _code,
      _address,
      _city,
      _state,
      _postalCode,
      _phone,
      _latitude,
      _longitude,
      _openingTime,
      _closingTime,
      _imageUrl,
      _videoUrl,
      _search,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadRecords() async {
    setState(() => _loadingRecords = true);
    final records = await widget.onLoad(_search.text.trim());
    if (!mounted) {
      return;
    }
    setState(() {
      _records = records ?? [];
      _loadingRecords = false;
    });
  }

  void _select(AdminOutletRecord record) {
    setState(() {
      _id.text = record.id;
      _name.text = record.name;
      _slug.text = record.slug;
      _code.text = record.code;
      _salonCategory = record.salonCategory.isEmpty
          ? 'Gold'
          : record.salonCategory;
      _address.text = record.addressLine1;
      _city.text = record.city;
      _state.text = record.state;
      _postalCode.text = record.postalCode;
      _phone.text = record.phone;
      _latitude.text = record.latitude;
      _longitude.text = record.longitude;
      _openingTime.text = record.openingTime;
      _closingTime.text = record.closingTime;
      _imageUrl.text = record.imageUrl;
      _videoUrl.text = record.videoUrl;
      _isActive = record.isActive;
    });
  }

  void _replaceRecord(AdminOutletRecord record) {
    final index = _records.indexWhere((item) => item.id == record.id);
    setState(() {
      if (index == -1) {
        _records = [record, ..._records];
      } else {
        _records = [
          for (final item in _records) item.id == record.id ? record : item,
        ];
      }
    });
  }

  void _clear() {
    setState(() {
      for (final controller in [
        _id,
        _name,
        _slug,
        _code,
        _address,
        _city,
        _state,
        _postalCode,
        _phone,
        _latitude,
        _longitude,
        _imageUrl,
        _videoUrl,
      ]) {
        controller.clear();
      }
      _openingTime.text = '10:00';
      _closingTime.text = '21:00';
      _salonCategory = 'Gold';
      _isActive = true;
    });
  }

  Future<void> _toggleActive() async {
    final id = _text(_id);
    if (id.isEmpty || _saving) {
      return;
    }
    final nextActive = !_isActive;
    final deactivate = !nextActive;
    final confirmed = await _confirmAdminAction(
      context,
      title: deactivate ? 'Deactivate outlet?' : 'Activate outlet?',
      message: deactivate
          ? 'This outlet will stop appearing as available, but existing bookings, orders, reviews, and history will remain safe.'
          : 'This outlet will become available again in outlet and booking flows.',
      actionLabel: deactivate ? 'Deactivate' : 'Activate',
      destructive: deactivate,
    );
    if (!confirmed) {
      return;
    }
    setState(() => _saving = true);
    final updated = await widget.onSetActive(id, nextActive);
    if (!mounted) {
      return;
    }
    if (updated != null) {
      _replaceRecord(updated);
      _select(updated);
    }
    setState(() => _saving = false);
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    setState(() => _saving = true);
    await widget.onSave({
      if (_text(_id).isNotEmpty) 'id': _text(_id),
      'name': _text(_name),
      if (_text(_slug).isNotEmpty) 'slug': _text(_slug),
      if (_text(_code).isNotEmpty) 'code': _text(_code),
      'salon_category': _salonCategory,
      if (_text(_address).isNotEmpty) 'address_line1': _text(_address),
      if (_text(_city).isNotEmpty) 'city': _text(_city),
      if (_text(_state).isNotEmpty) 'state': _text(_state),
      if (_text(_postalCode).isNotEmpty) 'postal_code': _text(_postalCode),
      if (_text(_phone).isNotEmpty) 'phone': _text(_phone),
      if (_text(_latitude).isNotEmpty) 'latitude': _text(_latitude),
      if (_text(_longitude).isNotEmpty) 'longitude': _text(_longitude),
      if (_text(_openingTime).isNotEmpty) 'opening_time': _text(_openingTime),
      if (_text(_closingTime).isNotEmpty) 'closing_time': _text(_closingTime),
      if (_text(_imageUrl).isNotEmpty) 'image_url': _text(_imageUrl),
      if (_text(_videoUrl).isNotEmpty) 'video_url': _text(_videoUrl),
      'is_active': _isActive,
    });
    if (mounted) {
      setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AdminFormPage(
      title: 'Outlet management',
      subtitle: 'Manage Baylen salons, locations, timing, media, and category.',
      child: Column(
        children: [
          _AdminEntitySearchBox(
            controller: _search,
            label: 'Search outlets by name, city, code, ID',
            loading: _loadingRecords,
            onSearch: _loadRecords,
          ),
          const SizedBox(height: 10),
          if (_records.isEmpty)
            const Text('Search outlets to edit existing records.')
          else
            ..._records
                .take(8)
                .map(
                  (record) => _AdminEntityTile(
                    title: record.name,
                    subtitle:
                        'ID ${record.id} / ${record.city} / ${record.salonCategory}',
                    status: record.isActive ? 'ACTIVE' : 'INACTIVE',
                    imageUrl: record.imageUrl,
                    onTap: () => _select(record),
                  ),
                ),
          const Divider(height: 28),
          Row(
            children: [
              Expanded(
                child: Text(
                  _id.text.isEmpty
                      ? 'Create outlet'
                      : 'Edit outlet ${_id.text}',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Wrap(
                spacing: 8,
                children: [
                  if (_id.text.isNotEmpty)
                    _StatusActionButton(
                      active: _isActive,
                      saving: _saving,
                      entityLabel: 'outlet',
                      onPressed: _toggleActive,
                    ),
                  TextButton.icon(
                    onPressed: _clear,
                    icon: const Icon(Icons.add_circle_outline),
                    label: const Text('New'),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Form(
            key: _formKey,
            child: Column(
              children: [
                _AdminTextField(controller: _id, label: 'Outlet ID for update'),
                _AdminTextField(
                  controller: _name,
                  label: 'Outlet name',
                  isRequired: true,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(controller: _slug, label: 'Slug'),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _code,
                        label: 'Outlet code',
                      ),
                    ),
                  ],
                ),
                DropdownButtonFormField<String>(
                  initialValue: _salonCategory,
                  decoration: const InputDecoration(
                    labelText: 'Salon category',
                  ),
                  items: const [
                    DropdownMenuItem(value: 'Bronze', child: Text('Bronze')),
                    DropdownMenuItem(value: 'Silver', child: Text('Silver')),
                    DropdownMenuItem(value: 'Gold', child: Text('Gold')),
                    DropdownMenuItem(value: 'Luxury', child: Text('Luxury')),
                    DropdownMenuItem(value: 'Royal', child: Text('Royal')),
                  ],
                  onChanged: (value) =>
                      setState(() => _salonCategory = value ?? 'Gold'),
                ),
                const SizedBox(height: 10),
                _AdminTextField(
                  controller: _address,
                  label: 'Address line 1',
                  maxLines: 2,
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(controller: _city, label: 'City'),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _state,
                        label: 'State',
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _postalCode,
                        label: 'Postal code',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _phone,
                        label: 'Phone',
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _latitude,
                        label: 'Latitude',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _longitude,
                        label: 'Longitude',
                      ),
                    ),
                  ],
                ),
                Row(
                  children: [
                    Expanded(
                      child: _AdminTextField(
                        controller: _openingTime,
                        label: 'Opening time',
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _AdminTextField(
                        controller: _closingTime,
                        label: 'Closing time',
                      ),
                    ),
                  ],
                ),
                _AdminImageUploadField(
                  controller: _imageUrl,
                  label: 'Outlet image URL',
                  mediaType: 'outlet',
                  onUpload: widget.onUpload,
                ),
                _AdminTextField(
                  controller: _videoUrl,
                  label: 'Outlet video URL',
                ),
                _AdminSwitch(
                  label: 'Outlet active',
                  value: _isActive,
                  onChanged: (value) => setState(() => _isActive = value),
                ),
                const SizedBox(height: 12),
                _SaveButton(
                  label: 'Save outlet',
                  saving: _saving,
                  onPressed: _submit,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AdminFormPage extends StatelessWidget {
  const _AdminFormPage({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleLarge
              ?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 4),
        Text(subtitle, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 16),
        child,
      ],
    );
  }
}

class _AdminTextField extends StatelessWidget {
  const _AdminTextField({
    required this.controller,
    required this.label,
    this.isRequired = false,
    this.maxLines = 1,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String label;
  final bool isRequired;
  final int maxLines;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: InputDecoration(labelText: label),
        validator: isRequired
            ? (value) {
                if (value == null || value.trim().isEmpty) {
                  return '$label is required';
                }
                return null;
              }
            : null,
      ),
    );
  }
}

class _AdminImageUploadField extends StatefulWidget {
  const _AdminImageUploadField({
    required this.controller,
    required this.label,
    required this.mediaType,
    required this.onUpload,
  });

  final TextEditingController controller;
  final String label;
  final String mediaType;
  final Future<AdminUploadedFile?> Function(String mediaType, PlatformFile file)
  onUpload;

  @override
  State<_AdminImageUploadField> createState() => _AdminImageUploadFieldState();
}

class _AdminImageUploadFieldState extends State<_AdminImageUploadField> {
  bool _uploading = false;
  String? _localError;

  Future<void> _upload() async {
    final file = await _pickAdminImage();
    if (file == null) {
      return;
    }
    final bytes = file.bytes;
    if (bytes == null || bytes.isEmpty) {
      setState(() => _localError = 'Selected image could not be read.');
      return;
    }
    if (bytes.length > _maxAdminImageBytes) {
      setState(() => _localError = 'Image must be 5 MB or smaller.');
      return;
    }
    setState(() {
      _localError = null;
      _uploading = true;
    });
    final uploaded = await widget.onUpload(widget.mediaType, file);
    if (!mounted) {
      return;
    }
    if (uploaded != null) {
      setState(() {
        widget.controller.text = uploaded.fileUrl;
        _uploading = false;
      });
    } else {
      setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final url = widget.controller.text.trim();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextFormField(
                  controller: widget.controller,
                  decoration: InputDecoration(labelText: widget.label),
                ),
              ),
              const SizedBox(width: 10),
              IconButton.filledTonal(
                tooltip: 'Upload image',
                onPressed: _uploading ? null : _upload,
                icon: _uploading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.cloud_upload_outlined),
              ),
            ],
          ),
          if (_localError != null) ...[
            const SizedBox(height: 6),
            Text(
              _localError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          if (url.isNotEmpty) ...[
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: double.infinity,
                height: 128,
                child: Image.network(
                  url,
                  fit: BoxFit.cover,
                  errorBuilder: (context, error, stackTrace) =>
                      const ColoredBox(
                        color: Color(0x14000000),
                        child: Center(child: Icon(Icons.broken_image_outlined)),
                      ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AdminSwitch extends StatelessWidget {
  const _AdminSwitch({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      value: value,
      onChanged: onChanged,
    );
  }
}

class _StatusDropdown extends StatelessWidget {
  const _StatusDropdown({required this.value, required this.onChanged});

  final String value;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: DropdownButtonFormField<String>(
        initialValue: value,
        decoration: const InputDecoration(labelText: 'Status'),
        items: const [
          DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
          DropdownMenuItem(value: 'DRAFT', child: Text('Draft')),
          DropdownMenuItem(value: 'INACTIVE', child: Text('Inactive')),
        ],
        onChanged: (value) => onChanged(value ?? 'ACTIVE'),
      ),
    );
  }
}

class _StatusActionButton extends StatelessWidget {
  const _StatusActionButton({
    required this.active,
    required this.saving,
    required this.entityLabel,
    required this.onPressed,
  });

  final bool active;
  final bool saving;
  final String entityLabel;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final deactivate = active;
    return Tooltip(
      message: deactivate ? 'Deactivate $entityLabel' : 'Activate $entityLabel',
      child: OutlinedButton.icon(
        style: deactivate
            ? OutlinedButton.styleFrom(
                foregroundColor: colorScheme.error,
                side: BorderSide(color: colorScheme.error),
              )
            : null,
        onPressed: saving ? null : onPressed,
        icon: Icon(
          deactivate
              ? Icons.visibility_off_outlined
              : Icons.visibility_outlined,
        ),
        label: Text(deactivate ? 'Deactivate' : 'Activate'),
      ),
    );
  }
}

class _SaveButton extends StatelessWidget {
  const _SaveButton({
    required this.label,
    required this.saving,
    required this.onPressed,
  });

  final String label;
  final bool saving;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: saving ? null : onPressed,
        icon: saving
            ? const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : const Icon(Icons.save_outlined),
        label: Text(saving ? 'Saving...' : label),
      ),
    );
  }
}

class _InventoryListTile extends StatelessWidget {
  const _InventoryListTile({required this.item, this.onTap});

  final AdminInventoryItem item;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final low = item.availableQuantity <= 5;
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: Icon(
          low ? Icons.warning_amber_outlined : Icons.inventory_2_outlined,
          color: low
              ? Theme.of(context).colorScheme.error
              : Theme.of(context).colorScheme.primary,
        ),
        title: Text(
          item.productName.isEmpty ? 'Inventory ${item.id}' : item.productName,
        ),
        subtitle: Text('ID ${item.id} / Product ${item.productId}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              '${item.availableQuantity} left',
              style: const TextStyle(fontWeight: FontWeight.w900),
            ),
            Text('On hand ${item.quantityOnHand}'),
          ],
        ),
      ),
    );
  }
}

class _EmptyAdminState extends StatelessWidget {
  const _EmptyAdminState({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Theme.of(context).colorScheme.primary),
          const SizedBox(height: 10),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(body),
        ],
      ),
    );
  }
}

const _sampleProductsCsv =
    'id,name,slug,sku,brand_id,category_id,short_description,description,mrp,selling_price,currency,tax_percent,thumbnail_url,has_variants,is_featured,status\n'
    ',Baylen Keratin Smooth Shampoo,baylen-keratin-smooth-shampoo,BAY-HC-001,,,"Keratin care shampoo","Smooth hair care shampoo for salon-grade shine",799,599,INR,18,https://example.com/products/shampoo.jpg,false,true,ACTIVE\n'
    ',Baylen Vitamin C Serum,baylen-vitamin-c-serum,BAY-SC-001,,,"Daily glow serum","Brightening serum for hydrated skin",1299,899,INR,18,https://example.com/products/serum.jpg,false,true,ACTIVE';

const _sampleServicesCsv =
    'id,name,slug,description,category_id,image_url,duration_minutes,gender,mrp,selling_price,currency,status,is_active\n'
    ',Hair Spa,hair-spa,"Deep nourishment hair spa",,,60,UNISEX,1499,1199,INR,ACTIVE,true\n'
    ',Global Hair Color,global-hair-color,"Full hair color service",,,120,UNISEX,2999,2499,INR,ACTIVE,true';

String _text(TextEditingController controller) {
  return controller.text.trim();
}

double _number(TextEditingController controller) {
  return double.tryParse(_text(controller)) ?? 0;
}

String _moneyLabel(String currency, double value) {
  final text = _moneyText(value);
  return currency == 'INR' ? 'INR $text' : '$currency $text';
}

String _moneyText(double value) {
  if (value == value.roundToDouble()) {
    return value.toStringAsFixed(0);
  }
  return value.toStringAsFixed(2);
}

int _intNumber(TextEditingController controller) {
  return int.tryParse(_text(controller)) ?? 0;
}

Future<PlatformFile?> _pickAdminImage() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    allowMultiple: false,
    withData: true,
  );
  if (result == null || result.files.isEmpty) {
    return null;
  }
  return result.files.first;
}

String _contentTypeForFile(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp';
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif';
  }
  return 'application/octet-stream';
}

class _DispatchTab extends StatefulWidget {
  const _DispatchTab({
    required this.onLoadJobs,
    required this.onLoadProviders,
    required this.onDispatchJob,
  });

  final Future<List<AdminServiceJobRecord>?> Function(String query) onLoadJobs;
  final Future<List<AdminProviderRecord>?> Function() onLoadProviders;
  final Future<bool> Function(String jobId, String providerId) onDispatchJob;

  @override
  State<_DispatchTab> createState() => _DispatchTabState();
}

class _DispatchTabState extends State<_DispatchTab> {
  final _searchController = TextEditingController();
  List<AdminServiceJobRecord> _jobs = [];
  List<AdminProviderRecord> _providers = [];
  bool _loading = false;
  String _statusFilter = 'ALL';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    final jobs = await widget.onLoadJobs(_searchController.text.trim());
    final providers = await widget.onLoadProviders();
    if (!mounted) return;
    setState(() {
      _jobs = jobs ?? [];
      _providers = providers ?? [];
      _loading = false;
    });
  }

  Future<void> _dispatch(
    AdminServiceJobRecord job, [
    String providerId = '',
  ]) async {
    final success = await widget.onDispatchJob(job.id, providerId);
    if (success) {
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _statusFilter == 'ALL'
        ? _jobs
        : _jobs.where((j) => j.status == _statusFilter).toList();

    final availableProviders = _providers
        .where((p) => p.status == 'AVAILABLE' && p.isActive)
        .toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.supervised_user_circle_outlined,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Provider Roster',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const Spacer(),
                      Text(
                        '${availableProviders.length} / ${_providers.length} Available',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          color: Colors.greenAccent,
                        ),
                      ),
                    ],
                  ),
                  if (_providers.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _providers.map((p) {
                        final isAvail = p.status == 'AVAILABLE';
                        return Chip(
                          avatar: Icon(
                            isAvail ? Icons.check_circle : Icons.timelapse,
                            size: 16,
                            color: isAvail ? Colors.green : Colors.orange,
                          ),
                          label: Text('${p.fullName} (${p.status})'),
                        );
                      }).toList(),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _searchController,
                  decoration: const InputDecoration(
                    labelText: 'Search jobs (City, ID, Status)',
                    isDense: true,
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.search),
                  ),
                  onSubmitted: (_) => _load(),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(onPressed: _load, child: const Text('Search')),
            ],
          ),
          const SizedBox(height: 12),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children:
                  [
                        'ALL',
                        'REQUESTED',
                        'ASSIGNED',
                        'ACCEPTED',
                        'EN_ROUTE',
                        'ARRIVED',
                        'STARTED',
                        'COMPLETED',
                        'CANCELLED',
                      ]
                      .map(
                        (s) => Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: FilterChip(
                            label: Text(s),
                            selected: _statusFilter == s,
                            onSelected: (_) =>
                                setState(() => _statusFilter = s),
                          ),
                        ),
                      )
                      .toList(),
            ),
          ),
          const SizedBox(height: 14),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (filtered.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Center(
                  child: Text('No service jobs found matching filter.'),
                ),
              ),
            )
          else
            ...filtered.map((job) {
              return Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: Theme.of(context).colorScheme.primary
                                      .withValues(alpha: 0.15),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(
                                    color: Theme.of(context)
                                        .colorScheme
                                        .primary,
                                  ),
                                ),
                                child: Text(
                                  job.status,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Job #${job.id}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          Text(
                            job.amountLabel,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.primary,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        [
                          job.visitLine1,
                          job.visitCity,
                          job.visitState,
                        ].where((s) => s.isNotEmpty).join(', '),
                      ),
                      if (job.providerId.isNotEmpty)
                        Text(
                          'Assigned Provider ID: ${job.providerId}',
                          style: const TextStyle(
                            color: Color(0xFFAAA4B6),
                            fontSize: 12,
                          ),
                        ),
                      const Divider(height: 18),
                      if (job.status == 'REQUESTED')
                        Row(
                          children: [
                            FilledButton.icon(
                              onPressed: () => _dispatch(job),
                              icon: const Icon(Icons.send_outlined, size: 16),
                              label: const Text('Auto-Dispatch'),
                            ),
                            const SizedBox(width: 8),
                            if (_providers.isNotEmpty)
                              PopupMenuButton<String>(
                                onSelected: (pId) => _dispatch(job, pId),
                                itemBuilder: (ctx) => _providers.map((p) {
                                  return PopupMenuItem(
                                    value: p.id,
                                    child: Text(
                                      'Assign ${p.fullName} (${p.status})',
                                    ),
                                  );
                                }).toList(),
                                child: const OutlinedButton(
                                  onPressed: null,
                                  child: Text('Assign Specific Provider ▾'),
                                ),
                              ),
                          ],
                        )
                      else
                        Text(
                          'Lifecycle state: ${job.status}',
                          style: const TextStyle(
                            color: Colors.greenAccent,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
