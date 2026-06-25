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
  Dimensions,
} from 'react-native'
import * as Location from 'expo-location'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { circleAPI, sosAPI, geofenceAPI, userAPI } from '../services/api'
import FamilyMap, { haversineMeters, formatDistance } from '../components/FamilyMap'
import { storage } from '../utils/storage'
import { useTheme } from '../theme/ThemeContext'
import { speedToMode } from '../services/location'

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

// ── Leaflet map is provided by the FamilyMap component (props-driven WebView) ──

// ── helpers ───────────────────────────────────────────────────────────────────

const formatLastSeen = (ts) => {
  if (!ts) return 'Unknown'
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// A connected member counts as "online" if we've heard from them within the
// last 10 min (consistent with Home/Circles). A missing timestamp is treated as
// offline — never "always online" — so stale rows don't read as connected.
const isOnlineMember = (loc) => {
  if (!loc || !loc.timestamp) return false
  return Date.now() - new Date(loc.timestamp).getTime() < 10 * 60 * 1000
}

// Soft "last seen" label so a connected member never shows a bare "Offline".
const lastSeenAgo = (ts) => {
  if (!ts) return ''
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─────────────────────────────────────────────────────────────────────────────

export default function MapScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const user = useAuthStore((s) => s.user)
  const insets = useSafeAreaInsets()
  // Cap the member-detail card body so its lower rows stay scrollable and
  // never hide behind the bottom tab bar / SOS button (~50% of screen height).
  const cardMaxHeight = Math.round(Dimensions.get('window').height * 0.5)

  // ── refs ──────────────────────────────────────────────────────────────────
  const mapRef = useRef(null)
  const esRef = useRef(null)           // EventSource
  const locationSubRef = useRef(null)  // Location.watchPositionAsync subscription
  const lastLocationPost = useRef(0)

  // ── state ─────────────────────────────────────────────────────────────────
  const [myLocation, setMyLocation] = useState(null)
  const [circles, setCircles] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [members, setMembers] = useState([])
  const [memberLocations, setMemberLocations] = useState({})  // { [userId]: { latitude, longitude, battery, timestamp } }
  const [safeZones, setSafeZones] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  // ── SOS ───────────────────────────────────────────────────────────────────
  const [sosModalVisible, setSosModalVisible] = useState(false)
  const [sosSending, setSosSending] = useState(false)
  const [sosMessage, setSosMessage] = useState('SOS! I need help!')


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
  const showToast = useCallback((message, color = c.accent) => {
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
          const { userId, latitude, longitude, battery_level, speed, mode, timestamp } = data
          if (!userId || latitude == null || longitude == null) return
          setMemberLocations((prev) => ({
            ...prev,
            [userId]: {
              latitude: Number(latitude),
              longitude: Number(longitude),
              battery: battery_level ?? prev[userId]?.battery ?? null,
              speed: speed != null ? Number(speed) : (prev[userId]?.speed ?? null),
              mode: mode ?? prev[userId]?.mode ?? null,
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

      es.addEventListener('sos_safe', (e) => {
        try {
          const data = JSON.parse(e.data)
          showToast(`${data.name || 'Someone'} is safe`, c.success)
          // Dismiss active SOS overlay if it's from the same user
          setSosAlert(prev => (prev && prev.userId === data.userId) ? null : prev)
        } catch (_) {}
      })

      es.addEventListener('geofence_event', (e) => {
        try {
          const data = JSON.parse(e.data)
          const { name, eventType, zoneName } = data
          const verb = eventType === 'enter' ? 'entered' : 'left'
          showToast(`${name || 'Someone'} ${verb} ${zoneName || 'a zone'}`, c.info)
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
          // Only update the on-screen "my location" marker. The background
          // foreground-service (services/location.js) already posts to the server
          // every few seconds (with speed/mode/battery) — posting here too would
          // double the network writes and battery use.
          setMyLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          })
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
          if (m.latitude != null && m.longitude != null) {
            locs[m.id] = {
              latitude: Number(m.latitude),
              longitude: Number(m.longitude),
              battery: m.battery_level ?? null,
              speed: m.speed != null ? Number(m.speed) : (prev[m.id]?.speed ?? null),
              mode: m.mode ?? prev[m.id]?.mode ?? null,
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
        message: sosMessage || 'SOS! I need help!',
        latitude: myLocation?.latitude ?? null,
        longitude: myLocation?.longitude ?? null,
      })
      setSosModalVisible(false)
      showToast('SOS sent to your family', c.danger)
    } catch (e) {
      console.error('[MapScreen] SOS error:', e)
      showToast('Failed to send SOS. Try again.', c.warning)
    } finally {
      setSosSending(false)
    }
  }, [sosSending, activeCircle, myLocation, sosMessage, showToast])

  // ── map pan helper ────────────────────────────────────────────────────────
  // FamilyMap is a props-driven WebView that auto-fits members/zones/me, so
  // there is no imperative pan API. Kept as a guarded no-op so the member card
  // and SOS-alert "center on map" buttons stay wired without crashing.
  const panMapTo = useCallback((_lat, _lng, _zoom = 16) => {
    if (!mapRef.current || typeof mapRef.current.animateToRegion !== 'function') return
    mapRef.current.animateToRegion(
      { latitude: _lat, longitude: _lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      800
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
  // Exclude yourself from the count/denominator (markers & list already do).
  const otherMembers = useMemo(() => members.filter((m) => m.id !== user?.id), [members, user?.id])
  const onlineCount = useMemo(
    () => otherMembers.filter((m) => isOnlineMember(memberLocations[m.id])).length,
    [otherMembers, memberLocations]
  )
  const selectedLoc = selectedMember ? memberLocations[selectedMember.id] : null

  // Transport mode for the selected member: derive from latest GPS speed.
  // (speedToMode also maps a missing speed → an "Unknown" placeholder.)
  const selectedMode = useMemo(
    () => speedToMode(selectedLoc?.speed),
    [selectedLoc?.speed]
  )

  // ── distances for the selected member ──────────────────────────────────────
  // Nearest safe zone (name + distance) and distance from the parent (myLocation).
  const { nearestZone, nearestZoneDist, parentDist } = useMemo(() => {
    if (!selectedLoc || selectedLoc.latitude == null || selectedLoc.longitude == null) {
      return { nearestZone: null, nearestZoneDist: null, parentDist: null }
    }
    const mLat = Number(selectedLoc.latitude)
    const mLng = Number(selectedLoc.longitude)

    let zone = null
    let zoneDist = null
    for (const z of safeZones) {
      const zLat = Number(z.center_lat)
      const zLng = Number(z.center_lng)
      if (isNaN(zLat) || isNaN(zLng)) continue
      const d = haversineMeters(mLat, mLng, zLat, zLng)
      if (zoneDist == null || d < zoneDist) {
        zoneDist = d
        zone = z
      }
    }

    let pDist = null
    if (myLocation && myLocation.latitude != null && myLocation.longitude != null) {
      pDist = haversineMeters(
        mLat,
        mLng,
        Number(myLocation.latitude),
        Number(myLocation.longitude)
      )
    }

    return { nearestZone: zone, nearestZoneDist: zoneDist, parentDist: pDist }
  }, [selectedLoc, safeZones, myLocation])

  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />

      {/* ── Full-screen map (free Leaflet/OSM via FamilyMap) ──────────────── */}
      <FamilyMap
        ref={mapRef}
        style={[StyleSheet.absoluteFill, { borderRadius: 0, borderWidth: 0 }]}
        zoomTopOffset={220}
        me={myLocation}
        zones={safeZones}
        members={members
          .filter((m) => m.id !== user?.id && memberLocations[m.id])
          .map((m) => ({
            id: m.id,
            name: m.name,
            latitude: memberLocations[m.id].latitude,
            longitude: memberLocations[m.id].longitude,
            battery_level: memberLocations[m.id].battery,
            account_type: m.account_type,
          }))}
      />
      {/* ── Member selector row (taps open the detail card; WebView markers
            aren't directly tappable from RN) ──────────────────────────── */}
      {members.filter((m) => m.id !== user?.id && memberLocations[m.id]).length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.memberPickRow, { bottom: insets.bottom + 180 }]}
          contentContainerStyle={styles.memberPickContent}
        >
          {members
            .filter((m) => m.id !== user?.id && memberLocations[m.id])
            .map((member) => {
              const isSelected = selectedMember?.id === member.id
              const online = isOnlineMember(memberLocations[member.id])
              return (
                <TouchableOpacity
                  key={member.id}
                  style={[styles.memberPickChip, isSelected && styles.memberPickChipActive]}
                  onPress={() => handleMemberTap(member)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.memberPickDot,
                      { backgroundColor: online ? c.online : c.offline },
                    ]}
                  />
                  <Text
                    style={[styles.memberPickText, isSelected && styles.memberPickTextActive]}
                    numberOfLines={1}
                  >
                    {member.name}
                  </Text>
                </TouchableOpacity>
              )
            })}
        </ScrollView>
      )}

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
                {onlineCount}/{otherMembers.length} online
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
                color={c.accent}
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
              <Ionicons name="close" size={18} color={c.textMuted} />
            </TouchableOpacity>

            {/* Scrollable body — so long content clears the tab bar / SOS button */}
            <ScrollView
              style={{ maxHeight: cardMaxHeight }}
              contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
              showsVerticalScrollIndicator={false}
              bounces={false}
              nestedScrollEnabled>

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
                      { backgroundColor: isOnlineMember(selectedLoc) ? c.online : c.offline },
                    ]}
                  />
                  <Text style={styles.statusText}>
                    {isOnlineMember(selectedLoc)
                      ? 'Online'
                      : (selectedLoc?.timestamp ? `Last seen ${lastSeenAgo(selectedLoc.timestamp)}` : 'Connecting…')}
                  </Text>
                </View>
              </View>
            </View>

            {/* Stats row */}
            <View style={styles.cardStats}>
              <View style={styles.cardStat}>
                <Ionicons name="battery-half" size={16} color={c.textMuted} />
                <Text style={styles.cardStatLabel}>Battery</Text>
                {selectedLoc?.battery != null ? (
                  <BatteryIndicator level={selectedLoc.battery} showText size="sm" />
                ) : (
                  <Text style={styles.cardStatValue}>—</Text>
                )}
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardStat}>
                <Ionicons name="time-outline" size={16} color={c.textMuted} />
                <Text style={styles.cardStatLabel}>Last seen</Text>
                <Text style={styles.cardStatValue}>
                  {formatLastSeen(selectedLoc?.timestamp)}
                </Text>
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardStat}>
                <Ionicons name="location-outline" size={16} color={c.textMuted} />
                <Text style={styles.cardStatLabel}>Location</Text>
                <Text style={styles.cardStatValue}>
                  {selectedLoc ? 'Shared' : 'Hidden'}
                </Text>
              </View>

              <View style={styles.cardDivider} />

              <View style={styles.cardStat}>
                <Ionicons name={selectedMode.icon} size={16} color={c.textMuted} />
                <Text style={styles.cardStatLabel}>Mode</Text>
                <Text style={styles.cardStatValue}>{selectedMode.label}</Text>
              </View>
            </View>

            {/* Distance readouts */}
            {selectedLoc && (
              <View style={styles.distanceRow}>
                <View style={styles.distanceItem}>
                  <Ionicons name="shield-checkmark" size={14} color={c.accent} />
                  <Text style={styles.distanceLabel} numberOfLines={1}>
                    {nearestZone ? nearestZone.name : 'No safe zone'}
                  </Text>
                  <Text style={styles.distanceValue}>
                    {nearestZone ? formatDistance(nearestZoneDist) : '—'}
                  </Text>
                </View>
                <View style={styles.cardDivider} />
                <View style={styles.distanceItem}>
                  <Ionicons name="navigate-circle" size={14} color={c.info} />
                  <Text style={styles.distanceLabel} numberOfLines={1}>From you</Text>
                  <Text style={styles.distanceValue}>
                    {parentDist != null ? formatDistance(parentDist) : '—'}
                  </Text>
                </View>
              </View>
            )}

            {/* Center on map */}
            {selectedLoc && (
              <TouchableOpacity
                style={styles.viewOnMapBtn}
                onPress={() => panMapTo(selectedLoc.latitude, selectedLoc.longitude, 17)}>
                <Ionicons name="navigate" size={15} color={c.accent} />
                <Text style={styles.viewOnMapText}>Center on map</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
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

            {/* Quick message chips */}
            <View style={styles.sosChipRow}>
              {['SOS! I need help!', 'Medical emergency', 'Fire emergency', "I'm lost", 'Call me now'].map(msg => (
                <Pressable
                  key={msg}
                  onPress={() => setSosMessage(msg)}
                  style={[styles.sosChip, sosMessage === msg && styles.sosChipActive]}>
                  <Text style={[styles.sosChipText, sosMessage === msg && styles.sosChipTextActive]}>{msg}</Text>
                </Pressable>
              ))}
            </View>

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

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep },
  noMapPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: c.bgDeep },
  noMapTitle: { color: c.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  noMapSub: { color: c.textMuted, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },

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
    color: c.textMuted,
  },
  headerCircle: {
    fontSize: 20,
    fontWeight: '800',
    color: c.textWhite,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.border,
  },
  countDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: c.online,
  },
  countText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: c.border,
  },

  // ── circle switcher ──
  circleSwitcher: { marginTop: 12 },
  circleSwitcherContent: { gap: 8, paddingRight: 4 },
  circleChip: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: c.border,
  },
  circleChipActive: { borderColor: c.accentSoft },
  circleChipText: { fontSize: 12, fontWeight: '700', color: c.textMuted },
  circleChipTextActive: { color: c.textWhite },

  // ── toast ──
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgCard,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: c.shadowDeep,
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
    color: c.textSecondary,
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
    shadowColor: c.accent,
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
    borderColor: c.info,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.bgCard,
  },
  memberRingSelected: { borderColor: c.accent, borderWidth: 3 },
  memberImage: { width: 36, height: 36, borderRadius: 18 },
  memberInitialWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: c.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { color: c.accent, fontSize: 16, fontWeight: '800' },
  selectedPip: {
    position: 'absolute',
    bottom: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.accent,
    borderWidth: 1.5,
    borderColor: c.bgDeep,
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
    borderColor: c.border,
  },
  zoneLabelText: { fontSize: 11, fontWeight: '700', color: c.accent },

  // ── member selector row ──
  memberPickRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    maxHeight: 44,
  },
  memberPickContent: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  memberPickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: c.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: c.border,
  },
  memberPickChipActive: { borderColor: c.accent, backgroundColor: 'rgba(13,122,69,0.35)' },
  memberPickDot: { width: 7, height: 7, borderRadius: 4 },
  memberPickText: { fontSize: 13, fontWeight: '700', color: c.textSecondary, maxWidth: 120 },
  memberPickTextActive: { color: c.textWhite },

  // ── locate FAB ──
  locateFab: {
    position: 'absolute',
    shadowColor: c.accentSoft,
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
    borderColor: c.borderStrong,
    shadowColor: c.shadowDeep,
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
    backgroundColor: c.bgGlassStrong,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 18, fontWeight: '800', color: c.textWhite, marginBottom: 6 },
  cardBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: {
    backgroundColor: c.bgGlassStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: c.border,
  },
  roleText: { fontSize: 10, fontWeight: '700', color: c.textMuted, letterSpacing: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

  // card stats
  cardStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgGlass,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 14,
  },
  cardStat: { flex: 1, alignItems: 'center', gap: 4 },
  cardStatLabel: { fontSize: 10, color: c.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  cardStatValue: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },
  cardDivider: { width: 1, height: 32, backgroundColor: c.divider },

  // distance readouts
  distanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgGlass,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: c.border,
    marginBottom: 14,
  },
  distanceItem: { flex: 1, alignItems: 'center', gap: 4 },
  distanceLabel: {
    fontSize: 10,
    color: c.textMuted,
    fontWeight: '600',
    letterSpacing: 0.5,
    maxWidth: '100%',
  },
  distanceValue: { fontSize: 13, color: c.textSecondary, fontWeight: '700' },

  // center on map button
  viewOnMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: c.bgGlassStrong,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  viewOnMapText: { fontSize: 13, fontWeight: '700', color: c.accent },

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
    backgroundColor: c.bgCard,
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
    color: c.textSecondary,
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
  sosChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    width: '100%',
    marginBottom: 16,
    justifyContent: 'center',
  },
  sosChip: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,23,68,0.3)',
    backgroundColor: 'rgba(255,23,68,0.07)',
  },
  sosChipActive: {
    borderColor: '#FF1744',
    backgroundColor: 'rgba(255,23,68,0.2)',
  },
  sosChipText: {
    color: '#FF8A80',
    fontSize: 12,
    fontWeight: '600',
  },
  sosChipTextActive: {
    color: '#fff',
    fontWeight: '700',
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
