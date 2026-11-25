import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

/// Indian passport photo proportions: 35mm × 45mm (7:9 width:height).
const double kPassportAspectWidth = 7;
const double kPassportAspectHeight = 9;
const int kPassportOutputWidth = 700;
const int kPassportOutputHeight = 900;

class _PassportCropJob {
  const _PassportCropJob(this.bytes, this.verticalCenterFactor);

  final Uint8List bytes;
  final double verticalCenterFactor;
}

Uint8List _passportCropIsolate(_PassportCropJob job) {
  final decoded = img.decodeImage(job.bytes);
  if (decoded == null) {
    throw FormatException('Could not read the photo for passport crop.');
  }

  final aspect = kPassportAspectWidth / kPassportAspectHeight;
  final iw = decoded.width;
  final ih = decoded.height;

  late double cropW;
  late double cropH;
  if (iw / ih >= aspect) {
    cropH = ih.toDouble();
    cropW = cropH * aspect;
  } else {
    cropW = iw.toDouble();
    cropH = cropW / aspect;
  }

  final cx = iw / 2.0;
  final cy = ih * job.verticalCenterFactor.clamp(0.28, 0.52);
  var x = (cx - cropW / 2).round();
  var y = (cy - cropH / 2).round();
  x = x.clamp(0, iw - cropW.round());
  y = y.clamp(0, ih - cropH.round());

  final cropped = img.copyCrop(
    decoded,
    x: x,
    y: y,
    width: cropW.round(),
    height: cropH.round(),
  );
  final resized = img.copyResize(
    cropped,
    width: kPassportOutputWidth,
    height: kPassportOutputHeight,
    interpolation: img.Interpolation.linear,
  );

  var quality = 88;
  Uint8List output = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
  while (output.length > 900 * 1024 && quality > 52) {
    quality -= 8;
    output = Uint8List.fromList(img.encodeJpg(resized, quality: quality));
  }
  return output;
}

Future<Uint8List> cropToPassportPhoto(
  Uint8List bytes, {
  double verticalCenterFactor = 0.38,
}) {
  return compute(
    _passportCropIsolate,
    _PassportCropJob(bytes, verticalCenterFactor),
  );
}
