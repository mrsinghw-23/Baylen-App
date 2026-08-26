import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

class GuestSession {
  GuestSession._();

  static final GuestSession instance = GuestSession._();
  static const _key = 'baylen_guest_session_id';

  String? _id;

  String? get currentId => _id;

  Future<String> id() async {
    if (_id != null && _id!.isNotEmpty) {
      return _id!;
    }
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString(_key);
    if (stored != null && stored.isNotEmpty) {
      _id = stored;
      return stored;
    }
    final generated = _generate();
    await prefs.setString(_key, generated);
    _id = generated;
    return generated;
  }

  String _generate() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return 'guest_$hex';
  }
}
