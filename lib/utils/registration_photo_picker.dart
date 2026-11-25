import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import 'registration_photo_picker_mobile.dart'
    if (dart.library.js_interop) 'registration_photo_picker_web.dart';

export 'registration_photo_picker_mobile.dart'
    if (dart.library.js_interop) 'registration_photo_picker_web.dart'
    show RegistrationPhotoException, RegistrationPhotoSource;

Future<XFile?> pickRegistrationPhoto({
  required bool useFrontCamera,
  required BuildContext context,
  required String title,
}) {
  return pickRegistrationPhotoImpl(
    useFrontCamera: useFrontCamera,
    context: context,
    title: title,
  );
}

Future<XFile?> pickRegistrationGalleryPhoto({
  required BuildContext context,
  required String title,
}) {
  return pickRegistrationGalleryPhotoImpl(context: context, title: title);
}

Future<RegistrationPhotoSource?> choosePassportPhotoSource(BuildContext context) {
  return choosePassportPhotoSourceImpl(context);
}

Future<String?> ensureRegistrationCameraPermission() {
  return ensureRegistrationCameraPermissionImpl();
}

Future<void> openRegistrationCameraSettings() {
  return openRegistrationCameraSettingsImpl();
}

String contentTypeForRegistrationPhoto(XFile file) {
  final mime = file.mimeType?.toLowerCase() ?? '';
  final name = file.name.toLowerCase();
  if (mime == 'image/png' || name.endsWith('.png')) return 'image/png';
  if (mime == 'image/webp' || name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}
