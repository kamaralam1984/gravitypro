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
// TEMPORARY diagnostic — the Timeline/Smart Places blank-screen bug has
// survived three separate fixes (source/inject prop stability, removing
// pullToRefreshEnabled) targeting a "WebView silently reloads" theory that
// hasn't been directly confirmed on a real device. This overlay makes the
// WebView's actual load/navigation events visible on-screen (no DevTools
// needed) so the next report can include real evidence instead of another
// guess. Remove once the real cause is found and fixed.
const DEBUG_OVERLAY = false

export default function WebPanelScreen({ path, route }) {
  const insets = useSafeAreaInsets()
  const webRef = useRef(null)
  const [inject, setInject] = useState(null)
  const [uri, setUri] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [debugLog, setDebugLog] = useState([])
  const logEvent = (label) => {
    if (!DEBUG_OVERLAY) return
    const time = new Date().toLocaleTimeString()
    setDebugLog((prev) => [...prev.slice(-4), `${time} ${label}`])
  }
  // Watchdog: the live panel's <head> pulls Leaflet + markercluster from unpkg
  // via BLOCKING <script src> tags. react-native-webview only fires onLoadEnd
  // on full onPageFinished — i.e. after those CDN scripts resolve. If the CDN
  // is slow/unreachable, onPageFinished never fires and the opaque loading
  // overlay hides the (already-rendered) SPA forever — an eternal spinner.
  // So we ALSO reveal the WebView on load progress and on a hard timeout, and
  // never let the overlay outlive that timeout.
  const watchdogRef = useRef(null)
  // Once the panel has painted even once, the SPA owns all further navigation
  // (Timeline / Smart Places are CLIENT-SIDE routes — no full page reload). Its
  // own in-page loading UI takes over, so we must NEVER cover it again with the
  // opaque full-screen overlay: doing so is exactly the "Timeline/Smart Places
  // goes blank" symptom (the content is still there, hidden behind our spinner).
  const revealedRef = useRef(false)
  // `revealed` is STATE (not just the ref) so the overlay's render is gated on
  // it reactively: once the panel has painted once, the full-screen overlay can
  // NEVER be shown again — no matter what a later load/nav event does with
  // `loading`. This is what keeps Timeline / Smart Places (client-side routes)
  // from being hidden behind a spinner that never clears.
  const [revealed, setRevealed] = useState(false)
  const clearWatchdog = () => { if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null } }
  const reveal = () => { revealedRef.current = true; setRevealed(true); setLoading(false); clearWatchdog() }
  const armWatchdog = () => {
    clearWatchdog()
    watchdogRef.current = setTimeout(() => { logEvent('watchdog fired -> revealing WebView'); reveal() }, 6000)
  }
  useEffect(() => () => clearWatchdog(), [])

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
    // A direct `path` prop wins (unused today — Panel tab mounts with none),
    // then a path passed via navigation params (e.g. navigation.navigate('Panel',
    // { path: '/child/panel?preview=1' }) from ProfileScreen's "View Child
    // Panel"), then the normal account_type auto-select.
    const resolvedPath = path || route?.params?.path || (accountType === 'child' ? '/child/panel' : '/parent/panel')
    // Seed the web app's auth so the panel is already logged in (SSO). Both
    // the routing decision above and this injected snapshot now read from the
    // SAME live store value — no second, independently-stale source.
    const js = `(function(){try{
      ${token ? `localStorage.setItem('gravity_token', ${JSON.stringify(token)});` : ''}
      localStorage.setItem('gravity_user', ${JSON.stringify(userKey)});
    }catch(e){}})(); true;`
    logEvent(`uri/inject effect ran -> ${resolvedPath}`)
    setInject(js)
    setUri(BASE + resolvedPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, route?.params?.path, accountType, token, userKey])

  const retry = () => { setError(false); setLoading(true); setReloadKey(k => k + 1) }

  // Android can kill the WebView's render process under memory pressure
  // (heavy pages — Leaflet map + marker clustering + polylines, exactly what
  // Timeline/Smart Places render — are the most likely to trigger this on
  // lower-RAM devices). Without handling this, the WebView is left showing
  // whatever was on screen when the process died — typically blank white —
  // forever, with no error event firing (onError does NOT cover this case).
  // Recommended react-native-webview recovery: reload once automatically.
  const onRenderProcessGone = () => {
    logEvent('RENDER PROCESS GONE -> auto-reloading')
    webRef.current?.reload()
  }

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
        onLoadStart={(e) => {
          logEvent(`onLoadStart ${e?.nativeEvent?.url?.slice(-40) || ''}`)
          setError(false)
          // Only ever show the full-screen overlay for the FIRST paint. After
          // that the SPA's own loading UI handles client-side route changes.
          if (!revealedRef.current) { setLoading(true); armWatchdog() }
        }}
        onLoadProgress={(e) => {
          // Reveal the WebView as soon as the document is mostly parsed — the
          // SPA renders its own login/dashboard well before the blocking unpkg
          // <head> scripts (and thus onLoadEnd) resolve.
          if ((e?.nativeEvent?.progress ?? 0) >= 0.6) reveal()
        }}
        onLoadEnd={(e) => { logEvent(`onLoadEnd ${e?.nativeEvent?.url?.slice(-40) || ''}`); reveal() }}
        onNavigationStateChange={(nav) => { logEvent(`nav -> ${(nav?.url || '').slice(-40)} (loading:${nav?.loading})`); if (nav && nav.loading === false) reveal() }}
        onError={(e) => { logEvent(`onError ${e?.nativeEvent?.description || ''}`); setError(true); setLoading(false); clearWatchdog() }}
        onContentProcessDidTerminate={() => { logEvent('CONTENT PROCESS TERMINATED (iOS crash) -> reloading'); webRef.current?.reload() }}
        onRenderProcessGone={onRenderProcessGone}
        domStorageEnabled
        javaScriptEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        originWhitelist={['*']}
        // Removed pullToRefreshEnabled: on Android it forces a native
        // webView.reload() on a downward swipe gesture, independent of the
        // source/inject prop stability fixes above — a swipe while
        // scrolling a list (Timeline stops, Smart Places) can misfire as
        // pull-to-refresh and blow away whatever client-side SPA route
        // (Timeline/Smart Places) the user had navigated into, back to the
        // panel's original URL, producing the same blank-screen symptom.
        allowsBackForwardNavigationGestures
        geolocationEnabled
        startInLoadingState
        style={styles.web}
      />
      {loading && !error && !revealed && (
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
      {DEBUG_OVERLAY && (
        <View style={styles.debugBox} pointerEvents="none">
          {debugLog.map((l, i) => (
            <Text key={i} style={styles.debugText} numberOfLines={1}>{l}</Text>
          ))}
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
  debugBox: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 6,
    padding: 4,
  },
  debugText: { color: '#00E676', fontSize: 9, fontFamily: 'monospace' },
})
