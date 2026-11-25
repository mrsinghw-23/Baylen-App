import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Vertical oval guide for selfie capture — face should fit inside the cutout.
class FaceOvalGuideMetrics {
  FaceOvalGuideMetrics._(this.rect);

  final Rect rect;

  static FaceOvalGuideMetrics forSize(Size size) {
    final width = size.width * 0.68;
    final height = math.min(size.height * 0.42, width * 1.28);
    final center = Offset(size.width / 2, size.height * 0.40);
    return FaceOvalGuideMetrics._(
      Rect.fromCenter(center: center, width: width, height: height),
    );
  }
}

class FaceOvalCameraOverlay extends StatelessWidget {
  const FaceOvalCameraOverlay({
    super.key,
    this.instruction = 'Align your face inside the oval',
  });

  final String instruction;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final metrics = FaceOvalGuideMetrics.forSize(constraints.biggest);
        return Stack(
          fit: StackFit.expand,
          children: [
            CustomPaint(
              painter: _FaceOvalMaskPainter(ovalRect: metrics.rect),
              child: const SizedBox.expand(),
            ),
            Positioned(
              top: 16,
              left: 20,
              right: 20,
              child: Text(
                instruction,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  shadows: [
                    Shadow(color: Colors.black54, blurRadius: 8),
                  ],
                ),
              ),
            ),
            Positioned(
              left: metrics.rect.left,
              top: metrics.rect.bottom + 18,
              width: metrics.rect.width,
              child: Text(
                'Keep your eyes level and look straight at the camera',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.88),
                  fontSize: 13,
                  shadows: const [
                    Shadow(color: Colors.black54, blurRadius: 6),
                  ],
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _FaceOvalMaskPainter extends CustomPainter {
  _FaceOvalMaskPainter({required this.ovalRect});

  final Rect ovalRect;

  @override
  void paint(Canvas canvas, Size size) {
    final overlay = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addOval(ovalRect)
      ..fillType = PathFillType.evenOdd;

    canvas.drawPath(
      overlay,
      Paint()..color = Colors.black.withValues(alpha: 0.58),
    );

    canvas.drawOval(
      ovalRect,
      Paint()
        ..color = Colors.white.withValues(alpha: 0.95)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );

    canvas.drawOval(
      ovalRect.deflate(6),
      Paint()
        ..color = const Color(0xFF35D07F).withValues(alpha: 0.85)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );
  }

  @override
  bool shouldRepaint(covariant _FaceOvalMaskPainter oldDelegate) {
    return oldDelegate.ovalRect != ovalRect;
  }
}
