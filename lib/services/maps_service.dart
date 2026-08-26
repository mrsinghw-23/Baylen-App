import 'package:url_launcher/url_launcher.dart';

class MapsService {
  const MapsService._();

  static Future<bool> openOutletLocation(String mapsUrl) async {
    final trimmedUrl = mapsUrl.trim();
    if (trimmedUrl.isEmpty) {
      return false;
    }

    final uri = Uri.tryParse(trimmedUrl);
    if (uri == null) {
      return false;
    }

    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}
