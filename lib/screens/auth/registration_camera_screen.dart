import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../widgets/registration/face_oval_camera_overlay.dart';

class RegistrationCameraScreen extends StatefulWidget {
  const RegistrationCameraScreen({
    super.key,
    required this.useFrontCamera,
    required this.title,
  });

  final bool useFrontCamera;
  final String title;

  @override
  State<RegistrationCameraScreen> createState() =>
      _RegistrationCameraScreenState();
}

class _RegistrationCameraScreenState extends State<RegistrationCameraScreen> {
  static const _presets = [
    ResolutionPreset.medium,
    ResolutionPreset.low,
    ResolutionPreset.high,
  ];

  CameraController? _controller;
  List<CameraDescription> _cameras = const [];
  String? _error;
  bool _initializing = true;
  bool _capturing = false;
  XFile? _captured;
  Uint8List? _previewBytes;

  bool get _selfieMode => widget.useFrontCamera;

  @override
  void initState() {
    super.initState();
    _openCamera();
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _openCamera() async {
    setState(() {
      _initializing = true;
      _error = null;
      _captured = null;
      _previewBytes = null;
    });
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw CameraException(
          'noCameras',
          'No camera found on this device.',
        );
      }
      _cameras = cameras;
      final preferred = widget.useFrontCamera
          ? CameraLensDirection.front
          : CameraLensDirection.back;
      final ordered = [
        ...cameras.where((camera) => camera.lensDirection == preferred),
        ...cameras.where((camera) => camera.lensDirection != preferred),
      ];

      Object? lastError;
      for (final camera in ordered) {
        for (final preset in _presets) {
          try {
            await _bindCamera(camera, preset);
            return;
          } catch (error) {
            lastError = error;
            await _safeDispose();
          }
        }
      }
      throw lastError ??
          CameraException('cameraInitFailed', 'Could not start any camera.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _initializing = false;
        _error = _friendlyError(error);
      });
    }
  }

  Future<void> _safeDispose() async {
    final controller = _controller;
    _controller = null;
    if (controller == null) return;
    try {
      await controller.dispose();
    } catch (_) {}
  }

  Future<void> _bindCamera(
    CameraDescription camera,
    ResolutionPreset preset,
  ) async {
    await _safeDispose();
    final controller = CameraController(
      camera,
      preset,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.jpeg,
    );
    _controller = controller;
    await controller.initialize();
    if (!mounted) {
      await _safeDispose();
      return;
    }
    setState(() {
      _initializing = false;
      _error = null;
    });
  }

  Future<void> _switchCamera() async {
    if (_cameras.length < 2 || _controller == null || _capturing) {
      return;
    }
    final current = _controller!.description;
    final next = _cameras.firstWhere(
      (camera) => camera.name != current.name,
      orElse: () => current,
    );
    setState(() => _initializing = true);
    try {
      Object? lastError;
      for (final preset in _presets) {
        try {
          await _bindCamera(next, preset);
          return;
        } catch (error) {
          lastError = error;
          await _safeDispose();
        }
      }
      throw lastError ??
          CameraException('cameraSwitchFailed', 'Could not switch camera.');
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _initializing = false;
        _error = _friendlyError(error);
      });
    }
  }

  Future<void> _capture() async {
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized || _capturing) {
      return;
    }
    setState(() => _capturing = true);
    try {
      final photo = await controller.takePicture();
      final bytes = await photo.readAsBytes();
      if (!mounted) return;
      if (bytes.isEmpty) {
        setState(() {
          _capturing = false;
          _error = 'Could not read the captured photo. Please try again.';
        });
        return;
      }
      setState(() {
        _capturing = false;
        _captured = photo;
        _previewBytes = bytes;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _capturing = false;
        _error = _friendlyError(error);
      });
    }
  }

  Future<void> _retake() async {
    setState(() {
      _captured = null;
      _previewBytes = null;
      _capturing = false;
    });
    final controller = _controller;
    if (controller == null || !controller.value.isInitialized) {
      await _openCamera();
    }
  }

  void _usePhoto() {
    final photo = _captured;
    if (photo == null) return;
    Navigator.of(context).pop(photo);
  }

  String _friendlyError(Object error) {
    final text = error.toString().replaceFirst('Exception: ', '');
    if (text.contains('CameraAccessDenied') ||
        text.contains('permission') ||
        text.contains('Access is denied') ||
        text.toLowerCase().contains('denied')) {
      return 'Camera permission is required. Enable Camera for Baylen in device Settings.';
    }
    if (text.contains('No camera') || text.contains('noCameras')) {
      return 'No camera found on this device.';
    }
    return 'Could not open the camera. Close other apps using the camera and try again.\n\nDetails: $text';
  }

  bool _mirrorPreview(CameraController controller) {
    return controller.description.lensDirection == CameraLensDirection.front ||
        (!kIsWeb &&
            defaultTargetPlatform == TargetPlatform.windows &&
            widget.useFrontCamera);
  }

  Widget _buildLivePreview(CameraController controller) {
    final mirror = _mirrorPreview(controller);
    final previewSize = controller.value.previewSize;
    final child = previewSize == null
        ? CameraPreview(controller)
        : FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: previewSize.height,
              height: previewSize.width,
              child: CameraPreview(controller),
            ),
          );

    return Transform.flip(
      flipX: mirror,
      child: child,
    );
  }

  Widget _buildSelfieCapture(CameraController? controller, bool ready) {
    return Stack(
      fit: StackFit.expand,
      children: [
        if (ready && controller != null)
          _buildLivePreview(controller)
        else if (_initializing)
          const Center(child: CircularProgressIndicator())
        else
          const SizedBox.shrink(),
        if (ready &&
            !reviewing &&
            controller!.description.lensDirection == CameraLensDirection.front)
          const FaceOvalCameraOverlay(),
        Positioned(
          top: MediaQuery.paddingOf(context).top + 8,
          left: 8,
          child: IconButton(
            style: IconButton.styleFrom(
              backgroundColor: Colors.black45,
              foregroundColor: Colors.white,
            ),
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.close),
          ),
        ),
        if (ready && !reviewing && _cameras.length > 1)
          Positioned(
            top: MediaQuery.paddingOf(context).top + 8,
            right: 8,
            child: IconButton(
              style: IconButton.styleFrom(
                backgroundColor: Colors.black45,
                foregroundColor: Colors.white,
              ),
              tooltip: 'Switch camera',
              onPressed: _initializing || _capturing ? null : _switchCamera,
              icon: const Icon(Icons.cameraswitch_outlined),
            ),
          ),
      ],
    );
  }

  bool get reviewing => _previewBytes != null;

  Widget _buildStandardCapture(CameraController? controller, bool ready) {
    return Column(
      children: [
        Expanded(
          child: Center(
            child: ready && controller != null
                ? AspectRatio(
                    aspectRatio: controller.value.aspectRatio == 0
                        ? 4 / 3
                        : controller.value.aspectRatio,
                    child: _buildLivePreview(controller),
                  )
                : _initializing
                    ? const CircularProgressIndicator()
                    : const SizedBox.shrink(),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    final ready = controller != null && controller.value.isInitialized;

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: _selfieMode && !reviewing,
      appBar: _selfieMode && !reviewing
          ? null
          : AppBar(
              title: Text(reviewing ? 'Preview' : widget.title),
              actions: [
                if (!reviewing && !_selfieMode && _cameras.length > 1)
                  IconButton(
                    tooltip: 'Switch camera',
                    onPressed: _initializing || _capturing ? null : _switchCamera,
                    icon: const Icon(Icons.cameraswitch_outlined),
                  ),
              ],
            ),
      body: _error != null
          ? Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _openCamera,
                    child: const Text('Retry camera'),
                  ),
                ],
              ),
            )
          : reviewing
              ? Column(
                  children: [
                    Expanded(
                      child: Center(
                        child: Image.memory(_previewBytes!, fit: BoxFit.contain),
                      ),
                    ),
                  ],
                )
              : _selfieMode
                  ? _buildSelfieCapture(controller, ready)
                  : _buildStandardCapture(controller, ready),
      bottomNavigationBar: _error != null
          ? null
          : SafeArea(
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  24,
                  12,
                  24,
                  _selfieMode && !reviewing ? 28 : 24,
                ),
                child: reviewing
                    ? Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: _retake,
                              child: const Text('Retake'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: _usePhoto,
                              child: const Text('Use Photo'),
                            ),
                          ),
                        ],
                      )
                    : Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (_selfieMode) ...[
                            Text(
                              _cameras.length > 1
                                  ? 'Tap switch (top-right) for back camera · Retake after capture'
                                  : 'Retake is available after you capture',
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white70, fontSize: 13),
                            ),
                            const SizedBox(height: 12),
                          ] else ...[
                            Text(
                              'Face the camera and tap Capture',
                              style: const TextStyle(color: Colors.white70),
                            ),
                            const SizedBox(height: 16),
                          ],
                          FilledButton.icon(
                            onPressed: ready && !_capturing && _error == null
                                ? _capture
                                : null,
                            style: FilledButton.styleFrom(
                              minimumSize: const Size.fromHeight(48),
                            ),
                            icon: const Icon(Icons.camera_alt),
                            label: Text(_capturing ? 'Capturing...' : 'Capture'),
                          ),
                        ],
                      ),
              ),
            ),
    );
  }
}
