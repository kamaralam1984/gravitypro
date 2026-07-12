// GPS-noise filter for distance / route accuracy.
//
// A phone that is standing still still emits location fixes that jump ±100s of
// metres (poor accuracy, wifi/cell triangulation, indoor drift). Connecting
// those raw fixes in time order — as ST_MakeLine / raw route drawing did —
// inflates the day's distance to absurd values (e.g. 74 km "walked" in an hour,
// a 621 km Timeline for someone who moved ~1 km) and draws a crisscross mess on
// the map. This filter drops the noise so distance + route reflect REAL travel.
//
// Used by routes/timeline.js for the daily summary distance and the route
// points endpoint (so both the number AND the drawn line are clean).

const EARTH_R = 6371000

function haversine(aLat, aLng, bLat, bLng) {
  const r = (x) => (x * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLng = r(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Tunables (metres / m-per-second).
const MAX_ACCURACY_M = 50       // fixes worse than this are unreliable — drop them
const STATIONARY_RADIUS_M = 60  // while fixes stay within this of the anchor, the
                                // user is "at one place" and GPS is just jittering:
                                // count NO distance and keep the anchor put. This is
                                // the key defence against jitter oscillating around a
                                // spot (which point-to-point summing turns into km).
const MAX_SPEED_MPS = 42        // ~150 km/h; a jump faster than this vs the anchor is a
                                // GPS teleport glitch — skip that fix entirely.

/**
 * Filter a time-ordered GPS track and compute its real distance.
 *
 * Anchor-based: the "anchor" is the last place we accepted the user as being.
 * Fixes within STATIONARY_RADIUS_M of it are treated as jitter (no distance, no
 * move). Only when a fix lands clearly OUTSIDE that radius (and at a plausible
 * speed) do we count that leg and re-anchor there.
 *
 * @param {Array<{lat:number,lng:number,accuracy?:number,recorded_at?:string|Date}>} points
 * @returns {{ points: Array, distanceMeters: number }}
 */
const WINDOW_MS = 60000 // smoothing window: 1 minute

function median(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function filterTrack(points) {
  // 1) Keep only usable fixes (valid coords + acceptable accuracy + a timestamp).
  const valid = (points || []).filter(
    (p) =>
      p != null &&
      p.lat != null && p.lng != null &&
      !Number.isNaN(Number(p.lat)) && !Number.isNaN(Number(p.lng)) &&
      !(p.accuracy != null && Number(p.accuracy) > MAX_ACCURACY_M) &&
      p.recorded_at != null
  )
  if (valid.length < 2) return { points: valid, distanceMeters: 0 }

  // 2) Bucket into 1-min windows and take the MEDIAN lat/lng of each window.
  // The median is robust to jitter outliers: a phone sitting still produces a
  // cloud of noisy fixes whose median is the true spot, so 30 stationary
  // minutes collapse to ~30 near-identical points instead of a km-long zigzag.
  const buckets = new Map()
  for (const p of valid) {
    const key = Math.floor(new Date(p.recorded_at).getTime() / WINDOW_MS)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(p)
  }
  const smoothed = [...buckets.keys()].sort((a, b) => a - b).map((k) => {
    const g = buckets.get(k)
    const mid = g[Math.floor(g.length / 2)]
    return {
      lat: median(g.map((p) => Number(p.lat))),
      lng: median(g.map((p) => Number(p.lng))),
      recorded_at: mid.recorded_at,
      speed: mid.speed, bearing: mid.bearing, altitude: mid.altitude, accuracy: mid.accuracy,
      recordedAt: mid.recordedAt,
    }
  })

  // 3) Anchor-walk the smoothed points: still-within-radius = same place (no
  // distance); a real move beyond the radius (at a plausible speed) is counted.
  const kept = [smoothed[0]]
  let dist = 0
  let anchor = smoothed[0]
  for (let i = 1; i < smoothed.length; i++) {
    const p = smoothed[i]
    const d = haversine(anchor.lat, anchor.lng, p.lat, p.lng)
    const dt = (new Date(p.recorded_at).getTime() - new Date(anchor.recorded_at).getTime()) / 1000
    if (dt > 0 && d / dt > MAX_SPEED_MPS) continue // teleport glitch
    if (d < STATIONARY_RADIUS_M) continue          // jitter around the same place
    dist += d
    kept.push(p)
    anchor = p
  }

  return { points: kept, distanceMeters: Math.round(dist) }
}

module.exports = { filterTrack, haversine, MAX_ACCURACY_M, STATIONARY_RADIUS_M, MAX_SPEED_MPS }
