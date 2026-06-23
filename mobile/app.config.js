// Dynamic Expo config.
//
// We keep the bulk of the configuration in app.json (loaded below as the base)
// and only layer in values that must come from the environment at build time.
//
// Maps: the app now uses free Leaflet/OSM/CARTO tiles (no native Google Maps
// provider and no API key required), so there is no Google Maps key injection
// here. The only build-time layering left is the parental-control plugin below.

const base = require('./app.json')

module.exports = () => {
  const config = JSON.parse(JSON.stringify(base.expo))

  // Native parental-control scaffolding (Android-only). On prebuild this adds
  // the UsageStats + AccessibilityService manifest entries and copies the Kotlin
  // sources into android/. See plugins/PARENTAL_CONTROL_README.md.
  // NOTE: requires a native rebuild (`npx expo prebuild` + run:android) to take effect.
  config.plugins = config.plugins || []
  if (!config.plugins.includes('./plugins/withParentalControl')) {
    config.plugins.push('./plugins/withParentalControl')
  }

  return config
}
