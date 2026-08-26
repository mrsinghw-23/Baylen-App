import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../auth/auth_user.dart';
import '../models/order.dart';
import 'login_screen.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<ShopOrder> _orders = [];
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
        _error = null;
        _orders = [];
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final orders = await AuthService.instance.api.orders();
      if (!mounted) return;
      setState(() {
        _orders = orders;
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

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AuthUser?>(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) {
        return Scaffold(
          appBar: AppBar(title: const Text('Orders')),
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
              ? Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_error!),
                      TextButton(onPressed: _load, child: const Text('Retry')),
                    ],
                  ),
                )
              : _orders.isEmpty
              ? const Center(child: Text('No orders yet.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: _orders.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final order = _orders[index];
                      return Card(
                        child: ListTile(
                          title: Text(order.orderNumber),
                          subtitle: Text(
                            '${order.status} - payment ${order.paymentStatus}',
                          ),
                          trailing: Text(order.totalLabel),
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) =>
                                    OrderDetailScreen(orderId: order.id),
                              ),
                            );
                          },
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

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  ShopOrder? _order;
  List<OrderTimelineEntry> _timeline = [];
  String? _error;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final order = await AuthService.instance.api.order(widget.orderId);
      final timeline = await AuthService.instance.api.orderTimeline(
        widget.orderId,
      );
      if (!mounted) return;
      setState(() {
        _order = order;
        _timeline = timeline;
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

  Future<String?> _askReason(String title) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(labelText: 'Reason'),
            maxLines: 3,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.of(context).pop(controller.text.trim()),
              child: const Text('Submit'),
            ),
          ],
        );
      },
    );
    controller.dispose();
    return reason;
  }

  Future<void> _cancelOrder(ShopOrder order) async {
    final reason = await _askReason('Cancel order');
    if (reason == null || reason.isEmpty) {
      return;
    }
    setState(() => _busy = true);
    try {
      final updated = await AuthService.instance.api.cancelOrder(
        orderId: order.id,
        reason: reason,
      );
      final timeline = await AuthService.instance.api.orderTimeline(order.id);
      if (!mounted) return;
      setState(() {
        _order = updated;
        _timeline = timeline;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  Future<void> _requestReturn(ShopOrder order) async {
    final reason = await _askReason('Request return');
    if (reason == null || reason.isEmpty) {
      return;
    }
    setState(() => _busy = true);
    try {
      final updated = await AuthService.instance.api.requestOrderReturn(
        orderId: order.id,
        reason: reason,
      );
      final timeline = await AuthService.instance.api.orderTimeline(order.id);
      if (!mounted) return;
      setState(() {
        _order = updated;
        _timeline = timeline;
        _busy = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    return Scaffold(
      appBar: AppBar(title: Text(order?.orderNumber ?? 'Order')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(child: Text(_error!))
          : order == null
          ? const Center(child: Text('Order not found'))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text('${order.status} - payment ${order.paymentStatus}'),
                  const SizedBox(height: 8),
                  Text(
                    order.totalLabel,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 12),
                  if (_busy) const LinearProgressIndicator(),
                  if (order.canCancel)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _cancelOrder(order),
                      icon: const Icon(Icons.cancel_outlined),
                      label: const Text('Cancel order'),
                    ),
                  if (order.canReturn)
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _requestReturn(order),
                      icon: const Icon(Icons.assignment_return_outlined),
                      label: const Text('Request return'),
                    ),
                  const Divider(),
                  ...order.items.map(
                    (item) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(item.name),
                      subtitle: Text('Qty ${item.quantity}'),
                      trailing: Text(
                        'INR ${item.lineTotal.toStringAsFixed(0)}',
                      ),
                    ),
                  ),
                  if (order.shippingLine1.isNotEmpty) ...[
                    const Divider(),
                    Text(order.shippingName),
                    Text(order.shippingLine1),
                    Text(order.shippingCity),
                  ],
                  if (_timeline.isNotEmpty) ...[
                    const Divider(),
                    Text(
                      'Tracking',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    ..._timeline.map(
                      (entry) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.radio_button_checked),
                        title: Text(entry.status),
                        subtitle: Text(
                          [
                            entry.note,
                            if (entry.happenedAt.isNotEmpty) entry.happenedAt,
                          ].where((part) => part.isNotEmpty).join('\n'),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}
