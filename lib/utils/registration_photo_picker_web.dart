import 'dart:async';
import 'dart:js_interop';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:web/web.dart' as web;

import '../screens/auth/registration_photo_preview_screen.dart';

enum RegistrationPhotoSource { camera, gallery }

Future<String?> ensureRegistrationCameraPermissionImpl() async => null;

Future<void> openRegistrationCameraSettingsImpl() async {}

Future<XFile?> pickRegistrationPhotoImpl({
  required bool useFrontCamera,
  required BuildContext context,
  required String title,
}) async {
  final captured = await _pickWithBrowserCapture(useFrontCamera);
  if (captured == null || !context.mounted) return null;
  final accepted = await RegistrationPhotoPreviewScreen.confirm(
    context,
    photo: captured,
    title: title,
  );
  return accepted ? captured : null;
}

Future<XFile?> pickRegistrationGalleryPhotoImpl({
  required BuildContext context,
  required String title,
}) async {
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

Future<XFile?> _pickWithBrowserCapture(bool useFrontCamera) async {
  final completer = Completer<XFile?>();
  final input = web.HTMLInputElement()
    ..type = 'file'
    ..accept = 'image/*';
  input.setAttribute('capture', useFrontCamera ? 'user' : 'environment');

  void finish(XFile? file) {
    if (!completer.isCompleted) completer.complete(file);
  }

  input.onchange = ((web.Event event) {
    final files = input.files;
    if (files == null || files.length == 0) {
      finish(null);
      return;
    }
    final file = files.item(0);
    if (file == null) {
      finish(null);
      return;
    }
    final reader = web.FileReader();
    reader.onload = ((web.Event e) {
      final result = reader.result;
      if (result == null) {
        finish(null);
        return;
      }
      final bytes = (result as JSArrayBuffer).toDart.asUint8List();
      finish(
        XFile.fromData(
          bytes,
          name: file.name.isNotEmpty ? file.name : 'photo.jpg',
          mimeType: file.type.isNotEmpty ? file.type : 'image/jpeg',
        ),
      );
    }).toJS;
    reader.onerror = ((web.Event e) => finish(null)).toJS;
    reader.readAsArrayBuffer(file);
  }).toJS;

  input.oncancel = ((web.Event event) => finish(null)).toJS;
  input.click();
  return completer.future;
}

class RegistrationPhotoException implements Exception {
  RegistrationPhotoException(this.message);
  final String message;

  @override
  String toString() => message;
}
