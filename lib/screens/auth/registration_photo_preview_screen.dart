import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

class RegistrationPhotoPreviewScreen extends StatelessWidget {
  const RegistrationPhotoPreviewScreen({
    super.key,
    required this.bytes,
    required this.title,
    this.confirmLabel = 'Use Photo',
  });

  final Uint8List bytes;
  final String title;
  final String confirmLabel;

  static Future<bool> confirm(
    BuildContext context, {
    required XFile photo,
    required String title,
    String confirmLabel = 'Use Photo',
  }) async {
    final bytes = await photo.readAsBytes();
    if (!context.mounted || bytes.isEmpty) return false;
    final accepted = await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => RegistrationPhotoPreviewScreen(
          bytes: bytes,
          title: title,
          confirmLabel: confirmLabel,
        ),
      ),
    );
    return accepted == true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(title: Text(title)),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: Image.memory(bytes, fit: BoxFit.contain),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(false),
                      child: const Text('Retake'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.of(context).pop(true),
                      child: Text(confirmLabel),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
