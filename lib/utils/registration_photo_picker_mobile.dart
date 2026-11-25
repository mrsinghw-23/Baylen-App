import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';

import '../screens/auth/registration_camera_screen.dart';
import '../screens/auth/registration_photo_preview_screen.dart';

enum RegistrationPhotoSource { camera, gallery }

Future<String?> ensureRegistrationCameraPermissionImpl() async {
  if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) {
    return null;
  }
  var status = await Permission.camera.status;
  if (status.isGranted) return null;
  status = await Permission.camera.request();
  if (status.isGranted) return null;
  if (status.isPermanentlyDenied) {
    return 'Camera permission denied. Enable Camera for Baylen in Settings.';
  }
  return 'Camera permission is required to take your photo.';
}

Future<String?> ensureRegistrationGalleryPermissionImpl() async {
  if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) {
    return null;
  }
  if (Platform.isIOS) {
    var status = await Permission.photos.status;
    if (status.isGranted || status.isLimited) return null;
    status = await Permission.photos.request();
    if (status.isGranted || status.isLimited) return null;
    if (status.isPermanentlyDenied) {
      return 'Photo library access denied. Enable Photos for Baylen in Settings.';
    }
    return 'Photo library access is required to upload a passport photo.';
  }
  if (await Permission.photos.isGranted ||
      await Permission.photos.isLimited ||
      await Permission.storage.isGranted) {
    return null;
  }
  final photos = await Permission.photos.request();
  if (photos.isGranted || photos.isLimited) return null;
  final storage = await Permission.storage.request();
  if (storage.isGranted) return null;
  if (photos.isPermanentlyDenied || storage.isPermanentlyDenied) {
    return 'Gallery access denied. Enable Photos for Baylen in Settings.';
  }
  return null;
}

Future<void> openRegistrationCameraSettingsImpl() async {
  if (kIsWeb || !(Platform.isAndroid || Platform.isIOS)) return;
  await openAppSettings();
}

Future<XFile?> pickRegistrationPhotoImpl({
  required bool useFrontCamera,
  required BuildContext context,
  required String title,
}) async {
  final permissionError = await ensureRegistrationCameraPermissionImpl();
  if (permissionError != null) {
    throw RegistrationPhotoException(permissionError);
  }
  if (!context.mounted) return null;
  return Navigator.of(context).push<XFile>(
    MaterialPageRoute<XFile>(
      builder: (_) => RegistrationCameraScreen(
        useFrontCamera: useFrontCamera,
        title: title,
      ),
    ),
  );
}

Future<XFile?> pickRegistrationGalleryPhotoImpl({
  required BuildContext context,
  required String title,
}) async {
  final permissionError = await ensureRegistrationGalleryPermissionImpl();
  if (permissionError != null) {
    throw RegistrationPhotoException(permissionError);
  }
  final picked = await ImagePicker().pickImage(
    source: ImageSource.gallery,
    imageQuality: 85,
    maxWidth: 1920,
    maxHeight: 1920,
  );
  if (picked == null || !context.mounted) return null;
  final accepted = await RegistrationPhotoPreviewScreen.confirm(
    context,
    photo: picked,
    title: title,
    confirmLabel: 'Confirm',
  );
  return accepted ? picked : null;
}

Future<RegistrationPhotoSource?> choosePassportPhotoSourceImpl(
  BuildContext context,
) {
  return showModalBottomSheet<RegistrationPhotoSource>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: const Text('Open Camera'),
              onTap: () => Navigator.of(sheetContext).pop(
                RegistrationPhotoSource.camera,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Upload from Gallery'),
              onTap: () => Navigator.of(sheetContext).pop(
                RegistrationPhotoSource.gallery,
              ),
            ),
            ListTile(
              leading: const Icon(Icons.close),
              title: const Text('Cancel'),
              onTap: () => Navigator.of(sheetContext).pop(),
            ),
          ],
        ),
      );
    },
  );
}

class RegistrationPhotoException implements Exception {
  RegistrationPhotoException(this.message);
  final String message;

  @override
  String toString() => message;
}
