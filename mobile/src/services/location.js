import { Platform } from 'react-native'
import * as Location from 'expo-location'

const LOCATION_TASK_NAME = 'gravity-background-location'
const TRACCAR_ENDPOINT = 'https://gravity.trackalways.com/telemetry'

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
      useSignificantChanges: true,
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      deferredUpdatesInterval: 60000,
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
        pos => resolve({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude, altitude: 0, accuracy: pos.coords.accuracy, speed: 0, heading: 0 } }),
        err => reject(err),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    })
  }
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') throw new Error('Location permission denied')
  return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
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
