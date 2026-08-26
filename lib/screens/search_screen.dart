import 'dart:async';

import 'package:flutter/material.dart';

import '../api/catalyst_api.dart';
import '../services/location_service.dart';
import '../widgets/home/_home_constants.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final TextEditingController _controller = TextEditingController();
  final CatalystApi _api = CatalystApi();
  Timer? _debounce;

  bool _isLoading = false;
  String _error = '';
  List<Map<String, dynamic>> _results = [];
  String _activeTypeFilter = '';

  final List<String> _filters = ['', 'product', 'service', 'outlet', 'brand'];
  final Map<String, String> _filterLabels = {
    '': 'All',
    'product': 'Products',
    'service': 'Services',
    'outlet': 'Salons',
    'brand': 'Brands',
  };

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onSearchChanged);
    _controller.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged() {
    if (_debounce?.isActive ?? false) _debounce!.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      if (_controller.text.trim().isNotEmpty) {
        _performSearch();
      } else {
        setState(() {
          _results = [];
          _error = '';
        });
      }
    });
  }

  void _setFilter(String type) {
    setState(() {
      _activeTypeFilter = type;
    });
    if (_controller.text.trim().isNotEmpty) {
      _performSearch();
    }
  }

  Future<void> _performSearch() async {
    setState(() {
      _isLoading = true;
      _error = '';
    });

    try {
      final loc = LocationService.instance.currentLocation.value;
      final data = await _api.search(
        query: _controller.text.trim(),
        type: _activeTypeFilter,
        lat: loc?.latitude,
        lng: loc?.longitude,
      );

      final List rawResults = data['results'] ?? [];
      setState(() {
        _results = rawResults.whereType<Map<String, dynamic>>().toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = 'Failed to search: $e';
        _isLoading = false;
      });
    }
  }

  Widget _buildResultItem(Map<String, dynamic> item) {
    final type = item['type'];
    final name = item['name'] ?? '';
    final imageUrl =
        item['thumbnail_url'] ?? item['image_url'] ?? item['logo_url'] ?? '';
    final description = item['description'] ?? item['address'] ?? '';

    IconData fallbackIcon = Icons.search;
    if (type == 'product') fallbackIcon = Icons.inventory_2_outlined;
    if (type == 'service') fallbackIcon = Icons.spa_outlined;
    if (type == 'outlet') fallbackIcon = Icons.store_mall_directory_outlined;
    if (type == 'brand') fallbackIcon = Icons.branding_watermark_outlined;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Container(
          width: 50,
          height: 50,
          color: kHomeCard,
          child: imageUrl.isNotEmpty
              ? Image.network(imageUrl, fit: BoxFit.cover)
              : Icon(fallbackIcon, color: kHomePink),
        ),
      ),
      title: Text(
        name,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.bold,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            description,
            style: const TextStyle(color: kHomeTextSecondary, fontSize: 12),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
            decoration: BoxDecoration(
              color: kHomePink.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              _filterLabels[type] ?? type,
              style: const TextStyle(
                color: kHomePink,
                fontSize: 9,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      onTap: () {
        // Deep link based on type
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: kHomeCanvas,
      body: SafeArea(
        child: Column(
          children: [
            // Header Search Bar
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
              child: Row(
                children: [
                  IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white),
                    onPressed: () => Navigator.pop(context),
                  ),
                  Expanded(
                    child: Container(
                      height: 46,
                      decoration: BoxDecoration(
                        color: kHomeCard,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: kHomeOutline),
                      ),
                      child: Row(
                        children: [
                          const SizedBox(width: 14),
                          const Icon(
                            Icons.search,
                            color: kHomeTextSecondary,
                            size: 20,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: TextField(
                              controller: _controller,
                              autofocus: true,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 14,
                              ),
                              decoration: const InputDecoration(
                                hintText:
                                    'Search products, services, salons...',
                                hintStyle: TextStyle(color: kHomeTextSecondary),
                                border: InputBorder.none,
                                isDense: true,
                              ),
                            ),
                          ),
                          if (_controller.text.isNotEmpty)
                            IconButton(
                              icon: const Icon(
                                Icons.close,
                                color: kHomeTextSecondary,
                                size: 18,
                              ),
                              onPressed: () {
                                _controller.clear();
                              },
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // Filter Chips
            SizedBox(
              height: 40,
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: _filters.length,
                itemBuilder: (context, i) {
                  final filter = _filters[i];
                  final isActive = _activeTypeFilter == filter;
                  return GestureDetector(
                    onTap: () => _setFilter(filter),
                    child: Container(
                      margin: const EdgeInsets.only(right: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: isActive ? kHomePink : kHomeCard,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: isActive ? kHomePink : kHomeOutline,
                        ),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        _filterLabels[filter]!,
                        style: TextStyle(
                          color: isActive ? Colors.white : kHomeTextSecondary,
                          fontWeight: isActive
                              ? FontWeight.w600
                              : FontWeight.normal,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),

            // Results List
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: CircularProgressIndicator(color: kHomePink),
                    )
                  : _error.isNotEmpty
                  ? Center(
                      child: Text(
                        _error,
                        style: const TextStyle(color: Colors.red),
                      ),
                    )
                  : _results.isEmpty && _controller.text.trim().isNotEmpty
                  ? const Center(
                      child: Text(
                        'No results found',
                        style: TextStyle(color: kHomeTextSecondary),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (context, i) =>
                          _buildResultItem(_results[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
