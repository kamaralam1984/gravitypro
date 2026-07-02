const { haversineMeters } = require('../utils/geo')

const MS_TO_KMH = 3.6

// Tunable thresholds (km/h). Car and motorbike are not distinguishable from
// speed alone — both fall under 'vehicle' — this is a documented limitation,
// not an oversight (see final report).
const MODES = [
  { key: 'stationary', icon: '⏸️', maxKmh: 1 },
  { key: 'walking', icon: '🚶', maxKmh: 7 },
  { key: 'cycling', icon: '🚲', maxKmh: 25 },
  { key: 'vehicle', icon: '🚗', maxKmh: 120 },
  { key: 'highspeed', icon: '🚄', maxKmh: Infinity },
]

const modeForSpeed = (kmh) => MODES.find((m) => kmh <= m.maxKmh)?.key || 'highspeed'

// Instantaneous speed between two consecutive points, in km/h. Prefers the
// device-reported GPS speed (m/s) when available; falls back to distance/time.
const intervalSpeedKmh = (a, b) => {
  if (b.speed != null && b.speed >= 0) return b.speed * MS_TO_KMH
  const dtSec = (b.ts - a.ts) / 1000
  if (dtSec <= 0) return 0
  const distM = haversineMeters(a.lat, a.lng, b.lat, b.lng)
  return (distM / dtSec) * MS_TO_KMH
}

const SMOOTHING_WINDOW = 5

// Majority-vote smoothing over a sliding window so a single noisy GPS jump
// doesn't flip the classified mode for one interval and back.
const smoothModes = (rawModes) => {
  const smoothed = []
  for (let i = 0; i < rawModes.length; i++) {
    const start = Math.max(0, i - Math.floor(SMOOTHING_WINDOW / 2))
    const end = Math.min(rawModes.length, start + SMOOTHING_WINDOW)
    const counts = {}
    for (let j = start; j < end; j++) counts[rawModes[j]] = (counts[rawModes[j]] || 0) + 1
    let best = rawModes[i]
    let bestCount = -1
    for (const [mode, count] of Object.entries(counts)) {
      if (count > bestCount) { best = mode; bestCount = count }
    }
    smoothed.push(best)
  }
  return smoothed
}

/**
 * Classifies a sequence of ordered points ({lat,lng,ts,speed}) into
 * contiguous same-mode segments. Used to color-code the route polyline and
 * to compute avg/max speed + travel time for the Daily Summary.
 */
const classifyRoute = (points) => {
  if (!points || points.length < 2) return []

  const intervalKmh = []
  const rawModes = []
  for (let i = 1; i < points.length; i++) {
    const kmh = intervalSpeedKmh(points[i - 1], points[i])
    intervalKmh.push(kmh)
    rawModes.push(modeForSpeed(kmh))
  }
  const modes = smoothModes(rawModes)

  const segments = []
  let segStart = 0
  for (let i = 1; i <= modes.length; i++) {
    const isBoundary = i === modes.length || modes[i] !== modes[segStart]
    if (!isBoundary) continue

    const fromPoint = points[segStart]
    const toPoint = points[i]
    let distanceMeters = 0
    let maxKmh = 0
    for (let j = segStart; j < i; j++) {
      distanceMeters += haversineMeters(points[j].lat, points[j].lng, points[j + 1].lat, points[j + 1].lng)
      if (intervalKmh[j] > maxKmh) maxKmh = intervalKmh[j]
    }
    const durationSec = Math.max(0, Math.round((toPoint.ts - fromPoint.ts) / 1000))
    const avgKmh = durationSec > 0 ? (distanceMeters / durationSec) * 3.6 : 0

    segments.push({
      mode: modes[segStart],
      fromIdx: segStart,
      toIdx: i,
      startedAt: new Date(fromPoint.ts).toISOString(),
      endedAt: new Date(toPoint.ts).toISOString(),
      avgSpeedKmh: Math.round(avgKmh * 10) / 10,
      maxSpeedKmh: Math.round(maxKmh * 10) / 10,
      durationSec,
      distanceMeters: Math.round(distanceMeters),
    })
    segStart = i
  }

  return segments
}

module.exports = { classifyRoute, modeForSpeed, MODES }
