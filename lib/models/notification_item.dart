class BaylenNotification {
  const BaylenNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.referenceType,
    required this.referenceId,
    required this.deliveryStatus,
    required this.createdAt,
    required this.readAt,
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final String referenceType;
  final String referenceId;
  final String deliveryStatus;
  final String createdAt;
  final String readAt;

  bool get isUnread => readAt.isEmpty;

  factory BaylenNotification.fromJson(Map<String, dynamic> json) {
    return BaylenNotification(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      body: json['body']?.toString() ?? '',
      referenceType: json['reference_type']?.toString() ?? '',
      referenceId: json['reference_id']?.toString() ?? '',
      deliveryStatus: json['delivery_status']?.toString() ?? '',
      createdAt: json['created_at']?.toString() ?? '',
      readAt: json['read_at']?.toString() ?? '',
    );
  }
}
