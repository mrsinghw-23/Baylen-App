import 'package:flutter/material.dart';

const kShopBlue = Color(0xFF64A1FF);
const kShopCyan = Color(0xFF8BFCFE);
const kShopOnBlue = Colors.white;
const kShopInk = Color(0xFF10233F);
const kShopMuted = Color(0xFF334861);
const kShopCard = Colors.white;
const kShopSurface = Color(0xFFF4F8FF);
const kShopLine = Color(0xFFC9D6E8);
const kShopPrimary = Color(0xFFFF1B78);

ThemeData shopLightTheme({Color primary = kShopPrimary}) {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    fontFamily: 'Roboto',
    colorScheme: ColorScheme.light(
      primary: primary,
      secondary: kShopBlue,
      surface: Colors.white,
      error: const Color(0xFFC62828),
      onPrimary: Colors.white,
      onSecondary: Colors.white,
      onSurface: kShopInk,
      onSurfaceVariant: kShopMuted,
    ),
    scaffoldBackgroundColor: kShopSurface,
    appBarTheme: const AppBarTheme(
      backgroundColor: kShopSurface,
      foregroundColor: kShopInk,
      elevation: 0,
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: kShopInk,
        fontSize: 18,
        fontWeight: FontWeight.w800,
      ),
      iconTheme: IconThemeData(color: kShopInk),
    ),
    cardTheme: const CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
        side: BorderSide(color: kShopLine),
      ),
    ),
    dividerTheme: const DividerThemeData(color: kShopLine),
    iconTheme: const IconThemeData(color: kShopInk),
    textTheme: Typography.blackMountainView.apply(
      bodyColor: kShopInk,
      displayColor: kShopInk,
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: primary,
        backgroundColor: Colors.white,
        disabledForegroundColor: const Color(0xFF6B7C93),
        side: BorderSide(color: primary, width: 1.6),
        minimumSize: const Size.fromHeight(48),
        textStyle: const TextStyle(fontWeight: FontWeight.w800),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        disabledForegroundColor: Colors.white,
        minimumSize: const Size.fromHeight(48),
        textStyle: const TextStyle(fontWeight: FontWeight.w800),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: kShopInk),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: primary.withValues(alpha: 0.16),
      disabledColor: const Color(0xFFE8EEF6),
      labelStyle: const TextStyle(color: kShopInk, fontWeight: FontWeight.w700),
      secondaryLabelStyle: const TextStyle(color: kShopInk),
      side: const BorderSide(color: kShopLine),
      checkmarkColor: primary,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      hintStyle: const TextStyle(color: Color(0xFF4A5D75)),
      labelStyle: const TextStyle(color: kShopInk),
      prefixIconColor: kShopMuted,
      suffixIconColor: kShopMuted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: kShopLine),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: kShopLine),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: BorderSide(color: primary),
      ),
    ),
  );
}

class ShopThemeScope extends StatelessWidget {
  const ShopThemeScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Theme(data: shopLightTheme(), child: child);
  }
}
