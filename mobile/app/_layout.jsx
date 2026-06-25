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
import { syncOfflineLocations, reportBatteryLevel, startBackgroundTracking, sendHeartbeat } from '../src/services/location'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import gpsWatch from '../src/services/gpsWatch'
import { ensureReliableTracking } from '../src/services/reliability'
import { storage } from '../src/utils/storage'

const queryClient = new QueryClient()

// Root surface — inside ThemeProvider so it can follow the active theme.
function ThemedRoot({ isAuthenticated }) {
  const c = useTheme()
  return (
    <View style={{ flex: 1, backgroundColor: c.bgDeep }}>
      <StatusBar style={c.statusBarStyle} />
      {isAuthenticated ? <MainNavigator /> : <AuthNavigator />}
      <UpdateBanner />
    </View>
  )
}

export default function RootLayout() {
  const [showSplash, setShowSplash] = useState(true)
  const [animDone, setAnimDone] = useState(false)
  const initialize = useAuthStore(s => s.initialize)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const isLoading = useAuthStore(s => s.isLoading)
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

  // Start persistent background location tracking once authenticated.
  // This launches an Android foreground service (and iOS background-location
  // mode) so the device keeps reporting its position to the family even after
  // the app is sent to the background or swiped away from recents.
  useEffect(() => {
    if (!isAuthenticated) return
    startBackgroundTracking().catch(e => console.warn('Background tracking not started', e?.message))
    // Watch for GPS/location-services being turned off → alerts the family.
    try { gpsWatch.start() } catch (e) { console.warn('gpsWatch not started', e?.message) }
    // One-time prompt to whitelist battery optimisation / auto-start (reliability).
    ;(async () => {
      try {
        const done = await storage.getItem('reliability_prompted')
        if (!done) {
          await ensureReliableTracking()
          await storage.setItem('reliability_prompted', '1')
        }
      } catch {}
    })()
    return () => { try { gpsWatch.stop() } catch {} }
  }, [isAuthenticated])

  // Sync offline location queue whenever app comes to foreground
  useEffect(() => {
    if (!isAuthenticated) return
    syncOfflineLocations()
    reportBatteryLevel()
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        syncOfflineLocations()
        reportBatteryLevel()
        sendHeartbeat()
      }
      appState.current = nextState
    })
    return () => sub.remove()
  }, [isAuthenticated])

  // Presence heartbeat — bump "online" every 60s while the app is running, so a
  // child whose phone is ON stays ONLINE to the parent even when stationary
  // (Android throttles/stops background GPS when the device isn't moving).
  useEffect(() => {
    if (!isAuthenticated) return
    sendHeartbeat()
    const id = setInterval(() => { sendHeartbeat() }, 60_000)
    return () => clearInterval(id)
  }, [isAuthenticated])

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
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <NavigationContainer>
              <ThemedRoot isAuthenticated={isAuthenticated} />
            </NavigationContainer>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
