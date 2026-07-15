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
const MAX_SPEED_MPS = 42        // ~150 km/h; a jump faster than this vs the anchor is a
                                // GPS teleport glitch — skip that fix entirely.

// The stationary radius — the distance a fix must clear before we call it a real
// move rather than jitter — scales with how good the fix actually is, because a
// fixed 60 m served neither end of the range well: it under-counted slow/short
// travel on good fixes (a 300 m stroll measured 240 m, -20%), and let ~±80 m
// drift on poor fixes register as real travel (a still phone "walked" 428 m in
// 30 min). Jitter is roughly proportional to the reported accuracy, so gate on
// that: radius = 2 x the worse of the two fixes' accuracy, clamped.
//   <=20 m accuracy -> 40 m radius (that 300 m stroll now measures 280 m)
//     30 m accuracy -> 60 m radius (unchanged from the old fixed value)
//     50 m accuracy -> 100 m radius (drift stays jitter: 428 m -> 0 m)
//
// The floor is 40 rather than 25 because a device claiming 15 m while drifting
// ±30 m — mild under-reporting, and common — leaks ~67 m/half-hour at 25 m but
// nothing at 40 m. It costs the stroll case only ~16 m. A device that badly
// under-reports (claims 20 m while drifting ±80 m) still defeats this, and
// scores worse than the old fixed 60 m would; catching that needs an empirical
// noise estimate rather than the device's own claim.
const MIN_STATIONARY_RADIUS_M = 40
const MAX_STATIONARY_RADIUS_M = 100  // = 2 x MAX_ACCURACY_M, the worst fix we keep
const ACCURACY_MULTIPLIER = 2

// A fix with no accuracy at all (Traccar hardware, older clients, /ping without
// the param) previously sailed through every accuracy gate as if it were
// perfect. Treat it as this instead — chosen so its radius lands on 60 m, i.e.
// exactly the old behaviour for devices that never report accuracy.
const ASSUMED_ACCURACY_M = 30

// Real reported accuracy, or null. Never invents a number — used for OUTPUT, so
// the Timeline keeps showing "—" rather than a fabricated "±30m".
const reportedAccuracy = (p) => {
  const a = Number(p?.accuracy)
  return p?.accuracy != null && Number.isFinite(a) ? a : null
}

// Accuracy for DECISIONS: falls back to the assumption when unreported.
const accuracyOf = (p) => reportedAccuracy(p) ?? ASSUMED_ACCURACY_M

// Jitter gate between two fixes — driven by whichever is the worse of the pair.
function stationaryRadiusFor(a, b) {
  const worst = Math.max(accuracyOf(a), accuracyOf(b))
  return Math.min(
    MAX_STATIONARY_RADIUS_M,
    Math.max(MIN_STATIONARY_RADIUS_M, ACCURACY_MULTIPLIER * worst)
  )
}

/**
 * Filter a time-ordered GPS track and compute its real distance.
 *
 * Anchor-based: the "anchor" is the last place we accepted the user as being.
 * Fixes within the stationary radius of it are treated as jitter (no distance,
 * no move). Only when a fix lands clearly OUTSIDE that radius (and at a
 * plausible speed) do we count that leg and re-anchor there. The radius is
 * per-leg and scales with fix accuracy — see stationaryRadiusFor().
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
  // An unreported accuracy is kept (dropping it would zero out the distance of
  // every device that never sends one); it is held to ASSUMED_ACCURACY_M later.
  // A malformed one ('abc', Infinity) is dropped — it used to slip through the
  // `> MAX_ACCURACY_M` comparison, which is false for NaN.
  const valid = (points || []).filter((p) => {
    if (p == null || p.lat == null || p.lng == null || p.recorded_at == null) return false
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return false
    if (p.accuracy == null) return true
    const acc = Number(p.accuracy)
    return Number.isFinite(acc) && acc <= MAX_ACCURACY_M
  })
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
    // Median the accuracy too, for the same reason we median lat/lng: one wild
    // fix in the window shouldn't set the jitter gate for the whole minute.
    // Stays null when nobody in the window reported one.
    const accs = g.map(reportedAccuracy).filter((a) => a != null)
    return {
      lat: median(g.map((p) => Number(p.lat))),
      lng: median(g.map((p) => Number(p.lng))),
      recorded_at: mid.recorded_at,
      speed: mid.speed, bearing: mid.bearing, altitude: mid.altitude,
      accuracy: accs.length ? median(accs) : null,
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
    if (dt > 0 && d / dt > MAX_SPEED_MPS) continue      // teleport glitch
    if (d < stationaryRadiusFor(anchor, p)) continue    // jitter around the same place
    dist += d
    kept.push(p)
    anchor = p
  }

  return { points: kept, distanceMeters: Math.round(dist) }
}

module.exports = {
  filterTrack,
  haversine,
  stationaryRadiusFor,
  MAX_ACCURACY_M,
  MAX_SPEED_MPS,
  MIN_STATIONARY_RADIUS_M,
  MAX_STATIONARY_RADIUS_M,
  ASSUMED_ACCURACY_M,
}
