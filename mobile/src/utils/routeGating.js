// Decides whether a new GPS fix is "significant" enough to warrant fetching a
// new road-snapped route segment — keeps the live map from hammering
// /routing/segment on every 5s GPS tick when someone is standing still or
// barely moving. Used by routeSegmentTracker.js.

const EARTH_RADIUS_M = 6371000
const toRad = (d) => (d * Math.PI) / 180

function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Bearing in degrees [0, 360) from point a to point b.
function bearingDegrees(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function angleDiffDegrees(a, b) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

/**
 * @param {{lat:number,lng:number,bearing?:number}|null} lastRoutedPoint
 * @param {{lat:number,lng:number}} newPoint
 * @param {{minDistanceM?:number, minBearingDeg?:number}} opts
 * @returns {boolean}
 */
export function shouldRequestNewSegment(lastRoutedPoint, newPoint, opts = {}) {
  const { minDistanceM = 25, minBearingDeg = 30 } = opts
  if (!lastRoutedPoint) return true

  const dist = haversineMeters(lastRoutedPoint.lat, lastRoutedPoint.lng, newPoint.lat, newPoint.lng)
  if (dist < 5) return false // essentially stationary — never re-route
  if (dist >= minDistanceM) return true

  // Moved a little but not the full threshold — only re-route if direction
  // changed significantly since the last routed leg.
  if (lastRoutedPoint.bearing == null) return false
  const newBearing = bearingDegrees(lastRoutedPoint.lat, lastRoutedPoint.lng, newPoint.lat, newPoint.lng)
  return angleDiffDegrees(lastRoutedPoint.bearing, newBearing) >= minBearingDeg
}

export { haversineMeters, bearingDegrees }
