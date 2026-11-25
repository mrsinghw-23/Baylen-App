import '../models/at_home_beauty.dart';
import '../models/salon.dart';

/// UI-only beauty category chips for Home Service — not a separate catalog.
/// Maps to `SalonService.serviceType` filters on `/v1/salon/services?is_at_home=true`.
const homeServiceCategories = <BeautyCategory>[
  BeautyCategory(slug: 'hair', name: 'Hair', iconKey: 'hair'),
  BeautyCategory(slug: 'beauty', name: 'Beauty', iconKey: 'beauty'),
  BeautyCategory(slug: 'makeup', name: 'Makeup', iconKey: 'makeup'),
  BeautyCategory(slug: 'nails', name: 'Nails', iconKey: 'nail'),
  BeautyCategory(slug: 'facial-skin', name: 'Facial & Skin', iconKey: 'skin'),
  BeautyCategory(slug: 'hair-care', name: 'Hair Care', iconKey: 'hair'),
];

String? homeServiceCategoryToServiceType(String slug) {
  switch (slug) {
    case 'hair':
      return 'Hair';
    case 'beauty':
      return 'Beauty';
    case 'makeup':
      return 'Makeup';
    case 'nails':
      return 'Nails';
    case 'facial-skin':
      return 'Skin';
    case 'hair-care':
      return 'Hair';
    default:
      return null;
  }
}

bool salonServiceMatchesCategory(SalonService service, BeautyCategory? category) {
  if (category == null || category.slug.isEmpty) {
    return true;
  }
  final type = service.serviceType.toLowerCase();
  final slug = category.slug.toLowerCase();
  if (slug == 'hair' || slug == 'hair-care') {
    return type.contains('hair');
  }
  if (slug == 'facial-skin') {
    return type.contains('skin') || type.contains('facial');
  }
  if (slug == 'nails') {
    return type.contains('nail');
  }
  if (slug == 'makeup') {
    return type.contains('makeup') || type.contains('bridal');
  }
  if (slug == 'beauty') {
    return type.contains('beauty') || type.contains('groom');
  }
  return type.contains(slug.replaceAll('-', ' '));
}
