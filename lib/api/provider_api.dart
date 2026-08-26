import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../models/provider.dart';
import 'catalyst_api.dart';

class ProviderApi {
  ProviderApi({required this.providerKey, http.Client? client})
    : _client = client ?? http.Client();

  final String providerKey;
  final http.Client _client;
  static const _timeout = Duration(seconds: 25);

  Map<String, String> get _headers {
    return {'Accept': 'application/json', 'X-Baylen-Provider-Key': providerKey};
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

  Future<List<ProviderJob>> assignedJobs(String providerId) async {
    final data = await _get('/v1/provider/jobs', {
      'provider_id': providerId.trim(),
    });
    final items = data['jobs'];
    if (items is! List) {
      return [];
    }
    return items
        .whereType<Map<String, dynamic>>()
        .map(ProviderJob.fromJson)
        .toList();
  }

  Future<ProviderDispatchOffer> dispatchJob(String jobId) async {
    final data = await _post('/v1/jobs/dispatch', {'job_id': jobId.trim()});
    return ProviderDispatchOffer.fromJson(data);
  }

  Future<Map<String, dynamic>> acceptJob({
    required String dispatchId,
    required String providerId,
  }) async {
    return _post('/v1/jobs/accept', {
      'dispatch_id': dispatchId.trim(),
      'provider_id': providerId.trim(),
    });
  }

  Future<void> updateJobStatus({
    required String jobId,
    required String providerId,
    required String status,
    String? note,
  }) async {
    await _post('/v1/jobs/status', {
      'job_id': jobId.trim(),
      'provider_id': providerId.trim(),
      'status': status.trim().toUpperCase(),
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    });
  }

  Future<bool> sendLocationPing({
    required String jobId,
    required String providerId,
    required double latitude,
    required double longitude,
    double? heading,
    double? speed,
    String? status,
  }) async {
    final data = await _post('/v1/jobs/location', {
      'job_id': jobId.trim(),
      'provider_id': providerId.trim(),
      'latitude': latitude,
      'longitude': longitude,
      'heading': ?heading,
      'speed': ?speed,
      if (status != null && status.isNotEmpty) 'status': status,
    });

    return data['recorded'] == true;
  }

  Future<JobProofRecord> submitJobProof({
    required String jobId,
    required String providerId,
    required String fileUrl,
    String proofType = 'PHOTO',
    String? notes,
  }) async {
    final data = await _post('/v1/jobs/proof', {
      'job_id': jobId.trim(),
      'provider_id': providerId.trim(),
      'file_url': fileUrl.trim(),
      'proof_type': proofType.trim(),
      if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
    });
    return JobProofRecord.fromJson(data);
  }
}
