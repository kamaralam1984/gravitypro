import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  Platform,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native'
import { WebView } from 'react-native-webview'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { circleAPI, sosAPI, geofenceAPI, userAPI } from '../services/api'
import { storage } from '../utils/storage'
import { Colors } from '../theme/colors'

const getBatteryLevel = async () => {
  try {
    const Battery = require('expo-battery')
    const level = await Battery.getBatteryLevelAsync()
    return level >= 0 ? Math.round(level * 100) : null
  } catch {
    return null
  }
}

// ── SSE (NativeEventSource) ───────────────────────────────────────────────────
const NativeEventSource =
  Platform.OS !== 'web' ? require('react-native-sse').default : null

const SSE_BASE =
  (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') +
  '/api/v1/sse/stream'

// ── Tile layer configs (same as website ParentPanel / ChildPanel) ─────────────
const TILE_LAYERS = {
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',           opts: '{subdomains:"abcd",maxZoom:19}' },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',          opts: '{subdomains:"abcd",maxZoom:19}' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: '{maxZoom:19}' },
  street:    { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: '{subdomains:"abcd",maxZoom:19}' },
}

// ── Leaflet HTML ──────────────────────────────────────────────────────────────

function buildLeafletHTML({ myLocation, members, memberLocations, safeZones, user, mapType = 'dark', locationHistory = [] }) {
  const center = myLocation
    ? [myLocation.latitude, myLocation.longitude]
    : [20.5937, 78.9629]
  const zoom = myLocation ? 14 : 5

  const tile = TILE_LAYERS[mapType] || TILE_LAYERS.dark

  // Build tile layer entries for JS switcher
  const tileLayersJS = Object.entries(TILE_LAYERS).map(([key, t]) =>
    `"${key}": L.tileLayer("${t.url}", ${t.opts})`
  ).join(',\n    ')

  const markersJS = []

  if (myLocation) {
    markersJS.push(`
      var myIcon = L.divIcon({
        className: '',
        html: '<div style="width:32px;height:32px;border-radius:50%;background:#00E676;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,230,118,0.5);display:flex;align-items:center;justify-content:center;font-size:16px;text-align:center;line-height:26px;">👤</div>',
        iconSize:[32,32], iconAnchor:[16,16]
      });
      L.marker([${myLocation.latitude},${myLocation.longitude}],{icon:myIcon}).addTo(map).bindPopup('<b>You</b>',{className:'gravity-popup'});
    `)
  }

  members.filter(m => m.id !== user?.id && memberLocations[m.id]).forEach(m => {
    const loc = memberLocations[m.id]
    const initials = (m.name || '?')[0].toUpperCase()
    const color = '#2196F3'
    const safeId = m.id.replace(/-/g, '_')
    const safeName = (m.name || '?').replace(/'/g, "\\'")
    markersJS.push(`
      var icon_${safeId} = L.divIcon({
        className: '',
        html: '<div onclick="window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:\\"memberTap\\",id:\\"${m.id}\\"}))" style="width:38px;height:38px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(33,150,243,0.5);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;font-size:14px;text-align:center;line-height:32px;cursor:pointer;">${initials}</div>',
        iconSize:[38,38], iconAnchor:[19,19]
      });
      L.marker([${loc.latitude},${loc.longitude}],{icon:icon_${safeId}}).addTo(map).bindPopup('<b>${safeName}</b>',{className:'gravity-popup'});
    `)
  })

  safeZones.forEach(z => {
    const safeName = z.name.replace(/'/g, "\\'")
    markersJS.push(`
      L.circle([${z.center_lat},${z.center_lng}],{radius:${z.radius_meters},color:'#00E676',fillColor:'#00E676',fillOpacity:0.12,weight:2}).addTo(map).bindPopup('<b>${safeName}</b>',{className:'gravity-popup'});
    `)
  })

  if (locationHistory.length > 1) {
    const sorted = [...locationHistory].reverse()
    const points = sorted.map(p => `[${p.latitude},${p.longitude}]`).join(',')
    markersJS.push(`
      L.polyline([${points}],{color:'#00E676',weight:3,opacity:0.65,dashArray:'6,4'}).addTo(map);
      L.circleMarker([${sorted[0].latitude},${sorted[0].longitude}],{radius:6,color:'#00C853',fillColor:'#00C853',fillOpacity:1}).addTo(map).bindPopup('<b>Start</b>',{className:'gravity-popup'});
      L.circleMarker([${sorted[sorted.length-1].latitude},${sorted[sorted.length-1].longitude}],{radius:6,color:'#FF8A00',fillColor:'#FF8A00',fillOpacity:1}).addTo(map).bindPopup('<b>Latest</b>',{className:'gravity-popup'});
    `)
  }

  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body,#map{width:100%;height:100%;background:#0a1a0e}
  .gravity-popup .leaflet-popup-content-wrapper{background:#0F2518;border:1px solid #1a4a2a;border-radius:8px;color:#e0ffe8;font-family:sans-serif;font-size:13px;}
  .gravity-popup .leaflet-popup-tip{background:#0F2518;}
  .leaflet-control-zoom{border:none!important;background:transparent!important;}
  .leaflet-control-zoom a{background:#0F2518!important;color:#00E676!important;border:1px solid #1a4a2a!important;margin-bottom:2px!important;border-radius:6px!important;}
</style>
</head>
<body>
<div id="map"></div>
<script>
var currentTile;
var tileLayers = {
    ${tileLayersJS}
};
var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([${center[0]},${center[1]}],${zoom});
currentTile = tileLayers["${mapType}"];
currentTile.addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);
${markersJS.join('\n')}
map.on('click',function(e){
  if(window.ReactNativeWebView)
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'mapTap',lat:e.latlng.lat,lng:e.latlng.lng}));
});
// Handle messages from React Native (tile switch, pan)
document.addEventListener('message', handleMsg);
window.addEventListener('message', handleMsg);
function handleMsg(e){
  try{
    var d = JSON.parse(e.data);
    if(d.type==='setTile' && tileLayers[d.tile]){
      if(currentTile) map.removeLayer(currentTile);
      currentTile = tileLayers[d.tile];
      currentTile.addTo(map);
      currentTile.bringToBack();
    } else if(d.type==='panTo'){
      map.setView([d.lat,d.lng],d.zoom||16,{animate:true});
    }
  }catch(_){}
}
</script>
</body></html>`
}

// ── helpers ───────────────────────────────────────────────────────────────────

const formatLastSeen = (ts) => {
  if (!ts) return 'Unknown'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const isOnlineMember = (loc) => {
  if (!loc) return false
  if (!loc.timestamp) return true
  return Date.now() - new Date(loc.timestamp).getTime() < 5 * 60 * 1000
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const user = useAuthStore((s) => s.user)
  const insets = useSafeAreaInsets()

  // ── refs ──────────────────────────────────────────────────────────────────
  const webViewRef = useRef(null)
  const esRef = useRef(null)           // EventSource
  const locationSubRef = useRef(null)  // Location.watchPositionAsync subscription
  const lastLocationPost = useRef(0)

  // ── state ─────────────────────────────────────────────────────────────────
  const [myLocation, setMyLocation] = useState(null)
  const [mapType, setMapType] = useState('dark')
  const [showMapTypePicker, setShowMapTypePicker] = useState(false)
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [members, setMembers] = useState([])
  const [memberLocations, setMemberLocations] = useState({})  // { [userId]: { latitude, longitude, battery, timestamp } }
  const [safeZones, setSafeZones] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // ── History ───────────────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)
  const [locationHistory, setLocationHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // ── SOS ───────────────────────────────────────────────────────────────────
  const [sosModalVisible, setSosModalVisible] = useState(false)
  const [sosSending, setSosSending] = useState(false)

  // ── toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState(null)               // { message, color }
  const toastTimer = useRef(null)

  // ── SOS alert overlay (incoming) ─────────────────────────────────────────
  const [sosAlert, setSosAlert] = useState(null)          // { userId, name, message, latitude, longitude }

  // ── animations ───────────────────────────────────────────────────────────
  const headerAnim = useRef(new Animated.Value(0)).current
  const cardAnim = useRef(new Animated.Value(200)).current
  const cardOpacity = useRef(new Animated.Value(0)).current
  const sosPulse = useRef(new Animated.Value(1)).current
  const toastAnim = useRef(new Animated.Value(0)).current

  // ── animation setup ───────────────────────────────────────────────────────
  useEffect(() => {
    Animated.timing(headerAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start()

    Animated.loop(
      Animated.sequence([
        Animated.timing(sosPulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(sosPulse, { toValue: 1.0, duration: 700, useNativeDriver: true }),
      ])
    ).start()
  }, [])

  // ── toast helper ──────────────────────────────────────────────────────────
  const showToast = useCallback((message, color = Colors.accent) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, color })
    toastAnim.setValue(0)
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(toastAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setToast(null)
      toastTimer.current = null
    })
  }, [toastAnim])

  // ── card show / hide ──────────────────────────────────────────────────────
  const showCard = useCallback(() => {
    Animated.parallel([
      Animated.spring(cardAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start()
  }, [cardAnim, cardOpacity])

  const hideCard = useCallback(() => {
    Animated.parallel([
      Animated.timing(cardAnim, { toValue: 200, duration: 250, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setSelectedMember(null))
  }, [cardAnim, cardOpacity])

  // ── SSE ───────────────────────────────────────────────────────────────────
  const connectSSE = useCallback(async () => {
    // tear down existing connection
    if (esRef.current) {
      try { esRef.current.close() } catch (_) {}
      esRef.current = null
    }
    if (!NativeEventSource) return

    try {
      const token = await storage.getItem('auth_token')
      if (!token) return

      const es = new NativeEventSource(SSE_BASE, {
        headers: { Authorization: 'Bearer ' + token },
      })

      es.addEventListener('location_update', (e) => {
        try {
          const data = JSON.parse(e.data)
          const { userId, latitude, longitude, battery_level, timestamp } = data
          if (!userId || !latitude || !longitude) return
          setMemberLocations((prev) => ({
            ...prev,
            [userId]: {
              latitude,
              longitude,
              battery: battery_level ?? prev[userId]?.battery ?? null,
              timestamp: timestamp || new Date().toISOString(),
            },
          }))
        } catch (_) {}
      })

      es.addEventListener('sos_alert', (e) => {
        try {
          const data = JSON.parse(e.data)
          setSosAlert(data)
        } catch (_) {}
      })

      es.addEventListener('geofence_event', (e) => {
        try {
          const data = JSON.parse(e.data)
          const { name, eventType, zoneName } = data
          const verb = eventType === 'enter' ? 'entered' : 'left'
          showToast(`${name || 'Someone'} ${verb} ${zoneName || 'a zone'}`, Colors.info)
        } catch (_) {}
      })

      es.onerror = () => {
        // silent — reconnect handled by activeCircle effect
      }

      esRef.current = es
    } catch (err) {
      console.error('[MapScreen] SSE connect error:', err)
    }
  }, [showToast])

  // ── own location tracking ─────────────────────────────────────────────────
  const initLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        console.warn('[MapScreen] location permission denied')
        return
      }

      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (loc) => {
          const coord = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          }
          setMyLocation(coord)

          // Throttled POST to server (max once per 30 s)
          const now = Date.now()
          if (now - lastLocationPost.current > 30_000) {
            lastLocationPost.current = now
            getBatteryLevel().then(battery_level => {
              userAPI
                .postLocation({
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  accuracy: loc.coords.accuracy ?? undefined,
                  battery_level,
                })
                .catch(() => {})
            })
          }
        }
      )

      locationSubRef.current = sub
    } catch (e) {
      console.error('[MapScreen] initLocation:', e)
    }
  }, [])

  // ── circles ───────────────────────────────────────────────────────────────
  const loadCircles = useCallback(async () => {
    try {
      const res = await circleAPI.getMy()
      const list = res?.circles || []
      setCircles(list)
      if (list.length > 0) {
        setActiveCircle((prev) => prev ?? list[0])
      }
    } catch (e) {
      console.error('[MapScreen] loadCircles:', e)
    }
  }, [])

  // ── members ───────────────────────────────────────────────────────────────
  const loadMembers = useCallback(async (circleId) => {
    if (!circleId) return
    try {
      const res = await circleAPI.getMembers(circleId)
      const list = res?.members || []
      setMembers(list)
      setMemberLocations((prev) => {
        const locs = { ...prev }
        for (const m of list) {
          if (m.latitude && m.longitude) {
            locs[m.id] = {
              latitude: m.latitude,
              longitude: m.longitude,
              battery: m.battery_level ?? null,
              timestamp: m.location_updated_at || m.updated_at || null,
            }
          }
        }
        return locs
      })
    } catch (e) {
      console.error('[MapScreen] loadMembers:', e)
    }
  }, [])

  // ── safe zones ────────────────────────────────────────────────────────────
  const loadSafeZones = useCallback(async (circleId) => {
    if (!circleId) return
    try {
      const res = await geofenceAPI.getByCircle(circleId)
      setSafeZones(res?.safe_zones || [])
    } catch (e) {
      console.error('[MapScreen] loadSafeZones:', e)
    }
  }, [])

  // ── refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setRefreshing(true)
    await loadCircles()
    if (activeCircle) {
      await Promise.all([
        loadMembers(activeCircle.id),
        loadSafeZones(activeCircle.id),
      ])
    }
    setRefreshing(false)
  }, [activeCircle, loadCircles, loadMembers, loadSafeZones])

  // ── SOS send ──────────────────────────────────────────────────────────────
  const sendSOS = useCallback(async () => {
    if (sosSending || !activeCircle) return
    setSosSending(true)
    try {
      await sosAPI.trigger({
        circle_id: activeCircle.id,
        message: 'SOS! I need help!',
        latitude: myLocation?.latitude ?? null,
        longitude: myLocation?.longitude ?? null,
      })
      setSosModalVisible(false)
      showToast('SOS sent to your family', Colors.danger)
    } catch (e) {
      console.error('[MapScreen] SOS error:', e)
      showToast('Failed to send SOS. Try again.', Colors.warning)
    } finally {
      setSosSending(false)
    }
  }, [sosSending, activeCircle, myLocation, showToast])

  // ── WebView helpers ───────────────────────────────────────────────────────
  const panMapTo = useCallback((lat, lng, zoom = 16) => {
    webViewRef.current?.injectJavaScript(
      `map.setView([${lat},${lng}],${zoom},{animate:true});true;`
    )
  }, [])

  const switchMapTile = useCallback((type) => {
    setMapType(type)
    webViewRef.current?.injectJavaScript(
      `(function(){var t=tileLayers["${type}"];if(currentTile)map.removeLayer(currentTile);currentTile=t;t.addTo(map);t.bringToBack();})(true);`
    )
  }, [])

  // ── member tap ────────────────────────────────────────────────────────────
  const handleMemberTap = useCallback(
    (member) => {
      setSelectedMember(member)
      showCard()
      const loc = memberLocations[member.id]
      if (loc) panMapTo(loc.latitude, loc.longitude, 16)
    },
    [memberLocations, showCard, panMapTo]
  )

  // ── center on self ────────────────────────────────────────────────────────
  const centerOnMe = useCallback(() => {
    if (!myLocation) return
    panMapTo(myLocation.latitude, myLocation.longitude, 16)
  }, [myLocation, panMapTo])

  // ── history toggle ────────────────────────────────────────────────────────
  const toggleHistory = useCallback(async () => {
    if (showHistory) {
      setShowHistory(false)
      setLocationHistory([])
      return
    }
    setLoadingHistory(true)
    try {
      const res = await userAPI.getLocationHistory()
      setLocationHistory(res?.locations || [])
      setShowHistory(true)
    } catch (e) {
      showToast('Failed to load history', Colors.warning)
    } finally {
      setLoadingHistory(false)
    }
  }, [showHistory, showToast])

  // ── lifecycle: mount ──────────────────────────────────────────────────────
  useEffect(() => {
    initLocation()
    loadCircles()

    return () => {
      // cleanup location watch
      if (locationSubRef.current) {
        locationSubRef.current.remove()
        locationSubRef.current = null
      }
      // cleanup SSE
      if (esRef.current) {
        try { esRef.current.close() } catch (_) {}
        esRef.current = null
      }
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── lifecycle: active circle changed ─────────────────────────────────────
  useEffect(() => {
    if (!activeCircle) return

    loadMembers(activeCircle.id)
    loadSafeZones(activeCircle.id)
    connectSSE()

    return () => {
      if (esRef.current) {
        try { esRef.current.close() } catch (_) {}
        esRef.current = null
      }
    }
  }, [activeCircle?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── derived ───────────────────────────────────────────────────────────────
  const onlineCount = useMemo(
    () => members.filter((m) => isOnlineMember(memberLocations[m.id])).length,
    [members, memberLocations]
  )
  const selectedLoc = selectedMember ? memberLocations[selectedMember.id] : null

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* ── Full-screen Leaflet map (same system as website parent/child panel) ── */}
      <WebView
        ref={webViewRef}
        source={{ html: buildLeafletHTML({ myLocation, members, memberLocations, safeZones, user, mapType, locationHistory }) }}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        originWhitelist={['*']}
        onMessage={(e) => {
          try {
            const data = JSON.parse(e.nativeEvent.data)
            if (data.type === 'memberTap') {
              const member = members.find((m) => m.id === data.id)
              if (member) handleMemberTap(member)
            } else if (data.type === 'mapTap') {
              if (selectedMember) hideCard()
              if (showMapTypePicker) setShowMapTypePicker(false)
            }
          } catch (_) {}
        }}
      />

      {/* ── Header overlay ──────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.header,
          { paddingTop: insets.top + 10, opacity: headerAnim },
        ]}>
        <LinearGradient
          colors={['rgba(5,15,8,0.96)', 'rgba(5,15,8,0)']}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.headerRow}>
          {/* Circle name + label */}
          <View style={styles.headerLeft}>
            <Text style={styles.headerLabel}>FAMILY MAP</Text>
            {activeCircle && (
              <Text style={styles.headerCircle}>{activeCircle.name}</Text>
            )}
          </View>

          <View style={styles.headerRight}>
            {/* Online count chip */}
            <View style={styles.countChip}>
              <View style={styles.countDot} />
              <Text style={styles.countText}>
                {onlineCount}/{members.length} online
              </Text>
            </View>
            {/* Refresh */}
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={refresh}
              activeOpacity={0.7}>
              <Ionicons
                name={refreshing ? 'sync' : 'refresh'}
                size={18}
                color={Colors.accent}
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Circle switcher (shown only when >1 circle) */}
        {circles.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.circleSwitcherContent}
            style={styles.circleSwitcher}>
            {circles.map((c) => {
              const active = c.id === activeCircle?.id
              return (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setActiveCircle(c)}
                  activeOpacity={0.75}>
                  <LinearGradient
                    colors={active ? ['#0D7A45', '#0A5C35'] : ['rgba(10,92,53,0.25)', 'rgba(10,92,53,0.1)']}
                    style={[styles.circleChip, active && styles.circleChipActive]}>
                    <Text style={[styles.circleChipText, active && styles.circleChipTextActive]}>
                      {c.name}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}
      </Animated.View>

      {/* ── Toast notification ──────────────────────────────────────────── */}
      {toast && (
        <Animated.View
          style={[
            styles.toast,
            { top: insets.top + 80, opacity: toastAnim, borderColor: toast.color + '50' },
          ]}>
          <View style={[styles.toastBar, { backgroundColor: toast.color }]} />
          <Text style={styles.toastText}>{toast.message}</Text>
        </Animated.View>
      )}

      {/* ── Map type picker panel ─────────────────────────────────────── */}
      {showMapTypePicker && (
        <View style={[styles.mapTypePicker, { bottom: insets.bottom + 162, right: 16 }]}>
          {[
            { key: 'dark', label: 'Dark', icon: 'moon' },
            { key: 'light', label: 'Light', icon: 'sunny' },
            { key: 'satellite', label: 'Satellite', icon: 'earth' },
            { key: 'street', label: 'Street', icon: 'map' },
          ].map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.mapTypeBtn, mapType === t.key && styles.mapTypeBtnActive]}
              onPress={() => { switchMapTile(t.key); setShowMapTypePicker(false) }}
              activeOpacity={0.75}>
              <Ionicons name={t.icon} size={14} color={mapType === t.key ? '#fff' : Colors.textMuted} />
              <Text style={[styles.mapTypeTxt, mapType === t.key && styles.mapTypeTxtActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ── History FAB ─────────────────────────────────────────────────── */}
      <Pressable
        style={[styles.locateFab, { bottom: insets.bottom + 108, right: 204 }]}
        onPress={toggleHistory}
        disabled={loadingHistory}>
        <LinearGradient
          colors={showHistory ? ['#0A5C35', '#063d24'] : ['#0D7A45', '#0A5C35']}
          style={styles.locateFabGrad}>
          {loadingHistory
            ? <Ionicons name="sync" size={18} color="#fff" />
            : <Ionicons name="time" size={20} color={showHistory ? Colors.accent : '#fff'} />
          }
        </LinearGradient>
      </Pressable>

      {/* ── Layers FAB ──────────────────────────────────────────────────── */}
      <Pressable
        style={[styles.locateFab, { bottom: insets.bottom + 108, right: 148 }]}
        onPress={() => setShowMapTypePicker((v) => !v)}>
        <LinearGradient
          colors={showMapTypePicker ? ['#0A5C35', '#063d24'] : ['#0D7A45', '#0A5C35']}
          style={styles.locateFabGrad}>
          <Ionicons name="layers" size={20} color="#fff" />
        </LinearGradient>
      </Pressable>

      {/* ── Locate-me FAB ───────────────────────────────────────────────── */}
      <Pressable
        style={[styles.locateFab, { bottom: insets.bottom + 108, right: 92 }]}
        onPress={centerOnMe}>
        <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.locateFabGrad}>
          <Ionicons name="locate" size={22} color="#fff" />
        </LinearGradient>
      </Pressable>

      {/* ── SOS FAB ─────────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.sosFabWrap,
          { bottom: insets.bottom + 100, right: 20 },
          { transform: [{ scale: sosPulse }] },
        ]}>
        <Pressable style={styles.sosFab} onPress={() => setSosModalVisible(true)}>
          <LinearGradient colors={['#FF1744', '#B71C1C']} style={styles.sosFabGrad}>
            <Text style={styles.sosLabel}>SOS</Text>
          </LinearGradient>
        </Pressable>
      </Animated.View>

      {/* ── Member info card (slides up on tap) ─────────────────────────── */}
      {selectedMember && (
        <Animated.View
          style={[
            styles.memberCard,
            {
              bottom: insets.bottom + 16,
              opacity: cardOpacity,
              transform: [{ translateY: cardAnim }],
            },
          ]}>
          <LinearGradient colors={['#0F2518', '#081510']} style={styles.memberCardGrad}>
            {/* Close */}
            <TouchableOpacity style={styles.cardClose} onPress={hideCard}>
              <Ionicons name="close" size={18} color={Colors.textMuted} />
            </TouchableOpacity>

            {/* Avatar + name */}
            <View style={styles.cardTop}>
              <MemberAvatar
                member={selectedMember}
                size={52}
                showStatus
                isOnline={isOnlineMember(selectedLoc)}
              />
              <View style={styles.cardInfo}>
                <Text style={styles.cardName}>{selectedMember.name}</Text>
                <View style={styles.cardBadgeRow}>
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleText}>
                      {(selectedMember.role || 'member').toUpperCase()}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: isOnlineMember(selectedLoc) ? Colors.online : Colors.offline },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {isOnlineMember(selectedLoc) ? 'Online' : 'Offline'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.cardStats}>
              <View style={styles.cardStat}>
                <Ionicons name="battery-half" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Battery</Text>
                {selectedLoc?.battery != null ? (
                  <BatteryIndicator level={selectedLoc.battery} showText size="sm" />
                ) : (
                  <Text style={styles.cardStatValue}>—</Text>
                )}
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardStat}>
                <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Last seen</Text>
                <Text style={styles.cardStatValue}>
                  {formatLastSeen(selectedLoc?.timestamp)}
                </Text>
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardStat}>
                <Ionicons name="location-outline" size={16} color={Colors.textMuted} />
                <Text style={styles.cardStatLabel}>Location</Text>
                <Text style={styles.cardStatValue}>
                  {selectedLoc ? 'Shared' : 'Hidden'}
                </Text>
              </View>
            </View>

            {/* Center on map */}
            {selectedLoc && (
              <TouchableOpacity
                style={styles.viewOnMapBtn}
                onPress={() => panMapTo(selectedLoc.latitude, selectedLoc.longitude, 17)}>
                <Ionicons name="navigate" size={15} color={Colors.accent} />
                <Text style={styles.viewOnMapText}>Center on map</Text>
              </TouchableOpacity>
            )}
          </LinearGradient>
        </Animated.View>
      )}

      {/* ── SOS Confirm Modal ───────────────────────────────────────────── */}
      <Modal
        visible={sosModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSosModalVisible(false)}>
        <Pressable
          style={styles.modalOverlay}
          onPress={() => !sosSending && setSosModalVisible(false)}>
          <Pressable style={styles.sosCard} onPress={(e) => e.stopPropagation()}>
            {/* Warning icon */}
            <View style={styles.sosIconWrap}>
              <LinearGradient colors={['#FF1744', '#B71C1C']} style={styles.sosIconGrad}>
                <Ionicons name="warning" size={32} color="#fff" />
              </LinearGradient>
            </View>

            <Text style={styles.sosModalTitle}>SEND SOS ALERT?</Text>
            <Text style={styles.sosModalSubtitle}>
              Your family will be notified immediately with your current location.
            </Text>

            <View style={styles.sosModalBtns}>
              {/* Cancel */}
              <TouchableOpacity
                style={styles.sosCancelBtn}
                onPress={() => setSosModalVisible(false)}
                disabled={sosSending}
                activeOpacity={0.75}>
                <Text style={styles.sosCancelText}>CANCEL</Text>
              </TouchableOpacity>

              {/* Send SOS */}
              <TouchableOpacity
                style={styles.sosSendBtn}
                onPress={sendSOS}
                disabled={sosSending}
                activeOpacity={0.8}>
                <LinearGradient colors={['#FF1744', '#B71C1C']} style={styles.sosSendGrad}>
                  <Ionicons name="warning" size={16} color="#fff" />
                  <Text style={styles.sosSendText}>
                    {sosSending ? 'SENDING…' : 'SEND SOS'}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Incoming SOS Alert overlay ───────────────────────────────────── */}
      <Modal
        visible={!!sosAlert}
        transparent
        animationType="slide"
        onRequestClose={() => setSosAlert(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSosAlert(null)}>
          <View style={[styles.sosCard, styles.sosAlertCard]}>
            <LinearGradient
              colors={['rgba(183,28,28,0.95)', 'rgba(80,0,0,0.98)']}
              style={StyleSheet.absoluteFill}
              borderRadius={24}
            />
            <View style={styles.sosIconWrap}>
              <View style={[styles.sosIconGrad, { backgroundColor: '#FF1744' }]}>
                <Ionicons name="alert-circle" size={32} color="#fff" />
              </View>
            </View>
            <Text style={[styles.sosModalTitle, { color: '#FF8A80' }]}>SOS ALERT</Text>
            <Text style={styles.sosAlertName}>{sosAlert?.name || 'A family member'}</Text>
            <Text style={styles.sosAlertMessage}>
              {sosAlert?.message || 'Needs help!'}
            </Text>
            <TouchableOpacity
              style={[styles.sosSendBtn, { marginTop: 20 }]}
              onPress={() => {
                if (sosAlert?.latitude && sosAlert?.longitude) {
                  panMapTo(sosAlert.latitude, sosAlert.longitude, 16)
                }
                setSosAlert(null)
              }}
              activeOpacity={0.8}>
              <LinearGradient colors={['#FF1744', '#B71C1C']} style={styles.sosSendGrad}>
                <Ionicons name="navigate" size={16} color="#fff" />
                <Text style={styles.sosSendText}>VIEW ON MAP</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sosCancelBtn, { marginTop: 10 }]}
              onPress={() => setSosAlert(null)}
              activeOpacity={0.75}>
              <Text style={styles.sosCancelText}>DISMISS</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

// ── styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  noMapPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.bgDeep },
  noMapTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  noMapSub: { color: Colors.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },

  // ── header ──
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flex: 1 },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    color: Colors.textMuted,
  },
  headerCircle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textWhite,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  countDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.online,
  },
  countText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // ── circle switcher ──
  circleSwitcher: { marginTop: 12 },
  circleSwitcherContent: { gap: 8, paddingRight: 4 },
  circleChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  circleChipActive: { borderColor: Colors.accentSoft },
  circleChipText: { fontSize: 12, fontWeight: '700', color: Colors.textMuted },
  circleChipTextActive: { color: Colors.textWhite },

  // ── toast ──
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: Colors.shadowDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  toastBar: {
    width: 4,
    height: '100%',
    borderRadius: 2,
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  toastText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
    paddingLeft: 10,
    flex: 1,
  },

  // ── own marker ──
  myMarkerWrap: { alignItems: 'center', justifyContent: 'center', width: 60, height: 60 },
  myMarkerGrad: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    elevation: 10,
  },

  // ── member markers ──
  memberMarkerWrap: { alignItems: 'center', justifyContent: 'center', width: 56, height: 56 },
  memberRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2.5,
    borderColor: Colors.info,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgCard,
  },
  memberRingSelected: { borderColor: Colors.accent, borderWidth: 3 },
  memberImage: { width: 36, height: 36, borderRadius: 18 },
  memberInitialWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { color: Colors.accent, fontSize: 16, fontWeight: '800' },
  selectedPip: {
    position: 'absolute',
    bottom: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    borderWidth: 1.5,
    borderColor: Colors.bgDeep,
  },

  // ── safe zone label ──
  zoneLabelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(5,15,8,0.82)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  zoneLabelText: { fontSize: 11, fontWeight: '700', color: Colors.accent },

  // ── map type picker ──
  mapTypePicker: {
    position: 'absolute',
    backgroundColor: 'rgba(10,26,14,0.96)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.2)',
    overflow: 'hidden',
    elevation: 12,
  },
  mapTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,230,118,0.1)',
  },
  mapTypeBtnActive: { backgroundColor: 'rgba(13,122,69,0.5)' },
  mapTypeTxt: { fontSize: 13, color: Colors.textMuted, fontWeight: '600' },
  mapTypeTxtActive: { color: '#fff' },

  // ── locate FAB ──
  locateFab: {
    position: 'absolute',
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 10,
  },
  locateFabGrad: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── SOS FAB ──
  sosFabWrap: {
    position: 'absolute',
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 14,
  },
  sosFab: { borderRadius: 32 },
  sosFabGrad: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,23,68,0.4)',
  },
  sosLabel: { fontSize: 15, fontWeight: '900', color: '#fff', letterSpacing: 1.5 },

  // ── member card ──
  memberCard: {
    position: 'absolute',
    left: 16,
    right: 92,  // clear SOS button
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    shadowColor: Colors.shadowDeep,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 20,
  },
  memberCardGrad: { padding: 18 },
  cardClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 18, fontWeight: '800', color: Colors.textWhite, marginBottom: 6 },
  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: {
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  roleText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },

  // card stats
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgGlass,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  cardStat: { flex: 1, alignItems: 'center', gap: 4 },
  cardStatLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  cardStatValue: { fontSize: 13, color: Colors.textSecondary, fontWeight: '700' },
  cardDivider: { width: 1, height: 32, backgroundColor: Colors.divider },

  // center on map button
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.bgGlassStrong,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  viewOnMapText: { fontSize: 13, fontWeight: '700', color: Colors.accent },

  // ── modal overlay ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,12,5,0.88)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },

  // ── SOS confirm card ──
  sosCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: Colors.bgCard,
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.35)',
    shadowColor: '#FF1744',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 24,
  },
  sosAlertCard: {
    overflow: 'hidden',
    borderColor: 'rgba(255,23,68,0.6)',
  },
  sosIconWrap: { marginBottom: 18 },
  sosIconGrad: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosModalTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FF1744',
    letterSpacing: 1.5,
    marginBottom: 10,
    textAlign: 'center',
  },
  sosModalSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  sosAlertName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  sosAlertMessage: {
    fontSize: 14,
    color: '#FF8A80',
    textAlign: 'center',
    lineHeight: 20,
  },
  sosModalBtns: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  sosCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255,23,68,0.35)',
    backgroundColor: 'rgba(255,23,68,0.08)',
  },
  sosCancelText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FF8A80',
    letterSpacing: 1,
  },
  sosSendBtn: {
    flex: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  sosSendGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  sosSendText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 1,
  },
})
