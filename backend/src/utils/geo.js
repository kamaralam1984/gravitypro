// Shared geo math — extracted so timeline.js and speedClassifier.js (and any
// future consumer) use one implementation instead of duplicating it.
const EARTH_RADIUS_M = 6371000
const toRad = (d) => (d * Math.PI) / 180

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

module.exports = { haversineMeters }
