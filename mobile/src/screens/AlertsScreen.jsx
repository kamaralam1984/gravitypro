import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Platform,
  ScrollView,
  Alert,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDistanceToNow } from 'date-fns'
import { GradientCard } from '../components/ui/GradientCard'
import { circleAPI, geofenceAPI, sosAPI } from '../services/api'
import { storage } from '../utils/storage'
import { useTheme } from '../theme/ThemeContext'
import { useAuthStore } from '../store/authStore'

const NativeEventSource = Platform.OS !== 'web' ? require('react-native-sse').default : null

const SSE_URL =
  (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') +
  '/api/v1/sse/stream'

const TABS = ['All', 'SOS', 'Geofence', 'Device']

// Device-health alert presentation map (event_type -> icon/label/color)
const DEVICE_ALERTS = {
  battery_low: {
    icon: 'battery-dead-outline',
    emoji: '🔋',
    badge: 'BATTERY LOW',
    color: '#FF8F00', // amber
    iconBg: 'rgba(255,143,0,0.14)',
    label: (name, item) =>
      `${name} battery low${item.battery != null ? ` (${item.battery}%)` : ''}`,
  },
  gps_off: {
    icon: 'warning-outline',
    emoji: '⚠️',
    badge: 'GPS OFF',
    color: '#FFB300', // warning yellow
    iconBg: 'rgba(255,179,0,0.14)',
    label: (name) => `${name} turned off location`,
  },
  device_offline: {
    icon: 'cloud-offline-outline',
    emoji: '📵',
    badge: 'OFFLINE',
    color: '#9E9E9E', // muted grey
    iconBg: 'rgba(158,158,158,0.16)',
    label: (name) => `${name} went offline`,
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeTimeAgo(dateStr) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return 'just now'
    return formatDistanceToNow(d, { addSuffix: true })
  } catch {
    return 'just now'
  }
}

// ── SOS Card ─────────────────────────────────────────────────────────────────

function SosCard({ item, index, onResolve, isParent }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const slideAnim = useRef(new Animated.Value(24)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current
  const pulseAnim = useRef(new Animated.Value(1)).current
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    const delay = Math.min(index * 60, 300)
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, delay)
  }, [])

  useEffect(() => {
    if (!item.resolved) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.5, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      )
      loop.start()
      return () => loop.stop()
    }
  }, [item.resolved])

  const handleResolve = async () => {
    setResolving(true)
    try {
      await sosAPI.resolve(item.id)
      onResolve(item.id)
    } catch (e) {
      console.error('Resolve SOS error', e)
    } finally {
      setResolving(false)
    }
  }

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <View style={[styles.sosCard, item.resolved ? styles.sosCardResolved : styles.sosCardActive]}>
        {/* Red left border accent */}
        <View style={[styles.leftBorder, { backgroundColor: item.resolved ? c.textMuted : c.danger }]} />

        {/* Pulse overlay for unresolved */}
        {!item.resolved && (
          <Animated.View style={[StyleSheet.absoluteFill, styles.sosPulseOverlay, { opacity: pulseAnim }]} />
        )}

        <View style={styles.cardInner}>
          {/* Top row: icon + badge + time */}
          <View style={styles.sosTopRow}>
            <View style={[styles.sosIconWrap, { backgroundColor: item.resolved ? 'rgba(94,139,110,0.15)' : 'rgba(229,57,53,0.15)' }]}>
              <Ionicons name="warning" size={20} color={item.resolved ? c.textMuted : c.danger} />
            </View>
            <View style={[styles.sosBadge, { backgroundColor: item.resolved ? 'rgba(94,139,110,0.2)' : 'rgba(229,57,53,0.2)' }]}>
              <Text style={[styles.sosBadgeText, { color: item.resolved ? c.textMuted : c.danger }]}>
                SOS ALERT
              </Text>
            </View>
            <Text style={styles.alertTime}>{safeTimeAgo(item.created_at)}</Text>
          </View>

          {/* Sender name */}
          <Text style={styles.senderName}>{item.user_name || 'Unknown'}</Text>

          {/* Message */}
          {!!item.message && (
            <Text style={styles.sosMessage}>"{item.message}"</Text>
          )}

          {/* Action row */}
          <View style={styles.sosActionRow}>
            {item.resolved ? (
              <View style={styles.resolvedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={c.success} />
                <Text style={styles.resolvedBadgeText}>Resolved</Text>
              </View>
            ) : isParent ? (
              // Only a parent can mark an SOS resolved.
              <Pressable
                onPress={handleResolve}
                disabled={resolving}
                style={({ pressed }) => [styles.resolveBtn, pressed && { opacity: 0.75 }]}>
                <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.resolveBtnGrad}>
                  {resolving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={14} color="#fff" />
                      <Text style={styles.resolveBtnText}>Mark Resolved</Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

// ── Geofence Card ─────────────────────────────────────────────────────────────

function GeofenceCard({ item, index }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const slideAnim = useRef(new Animated.Value(24)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  const isEntry = item.event_type === 'entry'
  const borderColor = isEntry ? c.success : c.warning
  const iconBg = isEntry ? 'rgba(0,200,83,0.12)' : 'rgba(255,179,0,0.12)'
  const icon   = isEntry ? 'enter-outline' : 'exit-outline'
  const label  = isEntry ? 'Arrived' : 'Left'
  const labelColor = isEntry ? c.success : c.warning

  useEffect(() => {
    const delay = Math.min(index * 60, 300)
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, delay)
  }, [])

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <View style={[styles.geoCard]}>
        <View style={[styles.leftBorder, { backgroundColor: borderColor }]} />
        <View style={styles.cardInner}>
          <View style={styles.geoRow}>
            <View style={[styles.geoIconWrap, { backgroundColor: iconBg }]}>
              <Ionicons name="person" size={18} color={labelColor} />
            </View>
            <View style={styles.geoBody}>
              <Text style={styles.senderName}>{item.user_name || 'Unknown'}</Text>
              <Text style={styles.geoDesc}>
                <Text style={{ color: labelColor }}>{isEntry ? 'arrived at' : 'left'} </Text>
                <Text style={styles.zoneName}>{item.zone_name || 'a safe zone'}</Text>
              </Text>
            </View>
            <View style={styles.geoRight}>
              <View style={[styles.geoTypeBadge, { backgroundColor: iconBg }]}>
                <Ionicons name={icon} size={12} color={labelColor} />
                <Text style={[styles.geoTypeBadgeText, { color: labelColor }]}>{label}</Text>
              </View>
              <Text style={styles.alertTime}>{safeTimeAgo(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

// ── Device Health Card ────────────────────────────────────────────────────────

function DeviceCard({ item, index }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const slideAnim = useRef(new Animated.Value(24)).current
  const fadeAnim  = useRef(new Animated.Value(0)).current

  const cfg = DEVICE_ALERTS[item.event_type] || DEVICE_ALERTS.device_offline
  const name = item.user_name || 'A member'

  useEffect(() => {
    const delay = Math.min(index * 60, 300)
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, delay)
  }, [])

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 12 }}>
      <View style={[styles.geoCard]}>
        <View style={[styles.leftBorder, { backgroundColor: cfg.color }]} />
        <View style={styles.cardInner}>
          <View style={styles.geoRow}>
            <View style={[styles.geoIconWrap, { backgroundColor: cfg.iconBg }]}>
              <Ionicons name={cfg.icon} size={18} color={cfg.color} />
            </View>
            <View style={styles.geoBody}>
              <Text style={styles.senderName}>{name}</Text>
              <Text style={styles.geoDesc}>{cfg.emoji} {cfg.label(name, item)}</Text>
            </View>
            <View style={styles.geoRight}>
              <View style={[styles.geoTypeBadge, { backgroundColor: cfg.iconBg }]}>
                <Ionicons name={cfg.icon} size={12} color={cfg.color} />
                <Text style={[styles.geoTypeBadgeText, { color: cfg.color }]}>{cfg.badge}</Text>
              </View>
              <Text style={styles.alertTime}>{safeTimeAgo(item.created_at)}</Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}

// ── Flash Banner ──────────────────────────────────────────────────────────────

function FlashBanner({ banner, insetTop }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const slideAnim = useRef(new Animated.Value(-120)).current

  useEffect(() => {
    if (!banner) return
    slideAnim.setValue(-120)
    Animated.sequence([
      Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 10, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(slideAnim, { toValue: -120, duration: 350, useNativeDriver: true }),
    ]).start()
  }, [banner?.key])

  if (!banner) return null

  const isSos = banner.type === 'sos'
  const isDevice = banner.type === 'device'
  const deviceCfg = isDevice ? (DEVICE_ALERTS[banner.eventType] || DEVICE_ALERTS.device_offline) : null
  const bg = isSos
    ? c.danger
    : isDevice
      ? deviceCfg.color
      : banner.eventType === 'exit'
        ? c.warning
        : c.success
  const bannerIcon = isSos ? 'warning' : isDevice ? deviceCfg.icon : 'notifications'

  return (
    <Animated.View
      style={[
        styles.flashBanner,
        { top: insetTop, backgroundColor: bg, transform: [{ translateY: slideAnim }] },
      ]}
      pointerEvents="none">
      <Ionicons name={bannerIcon} size={20} color="#fff" />
      <View style={styles.flashTextWrap}>
        <Text style={styles.flashTitle}>{banner.title}</Text>
        <Text style={styles.flashBody} numberOfLines={1}>{banner.body}</Text>
      </View>
    </Animated.View>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ tab }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const config = {
    All:      { icon: 'notifications-off-outline', title: 'No alerts yet',          body: 'SOS alerts and geofence events will appear here.' },
    SOS:      { icon: 'warning-outline',           title: 'No SOS alerts',           body: 'Emergency SOS alerts from your family will show up here.' },
    Geofence: { icon: 'map-outline',               title: 'No geofence events',      body: 'Entry and exit events for your safe zones appear here.' },
    Device:   { icon: 'phone-portrait-outline',    title: 'No device alerts',        body: 'Low battery, location-off, and offline alerts appear here.' },
  }[tab] || {}
  return (
    <View style={styles.emptyBox}>
      <Ionicons name={config.icon} size={64} color={c.accentDim} />
      <Text style={styles.emptyTitle}>{config.title}</Text>
      <Text style={styles.emptyText}>{config.body}</Text>
    </View>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AlertsScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const user = useAuthStore(s => s.user)
  // Only a parent can resolve an SOS; a child can view alerts but not "Mark Resolved".
  const isParent = user?.account_type !== 'child'

  const [activeCircle, setActiveCircle] = useState(null)
  const [sendingSafe, setSendingSafe] = useState(false)
  const [sosItems, setSosItems]         = useState([])
  const [geoItems, setGeoItems]         = useState([])
  const [deviceItems, setDeviceItems]   = useState([])
  const [activeTab, setActiveTab]       = useState('All')
  const [loading, setLoading]           = useState(true)
  const [refreshing, setRefreshing]     = useState(false)
  const [error, setError]               = useState('')
  const [banner, setBanner]             = useState(null)

  const fadeAnim = useRef(new Animated.Value(0)).current
  const sseRef   = useRef(null)
  const bannerKey = useRef(0)

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setError('')
    try {
      const circleRes = await circleAPI.getAll()
      const circles = circleRes.circles || []
      if (!circles.length) { setLoading(false); return }
      const circle = circles[0]
      setActiveCircle(circle)
      await Promise.all([loadSos(circle.id), loadGeo(circle.id)])
    } catch (e) {
      setError('Failed to load alerts')
    } finally {
      setLoading(false)
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    }
  }, [])

  const loadSos = async (circleId) => {
    try {
      const res = await sosAPI.getHistory(circleId)
      setSosItems(res.sos_events || [])
    } catch (e) {
      console.error('Load SOS error', e)
    }
  }

  const loadGeo = async (circleId) => {
    try {
      const res = await geofenceAPI.getEvents(circleId)
      setGeoItems(res.events || [])
    } catch (e) {
      console.error('Load geofence error', e)
    }
  }

  useEffect(() => {
    loadData()
    return () => sseRef.current?.close()
  }, [])

  useEffect(() => {
    if (activeCircle) connectSSE()
  }, [activeCircle])

  // ── SSE ─────────────────────────────────────────────────────────────────────

  const connectSSE = async () => {
    if (Platform.OS === 'web' || !NativeEventSource) return
    const token = await storage.getItem('auth_token')
    if (!token) return
    sseRef.current?.close()
    const es = new NativeEventSource(SSE_URL, {
      headers: { Authorization: 'Bearer ' + token },
    })

    es.addEventListener('sos_alert', (e) => {
      try {
        const data = JSON.parse(e.data)
        const newItem = {
          id: data.sosId || String(Date.now()),
          user_id: data.userId,
          user_name: data.name,
          message: data.message,
          latitude: data.latitude,
          longitude: data.longitude,
          resolved: false,
          created_at: new Date().toISOString(),
        }
        setSosItems(prev => [newItem, ...prev])
        bannerKey.current += 1
        setBanner({
          key: bannerKey.current,
          type: 'sos',
          title: `SOS from ${data.name}`,
          body: data.message || 'Emergency alert triggered',
        })
      } catch (err) {
        console.error('SSE sos_alert parse error', err)
      }
    })

    es.addEventListener('sos_safe', (e) => {
      try {
        const data = JSON.parse(e.data)
        bannerKey.current += 1
        setBanner({
          key: bannerKey.current,
          type: 'geofence',
          eventType: 'enter',
          title: `${data.name || 'Someone'} is safe`,
          body: data.message || 'They reported being safe',
        })
      } catch (err) {
        console.error('SSE sos_safe parse error', err)
      }
    })

    es.addEventListener('geofence_event', (e) => {
      try {
        const data = JSON.parse(e.data)
        const newItem = {
          id: String(Date.now()),
          user_id: data.userId,
          user_name: data.name,
          event_type: data.eventType,
          safe_zone_id: data.zoneId,
          zone_name: data.zoneName,
          created_at: new Date().toISOString(),
        }
        setGeoItems(prev => [newItem, ...prev])
        bannerKey.current += 1
        setBanner({
          key: bannerKey.current,
          type: 'geofence',
          eventType: data.eventType,
          title: data.eventType === 'exit' ? `${data.name} left ${data.zoneName}` : `${data.name} arrived at ${data.zoneName}`,
          body: data.eventType === 'exit' ? 'Geofence exit event' : 'Geofence entry event',
        })
      } catch (err) {
        console.error('SSE geofence_event parse error', err)
      }
    })

    es.addEventListener('device_alert', (e) => {
      try {
        const data = JSON.parse(e.data)
        const eventType = data.event_type || data.alertType
        const name = data.name || data.user_name || 'A member'
        const cfg = DEVICE_ALERTS[eventType] || DEVICE_ALERTS.device_offline
        const newItem = {
          id: String(data.userId || data.user_id || '') + '-' + (data.created_at || Date.now()),
          user_id: data.userId || data.user_id,
          user_name: name,
          event_type: eventType,
          battery: data.battery,
          created_at: data.created_at || data.timestamp || new Date().toISOString(),
        }
        setDeviceItems(prev => [newItem, ...prev])
        bannerKey.current += 1
        setBanner({
          key: bannerKey.current,
          type: 'device',
          eventType,
          title: data.title || cfg.label(name, newItem),
          body: data.body || cfg.badge,
        })
      } catch (err) {
        console.error('SSE device_alert parse error', err)
      }
    })

    sseRef.current = es
  }

  // ── Mark as Safe ────────────────────────────────────────────────────────────

  const handleMarkSafe = useCallback(async () => {
    setSendingSafe(true)
    try {
      await sosAPI.safe({ message: "I'm safe!" })
      bannerKey.current += 1
      setBanner({
        key: bannerKey.current,
        type: 'geofence',
        eventType: 'enter',
        title: 'Safe notification sent',
        body: 'Your circle has been notified you are safe.',
      })
    } catch (e) {
      Alert.alert('Error', 'Could not send safe notification. Try again.')
    } finally {
      setSendingSafe(false)
    }
  }, [])

  // ── Resolve SOS ─────────────────────────────────────────────────────────────

  const handleResolve = useCallback((sosId) => {
    setSosItems(prev => prev.map(s => s.id === sosId ? { ...s, resolved: true } : s))
  }, [])

  // ── Refresh ─────────────────────────────────────────────────────────────────

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    if (activeCircle) {
      await Promise.all([loadSos(activeCircle.id), loadGeo(activeCircle.id)])
    }
    setRefreshing(false)
  }, [activeCircle])

  // ── Feed data for active tab ─────────────────────────────────────────────────

  const feedData = (() => {
    const sosFeed = sosItems.map(s => ({ ...s, _type: 'sos' }))
    const geoFeed = geoItems.map(g => ({ ...g, _type: 'geo' }))
    const deviceFeed = deviceItems.map(d => ({ ...d, _type: 'device' }))
    if (activeTab === 'SOS') return sosFeed
    if (activeTab === 'Geofence') return geoFeed
    if (activeTab === 'Device') return deviceFeed
    // All: merge by created_at descending
    return [...sosFeed, ...geoFeed, ...deviceFeed].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  })()

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />

      {/* Flash Banner (SSE live notification) */}
      <FlashBanner banner={banner} insetTop={insets.top} />

      {/* Header */}
      <LinearGradient
        colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.9)']}
        style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Alerts</Text>
            <Text style={styles.headerSubtitle}>
              {activeCircle ? activeCircle.name : 'Your safety events'}
            </Text>
          </View>
          <Pressable
            onPress={handleMarkSafe}
            disabled={sendingSafe}
            style={({ pressed }) => [styles.safeBtn, pressed && { opacity: 0.75 }]}>
            <LinearGradient colors={['#0D7A45', '#0A5C35']} style={styles.safeBtnGrad}>
              {sendingSafe
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="checkmark-circle" size={16} color="#fff" />
              }
              <Text style={styles.safeBtnText}>{sendingSafe ? 'Sending…' : "I'm Safe"}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabRow}
          style={styles.tabScroll}>
          {TABS.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={({ pressed }) => [
                styles.tab,
                activeTab === tab && styles.tabActive,
                pressed && { opacity: 0.75 },
              ]}>
              {activeTab === tab ? (
                <LinearGradient colors={c.gradients.button} style={styles.tabGrad}>
                  <Text style={styles.tabTextActive}>{tab}</Text>
                </LinearGradient>
              ) : (
                <Text style={styles.tabText}>{tab}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      {/* Body */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={48} color={c.danger} />
          <Text style={styles.errorTitle}>Could not load alerts</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={loadData} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.FlatList
          style={{ opacity: fadeAnim }}
          data={feedData}
          keyExtractor={(item) => `${item._type}-${item.id}`}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={c.accent}
              colors={[c.accent]}
            />
          }
          ListEmptyComponent={<EmptyState tab={activeTab} />}
          renderItem={({ item, index }) =>
            item._type === 'sos' ? (
              <SosCard item={item} index={index} onResolve={handleResolve} isParent={isParent} />
            ) : item._type === 'device' ? (
              <DeviceCard item={item} index={index} />
            ) : (
              <GeofenceCard item={item} index={index} />
            )
          }
        />
      )}
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep },

  // Header
  header: { paddingHorizontal: 20, paddingBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 28, fontWeight: '800', color: c.textWhite },
  headerSubtitle: { fontSize: 13, color: c.textMuted, marginTop: 2 },
  safeBtn: { borderRadius: 20, overflow: 'hidden' },
  safeBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9 },
  safeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabScroll: { marginTop: 14 },
  tabRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  tab: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
  tabActive: { borderColor: c.accentSoft },
  tabGrad: { paddingHorizontal: 18, paddingVertical: 7 },
  tabText: { color: c.textMuted, fontSize: 13, fontWeight: '600', paddingHorizontal: 18, paddingVertical: 7 },
  tabTextActive: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Feed
  list: { padding: 16 },

  // Loading / Error
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: c.textSecondary },
  errorText:  { fontSize: 14, color: c.textMuted, textAlign: 'center' },
  retryBtn:   { backgroundColor: c.bgCard, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  retryText:  { color: c.accent, fontWeight: '700' },

  // Empty state
  emptyBox:   { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: c.textSecondary },
  emptyText:  { fontSize: 14, color: c.textMuted, textAlign: 'center', paddingHorizontal: 32 },

  // Shared card structure
  leftBorder: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  cardInner:  { flex: 1, padding: 14, paddingLeft: 18 },

  // SOS Card
  sosCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: c.bgCard,
  },
  sosCardActive:   { borderColor: 'rgba(229,57,53,0.35)' },
  sosCardResolved: { borderColor: c.border },
  sosPulseOverlay: { backgroundColor: 'rgba(229,57,53,0.06)', borderRadius: 16 },
  sosTopRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  sosIconWrap:  { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sosBadge:     { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sosBadgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  senderName:   { fontSize: 16, fontWeight: '700', color: c.textPrimary, marginBottom: 4 },
  sosMessage:   { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginBottom: 10 },
  alertTime:    { fontSize: 12, color: c.textMuted, marginLeft: 'auto' },
  sosActionRow: { flexDirection: 'row', alignItems: 'center' },
  resolveBtn:   { borderRadius: 10, overflow: 'hidden' },
  resolveBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8 },
  resolveBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  resolvedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,200,83,0.12)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  resolvedBadgeText: { color: c.success, fontSize: 13, fontWeight: '700' },

  // Geofence Card
  geoCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bgCard,
    overflow: 'hidden',
    position: 'relative',
  },
  geoRow:        { flexDirection: 'row', alignItems: 'center', gap: 12 },
  geoIconWrap:   { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  geoBody:       { flex: 1, gap: 3 },
  geoDesc:       { fontSize: 13, color: c.textSecondary },
  zoneName:      { fontWeight: '600', color: c.textPrimary },
  geoRight:      { alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  geoTypeBadge:  { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  geoTypeBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Flash Banner
  flashBanner: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 999,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 16,
  },
  flashTextWrap: { flex: 1 },
  flashTitle:    { color: '#fff', fontSize: 14, fontWeight: '800' },
  flashBody:     { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
})
