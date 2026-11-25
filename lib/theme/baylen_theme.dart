import 'package:flutter/material.dart';

ThemeData baylenTheme() {
  const primary = Color(0xFFFF1B78);
  const secondary = Color(0xFFFFC857);
  const canvas = Color(0xFF070708);
  const surface = Color(0xFF121216);
  const surfaceHigh = Color(0xFF1A1A21);
  const outline = Color(0xFF2B2B34);

  return ThemeData(
    colorScheme: const ColorScheme.dark(
      primary: primary,
      secondary: secondary,
      surface: surface,
      error: Color(0xFFFF5A6B),
      onPrimary: Colors.white,
      onSecondary: Color(0xFF111111),
      onSurface: Color(0xFFF8F6FA),
    ),
    scaffoldBackgroundColor: canvas,
    useMaterial3: true,
    fontFamily: 'Roboto',
    appBarTheme: const AppBarTheme(
      backgroundColor: canvas,
      foregroundColor: Color(0xFFF8F6FA),
      elevation: 0,
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: Color(0xFFF8F6FA),
        fontSize: 18,
        fontWeight: FontWeight.w800,
        letterSpacing: 0,
      ),
      iconTheme: IconThemeData(color: Color(0xFFF8F6FA)),
    ),
    cardTheme: const CardThemeData(
      color: surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
        side: BorderSide(color: outline),
      ),
    ),
    dividerTheme: const DividerThemeData(color: outline),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: surfaceHigh,
      contentTextStyle: TextStyle(color: Color(0xFFF8F6FA)),
      behavior: SnackBarBehavior.floating,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surface,
      hintStyle: const TextStyle(color: Color(0xFF8E8A98)),
      labelStyle: const TextStyle(color: Color(0xFFAAA4B6)),
      prefixIconColor: const Color(0xFFAAA4B6),
      suffixIconColor: const Color(0xFFAAA4B6),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(8),
        borderSide: const BorderSide(color: primary),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: primary,
        foregroundColor: Colors.white,
        minimumSize: const Size(64, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        textStyle: const TextStyle(
          fontWeight: FontWeight.w800,
          letterSpacing: 0,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: const Color(0xFFF8F6FA),
        side: const BorderSide(color: primary),
        minimumSize: const Size(64, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: surface,
      selectedColor: primary.withValues(alpha: 0.20),
      disabledColor: surfaceHigh,
      labelStyle: const TextStyle(color: Color(0xFFF8F6FA)),
      secondaryLabelStyle: const TextStyle(color: Color(0xFFF8F6FA)),
      side: const BorderSide(color: outline),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: canvas,
      surfaceTintColor: Colors.transparent,
      indicatorColor: primary.withValues(alpha: 0.18),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const IconThemeData(color: primary, size: 22);
        }
        return const IconThemeData(color: Color(0xFFAAA4B6), size: 22);
      }),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) {
          return const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: primary,
          );
        }
        return const TextStyle(fontSize: 11, color: Color(0xFFAAA4B6));
      }),
    ),
    textTheme: Typography.whiteMountainView.apply(
      bodyColor: const Color(0xFFEDEAF2),
      displayColor: const Color(0xFFF8F6FA),
    ),
  );
}
