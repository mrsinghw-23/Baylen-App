import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

// TODO: Move delivery options to RadioGroup when the app baseline fully adopts
// the Flutter 3.32 RadioGroup API.
// ignore_for_file: deprecated_member_use

import '../auth/auth_gate.dart';
import '../auth/auth_service.dart';
import '../models/account.dart';
import '../models/cart.dart';
import '../models/fulfillment.dart';
import '../models/order.dart';
import '../services/cart_service.dart';
import '../services/delivery_location_service.dart';
import '../utils/fulfillment_helpers.dart';
import 'addresses_screen.dart';
import 'order_tracking_screen.dart';
import 'orders_screen.dart';
import 'payment_checkout_screen.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key, required this.cart});

  final Cart cart;

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _line1 = TextEditingController();
  final _city = TextEditingController();
  final _state = TextEditingController();
  final _postal = TextEditingController();
  List<Address> _addresses = [];
  Address? _selectedAddress;
  bool _loadingAddresses = true;
  bool _placing = false;
  bool _loadingFulfillment = false;
  CartFulfillmentResult? _fulfillment;
  String? _selectedMode;
  String? _fulfillmentError;
  String _paymentMethod = 'COD';
  bool _paymentChoiceMade = false;
  bool _razorpayEnabled = false;
  Timer? _pinDebounce;
  bool _pinChecking = false;
  bool? _pinServiceable;
  String _pinMessage = '';
  String _pinCity = '';
  String _pinState = '';
  String _pinEta = '';
  Map<String, dynamic>? _validatedTotals;
  String? _idempotencyKey;

  @override
  void initState() {
    super.initState();
    AuthService.instance.user.addListener(_onAuthChanged);
    _postal.addListener(_onPostalChanged);
    _loadAddresses();
    _loadPaymentProviders();
  }

  @override
  void dispose() {
    AuthService.instance.user.removeListener(_onAuthChanged);
    _postal.removeListener(_onPostalChanged);
    _pinDebounce?.cancel();
    _name.dispose();
    _phone.dispose();
    _line1.dispose();
    _city.dispose();
    _state.dispose();
    _postal.dispose();
    super.dispose();
  }

  void _onAuthChanged() {
    if (AuthService.instance.isSignedIn) {
      _loadAddresses();
    }
  }

  Future<bool> _openLogin() {
    return AuthGate.ensureSignedIn(
      context,
      message: 'Sign in to continue checkout',
    );
  }

  double? get _lat => _selectedAddress?.latitude;
  double? get _lng => _selectedAddress?.longitude;

  Future<void> _loadAddresses() async {
    if (!AuthService.instance.isSignedIn) {
      setState(() => _loadingAddresses = false);
      return;
    }
    try {
      final addresses = await AuthService.instance.api.addresses();
      if (!mounted) return;
      Address? selected;
      for (final address in addresses) {
        if (address.isDefault) {
          selected = address;
          break;
        }
      }
      selected ??= addresses.isNotEmpty ? addresses.first : null;
      setState(() {
        _addresses = addresses;
        _selectedAddress = selected;
        _loadingAddresses = false;
      });
      DeliveryLocationService.instance.invalidate();
      _applySelectedAddressToForm();
      await _checkPincode();
      await _refreshFulfillment();
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingAddresses = false);
    }
  }

  void _applySelectedAddressToForm() {
    final address = _selectedAddress;
    if (address == null) return;
    _name.text = address.fullName;
    _phone.text = address.phone;
    _line1.text = [
      address.line1,
      address.line2,
    ].where((part) => part.isNotEmpty).join(', ');
    _city.text = address.city;
    _state.text = address.state;
    _postal.text = address.postalCode;
  }

  Future<void> _manageAddresses() async {
    await Navigator.of(context)
        .push(MaterialPageRoute<void>(builder: (_) => const AddressesScreen()));
    if (!mounted) return;
    await _loadAddresses();
  }

  Future<void> _refreshFulfillment() async {
    if (!AuthService.instance.isSignedIn) return;
    setState(() {
      _loadingFulfillment = true;
      _fulfillmentError = null;
    });
    try {
      final result = await AuthService.instance.api.checkFulfillment(
        latitude: _lat,
        longitude: _lng,
        useCart: true,
      );
      if (!mounted) return;
      final available = result.options.where((o) => o.available).toList();
      String? mode = _selectedMode;
      if (mode == null) {
        if (available.any(
          (o) => o.mode == FulfillmentOptionMode.quickCommerce,
        )) {
          mode = FulfillmentOptionMode.quickCommerce;
        } else if (available.any(
          (o) => o.mode == FulfillmentOptionMode.split,
        )) {
          mode = FulfillmentOptionMode.split;
        } else if (available.isNotEmpty) {
          mode = available.first.mode;
        }
      }
      setState(() {
        _fulfillment = result;
        _selectedMode = mode;
        _loadingFulfillment = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadingFulfillment = false;
        _fulfillmentError = checkoutErrorMessage(error);
      });
    }
  }

  void _onPostalChanged() {
    _pinDebounce?.cancel();
    _pinDebounce = Timer(const Duration(milliseconds: 450), _checkPincode);
  }

  Future<void> _loadPaymentProviders() async {
    if (!AuthService.instance.isSignedIn) return;
    try {
      final providers = await AuthService.instance.api.paymentProviders();
      final razorpay = providers['razorpay'];
      final enabled = razorpay is Map && (razorpay['enabled'] == true);
      if (!mounted) return;
      setState(() {
        _razorpayEnabled = enabled;
        if (enabled && !_paymentChoiceMade) _paymentMethod = 'UPI';
      });
    } catch (_) {}
  }

  Future<void> _checkPincode() async {
    final pin = _postal.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(pin)) {
      if (!mounted) return;
      setState(() {
        _pinChecking = false;
        _pinServiceable = pin.isEmpty ? null : false;
        _pinMessage = pin.isEmpty ? '' : 'Enter a valid 6-digit PIN code';
        _pinCity = '';
        _pinState = '';
        _pinEta = '';
      });
      return;
    }
    setState(() {
      _pinChecking = true;
      _pinMessage = '';
    });
    try {
      final data = await AuthService.instance.api.checkServiceablePincode(pin);
      if (!mounted) return;
      final serviceable = data['serviceable'] == true;
      setState(() {
        _pinChecking = false;
        _pinServiceable = serviceable;
        _pinCity = data['city']?.toString() ?? '';
        _pinState = data['state']?.toString() ?? '';
        _pinEta = data['eta_label']?.toString() ?? '';
        _pinMessage =
            data['message']?.toString() ??
            (serviceable
                ? 'Delivery available'
                : 'Sorry, delivery is currently unavailable at this location.');
      });
      if (serviceable) {
        await _validateServerTotals();
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _pinChecking = false;
        _pinServiceable = null;
        _pinMessage = 'Could not check delivery for this PIN. Try again.';
      });
    }
  }

  Future<void> _validateServerTotals() async {
    if (!AuthService.instance.isSignedIn) return;
    try {
      final data = await AuthService.instance.api.validateCheckout(
        pincode: _postal.text.trim(),
      );
      if (!mounted) return;
      setState(() => _validatedTotals = data);
      final pin = data['pincode'];
      if (pin is Map<String, dynamic>) {
        setState(() {
          _pinServiceable = pin['serviceable'] == true;
          _pinCity = pin['city']?.toString() ?? _pinCity;
          _pinState = pin['state']?.toString() ?? _pinState;
          _pinEta = pin['eta_label']?.toString() ?? _pinEta;
          _pinMessage = pin['message']?.toString() ?? _pinMessage;
        });
      }
    } catch (_) {}
  }

  String get _checkoutEstimatedDeliveryEta {
    return checkoutEstimatedDeliveryLabel(
      selectedMode: _selectedMode,
      fulfillment: _fulfillment,
      pincodeEtaFallback: _pinEta,
    );
  }

  bool get _canPlace {
    if (_placing || _pinChecking) return false;
    if (_pinServiceable != true) return false;
    if (_selectedMode == null || _selectedMode!.isEmpty) return false;
    final selected = _fulfillment?.options
        .where((o) => o.mode == _selectedMode && o.available)
        .toList();
    if (selected == null || selected.isEmpty) return false;
    if (_paymentMethod != 'COD' && !_razorpayEnabled) return false;
    return true;
  }

  String _ensureIdempotencyKey() {
    return _idempotencyKey ??=
        'chk-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 30)}';
  }

  Future<void> _placeOrder() async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await _openLogin();
      if (!signedIn) return;
      if (!mounted) return;
    }
    await _checkPincode();
    if (!mounted) return;
    if (_pinServiceable != true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _pinMessage.isNotEmpty
                ? _pinMessage
                : 'Sorry, delivery is currently unavailable at this location.',
          ),
        ),
      );
      return;
    }
    if (_selectedMode == null || _selectedMode!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'No delivery option available for this address. Add location or refresh.',
          ),
        ),
      );
      await _refreshFulfillment();
      return;
    }
    if (_paymentMethod != 'COD' && !_razorpayEnabled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Online payment is not configured. Choose Cash on Delivery or add Razorpay keys.',
          ),
        ),
      );
      return;
    }
    setState(() => _placing = true);
    try {
      final api = AuthService.instance.api;
      final key = _ensureIdempotencyKey();
      late ShopOrder order;
      if (_paymentMethod == 'COD') {
        order = await api.placeCodOrder(
          addressId: _selectedAddress?.id,
          shippingName: _name.text.trim(),
          shippingPhone: _phone.text.trim(),
          shippingLine1: _line1.text.trim(),
          shippingCity: _city.text.trim(),
          shippingState: _state.text.trim(),
          shippingPostalCode: _postal.text.trim(),
          fulfillmentMode: _selectedMode,
          latitude: _lat,
          longitude: _lng,
          idempotencyKey: key,
        );
      } else {
        final data = await api.createCheckoutPayment(
          addressId: _selectedAddress?.id,
          shippingName: _name.text.trim(),
          shippingPhone: _phone.text.trim(),
          shippingLine1: _line1.text.trim(),
          shippingCity: _city.text.trim(),
          shippingState: _state.text.trim(),
          shippingPostalCode: _postal.text.trim(),
          fulfillmentMode: _selectedMode,
          latitude: _lat,
          longitude: _lng,
          paymentMethod: _paymentMethod,
          idempotencyKey: key,
        );
        final orderMap = data['order'];
        if (orderMap is! Map<String, dynamic>) {
          throw Exception('Order was not returned');
        }
        order = ShopOrder.fromJson(orderMap);
        if (!mounted) return;
        final payment = data['payment'];
        final verified = await Navigator.of(context).push<PaymentRecord>(
          MaterialPageRoute(
            builder: (_) => PaymentCheckoutScreen(
              referenceType: 'ORDER',
              referenceId: order.id,
              payment: payment is Map<String, dynamic>
                  ? PaymentRecord.fromJson(payment)
                  : null,
            ),
          ),
        );
        if (verified?.isConfirmed != true) {
          if (mounted) {
            setState(() => _placing = false);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Payment was not completed. The order is saved. Pay it from Orders.',
                ),
              ),
            );
          }
          return;
        }
        order = await api.order(order.id);
      }
      if (!mounted) return;
      await CartService.instance.fetchCart();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => OrderPlacedScreen(order: order),
        ),
        (route) => route.isFirst,
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _placing = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(checkoutErrorMessage(error))));
      await _refreshFulfillment();
      await _checkPincode();
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = widget.cart;
    return ValueListenableBuilder(
      valueListenable: AuthService.instance.user,
      builder: (context, user, _) => Scaffold(
        appBar: AppBar(title: const Text('Checkout')),
        resizeToAvoidBottomInset: true,
        body: user == null
            ? _SignedOutCheckout(onSignIn: _openLogin)
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    'Order summary',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  ...cart.items.map(
                    (item) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(item.name),
                      subtitle: Text(
                        [
                          'Qty ${item.quantity}',
                          if (item.variantLabel.isNotEmpty) item.variantLabel,
                          if (item.lineSavings > 0)
                            'Saved ${cartMoney(item.currency, item.lineSavings.toDouble())}',
                        ].join(' · '),
                      ),
                      trailing: Text(item.lineLabel),
                    ),
                  ),
                  const Divider(),
                  Row(
                    children: [
                      const Text('Subtotal'),
                      const Spacer(),
                      Text(cart.subtotalLabel),
                    ],
                  ),
                  if (cart.discountAmount > 0) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text('Coupon ${cart.coupon?.code ?? ''}'),
                        const Spacer(),
                        Text(
                          cart.discountLabel,
                          style: const TextStyle(
                            color: Color(0xFF35D07F),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Text(cart.taxIncluded ? 'GST (included)' : 'Tax'),
                      const Spacer(),
                      Text(cart.taxLabel),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Text('Delivery'),
                      const Spacer(),
                      Text(cart.shippingValueLabel),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      const Text(
                        'Grand total',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                      const Spacer(),
                      Text(
                        cart.totalLabel,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: Theme.of(context).colorScheme.primary,
                          fontSize: 18,
                        ),
                      ),
                    ],
                  ),
                  if (_validatedTotals?['totals'] is Map) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Text('Server payable'),
                        const Spacer(),
                        Text(
                          cartMoney(
                            cart.currency,
                            ((_validatedTotals!['totals'] as Map)['grand_total']
                                        as num?)
                                    ?.toDouble() ??
                                cart.total,
                          ),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 8),
                  const Text(
                    'Choose how you will pay. Cash on Delivery stays unpaid until collection.',
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Delivery details',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  if (_loadingAddresses)
                    const LinearProgressIndicator()
                  else if (_addresses.isNotEmpty) ...[
                    DropdownButtonFormField<String>(
                      initialValue: _selectedAddress?.id,
                      decoration: const InputDecoration(
                        labelText: 'Saved address',
                      ),
                      items: _addresses
                          .map(
                            (address) => DropdownMenuItem(
                              value: address.id,
                              child: Text('${address.label} - ${address.city}'),
                            ),
                          )
                          .toList(),
                      onChanged: (id) async {
                        setState(() {
                          _selectedAddress = _addresses.firstWhere(
                            (address) => address.id == id,
                          );
                        });
                        _applySelectedAddressToForm();
                        await _checkPincode();
                        await _refreshFulfillment();
                      },
                    ),
                    if (_selectedAddress != null) ...[
                      const SizedBox(height: 8),
                      Text(_selectedAddress!.summary),
                      if (_lat == null || _lng == null)
                        const Padding(
                          padding: EdgeInsets.only(top: 6),
                          child: Text(
                            'This address has no map pin — Quick Commerce needs lat/lng. Standard Delivery may still work.',
                            style: TextStyle(
                              color: Color(0xFFAAA4B6),
                              fontSize: 12,
                            ),
                          ),
                        ),
                    ],
                    const SizedBox(height: 12),
                    Text(
                      'Or edit delivery details below',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: _manageAddresses,
                      icon: const Icon(Icons.edit_location_alt_outlined),
                      label: Text(
                        _addresses.isEmpty
                            ? 'Add saved address'
                            : 'Manage addresses',
                      ),
                    ),
                  ),
                  TextField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    keyboardType: TextInputType.name,
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  TextField(
                    controller: _phone,
                    decoration: const InputDecoration(labelText: 'Phone'),
                    keyboardType: TextInputType.phone,
                  ),
                  TextField(
                    controller: _line1,
                    textCapitalization: TextCapitalization.sentences,
                    keyboardType: TextInputType.streetAddress,
                    decoration: const InputDecoration(labelText: 'Address'),
                  ),
                  TextField(
                    controller: _city,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'City'),
                  ),
                  TextField(
                    controller: _state,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(labelText: 'State'),
                  ),
                  TextField(
                    controller: _postal,
                    decoration: const InputDecoration(labelText: 'PIN code'),
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                  ),
                  const SizedBox(height: 8),
                  _PincodeStatus(
                    checking: _pinChecking,
                    serviceable: _pinServiceable,
                    message: _pinMessage,
                    city: _pinCity,
                    state: _pinState,
                    eta: _checkoutEstimatedDeliveryEta,
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Text(
                        'Delivery option',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const Spacer(),
                      TextButton(
                        onPressed: _loadingFulfillment
                            ? null
                            : _refreshFulfillment,
                        child: const Text('Refresh'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_loadingFulfillment)
                    const LinearProgressIndicator()
                  else if (_fulfillmentError != null)
                    Text(
                      _fulfillmentError!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    )
                  else if (_fulfillment == null ||
                      _fulfillment!.options.where((o) => o.available).isEmpty)
                    const Text(
                      'No fulfillment option for this cart and location yet.',
                    )
                  else
                    ..._fulfillment!.options.map((option) {
                      final label = fulfillmentModeDisplayLabel(option.mode);
                      final eta = option.etaLabel.isNotEmpty
                          ? option.etaLabel
                          : (option.mode == FulfillmentOptionMode.quickCommerce
                                ? quickDeliveryEtaLabel()
                                : standardDeliveryEtaLabel());
                      return RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: option.mode,
                        groupValue: _selectedMode,
                        onChanged: option.available
                            ? (value) {
                                setState(() => _selectedMode = value);
                              }
                            : null,
                        title: Text(label),
                        subtitle: Text(
                          option.available
                              ? [
                                  eta,
                                  if (option.description.isNotEmpty)
                                    option.description,
                                  if (option.mode ==
                                      FulfillmentOptionMode.split)
                                    'Creates one master order with Quick + Standard shipments',
                                ].where((p) => p.isNotEmpty).join('\n')
                              : (option.mode ==
                                        FulfillmentOptionMode.quickCommerce
                                    ? 'Quick Delivery is no longer available for this item.'
                                    : 'Standard Delivery is currently unavailable.'),
                        ),
                      );
                    }),
                  if (_fulfillment?.warnings.isNotEmpty == true) ...[
                    const SizedBox(height: 8),
                    ..._fulfillment!.warnings.map(
                      (w) => Text(
                        w,
                        style: const TextStyle(
                          color: Color(0xFFAAA4B6),
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  Text(
                    'Payment method',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    value: 'COD',
                    groupValue: _paymentMethod,
                    onChanged: (value) {
                      if (value != null) {
                        setState(() {
                          _paymentChoiceMade = true;
                          _paymentMethod = value;
                        });
                      }
                    },
                    title: const Text('Cash on Delivery'),
                    subtitle: const Text(
                      'Pay when your order arrives. Payment stays pending.',
                    ),
                  ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    value: 'UPI',
                    groupValue: _paymentMethod,
                    onChanged: (value) {
                      if (value != null) {
                        setState(() {
                          _paymentChoiceMade = true;
                          _paymentMethod = value;
                        });
                      }
                    },
                    title: const Text('UPI'),
                    subtitle: Text(
                      _razorpayEnabled
                          ? 'Pay online. The server verifies the gateway signature before marking paid.'
                          : 'Razorpay is not configured yet.',
                    ),
                  ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    value: 'CARD',
                    groupValue: _paymentMethod,
                    onChanged: (value) {
                      if (value != null) {
                        setState(() {
                          _paymentChoiceMade = true;
                          _paymentMethod = value;
                        });
                      }
                    },
                    title: const Text('Card / Net Banking'),
                    subtitle: Text(
                      _razorpayEnabled
                          ? 'Pay online. The server verifies the gateway signature before marking paid.'
                          : 'Razorpay is not configured yet.',
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Displayed prices are a preview. The server recalculates the payable amount from live catalog and stock.',
                    style: TextStyle(fontSize: 12, color: Color(0xFFAAA4B6)),
                  ),
                  const SizedBox(height: 24),
                  SafeArea(
                    top: false,
                    child: FilledButton(
                      onPressed: _canPlace ? _placeOrder : null,
                      child: Text(
                        _placing
                            ? 'Placing order...'
                            : _pinServiceable == false
                            ? 'Delivery unavailable'
                            : _paymentMethod == 'COD'
                            ? 'Place COD order'
                            : 'Continue to payment',
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _SignedOutCheckout extends StatelessWidget {
  const _SignedOutCheckout({required this.onSignIn});

  final Future<bool> Function() onSignIn;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.lock_outline, size: 48),
            const SizedBox(height: 12),
            const Text('Sign in to continue checkout'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () {
                onSignIn();
              },
              child: const Text('Sign in'),
            ),
          ],
        ),
      ),
    );
  }
}

class OrderPlacedScreen extends StatelessWidget {
  const OrderPlacedScreen({super.key, required this.order});

  final ShopOrder order;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Order placed')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(Icons.check_circle_outline, size: 56),
            const SizedBox(height: 16),
            Text(
              order.orderNumber,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              '${order.totalLabel} / ${order.status} / payment ${order.paymentStatus}',
              textAlign: TextAlign.center,
            ),
            if (order.fulfillmentMode.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                order.fulfillmentLabel,
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ],
            if (order.children.isNotEmpty) ...[
              const SizedBox(height: 12),
              ...order.children.map(
                (child) => Text(
                  '${child.fulfillmentLabel}: ${child.orderNumber}',
                  textAlign: TextAlign.center,
                ),
              ),
            ],
            const SizedBox(height: 24),
            if (order.canTrackDelivery)
              FilledButton.icon(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => OrderTrackingScreen(
                        orderId: order.trackId,
                        orderNumber: order.orderNumber,
                      ),
                    ),
                  );
                },
                icon: const Icon(Icons.local_shipping_outlined),
                label: const Text('Track delivery'),
              ),
            if (order.canTrackDelivery) const SizedBox(height: 8),
            FilledButton(
              onPressed: () {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute<void>(builder: (_) => const OrdersScreen()),
                );
              },
              style: order.canTrackDelivery
                  ? FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF1A1A21),
                      foregroundColor: const Color(0xFFF8F6FA),
                    )
                  : null,
              child: const Text('View orders'),
            ),
            TextButton(
              onPressed: () =>
                  Navigator.of(context).popUntil((route) => route.isFirst),
              child: const Text('Back to home'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PincodeStatus extends StatelessWidget {
  const _PincodeStatus({
    required this.checking,
    required this.serviceable,
    required this.message,
    required this.city,
    required this.state,
    required this.eta,
  });

  final bool checking;
  final bool? serviceable;
  final String message;
  final String city;
  final String state;
  final String eta;

  @override
  Widget build(BuildContext context) {
    if (checking) {
      return const Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: 8),
          Expanded(child: Text('Checking delivery for this PIN…')),
        ],
      );
    }
    if (serviceable == true) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '✓ ${message.isEmpty ? 'Delivery available' : message}',
            style: const TextStyle(
              color: Color(0xFF35D07F),
              fontWeight: FontWeight.w700,
            ),
          ),
          if (eta.isNotEmpty) Text('✓ Estimated delivery: $eta'),
          if (city.isNotEmpty || state.isNotEmpty)
            Text(
              '✓ ${[city, state].where((part) => part.isNotEmpty).join(', ')}',
            ),
        ],
      );
    }
    if (serviceable == false) {
      return Text(
        '✕ ${message.isEmpty ? 'Sorry, delivery is currently unavailable at this location.' : message}',
        style: TextStyle(
          color: Theme.of(context).colorScheme.error,
          fontWeight: FontWeight.w600,
        ),
      );
    }
    if (message.isNotEmpty) {
      return Text('⚠ $message');
    }
    return const SizedBox.shrink();
  }
}
