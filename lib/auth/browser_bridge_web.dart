import 'package:web/web.dart' as web;

const _key = 'baylen_session';
const _dpKey = 'baylen_dp_session';
const _dpMetaKey = 'baylen_dp_session_meta';
const _activeRoleKey = 'baylen_active_role';

Future<String?> readSession() async => web.window.localStorage.getItem(_key);

Future<void> writeSession(String? token) async {
  if (token == null || token.isEmpty) {
    web.window.localStorage.removeItem(_key);
  } else {
    web.window.localStorage.setItem(_key, token);
  }
}

String _cacheKey(String userId) => 'baylen_account_cache_$userId';

Future<void> writeAccountCache(String userId, String json) async {
  if (userId.isEmpty) return;
  web.window.localStorage.setItem(_cacheKey(userId), json);
}

Future<String?> readAccountCache(String userId) async {
  if (userId.isEmpty) return null;
  return web.window.localStorage.getItem(_cacheKey(userId));
}

Future<void> clearAccountCache(String userId) async {
  if (userId.isEmpty) return;
  web.window.localStorage.removeItem(_cacheKey(userId));
}

Future<String?> readDpSession() async =>
    web.window.localStorage.getItem(_dpKey);

Future<void> writeDpSession(String? token, {String? metaJson}) async {
  if (token == null || token.isEmpty) {
    web.window.localStorage.removeItem(_dpKey);
    web.window.localStorage.removeItem(_dpMetaKey);
  } else {
    web.window.localStorage.setItem(_dpKey, token);
    if (metaJson != null) {
      web.window.localStorage.setItem(_dpMetaKey, metaJson);
    }
  }
}

Future<String?> readDpSessionMeta() async =>
    web.window.localStorage.getItem(_dpMetaKey);

Future<String?> readActiveRole() async =>
    web.window.localStorage.getItem(_activeRoleKey);

Future<void> writeActiveRole(String? role) async {
  if (role == null || role.isEmpty) {
    web.window.localStorage.removeItem(_activeRoleKey);
  } else {
    web.window.localStorage.setItem(_activeRoleKey, role);
  }
}

void openExternalUrl(String url) {
  web.window.location.href = url;
}

String currentOrigin() => web.window.location.origin;
