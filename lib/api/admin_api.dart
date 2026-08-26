import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/admin.dart';
import 'catalyst_api.dart';

class AdminApi {
  AdminApi({required this.adminKey, http.Client? client})
    : _client = client ?? http.Client();

  final String adminKey;
  final http.Client _client;
  static const _timeout = Duration(seconds: 30);

  Map<String, String> get _headers {
    return {'Accept': 'application/json', 'X-Baylen-Admin-Key': adminKey};
  }

  Future<Map<String, dynamic>> _get(
    String path, [
    Map<String, String>? query,
  ]) async {
    var uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    if (query != null && query.isNotEmpty) {
      uri = uri.replace(queryParameters: query);
    }
    final response = await _client
        .get(uri, headers: _headers)
        .timeout(_timeout);
    return _decode(response);
  }

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body,
  ) async {
    final uri = Uri.parse('${AppConfig.apiBaseUrl}$path');
    final response = await _client
        .post(
          uri,
          headers: {..._headers, 'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(_timeout);
    return _decode(response);
  }

  Map<String, dynamic> _decode(http.Response response) {
    Object? decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw ApiException('Request failed');
    }
    if (decoded is! Map<String, dynamic>) {
      throw ApiException('Unexpected response');
    }
    if (response.statusCode >= 400 || decoded['ok'] != true) {
      throw ApiException(decoded['error']?.toString() ?? 'Request failed');
    }
    final data = decoded['data'];
    if (data is Map<String, dynamic>) {
      return data;
    }
    return {};
  }

  Future<AdminSummary> summary() async {
    return AdminSummary.fromJson(await _get('/v1/admin/summary'));
  }

  Future<List<AdminSchemaCheckRecord>> schemaCheck() async {
    final data = await _get('/v1/admin/schema/check');
    final items = data['checks'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminSchemaCheckRecord.fromJson)
        .toList();
  }

  Future<List<AdminInventoryItem>> inventory({int limit = 100}) async {
    final data = await _get('/v1/admin/inventory', {'limit': '$limit'});
    final items = data['inventory'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminInventoryItem.fromJson)
        .toList();
  }

  Future<List<AdminStockMovementRecord>> inventoryMovements({
    String productId = '',
    String inventoryId = '',
    int limit = 100,
  }) async {
    final data = await _get('/v1/admin/inventory/movements', {
      if (productId.trim().isNotEmpty) 'product_id': productId.trim(),
      if (inventoryId.trim().isNotEmpty) 'inventory_id': inventoryId.trim(),
      'limit': '$limit',
    });
    final items = data['movements'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminStockMovementRecord.fromJson)
        .toList();
  }

  Future<List<AdminAuditLogRecord>> auditLogs({
    String entityType = '',
    String entityId = '',
    int limit = 100,
  }) async {
    final data = await _get('/v1/admin/audit-logs', {
      if (entityType.trim().isNotEmpty) 'entity_type': entityType.trim(),
      if (entityId.trim().isNotEmpty) 'entity_id': entityId.trim(),
      'limit': '$limit',
    });
    final items = data['audit_logs'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminAuditLogRecord.fromJson)
        .toList();
  }

  Future<List<AdminOrderRecord>> orders({
    String query = '',
    int limit = 50,
  }) async {
    final data = await _get('/v1/admin/orders', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['orders'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminOrderRecord.fromJson)
        .toList();
  }

  Future<AdminOrderRecord> setOrderStatus({
    required String id,
    required String status,
    String note = '',
  }) async {
    final data = await _post('/v1/admin/order/status', {
      'id': id,
      'status': status,
      if (note.trim().isNotEmpty) 'note': note.trim(),
    });
    final order = data['order'];
    if (order is Map<String, dynamic>) {
      return AdminOrderRecord.fromJson(order);
    }
    throw ApiException('Updated order was not returned');
  }

  Future<List<AdminBookingRecord>> bookings({
    String query = '',
    int limit = 50,
  }) async {
    final data = await _get('/v1/admin/bookings', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['bookings'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminBookingRecord.fromJson)
        .toList();
  }

  Future<AdminBookingRecord> setBookingStatus({
    required String id,
    required String status,
  }) async {
    final data = await _post('/v1/admin/booking/status', {
      'id': id,
      'status': status,
    });
    final booking = data['booking'];
    if (booking is Map<String, dynamic>) {
      return AdminBookingRecord.fromJson(booking);
    }
    throw ApiException('Updated booking was not returned');
  }

  Future<String> upsertProduct(Map<String, dynamic> payload) async {
    final data = await _post('/v1/admin/product/upsert', payload);
    return data['product_id']?.toString() ?? '';
  }

  Future<List<AdminProductRecord>> products({
    String query = '',
    int limit = 30,
  }) async {
    final data = await _get('/v1/admin/products', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['products'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminProductRecord.fromJson)
        .toList();
  }

  Future<AdminBulkImportResult> bulkProducts(String csvText) async {
    final data = await _post('/v1/admin/products/bulk', {'csv_text': csvText});
    final result = data['import'];
    if (result is Map<String, dynamic>) {
      return AdminBulkImportResult.fromJson(result);
    }
    throw ApiException('Import result was not returned');
  }

  Future<AdminProductRecord> setProductActive(String id, bool active) async {
    final data = await _post('/v1/admin/product/status', {
      'id': id,
      'active': active,
    });
    final product = data['product'];
    if (product is Map<String, dynamic>) {
      return AdminProductRecord.fromJson(product);
    }
    throw ApiException('Updated product was not returned');
  }

  Future<void> updateInventory(Map<String, dynamic> payload) async {
    await _post('/v1/admin/inventory/update', payload);
  }

  Future<String> upsertService(Map<String, dynamic> payload) async {
    final data = await _post('/v1/admin/service/upsert', payload);
    return data['service_id']?.toString() ?? '';
  }

  Future<List<AdminServiceRecord>> services({
    String query = '',
    int limit = 30,
  }) async {
    final data = await _get('/v1/admin/services', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['services'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminServiceRecord.fromJson)
        .toList();
  }

  Future<AdminBulkImportResult> bulkServices(String csvText) async {
    final data = await _post('/v1/admin/services/bulk', {'csv_text': csvText});
    final result = data['import'];
    if (result is Map<String, dynamic>) {
      return AdminBulkImportResult.fromJson(result);
    }
    throw ApiException('Import result was not returned');
  }

  Future<AdminServiceRecord> setServiceActive(String id, bool active) async {
    final data = await _post('/v1/admin/service/status', {
      'id': id,
      'active': active,
    });
    final service = data['service'];
    if (service is Map<String, dynamic>) {
      return AdminServiceRecord.fromJson(service);
    }
    throw ApiException('Updated service was not returned');
  }

  Future<String> upsertOutlet(Map<String, dynamic> payload) async {
    final data = await _post('/v1/admin/outlet/upsert', payload);
    return data['outlet_id']?.toString() ?? '';
  }

  Future<List<AdminOutletRecord>> outlets({
    String query = '',
    int limit = 30,
  }) async {
    final data = await _get('/v1/admin/outlets', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['outlets'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminOutletRecord.fromJson)
        .toList();
  }

  Future<AdminOutletRecord> setOutletActive(String id, bool active) async {
    final data = await _post('/v1/admin/outlet/status', {
      'id': id,
      'active': active,
    });
    final outlet = data['outlet'];
    if (outlet is Map<String, dynamic>) {
      return AdminOutletRecord.fromJson(outlet);
    }
    throw ApiException('Updated outlet was not returned');
  }

  Future<AdminUploadedFile> uploadMedia({
    required String mediaType,
    required String fileName,
    required String contentType,
    required Uint8List bytes,
  }) async {
    final data = await _post('/v1/admin/files/upload', {
      'media_type': mediaType,
      'file_name': fileName,
      'content_type': contentType,
      'base64': base64Encode(bytes),
    });
    final file = data['file'];
    if (file is Map<String, dynamic>) {
      return AdminUploadedFile.fromJson(file);
    }
    throw ApiException('Uploaded file was not returned');
  }

  Future<List<AdminMediaAsset>> media({
    required String mediaType,
    int limit = 100,
  }) async {
    final data = await _get('/v1/admin/files', {
      if (mediaType.isNotEmpty) 'media_type': mediaType,
      'limit': '$limit',
    });
    final items = data['media'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminMediaAsset.fromJson)
        .toList();
  }

  Future<AdminMediaAsset> mapMedia({
    required String assetId,
    required String targetId,
  }) async {
    final data = await _post('/v1/admin/files/map', {
      'asset_id': assetId,
      'target_id': targetId,
    });
    final media = data['media'];
    if (media is Map<String, dynamic>) {
      return AdminMediaAsset.fromJson(media);
    }
    throw ApiException('Mapped media was not returned');
  }

  Future<List<AdminMediaTarget>> searchMediaTargets({
    required String mediaType,
    required String query,
    int limit = 20,
  }) async {
    final data = await _get('/v1/admin/media-targets', {
      'media_type': mediaType,
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['targets'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminMediaTarget.fromJson)
        .toList();
  }

  Future<List<AdminServiceJobRecord>> serviceJobs({
    String query = '',
    int limit = 50,
  }) async {
    final data = await _get('/v1/admin/service-jobs', {
      if (query.trim().isNotEmpty) 'q': query.trim(),
      'limit': '$limit',
    });
    final items = data['jobs'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminServiceJobRecord.fromJson)
        .toList();
  }

  Future<List<AdminProviderRecord>> providers({int limit = 50}) async {
    final data = await _get('/v1/admin/providers', {'limit': '$limit'});
    final items = data['providers'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(AdminProviderRecord.fromJson)
        .toList();
  }

  Future<Map<String, dynamic>> dispatchJob({
    required String jobId,
    String providerId = '',
  }) async {
    final data = await _post('/v1/admin/jobs/dispatch', {
      'job_id': jobId,
      if (providerId.trim().isNotEmpty) 'provider_id': providerId.trim(),
    });
    return data;
  }
}
