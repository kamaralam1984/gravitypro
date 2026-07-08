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
    return fast
      ? { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 50 }
      : { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 12 }
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
