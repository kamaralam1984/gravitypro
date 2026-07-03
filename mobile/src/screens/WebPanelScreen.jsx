import React, { useEffect, useRef, useState } from 'react'
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native'
import { WebView } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthStore } from '../store/authStore'
import { userAPI } from '../services/api'
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
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)
  const updateUser = useAuthStore(s => s.updateUser)
  // Read live from the reactive store (not a one-time AsyncStorage snapshot)
  // so this screen re-resolves parent-vs-child immediately if account_type
  // changes while it's already mounted (e.g. a child joins a circle on
  // another tab — see CirclesScreen.jsx handleJoinCircle) instead of staying
  // stuck on whichever panel was cached at the time this screen first mounted.
  const accountType = user?.account_type

  // The cached user (from login, or a previous session) can be stale if
  // account_type changed server-side since — and this screen's whole job is
  // routing on that value. Re-fetch it fresh every time this screen opens
  // instead of trusting a possibly-stale snapshot until the user separately
  // happens to open the Profile tab.
  useEffect(() => {
    userAPI.getMe().then((res) => { if (res?.user) updateUser(res.user) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])

  useEffect(() => {
    if (!user) return
    const resolvedPath = path || (accountType === 'child' ? '/child/panel' : '/parent/panel')
    // Seed the web app's auth so the panel is already logged in (SSO). Both
    // the routing decision above and this injected snapshot now read from the
    // SAME live store value — no second, independently-stale source.
    const js = `(function(){try{
      ${token ? `localStorage.setItem('gravity_token', ${JSON.stringify(token)});` : ''}
      localStorage.setItem('gravity_user', ${JSON.stringify(JSON.stringify(user))});
    }catch(e){}})(); true;`
    setInject(js)
    setUri(BASE + resolvedPath)
  }, [path, accountType, token, user])

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
