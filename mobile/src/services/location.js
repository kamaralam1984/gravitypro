import { Platform } from 'react-native'
import * as Location from 'expo-location'

const LOCATION_TASK_NAME = 'gravity-background-location'

// ── Transport-mode detection (derived from GPS speed in metres/second) ─────────
// Thresholds are deliberately conservative so a stationary/walking member is not
// mislabelled as a vehicle on noisy GPS. speed may be null/-1 (unknown) on Android.
export const speedToMode = (speedMps) => {
  const s = typeof speedMps === 'number' && speedMps >= 0 ? speedMps : null
  if (s == null) return { key: 'unknown', label: 'Unknown', icon: 'help-circle-outline' }
  if (s < 0.5) return { key: 'still', label: 'Still', icon: 'pause-circle-outline' }
  if (s < 2.2) return { key: 'walking', label: 'Walking', icon: 'walk-outline' }
  if (s < 7) return { key: 'cycling', label: 'Cycling', icon: 'bicycle-outline' }
  return { key: 'vehicle', label: 'Driving', icon: 'car-outline' }
}

const getBatteryLevel = async () => {
  try {
    const Battery = require('expo-battery')
    const level = await Battery.getBatteryLevelAsync()
    return level >= 0 ? Math.round(level * 100) : null
  } catch {
    return null
  }
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'
const TRACCAR_ENDPOINT = `${API_BASE}/telemetry`

const fetchWithTimeout = (url, opts = {}, ms = 8000) => {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(tid))
}

// TaskManager & background tracking only on native
if (Platform.OS !== 'web') {
  const TaskManager = require('expo-task-manager')
  TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
    if (error) { console.error('Location task error:', error); return }
    if (!data) return
    const { locations } = data
    for (const location of locations) {
      try {
        const { latitude, longitude, altitude, accuracy, speed, heading } = location.coords
        const { storage } = require('../utils/storage')
        const deviceId = await storage.getItem('user_phone')
        if (!deviceId) continue

        const mode = speedToMode(speed).key

        const point = {
          lat: latitude, lon: longitude,
          altitude, accuracy, speed,
          mode,
          bearing: heading,
          timestamp: location.timestamp,
        }

        // Best-effort Traccar hardware telemetry (optional; NEVER drives online
        // state). Null/unknown params are omitted so Traccar doesn't reject the
        // request (Android reports speed/heading as null or -1 when unknown).
        try {
          const params = [
            `id=${encodeURIComponent(deviceId)}`,
            `lat=${latitude}`, `lon=${longitude}`,
            `timestamp=${location.timestamp}`,
          ]
          if (accuracy != null) params.push(`accuracy=${accuracy}`)
          if (speed != null && speed >= 0) params.push(`speed=${speed}`)
          if (heading != null && heading >= 0) params.push(`bearing=${heading}`)
          if (altitude != null) params.push(`altitude=${altitude}`)
          await fetchWithTimeout(`${TRACCAR_ENDPOINT}/?${params.join('&')}`)
        } catch {
          // Traccar optional/down — ignore
        }

        // Post location to Gravity API. THIS result (not Traccar) decides whether
        // we're online: if it succeeds we flush the offline queue, otherwise we
        // queue this point for later.
        let online = false
        try {
          const token = await storage.getItem('auth_token')
          if (token) {
            const battery_level = await getBatteryLevel()
            const res = await fetchWithTimeout(`${API_BASE}/api/v1/users/location`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
              },
              body: JSON.stringify({ latitude, longitude, accuracy, battery_level, speed, mode }),
            })
            if (res.ok) online = true
          }
        } catch (e) {
          // network down — will queue below
        }

        if (online) {
          // Back online — flush any queued offline locations
          try {
            const { flushOfflineQueue } = require('./offlineQueue')
            const token = await storage.getItem('auth_token')
            if (token) await flushOfflineQueue(token)
          } catch (e) {
            console.error('[Location] flush failed:', e.message)
          }
        } else {
          // Offline — save to local queue for later sync
          try {
            const { queueLocation } = require('./offlineQueue')
            await queueLocation(point)
          } catch (e) {
            console.error('[Location] queue failed:', e.message)
          }
        }
      } catch (e) {
        console.error('Location update failed:', e.message)
      }
    }
  })
}

export const startBackgroundTracking = async () => {
  if (Platform.OS === 'web') return
  const { status } = await Location.requestBackgroundPermissionsAsync()
  if (status !== 'granted') throw new Error('Background location permission denied')
  const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false)
  if (!isRegistered) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      // Live tracking while MOVING, but no GPS churn when stationary (the 60s
      // presence heartbeat keeps a still device "online", so we don't need a fix
      // every few seconds when it isn't moving — that was a major battery drain).
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,        // at most one fix per ~5s
      distanceInterval: 12,      // only when moved ≥12m → near-zero drain when still
      deferredUpdatesInterval: 0, // do not batch — deliver each fix immediately
      pausesUpdatesAutomatically: false, // iOS: never auto-pause when stationary
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Gravity is active',
        notificationBody: 'Sharing your live location with your family.',
        notificationColor: '#0A5C35',
        // Keep the location foreground-service ALIVE even after the user swipes
        // the app away from recents / closes it. As long as the phone is ON,
        // location keeps flowing so the child shows ONLINE to the parent.
        killServiceOnDestroy: false,
      },
    })
  }
}

export const stopBackgroundTracking = async () => {
  if (Platform.OS === 'web') return
  const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false)
  if (isRegistered) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME)
}

export const getCurrentLocation = async () => {
  if (Platform.OS === 'web') {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            altitude: 0,
            accuracy: pos.coords.accuracy,
            speed: 0,
            heading: 0,
          },
        }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })
  }
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') throw new Error('Location permission denied')
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
}

// Report the device battery level to the backend (PATCH /users/location).
// Uses expo-battery if available; safe no-op otherwise (no hard native dependency).
export const reportBatteryLevel = async () => {
  if (Platform.OS === 'web') return
  try {
    let Battery
    try { Battery = require('expo-battery') } catch { return }
    if (!Battery?.getBatteryLevelAsync) return
    const level = await Battery.getBatteryLevelAsync() // 0..1, -1 if unknown
    if (level == null || level < 0) return
    const battery_level = Math.round(level * 100)
    const { userAPI } = require('./api')
    await userAPI.updateBattery({ battery_level })
  } catch (e) {
    // best-effort; ignore failures
  }
}

// Presence heartbeat — keeps the device ONLINE to the family even when it is
// stationary and Android stops delivering background GPS fixes. Best-effort.
export const sendHeartbeat = async () => {
  if (Platform.OS === 'web') return
  try {
    const { userAPI } = require('./api')
    await userAPI.heartbeat()
  } catch (e) {
    // best-effort; ignore (offline, etc.)
  }
}

// Manually trigger a queue flush (call on app foreground / login)
export const syncOfflineLocations = async () => {
  if (Platform.OS === 'web') return 0
  try {
    const { flushOfflineQueue } = require('./offlineQueue')
    const { storage } = require('../utils/storage')
    const token = await storage.getItem('auth_token')
    if (!token) return 0
    return await flushOfflineQueue(token)
  } catch (e) {
    console.error('[Location] syncOfflineLocations failed:', e.message)
    return 0
  }
}
