import React, { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { storage } from '../utils/storage'
import { Colors } from '../theme/colors'

const BASE = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'

/**
 * WebPanelScreen — embeds the LIVE web dashboard (parent/child panel) in a WebView.
 * Because it loads the website directly, any change shipped to the web auto-appears
 * here with NO app reinstall. Single sign-on: we seed the web app's localStorage
 * (gravity_token / gravity_user) from the native session before the page loads.
 *
 * Pass `path` to force a panel, otherwise it auto-selects by the user's account_type.
 */
export default function WebPanelScreen({ path }) {
  const insets = useSafeAreaInsets()
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
      let resolvedPath = path
      if (!resolvedPath) {
        let isChild = false
        try {
          const u = JSON.parse(userRaw || '{}')
          isChild = u.account_type === 'child' || u.role === 'child'
        } catch {}
        resolvedPath = isChild ? '/child/panel' : '/parent/panel'
      }
      // Seed the web app's auth so the panel is already logged in (SSO).
      const js = `(function(){try{
        ${token ? `localStorage.setItem('gravity_token', ${JSON.stringify(token)});` : ''}
        ${userRaw ? `localStorage.setItem('gravity_user', ${JSON.stringify(userRaw)});` : ''}
      }catch(e){}})(); true;`
      if (!alive) return
      setInject(js)
      setUri(BASE + resolvedPath)
    })()
    return () => { alive = false }
  }, [path, reloadKey])

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
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        geolocationEnabled
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
          <Text style={styles.errText}>Couldn't load the dashboard.{'\n'}Check your connection.</Text>
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
