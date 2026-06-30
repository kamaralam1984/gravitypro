import { Platform } from 'react-native'
import * as Location from 'expo-location'

const LOCATION_TASK_NAME = 'gravity-background-location'

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

        const point = {
          lat: latitude, lon: longitude,
          altitude, accuracy, speed,
          bearing: heading,
          timestamp: location.timestamp,
        }

        let online = false
        try {
          const res = await fetchWithTimeout(
            `${TRACCAR_ENDPOINT}/?id=${encodeURIComponent(deviceId)}&lat=${latitude}&lon=${longitude}&altitude=${altitude}&speed=${speed}&bearing=${heading}&accuracy=${accuracy}&timestamp=${location.timestamp}`
          )
          if (res.ok) online = true
        } catch {
          // No internet or Traccar down
        }

        // Post location to Gravity API for SSE broadcast
        try {
          const token = await storage.getItem('auth_token')
          if (token) {
            let battery_level = null
            let is_charging = false
            try {
              const Battery = require('expo-battery')
              const lvl = await Battery.getBatteryLevelAsync()
              if (lvl != null && lvl >= 0) battery_level = Math.round(lvl * 100)
              const state = await Battery.getBatteryStateAsync()
              is_charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
            } catch {}
            await fetchWithTimeout(`${API_BASE}/api/v1/users/location`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token,
              },
              body: JSON.stringify({ latitude, longitude, accuracy, battery_level, is_charging }),
            })
          }
        } catch (e) {
          // Ignore — will retry on next update
        }

        // Speed alert: notify parents if child is driving fast (>60 km/h)
        if (speed != null && speed > 16.7) { // 16.7 m/s ≈ 60 km/h
          const speed_kmh = speed * 3.6
          try {
            const token = await storage.getItem('auth_token')
            // Only alert once per 5 minutes to avoid notification spam
            const lastAlertKey = 'last_speed_alert_ts'
            const lastAlert = await storage.getItem(lastAlertKey)
            const now = Date.now()
            if (!lastAlert || now - parseInt(lastAlert) > 5 * 60 * 1000) {
              if (token) {
                await fetchWithTimeout(`${API_BASE}/api/v1/users/speed-alert`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                  body: JSON.stringify({ speed_kmh, latitude, longitude }),
                })
                await storage.setItem(lastAlertKey, String(now))
              }
            }
          } catch {
            // Best-effort — ignore failures
          }
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
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5 * 60 * 1000,
      distanceInterval: 50,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Gravity is active',
        notificationBody: 'Your location is being shared with your family.',
        notificationColor: '#0A5C35',
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
    const level = await Battery.getBatteryLevelAsync()
    if (level == null || level < 0) return
    const battery_level = Math.round(level * 100)
    let is_charging = false
    try {
      const state = await Battery.getBatteryStateAsync()
      is_charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
    } catch {}
    const { userAPI } = require('./api')
    await userAPI.updateBattery({ battery_level, is_charging })
  } catch (e) {
    // best-effort; ignore failures
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
