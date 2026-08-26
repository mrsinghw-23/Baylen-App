# Baylen UI Brand Reference

This note records the latest visual direction provided for Baylen. The attached
reference images are samples only and should not be treated as final production
assets.

## Current Reference Direction

- Overall style: premium black background with Baylen pink accents.
- Brand feeling: beauty, salon, celebrity/family salon, polished luxury.
- Splash/onboarding direction:
  - First screen opens with Baylen brand logo.
  - Second stage can show a lady/beauty silhouette appearing above the brand
    logo.
  - Optional twinkle/sparkle animation around the logo/silhouette.
  - Pink wave/light animation can appear near the bottom of the splash screen.
- Home direction:
  - Baylen wordmark centered in the top area.
  - Location row visible near the top.
  - Search and notification icons in the app bar area.
  - Promotional salon banner near the first viewport.
  - Quick access actions for Book Service, Shop Now, Find Outlet, and At-Home
    Service.
  - Nearby outlets and popular services shown with strong image-led cards.
  - Bottom navigation remains Home, Shop, Salon, Service, Profile.

## Important Asset Note

The current images are only examples for layout, animation, color, and mood.
When the final Baylen app logo image is provided, replace the temporary/sample
logo direction with the real asset.

The latest two logo images were provided in chat as visual references, but no
downloadable image files were present in the local attachment folder. Place the
final image files in the paths listed below and Flutter will use them without
animation code changes.

Expected final logo assets:

- App launcher icon.
- Splash brand logo.
- Optional lady/beauty silhouette logo.
- Wordmark/header logo.
- Dark-background optimized versions.
- Transparent PNG/WebP preferred for Flutter.

## Implementation Reminder

When splash/logo work starts, implement it as a real Flutter splash/brand flow
using project assets. Do not hardcode final identity from the reference images.

## Current Implementation

The Flutter launch flow is implemented in `lib/launch/`:

- `launch_controller.dart`: runs initialization, restores auth/session, enforces
  a minimum premium splash duration, and transitions into the real app shell.
- `baylen_splash_screen.dart`: renders the black/pink splash, lady logo
  animation, twinkle particles, glow, blur/sharp effect, loading line, and retry
  state.
- `launch_assets.dart`: central asset path configuration for replacing sample
  placeholders with final Baylen logo files later.

Current expected asset paths:

- `assets/branding/baylen-de-louis-logo.png`
- `assets/branding/baylen-lady-logo.png`
- `assets/branding/baylen-logo-pink.png`
- `assets/splash/splash-background.png`

If these files are not present, the app uses lightweight Flutter fallback
branding so the splash screen never shows a broken image placeholder.

The current splash composition now treats the supplied images as the source of
truth: the brand logo asset is shown directly without extra hardcoded brand-name
text, and the lady logo asset appears above it with fade, scale, glow, twinkle,
then smooth fade-out. The brand logo remains visible with an animated circular
hot-pink light border before the Home transition.
