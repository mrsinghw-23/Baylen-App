class BaylenReview {
  const BaylenReview({
    required this.id,
    required this.userId,
    required this.targetType,
    required this.targetId,
    required this.rating,
    required this.review,
    required this.status,
  });

  final String id;
  final String userId;
  final String targetType;
  final String targetId;
  final int rating;
  final String review;
  final String status;

  factory BaylenReview.fromJson(Map<String, dynamic> json) {
    return BaylenReview(
      id: json['id']?.toString() ?? '',
      userId: json['user_id']?.toString() ?? '',
      targetType: json['target_type']?.toString() ?? '',
      targetId: json['target_id']?.toString() ?? '',
      rating: (json['rating'] as num?)?.toInt() ?? 0,
      review: json['review']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
    );
  }
}
