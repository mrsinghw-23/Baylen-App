import 'dart:typed_data';

import 'package:flutter/material.dart';

/// Renders a profile photo from direct URL, cached bytes, or an authenticated fetch.
class ProfilePhotoAvatar extends StatelessWidget {
  const ProfilePhotoAvatar({
    super.key,
    required this.name,
    this.photoUrl = '',
    this.photoBytes,
    this.radius = 28,
    this.backgroundColor,
  });

  final String name;
  final String photoUrl;
  final Uint8List? photoBytes;
  final double radius;
  final Color? backgroundColor;

  @override
  Widget build(BuildContext context) {
    final initial = name.trim().isNotEmpty ? name.trim()[0].toUpperCase() : '?';
    ImageProvider? image;
    if (photoBytes != null && photoBytes!.isNotEmpty) {
      image = MemoryImage(photoBytes!);
    } else if (photoUrl.startsWith('http')) {
      image = NetworkImage(photoUrl);
    }
    return CircleAvatar(
      radius: radius,
      backgroundColor: backgroundColor ?? Colors.grey.shade800,
      backgroundImage: image,
      child: image == null
          ? Text(
              initial,
              style: TextStyle(
                fontSize: radius * 0.75,
                fontWeight: FontWeight.w800,
                color: Colors.white,
              ),
            )
          : null,
    );
  }
}

/// Loads a profile photo from an authenticated API path, then renders [ProfilePhotoAvatar].
class AuthenticatedProfilePhotoAvatar extends StatefulWidget {
  const AuthenticatedProfilePhotoAvatar({
    super.key,
    required this.name,
    required this.fetchPhoto,
    this.photoUrl = '',
    this.radius = 28,
    this.backgroundColor,
  });

  final String name;
  final String photoUrl;
  final Future<Uint8List?> Function() fetchPhoto;
  final double radius;
  final Color? backgroundColor;

  @override
  State<AuthenticatedProfilePhotoAvatar> createState() =>
      _AuthenticatedProfilePhotoAvatarState();
}

class _AuthenticatedProfilePhotoAvatarState extends State<AuthenticatedProfilePhotoAvatar> {
  Uint8List? _bytes;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant AuthenticatedProfilePhotoAvatar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.photoUrl != widget.photoUrl) {
      _load();
    }
  }

  Future<void> _load() async {
    if (widget.photoUrl.startsWith('http')) {
      setState(() => _bytes = null);
      return;
    }
    setState(() => _loading = true);
    try {
      final bytes = await widget.fetchPhoto();
      if (!mounted) return;
      setState(() {
        _bytes = bytes;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _bytes = null;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _bytes == null && !widget.photoUrl.startsWith('http')) {
      return CircleAvatar(
        radius: widget.radius,
        backgroundColor: widget.backgroundColor ?? Colors.grey.shade800,
        child: SizedBox(
          width: widget.radius,
          height: widget.radius,
          child: const CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    return ProfilePhotoAvatar(
      name: widget.name,
      photoUrl: widget.photoUrl,
      photoBytes: _bytes,
      radius: widget.radius,
      backgroundColor: widget.backgroundColor,
    );
  }
}
