import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../auth/auth_service.dart';
import '../models/review.dart';
import '../screens/login_screen.dart';

class ReviewsPanel extends StatefulWidget {
  const ReviewsPanel({
    super.key,
    required this.targetType,
    required this.targetId,
    required this.title,
    this.framed = true,
  });

  final String targetType;
  final String targetId;
  final String title;
  final bool framed;

  @override
  State<ReviewsPanel> createState() => _ReviewsPanelState();
}

class _ReviewsPanelState extends State<ReviewsPanel> {
  final _review = TextEditingController();
  final _api = CatalystApi();
  List<BaylenReview> _reviews = [];
  int _rating = 5;
  bool _loading = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ReviewsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.targetId != widget.targetId ||
        oldWidget.targetType != widget.targetType) {
      _load();
    }
  }

  @override
  void dispose() {
    _review.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (widget.targetId.isEmpty) {
      setState(() {
        _reviews = [];
        _loading = false;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final reviews = await _api.reviews(
        targetType: widget.targetType,
        targetId: widget.targetId,
      );
      if (!mounted) return;
      setState(() {
        _reviews = reviews;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _submit() async {
    if (!AuthService.instance.isSignedIn) {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (signedIn != true) return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await AuthService.instance.api.submitReview(
        targetType: widget.targetType,
        targetId: widget.targetId,
        rating: _rating,
        review: _review.text.trim(),
      );
      if (!mounted) return;
      _review.clear();
      await _load();
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Review submitted')));
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _submitting = false;
      });
    }
  }

  double get _averageRating {
    if (_reviews.isEmpty) {
      return 0;
    }
    final total = _reviews.fold<int>(0, (sum, review) => sum + review.rating);
    return total / _reviews.length;
  }

  @override
  Widget build(BuildContext context) {
    final content = Padding(
      padding: EdgeInsets.all(widget.framed ? 14 : 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.star_border,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  widget.title,
                  style: Theme.of(context).textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              if (_reviews.isNotEmpty)
                Text('${_averageRating.toStringAsFixed(1)} / 5'),
            ],
          ),
          const SizedBox(height: 12),
          _RatingPicker(
            value: _rating,
            onChanged: (value) => setState(() => _rating = value),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _review,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              hintText: 'Write your review',
              prefixIcon: Icon(Icons.rate_review_outlined),
            ),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _submitting ? null : _submit,
            icon: const Icon(Icons.send_outlined),
            label: Text(_submitting ? 'Submitting...' : 'Submit review'),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const Divider(height: 24),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else if (_reviews.isEmpty)
            const Text('No reviews yet.')
          else
            ..._reviews
                .take(5)
                .map(
                  (review) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _ReviewTile(review: review),
                  ),
                ),
        ],
      ),
    );
    if (!widget.framed) {
      return content;
    }
    return Card(child: content);
  }
}

class _RatingPicker extends StatelessWidget {
  const _RatingPicker({required this.value, required this.onChanged});

  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(5, (index) {
        final star = index + 1;
        return IconButton(
          tooltip: '$star star',
          visualDensity: VisualDensity.compact,
          onPressed: () => onChanged(star),
          icon: Icon(
            star <= value ? Icons.star : Icons.star_border,
            color: Theme.of(context).colorScheme.secondary,
          ),
        );
      }),
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile({required this.review});

  final BaylenReview review;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: const Color(0xFF2B2B34)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                Icons.star,
                color: Theme.of(context).colorScheme.secondary,
                size: 18,
              ),
              const SizedBox(width: 4),
              Text(
                '${review.rating}/5',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ],
          ),
          if (review.review.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(review.review),
          ],
        ],
      ),
    );
  }
}
