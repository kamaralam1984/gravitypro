import React, { useEffect, useMemo, useRef, useState } from 'react'
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

  // A VALUE-based key, not the `user` object reference — updateUser() always
  // creates a new object even when the fetched data is byte-for-byte
  // identical (the background refresh above runs on every mount). Using the
  // object itself as an effect dependency re-ran this effect on every such
  // refresh and produced a new `inject`/`uri`, which made react-native-webview
  // treat the WebView as having a brand-new source and silently reload it —
  // including mid-navigation, after the user had already clicked into
  // Timeline/Smart Places (client-side SPA routes, no full page reload),
  // producing a blank screen. A string is compared by VALUE in a dependency
  // array, so this only changes when the underlying data actually does.
  const userKey = user ? JSON.stringify(user) : null

  useEffect(() => {
    if (userKey === null) return
    const resolvedPath = path || (accountType === 'child' ? '/child/panel' : '/parent/panel')
    // Seed the web app's auth so the panel is already logged in (SSO). Both
    // the routing decision above and this injected snapshot now read from the
    // SAME live store value — no second, independently-stale source.
    const js = `(function(){try{
      ${token ? `localStorage.setItem('gravity_token', ${JSON.stringify(token)});` : ''}
      localStorage.setItem('gravity_user', ${JSON.stringify(userKey)});
    }catch(e){}})(); true;`
    setInject(js)
    setUri(BASE + resolvedPath)
  }, [path, accountType, token, userKey])

  const retry = () => { setError(false); setLoading(true); setReloadKey(k => k + 1) }

  // A background /users/me refresh (see effect above) creates a NEW `user`
  // object reference even when the data is unchanged, which re-runs the
  // effect below and can produce a new `inject`/`uri` value. Passing a fresh
  // object literal as WebView's `source` prop on every such render makes
  // react-native-webview treat it as a brand-new source and silently reload
  // the WebView — including mid-navigation, after the user has already
  // clicked into Timeline/Smart Places (client-side SPA routes with no full
  // page reload), producing a blank screen. Memoizing on the `uri` STRING
  // (not a fresh object) means WebView only sees a new source when the URL
  // actually changes.
  const source = useMemo(() => (uri ? { uri } : undefined), [uri])

  if (!uri || inject === null) {
    return <View style={styles.center}><ActivityIndicator size="large" color={Colors.accent} /></View>
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <WebView
        key={reloadKey}
        ref={webRef}
        source={source}
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
