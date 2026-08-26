import 'package:flutter/foundation.dart';

import '../api/catalyst_api.dart';
import '../models/notification_item.dart';

class NotificationService {
  static final NotificationService instance = NotificationService._internal();
  NotificationService._internal();

  final ValueNotifier<int> unreadCount = ValueNotifier(0);
  final ValueNotifier<bool> isLoading = ValueNotifier(false);

  final _api = CatalystApi();

  Future<void> refreshUnreadCount() async {
    try {
      final count = await _api.notificationUnreadCount();
      unreadCount.value = count;
    } catch (_) {
      // Fail silently for background refreshes
    }
  }

  Future<List<BaylenNotification>> getNotifications() async {
    isLoading.value = true;
    try {
      final items = await _api.notifications();
      // Side-effect: update count from actual loaded data if needed
      unreadCount.value = items.where((n) => n.isUnread).length;
      return items;
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> markAsRead(String id) async {
    await _api.markNotificationRead(id);
    if (unreadCount.value > 0) {
      unreadCount.value -= 1;
    }
  }

  Future<void> markAllAsRead() async {
    await _api.markAllNotificationsRead();
    unreadCount.value = 0;
  }
}
