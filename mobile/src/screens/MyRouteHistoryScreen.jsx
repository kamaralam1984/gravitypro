import React, { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { storage } from '../utils/storage'
import { useAuthStore } from '../store/authStore'
import { Colors } from '../theme/colors'

const BASE = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'

/**
 * MyRouteHistoryScreen — Travel Route History (polyline, start/end/current
 * markers, distance, travel time, Route Replay, zoom-to-route).
 *
 * Rather than rebuilding this natively, it embeds the existing web Travel
 * Timeline page (landing-react `Timeline.tsx`) in a WebView — same SSO
 * pattern as WebPanelScreen.jsx — reusing the map/polyline/replay work
 * already built there instead of duplicating it for mobile.
 *
 * Two entry points:
 *  - Self view (no route param): a user opens their own route history.
 *  - Parent view (route.params.member passed, e.g. from ChildTimelineScreen):
 *    a parent opens a specific child's route history.
 *
 * A child account can only ever see its own id here regardless of any
 * passed param — that lock is enforced below AND server-side
 * (routes/timeline.js canView), so this is defense in depth, not the only
 * guard.
 */
export default function MyRouteHistoryScreen({ route }) {
  const insets = useSafeAreaInsets()
  const user = useAuthStore(s => s.user)
  const isChildAccount = user?.account_type === 'child'
  const requestedMember = route?.params?.member
  const targetId = !isChildAccount && requestedMember?.id ? requestedMember.id : user?.id
  const webRef = useRef(null)
  const [inject, setInject] = useState(null)
  const [uri, setUri] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const token = await storage.getItem('auth_token')
      const userRaw = await storage.getItem('user_data')
      const js = `(function(){try{
        ${token ? `localStorage.setItem('gravity_token', ${JSON.stringify(token)});` : ''}
        ${userRaw ? `localStorage.setItem('gravity_user', ${JSON.stringify(userRaw)});` : ''}
      }catch(e){}})(); true;`
      if (!alive || !targetId) return
      setInject(js)
      setUri(`${BASE}/parent/timeline?userId=${encodeURIComponent(targetId)}`)
    })()
    return () => { alive = false }
  }, [targetId, reloadKey])

  const retry = () => { setError(false); setLoading(true); setReloadKey(k => k + 1) }

  if (!uri || inject === null) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <WebView
        key={reloadKey}
        ref={webRef}
        source={{ uri }}
        injectedJavaScriptBeforeContentLoaded={inject}
        onLoadStart={() => { setLoading(true); setError(false) }}
        onLoadEnd={() => setLoading(false)}
        onError={() => { setError(true); setLoading(false) }}
        domStorageEnabled
        javaScriptEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        allowsBackForwardNavigationGestures
        startInLoadingState
        style={styles.web}
      />
      {loading && !error && (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      )}
      {error && (
        <View style={styles.overlay}>
          <Text style={styles.errText}>Couldn't load your route history.{'\n'}Check your connection.</Text>
          <TouchableOpacity style={styles.retry} onPress={retry}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  web: { flex: 1, backgroundColor: Colors.bgDeep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgDeep },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgDeep,
  },
  errText: { color: Colors.textMuted, textAlign: 'center', fontSize: 14, marginBottom: 16, lineHeight: 20 },
  retry: { backgroundColor: Colors.accent, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10 },
  retryText: { color: '#071a0f', fontWeight: '700', fontSize: 14 },
})
