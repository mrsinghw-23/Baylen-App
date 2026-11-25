import 'dart:convert';

import 'package:http/http.dart' as http;

import '../api/catalyst_api.dart';

class PincodeLookupResult {
  const PincodeLookupResult({
    required this.pincode,
    required this.city,
    required this.state,
    required this.district,
    this.area = '',
  });

  final String pincode;
  final String city;
  final String state;
  final String district;
  final String area;

  factory PincodeLookupResult.fromJson(Map<String, dynamic> json) {
    return PincodeLookupResult(
      pincode: json['pincode']?.toString() ?? '',
      city: json['city']?.toString() ?? '',
      state: json['state']?.toString() ?? '',
      district: json['district']?.toString() ?? '',
      area: json['area']?.toString() ?? '',
    );
  }
}

class PincodeLookupService {
  PincodeLookupService(this._api);

  final CatalystApi _api;

  static String normalizePin(String value) {
    final digits = value.replaceAll(RegExp(r'\D'), '');
    if (digits.length <= 6) {
      return digits;
    }
    return digits.substring(0, 6);
  }

  Future<PincodeLookupResult> lookup(String rawPin) async {
    final pin = normalizePin(rawPin);
    if (pin.length != 6) {
      throw ApiException('Enter a valid 6-digit pincode');
    }

    try {
      final data = await _api.lookupPincode(pin);
      return PincodeLookupResult.fromJson(data);
    } catch (_) {
      return _lookupDirect(pin);
    }
  }

  Future<PincodeLookupResult> _lookupDirect(String pin) async {
    final uri = Uri.parse('https://api.postalpincode.in/pincode/$pin');
    final response = await http
        .get(uri, headers: const {'Accept': 'application/json'})
        .timeout(const Duration(seconds: 15));

    if (response.statusCode != 200) {
      throw ApiException('PIN lookup service is temporarily unavailable');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List || decoded.isEmpty) {
      throw ApiException('Invalid or unknown PIN code');
    }

    final result = decoded.first;
    if (result is! Map<String, dynamic>) {
      throw ApiException('Invalid or unknown PIN code');
    }

    final offices = result['PostOffice'];
    if (result['Status'] != 'Success' || offices is! List || offices.isEmpty) {
      throw ApiException('Invalid or unknown PIN code');
    }

    Map<String, dynamic>? office;
    Map<String, dynamic>? deliveryOffice;
    for (final item in offices) {
      if (item is! Map<String, dynamic>) continue;
      if (item['BranchType'] == 'Head Post Office' &&
          item['DeliveryStatus'] == 'Delivery') {
        office = item;
        break;
      }
      if (item['DeliveryStatus'] == 'Delivery' && deliveryOffice == null) {
        deliveryOffice = item;
      }
    }
    office ??= deliveryOffice;
    if (office == null) {
      final first = offices.first;
      if (first is! Map<String, dynamic>) {
        throw ApiException('Invalid or unknown PIN code');
      }
      office = first;
    }

    final district = office['District']?.toString() ?? '';
    final block = office['Block']?.toString() ?? '';
    final region = office['Region']?.toString() ?? '';
    final city = block.isNotEmpty
        ? block
        : district.isNotEmpty
            ? district
            : region.isNotEmpty
                ? region
                : office['Name']?.toString() ?? '';

    return PincodeLookupResult(
      pincode: pin,
      city: city,
      state: office['State']?.toString() ?? '',
      district: district,
      area: office['Name']?.toString() ?? '',
    );
  }
}
