// Dynamic Expo config.
//
// We keep the bulk of the configuration in app.json (loaded below as the base)
// and only layer in values that must come from the environment at build time.
//
// Maps: the app now uses free Leaflet/OSM/CARTO tiles (no native Google Maps
// provider and no API key required), so there is no Google Maps key injection
// here. There is no build-time layering left, so we just return app.json as-is.

const base = require('./app.json')

module.exports = () => JSON.parse(JSON.stringify(base.expo))
