import 'package:flutter/material.dart';

import '../models/launch_content.dart';

class LaunchExperience extends StatefulWidget {
  const LaunchExperience({
    super.key,
    required this.content,
    required this.onComplete,
    required this.onAction,
  });

  final LaunchContent content;
  final VoidCallback onComplete;
  final ValueChanged<LaunchItem> onAction;

  @override
  State<LaunchExperience> createState() => _LaunchExperienceState();
}

class _LaunchExperienceState extends State<LaunchExperience> {
  final PageController _controller = PageController();
  int _index = 0;

  List<LaunchItem> get _items => widget.content.items;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _primaryAction() {
    final item = _items[_index];
    final isLast = _index == _items.length - 1;
    if (item.hasAction) {
      widget.onAction(item);
      return;
    }
    if (!isLast) {
      _controller.nextPage(
        duration: const Duration(milliseconds: 260),
        curve: Curves.easeOutCubic,
      );
      return;
    }
    widget.onComplete();
  }

  @override
  Widget build(BuildContext context) {
    if (_items.isEmpty) {
      return const SizedBox.shrink();
    }

    return Material(
      color: Colors.black,
      child: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment.topCenter,
                    radius: 0.95,
                    colors: [
                      const Color(0xFFED2F7D).withValues(alpha: 0.24),
                      const Color(0xFF10020A).withValues(alpha: 0.64),
                      Colors.black,
                    ],
                  ),
                ),
              ),
            ),
            Positioned.fill(
              child: PageView.builder(
                controller: _controller,
                itemCount: _items.length,
                onPageChanged: (index) => setState(() => _index = index),
                itemBuilder: (context, index) {
                  return _LaunchPage(item: _items[index]);
                },
              ),
            ),
            Positioned(
              top: 12,
              right: 12,
              child: IconButton.filledTonal(
                tooltip: 'Close',
                onPressed: widget.onComplete,
                icon: const Icon(Icons.close),
              ),
            ),
            Positioned(
              left: 20,
              right: 20,
              bottom: 24,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_items.length > 1) ...[
                    _LaunchDots(count: _items.length, activeIndex: _index),
                    const SizedBox(height: 18),
                  ],
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: widget.onComplete,
                          child: Text(
                            _items[_index].secondaryButtonLabel.isNotEmpty
                                ? _items[_index].secondaryButtonLabel
                                : 'Skip',
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          onPressed: _primaryAction,
                          child: Text(_primaryLabel),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String get _primaryLabel {
    final item = _items[_index];
    if (item.buttonLabel.isNotEmpty) return item.buttonLabel;
    if (item.hasAction) return 'Open';
    return _index == _items.length - 1 ? 'Continue' : 'Next';
  }
}

class _LaunchPage extends StatelessWidget {
  const _LaunchPage({required this.item});

  final LaunchItem item;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final maxContentWidth = width > 560 ? 460.0 : width;

    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 32, 24, 128),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxContentWidth),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _LaunchMedia(imageUrl: item.imageUrl),
              const SizedBox(height: 28),
              if (item.subtitle.isNotEmpty) ...[
                Text(
                  item.subtitle.toUpperCase(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFFED2F7D),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
              ],
              Text(
                item.title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                  height: 1.08,
                ),
              ),
              if (item.body.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  item.body,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFFD4CAD2),
                    fontSize: 15,
                    height: 1.45,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _LaunchMedia extends StatelessWidget {
  const _LaunchMedia({required this.imageUrl});

  final String imageUrl;

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1,
      child: DecoratedBox(
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          border: Border.all(
            color: const Color(0xFFED2F7D).withValues(alpha: 0.78),
            width: 1.4,
          ),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFFED2F7D).withValues(alpha: 0.34),
              blurRadius: 36,
              spreadRadius: 2,
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: ClipOval(
            child: imageUrl.isEmpty
                ? const ColoredBox(
                    color: Color(0xFF16030C),
                    child: Icon(
                      Icons.auto_awesome,
                      color: Color(0xFFED2F7D),
                      size: 92,
                    ),
                  )
                : Image.network(
                    imageUrl,
                    fit: BoxFit.cover,
                    filterQuality: FilterQuality.high,
                    errorBuilder: (context, error, stackTrace) {
                      return const ColoredBox(
                        color: Color(0xFF16030C),
                        child: Icon(
                          Icons.auto_awesome,
                          color: Color(0xFFED2F7D),
                          size: 92,
                        ),
                      );
                    },
                  ),
          ),
        ),
      ),
    );
  }
}

class _LaunchDots extends StatelessWidget {
  const _LaunchDots({required this.count, required this.activeIndex});

  final int count;
  final int activeIndex;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (index) {
        final active = index == activeIndex;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          width: active ? 22 : 7,
          height: 7,
          margin: const EdgeInsets.symmetric(horizontal: 4),
          decoration: BoxDecoration(
            color: active ? const Color(0xFFED2F7D) : const Color(0xFF4A3440),
            borderRadius: BorderRadius.circular(999),
          ),
        );
      }),
    );
  }
}
