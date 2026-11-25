import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../screens/auth/registration_camera_screen.dart';
import 'passport_photo_crop.dart';
import 'registration_photo_picker.dart';

enum KycDocumentSource { camera, gallery, file }

class KycPickedDocument {
  const KycPickedDocument({
    required this.bytes,
    required this.fileName,
    required this.contentType,
  });

  final List<int> bytes;
  final String fileName;
  final String contentType;
}

const int kMaxKycUploadBytes = 900 * 1024;

Future<KycDocumentSource?> chooseKycDocumentSource(BuildContext context) {
  return showModalBottomSheet<KycDocumentSource>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: const Text('Take photo'),
              onTap: () => Navigator.of(sheetContext).pop(KycDocumentSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Add from gallery'),
              onTap: () => Navigator.of(sheetContext).pop(KycDocumentSource.gallery),
            ),
            ListTile(
              leading: const Icon(Icons.attach_file),
              title: const Text('Add file (JPG / PNG / PDF)'),
              onTap: () => Navigator.of(sheetContext).pop(KycDocumentSource.file),
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

Future<KycPickedDocument?> pickKycSelfie({required BuildContext context}) async {
  final permissionError = await ensureRegistrationCameraPermission();
  if (permissionError != null) {
    throw RegistrationPhotoException(permissionError);
  }
  if (!context.mounted) return null;

  final photo = await Navigator.of(context).push<XFile>(
    MaterialPageRoute<XFile>(
      builder: (_) => const RegistrationCameraScreen(
        useFrontCamera: true,
        title: 'Selfie (passport size)',
      ),
    ),
  );
  if (photo == null) return null;

  final raw = await photo.readAsBytes();
  if (raw.isEmpty) {
    throw RegistrationPhotoException('Could not read the selfie. Please try again.');
  }

  final cropped = await cropToPassportPhoto(raw);
  if (cropped.isEmpty) {
    throw RegistrationPhotoException('Could not prepare passport-size selfie. Please retake.');
  }
  if (cropped.length > kMaxKycUploadBytes) {
    throw RegistrationPhotoException(
      'Selfie is too large after crop. Move closer and retake.',
    );
  }

  final name = photo.name.isNotEmpty
      ? photo.name.replaceAll(RegExp(r'\.[^.]+$'), '.jpg')
      : 'kyc_selfie_${DateTime.now().millisecondsSinceEpoch}.jpg';
  return KycPickedDocument(
    bytes: cropped,
    fileName: name,
    contentType: 'image/jpeg',
  );
}

Future<KycPickedDocument?> pickKycDocument({
  required BuildContext context,
  required String title,
  bool useFrontCamera = false,
  KycDocumentSource? forcedSource,
}) async {
  final source = forcedSource ?? await chooseKycDocumentSource(context);
  if (source == null || !context.mounted) return null;

  if (source == KycDocumentSource.file) {
    return _pickKycFile();
  }

  if (source == KycDocumentSource.gallery) {
    return _pickCompressedImage(ImageSource.gallery);
  }

  final permissionError = await ensureRegistrationCameraPermission();
  if (permissionError != null) {
    throw RegistrationPhotoException(permissionError);
  }
  if (!context.mounted) return null;
  return _pickCompressedImage(
    ImageSource.camera,
    preferredCameraDevice:
        useFrontCamera ? CameraDevice.front : CameraDevice.rear,
  );
}

Future<KycPickedDocument?> _pickCompressedImage(
  ImageSource source, {
  CameraDevice preferredCameraDevice = CameraDevice.rear,
}) async {
  final image = await ImagePicker().pickImage(
    source: source,
    imageQuality: 55,
    maxWidth: 1280,
    maxHeight: 1280,
    preferredCameraDevice: preferredCameraDevice,
  );
  if (image == null) return null;
  final bytes = await image.readAsBytes();
  if (bytes.isEmpty) {
    throw RegistrationPhotoException('Could not read the photo. Please try again.');
  }
  if (bytes.length > kMaxKycUploadBytes) {
    throw RegistrationPhotoException(
      'This photo is too large. Move closer, retake, or pick a smaller file.',
    );
  }
  final name = image.name.isNotEmpty
      ? image.name
      : 'kyc_${DateTime.now().millisecondsSinceEpoch}.jpg';
  return KycPickedDocument(
    bytes: bytes,
    fileName: name,
    contentType: contentTypeForRegistrationPhoto(image),
  );
}

Future<KycPickedDocument?> _pickKycFile() async {
  final result = await FilePicker.platform.pickFiles(
    type: FileType.custom,
    allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'pdf'],
    allowMultiple: false,
    withData: true,
  );
  if (result == null || result.files.isEmpty) return null;
  final file = result.files.first;
  final bytes = file.bytes;
  if (bytes == null || bytes.isEmpty) {
    throw RegistrationPhotoException('Could not read that file. Please try again.');
  }
  if (bytes.length > kMaxKycUploadBytes) {
    throw RegistrationPhotoException(
      'This file is too large. Use a JPG or PDF smaller than 1 MB.',
    );
  }
  final name = file.name.isNotEmpty
      ? file.name
      : 'kyc_${DateTime.now().millisecondsSinceEpoch}.jpg';
  return KycPickedDocument(
    bytes: bytes,
    fileName: name,
    contentType: _contentTypeForKycFile(name),
  );
}

String _contentTypeForKycFile(String fileName) {
  final lower = fileName.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}
