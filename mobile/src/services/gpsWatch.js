// gpsWatch.js — watches device location-services / permission state and reports
// it to the backend so the family circle gets a GPS-OFF alert when the monitored
// device disables location.
//
// It polls Location.hasServicesEnabledAsync() + the foreground permission status
// on an interval. On a transition to OFF (services disabled OR permission no
// longer granted) it POSTs { gps_enabled: false }; on a transition back to ON it
// POSTs { gps_enabled: true }. Only edges are reported to avoid spamming.
//
// Native-only: expo-location's services/permission APIs are no-ops on web, so we
// short-circuit there. Mirrors the auth/token + API_BASE conventions used by
// services/location.js (storage.getItem('auth_token'), EXPO_PUBLIC_API_URL).

import { Platform } from 'react-native'
import * as Location from 'expo-location'
import { storage } from '../utils/storage'

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'

const POLL_INTERVAL_MS = 30 * 1000 // check every 30s

let pollHandle = null
let lastReported = null // last gps_enabled value we successfully reported (true/false/null)
let inFlight = false

const fetchWithTimeout = (url, opts = {}, ms = 8000) => {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(tid))
}

// True only if OS location services are enabled AND foreground permission is granted.
const isGpsEnabled = async () => {
  try {
    const servicesOn = await Location.hasServicesEnabledAsync()
    if (!servicesOn) return false
    const perm = await Location.getForegroundPermissionsAsync()
    return perm.status === 'granted'
  } catch {
    // If we can't determine, assume enabled to avoid false-positive alerts.
    return true
  }
}

const reportStatus = async (enabled) => {
  const token = await storage.getItem('auth_token')
  if (!token) return false // not logged in — skip
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/v1/device/gps-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ gps_enabled: enabled }),
    })
    return res.ok
  } catch {
    return false
  }
}

const tick = async () => {
  if (inFlight) return
  inFlight = true
  try {
    const enabled = await isGpsEnabled()
    if (enabled !== lastReported) {
      const ok = await reportStatus(enabled)
      if (ok) lastReported = enabled // only commit the edge once the server accepted it
    }
  } catch {
    // swallow — best effort
  } finally {
    inFlight = false
  }
}

/**
 * Start polling GPS/location-services status. Idempotent.
 * Sends an immediate check, then polls every POLL_INTERVAL_MS.
 */
const start = () => {
  if (Platform.OS === 'web') return // expo-location services API is native-only
  if (pollHandle) return // already running
  lastReported = null // force a fresh report on (re)start
  tick() // immediate first check
  pollHandle = setInterval(tick, POLL_INTERVAL_MS)
}

/** Stop polling. */
const stop = () => {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
}

export default { start, stop }
export { start, stop }
