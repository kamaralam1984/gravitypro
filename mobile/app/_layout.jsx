import React, { useEffect, useRef, useState } from 'react'
import { AppState, View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { NavigationContainer } from '@react-navigation/native'
import { StatusBar } from 'expo-status-bar'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../src/store/authStore'
import SplashScreen from '../src/screens/auth/SplashScreen'
import AuthNavigator from '../src/navigation/AuthNavigator'
import TabNavigator from '../src/navigation/TabNavigator'
import { registerForPushNotifications } from '../src/services/notifications'
import { syncOfflineLocations } from '../src/services/location'
import { Colors } from '../src/theme/colors'

const queryClient = new QueryClient()

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

  // Register push notifications once authenticated
  useEffect(() => {
    if (isAuthenticated) {
      registerForPushNotifications().catch(e => console.warn('Push registration failed', e))
    }
  }, [isAuthenticated])

  // Sync offline location queue whenever app comes to foreground
  useEffect(() => {
    if (!isAuthenticated) return
    // Sync immediately on mount (covers cold-start after offline period)
    syncOfflineLocations()
    const sub = AppState.addEventListener('change', nextState => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        syncOfflineLocations()
      }
      appState.current = nextState
    })
    return () => sub.remove()
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
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <NavigationContainer>
            <View style={{ flex: 1, backgroundColor: Colors.bgDeep }}>
              <StatusBar style="light" />
              {isAuthenticated ? <TabNavigator /> : <AuthNavigator />}
            </View>
          </NavigationContainer>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  )
}
