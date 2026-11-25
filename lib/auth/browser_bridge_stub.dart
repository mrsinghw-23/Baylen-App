import 'package:shared_preferences/shared_preferences.dart';

const _key = 'baylen_session';
const _dpKey = 'baylen_dp_session';
const _dpMetaKey = 'baylen_dp_session_meta';
const _activeRoleKey = 'baylen_active_role';

Future<String?> readSession() async {
  final prefs = await SharedPreferences.getInstance();
  _memory ??= prefs.getString(_key);
  return _memory;
}

Future<void> writeSession(String? token) async {
  final prefs = await SharedPreferences.getInstance();
  _memory = token;
  if (token == null || token.isEmpty) {
    await prefs.remove(_key);
  } else {
    await prefs.setString(_key, token);
  }
}

String _cacheKey(String userId) => 'baylen_account_cache_$userId';

Future<void> writeAccountCache(String userId, String json) async {
  if (userId.isEmpty) return;
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_cacheKey(userId), json);
}

Future<String?> readAccountCache(String userId) async {
  if (userId.isEmpty) return null;
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_cacheKey(userId));
}

Future<void> clearAccountCache(String userId) async {
  if (userId.isEmpty) return;
  final prefs = await SharedPreferences.getInstance();
  await prefs.remove(_cacheKey(userId));
}

String? _memory;

Future<String?> readDpSession() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_dpKey);
}

Future<void> writeDpSession(String? token, {String? metaJson}) async {
  final prefs = await SharedPreferences.getInstance();
  if (token == null || token.isEmpty) {
    await prefs.remove(_dpKey);
    await prefs.remove(_dpMetaKey);
  } else {
    await prefs.setString(_dpKey, token);
    if (metaJson != null) {
      await prefs.setString(_dpMetaKey, metaJson);
    }
  }
}

Future<String?> readDpSessionMeta() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_dpMetaKey);
}

Future<String?> readActiveRole() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getString(_activeRoleKey);
}

Future<void> writeActiveRole(String? role) async {
  final prefs = await SharedPreferences.getInstance();
  if (role == null || role.isEmpty) {
    await prefs.remove(_activeRoleKey);
  } else {
    await prefs.setString(_activeRoleKey, role);
  }
}

void openExternalUrl(String url) {
  throw UnsupportedError('Open this URL in a browser: $url');
}

String currentOrigin() => 'http://localhost';
