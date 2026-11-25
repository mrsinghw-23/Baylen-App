import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../profile_photo_avatar.dart';

/// Shared Professional Partner design tokens (from app theme / mockup).
const kProPink = Color(0xFFFF1B78);
const kProCanvas = Color(0xFF0D0D0F);
const kProCard = Color(0xFF1A1A21);
const kProSurface = Color(0xFF121216);
const kProOutline = Color(0xFF2B2B34);
const kProTextSecondary = Color(0xFFAAA4B6);

class ProPartnerAvatar extends StatelessWidget {
  const ProPartnerAvatar({
    super.key,
    required this.name,
    this.photoUrl = '',
    this.photoBytes,
    this.radius = 28,
  });

  final String name;
  final String photoUrl;
  final Uint8List? photoBytes;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return ProfilePhotoAvatar(
      name: name,
      photoUrl: photoUrl,
      photoBytes: photoBytes,
      radius: radius,
      backgroundColor: kProSurface,
    );
  }
}

class ProCard extends StatelessWidget {
  const ProCard({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final dense = MediaQuery.sizeOf(context).width < 390;
    final card = Material(
      color: kProCard,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: BorderSide(color: kProPink.withValues(alpha: 0.18)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: EdgeInsets.all(dense ? 12 : 16),
        child: child,
      ),
    );
    if (onTap == null) return card;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: card,
    );
  }
}

class ProPrimaryButton extends StatelessWidget {
  const ProPrimaryButton({
    super.key,
    required this.label,
    this.onPressed,
    this.loading = false,
    this.fullWidth = true,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final bool fullWidth;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    final button = FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: enabled ? kProPink : kProOutline,
        minimumSize: Size(fullWidth ? double.infinity : 0, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      onPressed: enabled ? onPressed : null,
      child: loading
          ? const SizedBox(
              width: 22,
              height: 22,
              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
            )
          : Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
    );
    if (!fullWidth) return button;
    return SizedBox(width: double.infinity, height: 48, child: button);
  }
}

class ProStatusBadge extends StatelessWidget {
  const ProStatusBadge({super.key, required this.label, this.highlight = false});

  final String label;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: (highlight ? kProPink : kProSurface).withValues(alpha: 0.35),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: highlight ? kProPink : kProOutline),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: highlight ? Colors.white : kProTextSecondary,
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }
}

class ProLocationRow extends StatelessWidget {
  const ProLocationRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: kProPink, size: 22),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(subtitle, style: const TextStyle(color: kProTextSecondary)),
            ],
          ),
        ),
      ],
    );
  }
}

class ProChecklistItem extends StatelessWidget {
  const ProChecklistItem({
    super.key,
    required this.label,
    required this.done,
    this.subtitle,
    this.onChanged,
  });

  final String label;
  final bool done;
  final String? subtitle;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    return ProCard(
      child: Row(
        children: [
          Icon(
            done ? Icons.check_circle : Icons.radio_button_unchecked,
            color: done ? kProPink : kProTextSecondary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: Colors.white)),
                if (subtitle != null)
                  Text(subtitle!, style: const TextStyle(color: kProTextSecondary, fontSize: 12)),
              ],
            ),
          ),
          if (onChanged != null)
            Switch(
              value: done,
              onChanged: onChanged,
              activeThumbColor: kProPink,
            ),
        ],
      ),
    );
  }
}

class ProScreenState extends StatelessWidget {
  const ProScreenState.loading({super.key}) : _type = _StateType.loading, message = null, onRetry = null;
  const ProScreenState.error({super.key, required this.message, this.onRetry}) : _type = _StateType.error;
  const ProScreenState.empty({super.key, required this.message, this.onRetry}) : _type = _StateType.empty;

  final _StateType _type;
  final String? message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (_type == _StateType.loading) {
      return const Center(child: CircularProgressIndicator(color: kProPink));
    }
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _type == _StateType.error ? Icons.error_outline : Icons.inbox_outlined,
              color: kProTextSecondary,
              size: 40,
            ),
            const SizedBox(height: 12),
            Text(
              message ?? 'Nothing here yet',
              textAlign: TextAlign.center,
              style: const TextStyle(color: kProTextSecondary),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ],
        ),
      ),
    );
  }
}

enum _StateType { loading, error, empty }

/// Controlled rejection reasons aligned with backend PP-004.
const List<MapEntry<String, String>> kProRejectReasons = [
  MapEntry('TOO_FAR', 'Too far'),
  MapEntry('NOT_AVAILABLE', 'Not available'),
  MapEntry('WRONG_SERVICE', 'Wrong service'),
  MapEntry('VEHICLE_ISSUE', 'Vehicle issue'),
  MapEntry('PERSONAL_REASON', 'Personal reason'),
  MapEntry('OTHER', 'Other'),
];

Future<String?> showProRejectReasonSheet(BuildContext context) async {
  String selected = kProRejectReasons.first.key;
  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: kProCard,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) {
      return StatefulBuilder(
        builder: (context, setState) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Decline offer',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Select a reason. The job may be offered to another professional.',
                  style: TextStyle(color: kProTextSecondary, fontSize: 13),
                ),
                const SizedBox(height: 12),
                ...kProRejectReasons.map(
                  (entry) => RadioListTile<String>(
                    value: entry.key,
                    groupValue: selected,
                    activeColor: kProPink,
                    title: Text(entry.value, style: const TextStyle(color: Colors.white)),
                    onChanged: (value) {
                      if (value != null) setState(() => selected = value);
                    },
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(ctx),
                        child: const Text('Cancel'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: () => Navigator.pop(ctx, selected),
                        style: FilledButton.styleFrom(backgroundColor: kProPink),
                        child: const Text('Confirm decline'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      );
    },
  );
}
