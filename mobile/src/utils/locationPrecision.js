// Real (non-cosmetic) location-precision preference — see backend
// migrations/028_location_precision.sql. Drives the GPS accuracy/interval
// used by both independent watch setups: the background tracking task
// (services/location.js) and the live map's own-location marker
// (screens/MapScreen.jsx).
import * as Location from 'expo-location'

export const PRECISION = { PRECISE: 'precise', FAST: 'fast' }
export const DEFAULT_PRECISION = PRECISION.PRECISE

// context: 'background' (services/location.js task) or 'foreground' (MapScreen watch).
// 'precise' matches today's existing hardcoded values exactly — zero behavior
// change for anyone until they explicitly opt into 'fast'.
export function getWatchOptions(precision, context) {
  const fast = precision === PRECISION.FAST
  if (context === 'background') {
    // distanceInterval MUST be 0 for background tracking. A non-zero value makes
    // Android FusedLocation fire ONLY on movement, so a stationary phone (esp.
    // after the app is force-killed, when the 60s JS heartbeat is dead) never
    // reports and the parent sees the child go OFFLINE within the 20-min window.
    // distanceInterval:0 + a time interval means the still-alive foreground
    // service delivers a "still here" fix every timeInterval regardless of
    // movement, keeping the child online AND feeding the Timeline/route even
    // when the app is closed. timeInterval is the freshness/battery tradeoff:
    // ~20s (precise) gives a smooth road-snappable track; ~45s (fast) is lighter.
    return fast
      ? { accuracy: Location.Accuracy.Balanced, timeInterval: 45000, distanceInterval: 0 }
      : { accuracy: Location.Accuracy.High, timeInterval: 20000, distanceInterval: 0 }
  }
  return fast
    ? { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 40 }
    : { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 }
}

// The background task can run in a fresh JS engine instance after the app
// was killed (Zustand store not hydrated) — read straight from persisted
// storage, same as services/location.js already does for user_phone.
export async function getStoredPrecision() {
  try {
    const { storage } = require('./storage')
    const raw = await storage.getItem('user_data')
    const user = raw ? JSON.parse(raw) : null
    return user?.location_precision === PRECISION.FAST ? PRECISION.FAST : DEFAULT_PRECISION
  } catch {
    return DEFAULT_PRECISION
  }
}
