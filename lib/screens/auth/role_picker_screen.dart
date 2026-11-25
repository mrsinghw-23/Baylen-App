import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../launch/launch_assets.dart';
import '../../theme/baylen_theme.dart';
import '../login_screen.dart';
import '../../auth/professional_auth_exit.dart';
import '../../auth/delivery_partner_auth_service.dart';
import 'employee_login_screen.dart';
import 'professional_launch_gate.dart';

enum AuthRoleResult {
  customerSignedIn,
  deliveryPartnerSignedIn,
  cancelled,
}

class RolePickerScreen extends StatefulWidget {
  const RolePickerScreen({super.key, this.message});

  final String? message;

  @override
  State<RolePickerScreen> createState() => _RolePickerScreenState();
}

class _RolePickerScreenState extends State<RolePickerScreen>
    with SingleTickerProviderStateMixin {
  static const _assets = BaylenLaunchAssets();
  static const _gold = Color(0xFFFFC857);
  static const _muted = Color(0xFFAAA4B6);

  late final AnimationController _intro;
  String _busyRole = '';

  @override
  void initState() {
    super.initState();
    _intro = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 780),
    )..forward();
  }

  @override
  void dispose() {
    _intro.dispose();
    super.dispose();
  }

  Animation<double> _fade(double begin, double end) {
    return CurvedAnimation(
      parent: _intro,
      curve: Interval(begin, end, curve: Curves.easeOutCubic),
    );
  }

  Future<void> _openCustomerLogin() async {
    if (_busyRole.isNotEmpty) return;
    setState(() => _busyRole = 'user');
    try {
      final signedIn = await Navigator.of(context).push<bool>(
        MaterialPageRoute<bool>(builder: (_) => const LoginScreen()),
      );
      if (!mounted) return;
      if (signedIn == true) {
        Navigator.of(context).pop(AuthRoleResult.customerSignedIn);
      }
    } finally {
      if (mounted) setState(() => _busyRole = '');
    }
  }

  Future<void> _openEmployeeLogin() async {
    if (_busyRole.isNotEmpty) return;
    setState(() => _busyRole = 'employee');
    try {
      if (DeliveryPartnerAuthService.instance.isSignedIn) {
        if (!mounted) return;
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (gateContext) => ProfessionalLaunchGate(
              onExit: () => ProfessionalAuthExit.navigateToCustomerHome(gateContext),
            ),
          ),
        );
        return;
      }
      await Navigator.of(context).push<void>(
        MaterialPageRoute<void>(
          builder: (_) => const EmployeeLoginScreen(),
        ),
      );
    } finally {
      if (mounted) setState(() => _busyRole = '');
    }
  }

  void _showLanguageMenu() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF1A1A21),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Language',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 18,
                  ),
                ),
                const SizedBox(height: 12),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.check, color: Color(0xFFFF1B78)),
                  title: const Text(
                    'English',
                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                  onTap: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = baylenTheme();
    final primary = theme.colorScheme.primary;
    final subtitle = widget.message?.trim().isNotEmpty == true
        ? widget.message!
        : 'Choose your role to continue with the right sign-in flow.';

    return Theme(
      data: theme,
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: Scaffold(
          backgroundColor: theme.scaffoldBackgroundColor,
          body: SafeArea(
            child: LayoutBuilder(
              builder: (context, constraints) {
                final compact = constraints.maxHeight < 850;
                final ultraCompact = constraints.maxHeight < 620;
                final logoHeight = ultraCompact ? 36.0 : (compact ? 40.0 : 48.0);
                final hideFooter = constraints.maxHeight < 680;
                return Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: Padding(
                      padding: EdgeInsets.fromLTRB(12, compact ? 0 : 4, 12, compact ? 8 : 12),
                      child: Column(
                        children: [
                          Row(
                            children: [
                              if (Navigator.of(context).canPop())
                                IconButton(
                                  tooltip: 'Back',
                                  onPressed: () => Navigator.of(context).maybePop(),
                                  icon: const Icon(Icons.arrow_back),
                                )
                              else
                                const SizedBox(width: 48, height: 48),
                              const Spacer(),
                              _LanguageChip(onTap: _showLanguageMenu),
                            ],
                          ),
                          FadeTransition(
                            opacity: _fade(0, 0.45),
                            child: Column(
                              children: [
                                Image.asset(
                                  _assets.brandLogo,
                                  height: logoHeight,
                                  fit: BoxFit.contain,
                                  semanticLabel: 'Baylen De Louis',
                                  errorBuilder: (context, error, stackTrace) {
                                    return Text(
                                      'BAYLEN DE LOUIS',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: _gold,
                                        fontWeight: FontWeight.w800,
                                        letterSpacing: 1.4,
                                        fontSize: compact ? 16 : 18,
                                      ),
                                    );
                                  },
                                ),
                                SizedBox(height: compact ? 4 : 8),
                                Text(
                                  'BEAUTY BEYOND BOUNDARIES',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: compact ? 10 : 11,
                                    letterSpacing: compact ? 1.8 : 2.2,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          SizedBox(height: compact ? 10 : 16),
                          FadeTransition(
                            opacity: _fade(0.18, 0.62),
                            child: Column(
                              children: [
                                Text(
                                  'How are you using Baylen?',
                                  textAlign: TextAlign.center,
                                  style: theme.textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w900,
                                    height: 1.15,
                                    fontSize: compact ? 22 : null,
                                  ),
                                ),
                                SizedBox(height: compact ? 4 : 8),
                                Text(
                                  subtitle,
                                  textAlign: TextAlign.center,
                                  maxLines: compact ? 2 : 3,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: _muted,
                                    height: 1.35,
                                    fontSize: compact ? 13 : 14,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          SizedBox(height: compact ? 10 : 14),
                          Expanded(
                            child: LayoutBuilder(
                              builder: (context, cardConstraints) {
                                final cardGap = compact ? 8.0 : 12.0;
                                final cardSlotHeight =
                                    (cardConstraints.maxHeight - cardGap) / 2;
                                final cardCompact = compact || cardSlotHeight < 300;
                                final cardTight = cardSlotHeight < 250 || ultraCompact;
                                return Column(
                                  children: [
                                    Expanded(
                                      child: FadeTransition(
                                        opacity: _fade(0.28, 0.82),
                                        child: _RoleExperienceCard(
                                          compact: cardCompact,
                                          tight: cardTight,
                                          maxFeatures: cardTight
                                              ? 0
                                              : (cardCompact ? 1 : 2),
                                          accent: primary,
                                          watermarkAsset: _assets.ladyLogo,
                                          watermarkAlignment: Alignment.centerRight,
                                          headerIcon: Icons.person_outline,
                                          badgeIcon: Icons.workspace_premium_outlined,
                                          title: 'User',
                                          subtitle: 'Shop, Book & Experience',
                                          badge: 'For Customers',
                                          description:
                                              'Shop beauty products, book salon & home services, and enjoy exclusive offers.',
                                          features: const [
                                            _RoleFeature(
                                              icon: Icons.shopping_bag_outlined,
                                              title: 'Shop Products',
                                              subtitle: 'Beauty, Skincare, Makeup & More',
                                            ),
                                            _RoleFeature(
                                              icon: Icons.content_cut,
                                              title: 'Book Services',
                                              subtitle: 'Salon, Spa, Home Services',
                                            ),
                                            _RoleFeature(
                                              icon: Icons.card_giftcard_outlined,
                                              title: 'Exclusive Offers',
                                              subtitle: 'Discover Best Deals',
                                            ),
                                          ],
                                          buttonLabel: 'Continue as User →',
                                          buttonForeground: Colors.white,
                                          busy: _busyRole == 'user',
                                          onPressed: _openCustomerLogin,
                                        ),
                                      ),
                                    ),
                                    SizedBox(height: cardGap),
                                    Expanded(
                                      child: FadeTransition(
                                        opacity: _fade(0.42, 1),
                                        child: _RoleExperienceCard(
                                          compact: cardCompact,
                                          tight: cardTight,
                                          maxFeatures: cardTight
                                              ? 0
                                              : (cardCompact ? 1 : 2),
                                          accent: _gold,
                                          watermarkAsset: _assets.circularLogo,
                                          watermarkAlignment: Alignment.bottomRight,
                                          headerIcon: Icons.groups_outlined,
                                          badgeIcon: Icons.school_outlined,
                                          title: 'Employee',
                                          subtitle: 'Deliver, Serve & Grow',
                                          badge: 'For Partners & Service Professionals',
                                          description:
                                              'Manage deliveries, handle service bookings, and grow your earnings with Baylen.',
                                          features: const [
                                            _RoleFeature(
                                              icon: Icons.delivery_dining_outlined,
                                              title: 'Delivery Partner',
                                              subtitle: 'Pick & Deliver Products',
                                            ),
                                            _RoleFeature(
                                              icon: Icons.handyman_outlined,
                                              title: 'Service Professional',
                                              subtitle: 'Salon, Spa, Home Services',
                                            ),
                                            _RoleFeature(
                                              icon: Icons.bar_chart_outlined,
                                              title: 'Track Earnings',
                                              subtitle: 'Grow Your Income',
                                            ),
                                          ],
                                          buttonLabel: 'Continue as Employee →',
                                          buttonForeground: const Color(0xFF111111),
                                          busy: _busyRole == 'employee',
                                          onPressed: _openEmployeeLogin,
                                        ),
                                      ),
                                    ),
                                  ],
                                );
                              },
                            ),
                          ),
                          if (!hideFooter)
                            FadeTransition(
                              opacity: _fade(0.62, 1),
                              child: const Padding(
                                padding: EdgeInsets.only(top: 10),
                                child: Text(
                                  'Together for a more beautiful tomorrow',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontFamily: 'serif',
                                    fontStyle: FontStyle.italic,
                                    fontSize: 14,
                                    height: 1.35,
                                  ),
                                ),
                              ),
                            )
                          else
                            FadeTransition(
                              opacity: _fade(0.62, 1),
                              child: const Padding(
                                padding: EdgeInsets.only(top: 4),
                                child: Text(
                                  'Together for a more beautiful tomorrow',
                                  textAlign: TextAlign.center,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    color: Colors.white70,
                                    fontFamily: 'serif',
                                    fontStyle: FontStyle.italic,
                                    fontSize: 11,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
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

class _LanguageChip extends StatelessWidget {
  const _LanguageChip({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Language, English',
      child: Material(
        color: const Color(0xFF121216),
        shape: StadiumBorder(
          side: BorderSide(color: Colors.white.withValues(alpha: 0.16)),
        ),
        child: InkWell(
          onTap: onTap,
          customBorder: const StadiumBorder(),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.language, size: 16, color: Colors.white),
                SizedBox(width: 6),
                Text(
                  'English',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                SizedBox(width: 2),
                Icon(Icons.keyboard_arrow_down, size: 18, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RoleFeature {
  const _RoleFeature({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;
}

class _RoleExperienceCard extends StatefulWidget {
  const _RoleExperienceCard({
    required this.compact,
    this.tight = false,
    required this.maxFeatures,
    required this.accent,
    required this.watermarkAsset,
    required this.watermarkAlignment,
    required this.headerIcon,
    required this.badgeIcon,
    required this.title,
    required this.subtitle,
    required this.badge,
    required this.description,
    required this.features,
    required this.buttonLabel,
    required this.buttonForeground,
    required this.busy,
    required this.onPressed,
  });

  final bool compact;
  final bool tight;
  final int maxFeatures;
  final Color accent;
  final String watermarkAsset;
  final Alignment watermarkAlignment;
  final IconData headerIcon;
  final IconData badgeIcon;
  final String title;
  final String subtitle;
  final String badge;
  final String description;
  final List<_RoleFeature> features;
  final String buttonLabel;
  final Color buttonForeground;
  final bool busy;
  final VoidCallback onPressed;

  @override
  State<_RoleExperienceCard> createState() => _RoleExperienceCardState();
}

class _RoleExperienceCardState extends State<_RoleExperienceCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    final visibleFeatures = widget.features.take(widget.maxFeatures).toList();
    final cardPadding = widget.tight
        ? const EdgeInsets.fromLTRB(12, 10, 12, 10)
        : widget.compact
            ? const EdgeInsets.fromLTRB(14, 12, 14, 12)
            : const EdgeInsets.fromLTRB(18, 16, 18, 14);
    final showDescription = !widget.compact && !widget.tight;
    final showSubtitle = !widget.compact && !widget.tight;
    return Semantics(
      container: true,
      label: '${widget.title}. ${widget.subtitle}',
      child: AnimatedScale(
        scale: _pressed ? 0.985 : 1,
        duration: const Duration(milliseconds: 120),
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.compact ? 18 : 22),
            boxShadow: [
              BoxShadow(
                color: widget.accent.withValues(alpha: 0.22),
                blurRadius: widget.compact ? 14 : 22,
                spreadRadius: 0.4,
              ),
            ],
          ),
          child: Material(
            color: const Color(0xFF14141A),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(widget.compact ? 18 : 22),
              side: BorderSide(color: widget.accent.withValues(alpha: 0.55)),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(
              children: [
                Positioned.fill(
                  child: Align(
                    alignment: widget.watermarkAlignment,
                    child: Opacity(
                      opacity: 0.09,
                      child: Image.asset(
                        widget.watermarkAsset,
                        width: widget.compact ? 120 : 168,
                        height: widget.compact ? 120 : 168,
                        fit: BoxFit.contain,
                        errorBuilder: (context, error, stackTrace) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),
                ),
                Positioned.fill(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          widget.accent.withValues(alpha: 0.08),
                          Colors.black.withValues(alpha: 0.28),
                        ],
                      ),
                    ),
                  ),
                ),
                Positioned.fill(
                  child: Padding(
                    padding: cardPadding,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            CircleAvatar(
                              radius: widget.tight ? 14 : (widget.compact ? 16 : 20),
                              backgroundColor: Colors.white,
                              child: Icon(
                                widget.headerIcon,
                                color: const Color(0xFF111111),
                                size: widget.tight ? 16 : (widget.compact ? 18 : 22),
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    widget.title,
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontSize: widget.tight ? 18 : (widget.compact ? 20 : 24),
                                      fontWeight: FontWeight.w900,
                                      height: 1.05,
                                    ),
                                  ),
                                  if (showSubtitle) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      widget.subtitle,
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 13,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                  SizedBox(height: widget.tight ? 3 : (widget.compact ? 4 : 6)),
                                  DecoratedBox(
                                    decoration: BoxDecoration(
                                      color: widget.accent,
                                      borderRadius: BorderRadius.circular(20),
                                    ),
                                    child: Padding(
                                      padding: EdgeInsets.symmetric(
                                        horizontal: widget.tight ? 7 : (widget.compact ? 8 : 10),
                                        vertical: widget.tight ? 2 : (widget.compact ? 2 : 3),
                                      ),
                                      child: Text(
                                        widget.badge,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: widget.buttonForeground,
                                          fontSize: widget.tight ? 8 : (widget.compact ? 9 : 10),
                                          fontWeight: FontWeight.w800,
                                          height: 1.2,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        if (showDescription) ...[
                          const SizedBox(height: 8),
                          Text(
                            widget.description,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFFEDEAF2),
                              height: 1.35,
                              fontSize: 12,
                            ),
                          ),
                        ],
                        if (visibleFeatures.isNotEmpty) ...[
                          SizedBox(height: widget.tight ? 4 : (widget.compact ? 6 : 8)),
                          Expanded(
                            child: SingleChildScrollView(
                              physics: const ClampingScrollPhysics(),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  for (final feature in visibleFeatures)
                                    _FeatureRow(
                                      feature: feature,
                                      accent: widget.accent,
                                      compact: widget.compact || widget.tight,
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ] else
                          const Spacer(),
                        SizedBox(height: widget.tight ? 4 : 6),
                        SizedBox(
                          width: double.infinity,
                          child: Listener(
                            onPointerDown: (_) => setState(() => _pressed = true),
                            onPointerUp: (_) => setState(() => _pressed = false),
                            onPointerCancel: (_) => setState(() => _pressed = false),
                            child: FilledButton(
                              onPressed: widget.busy ? null : widget.onPressed,
                              style: FilledButton.styleFrom(
                                backgroundColor: widget.accent,
                                foregroundColor: widget.buttonForeground,
                                disabledBackgroundColor:
                                    widget.accent.withValues(alpha: 0.55),
                                minimumSize: Size(
                                  64,
                                  widget.tight ? 40 : (widget.compact ? 44 : 48),
                                ),
                                padding: EdgeInsets.symmetric(
                                  horizontal: widget.tight ? 12 : 16,
                                  vertical: widget.tight ? 8 : 10,
                                ),
                                shape: const StadiumBorder(),
                              ),
                              child: widget.busy
                                  ? SizedBox(
                                      height: 20,
                                      width: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2.2,
                                        color: widget.buttonForeground,
                                      ),
                                    )
                                  : Text(
                                      widget.buttonLabel,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontSize: widget.tight ? 12 : (widget.compact ? 13 : 14),
                                      ),
                                    ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.feature,
    required this.accent,
    this.compact = false,
  });

  final _RoleFeature feature;
  final Color accent;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: compact ? 6 : 10),
      child: Row(
        children: [
          CircleAvatar(
            radius: compact ? 14 : 16,
            backgroundColor: accent.withValues(alpha: 0.18),
            child: Icon(feature.icon, size: compact ? 14 : 16, color: accent),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  feature.title,
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: compact ? 12 : 14,
                  ),
                ),
                if (!compact)
                  Text(
                    feature.subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFFAAA4B6),
                      fontSize: 12,
                      height: 1.25,
                    ),
                  ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: Colors.white70, size: 18),
        ],
      ),
    );
  }
}
