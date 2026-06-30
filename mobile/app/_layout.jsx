import React, { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import * as Updates from 'expo-updates'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../src/store/authStore'
import SplashScreen from '../src/screens/auth/SplashScreen'
import AuthNavigator from '../src/navigation/AuthNavigator'
import MainNavigator from '../src/navigation/MainNavigator'
import UpdateBanner from '../src/components/ui/UpdateBanner'
import { registerForPushNotifications } from '../src/services/notifications'
import { syncOfflineLocations, reportBatteryLevel, startBackgroundTracking, getCurrentLocation } from '../src/services/location'
import { Colors } from '../src/theme/colors'

const queryClient = new QueryClient()

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true)
  const [animDone, setAnimDone] = useState(false)
  const initialize = useAuthStore(s => s.initialize)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const isLoading = useAuthStore(s => s.isLoading)
  const user = useAuthStore(s => s.user)
  const appState = useRef(AppState.currentState)

  useEffect(() => {
    initialize()
  }, [])

  // Over-the-air JS updates — fetch & apply silently on launch (no reinstall needed).
  // No-op in dev / Expo Go (Updates.isEnabled is false there).
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return
    ;(async () => {
      try {
        const res = await Updates.checkForUpdateAsync()
        if (res.isAvailable) {
          await Updates.fetchUpdateAsync()
          await Updates.reloadAsync()
        }
      } catch {
        // offline or no update available — ignore
      }
    })()
  }, [])

  // Register push notifications once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications().catch(e => console.warn('Push registration failed', e))
    }
  }, [isAuthenticated])

  // Start background location tracking for child accounts
  useEffect(() => {
    if (isAuthenticated && user?.role === 'child') {
      startBackgroundTracking().catch(e => console.warn('Background tracking start failed', e))
    }
  }, [isAuthenticated, user?.role])

  // Sync offline location queue whenever app comes to foreground; also check for OTA updates
  useEffect(() => {
    if (!isAuthenticated) return
    syncOfflineLocations()
    reportBatteryLevel()
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        syncOfflineLocations()
        reportBatteryLevel()
        // Re-check for OTA updates each time app foregrounds — apply if available
        if (!__DEV__ && Updates.isEnabled) {
          Updates.checkForUpdateAsync().then(res => {
            if (res.isAvailable) {
              Updates.fetchUpdateAsync().then(() => Updates.reloadAsync()).catch(() => {})
            }
          }).catch(() => {})
        }
      }
      appState.current = nextState
    })
    return () => sub.remove()
  }, [isAuthenticated])

  // Foreground heartbeat for child accounts — post location every 5 min while app is open
  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'child') return
    const postForegroundLocation = async () => {
      try {
        const pos = await getCurrentLocation()
        const { latitude, longitude, accuracy } = pos.coords
        const { storage } = await import('../src/utils/storage')
        const token = await storage.getItem('auth_token')
        if (!token) return
        const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'
        let battery_level = null
        let is_charging = false
        try {
          const Battery = await import('expo-battery')
          const lvl = await Battery.getBatteryLevelAsync()
          if (lvl != null && lvl >= 0) battery_level = Math.round(lvl * 100)
          const state = await Battery.getBatteryStateAsync()
          is_charging = state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL
        } catch {}
        await fetch(`${API_BASE}/api/v1/users/location`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ latitude, longitude, accuracy, battery_level, is_charging }),
        })
      } catch {
        // ignore — background task handles offline case
      }
    }
    postForegroundLocation()
    const interval = setInterval(postForegroundLocation, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isAuthenticated, user?.role])

  // Hide splash once animation is done AND auth init is done
  useEffect(() => {
    if (animDone && !isLoading) {
      setShowSplash(false)
    }
  }, [animDone, isLoading])

  if (showSplash) {
    return <SplashScreen onComplete={() => setAnimDone(true)} />
  }

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationContainer>
            <View style={{ flex: 1, backgroundColor: Colors.bgDeep }}>
              <StatusBar style="light" />
              {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
              <UpdateBanner />
            </View>
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  )
}
