class LaunchContent {
  const LaunchContent({required this.popups, required this.slides});

  const LaunchContent.empty() : popups = const [], slides = const [];

  final List<LaunchItem> popups;
  final List<LaunchItem> slides;

  List<LaunchItem> get items => [...popups, ...slides];

  bool get hasContent => items.isNotEmpty;

  List<String> get oneTimeIds {
    return items
        .where((item) => item.showOnce)
        .map((item) => item.storageId)
        .toList();
  }

  LaunchContent withoutSeen(Set<String> seenIds) {
    bool unseen(LaunchItem item) {
      return !item.showOnce || !seenIds.contains(item.storageId);
    }

    return LaunchContent(
      popups: popups.where(unseen).toList(),
      slides: slides.where(unseen).toList(),
    );
  }

  factory LaunchContent.fromJson(Map<String, dynamic> json) {
    return LaunchContent(
      popups: _items(json['popups']),
      slides: _items(json['slides']),
    );
  }

  static List<LaunchItem> _items(Object? value) {
    if (value is! List) return [];
    return value
        .whereType<Map<String, dynamic>>()
        .map(LaunchItem.fromJson)
        .where((item) => item.title.isNotEmpty || item.imageUrl.isNotEmpty)
        .toList();
  }
}

class LaunchItem {
  const LaunchItem({
    required this.id,
    required this.type,
    required this.title,
    required this.subtitle,
    required this.body,
    required this.imageUrl,
    required this.videoUrl,
    required this.buttonLabel,
    required this.secondaryButtonLabel,
    required this.actionType,
    required this.actionValue,
    required this.audience,
    required this.showOnce,
    required this.displayOrder,
  });

  final String id;
  final String type;
  final String title;
  final String subtitle;
  final String body;
  final String imageUrl;
  final String videoUrl;
  final String buttonLabel;
  final String secondaryButtonLabel;
  final String actionType;
  final String actionValue;
  final String audience;
  final bool showOnce;
  final int displayOrder;

  String get storageId => '$type:$id';

  bool get hasAction => actionType.trim().isNotEmpty;

  factory LaunchItem.fromJson(Map<String, dynamic> json) {
    return LaunchItem(
      id: json['id']?.toString() ?? '',
      type: json['type']?.toString() ?? 'popup',
      title: json['title']?.toString() ?? '',
      subtitle: json['subtitle']?.toString() ?? '',
      body: json['body']?.toString() ?? '',
      imageUrl: json['image_url']?.toString() ?? '',
      videoUrl: json['video_url']?.toString() ?? '',
      buttonLabel: json['button_label']?.toString() ?? '',
      secondaryButtonLabel: json['secondary_button_label']?.toString() ?? '',
      actionType: json['action_type']?.toString() ?? '',
      actionValue: json['action_value']?.toString() ?? '',
      audience: json['audience']?.toString() ?? 'ALL',
      showOnce: _bool(json['show_once']),
      displayOrder: _int(json['display_order']),
    );
  }

  static bool _bool(Object? value) {
    if (value is bool) return value;
    final text = value?.toString().toLowerCase() ?? '';
    return text == 'true' || text == '1' || text == 'yes';
  }

  static int _int(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
