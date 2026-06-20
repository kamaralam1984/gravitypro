import React, { useEffect, useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  ScrollView,
  FlatList,
  Alert,
  Platform,
} from 'react-native'
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { useAuthStore } from '../store/authStore'
import { MemberAvatar } from '../components/MemberAvatar'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { userAPI, circleAPI, sosAPI } from '../services/api'
import { Colors, Gradients } from '../theme/colors'
import { DARK_MAP_STYLE } from '../theme/mapStyles'
import { getCurrentLocation } from '../services/location'

// ── Greeting helper ───────────────────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Shimmer placeholder ───────────────────────────────────────────────────────

function Shimmer({ style }) {
  const anim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [])
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.65] })
  return <Animated.View style={[{ backgroundColor: Colors.bgCardLight, borderRadius: 12 }, style, { opacity }]} />
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, loading }) {
  return (
    <View style={styles.statCard}>
      <LinearGradient colors={Gradients.card} style={styles.statGrad}>
        <Text style={styles.statIcon}>{icon}</Text>
        {loading ? (
          <Shimmer style={{ width: 44, height: 22, marginVertical: 4 }} />
        ) : (
          <Text style={styles.statValue}>{value ?? '—'}</Text>
        )}
        <Text style={styles.statLabel}>{label}</Text>
      </LinearGradient>
    </View>
  )
}

// ── Member Chip ───────────────────────────────────────────────────────────────

function MemberChip({ member, memberLocations }) {
  const loc = memberLocations[member.id]
  const isOnline = loc
    ? (!loc.timestamp || Date.now() - new Date(loc.timestamp).getTime() < 5 * 60 * 1000)
    : false

  return (
    <View style={styles.memberChip}>
      <MemberAvatar member={member} size={52} showStatus isOnline={isOnline} />
      <Text style={styles.memberChipName} numberOfLines={1}>
        {member.name?.split(' ')[0] || '?'}
      </Text>
      {loc?.battery != null && (
        <BatteryIndicator level={loc.battery} showText size="sm" />
      )}
    </View>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const user       = useAuthStore(s => s.user)
  const insets     = useSafeAreaInsets()
  const navigation = useNavigation()

  const [loading, setLoading]               = useState(true)
  const [statsLoading, setStatsLoading]     = useState(true)
  const [activeCircle, setActiveCircle]     = useState(null)
  const [members, setMembers]               = useState([])
  const [memberLocations, setMemberLocations] = useState({})
  const [stats, setStats]                   = useState(null)
  const [myLocation, setMyLocation]         = useState(null)
  const [sosSending, setSosSending]         = useState(false)
  const [now, setNow]                       = useState(new Date())

  const fadeAnim = useRef(new Animated.Value(0)).current
  const mapRef   = useRef(null)

  // Tick the clock every minute
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // ── Mount ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    loadAll()
    initLocation()
  }, [])

  const loadAll = async () => {
    try {
      await Promise.all([loadCircle(), loadStats()])
    } finally {
      setLoading(false)
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start()
    }
  }

  const loadCircle = async () => {
    try {
      const res = await circleAPI.getAll()
      const circles = res.circles || []
      if (!circles.length) return
      const circle = circles[0]
      setActiveCircle(circle)
      await loadMembers(circle.id)
    } catch (e) {
      console.error('Load circle error', e)
    }
  }

  const loadMembers = async (circleId) => {
    try {
      const res = await circleAPI.getMembers(circleId)
      const mems = res.members || []
      setMembers(mems)
      const locs = {}
      for (const m of mems) {
        if (m.latitude && m.longitude) {
          locs[m.id] = {
            latitude: m.latitude,
            longitude: m.longitude,
            battery: m.battery_level,
            timestamp: m.last_seen,
          }
        }
      }
      setMemberLocations(locs)
    } catch (e) {
      console.error('Load members error', e)
    }
  }

  const loadStats = async () => {
    setStatsLoading(true)
    try {
      const res = await userAPI.getStats()
      setStats(res.today || res)
    } catch (e) {
      console.error('Load stats error', e)
    } finally {
      setStatsLoading(false)
    }
  }

  const initLocation = async () => {
    try {
      const { getCurrentLocation: getLocation } = await import('../services/location')
      const loc = await getLocation()
      setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
    } catch (e) {
      console.error('Location init error', e)
    }
  }

  // ── SOS ────────────────────────────────────────────────────────────────────

  const handleSOS = () => {
    Alert.alert(
      '🚨 Send SOS Alert',
      'This will immediately notify all family members of your emergency.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: sendSOS,
        },
      ]
    )
  }

  const sendSOS = async () => {
    setSosSending(true)
    try {
      const payload = {}
      if (myLocation) {
        payload.latitude  = myLocation.latitude
        payload.longitude = myLocation.longitude
      }
      await sosAPI.trigger(payload)
      Alert.alert('SOS Sent', 'Your family has been notified. Help is on the way.')
    } catch (e) {
      Alert.alert('Failed', 'Could not send SOS. Please try again.')
      console.error('SOS trigger error', e)
    } finally {
      setSosSending(false)
    }
  }

  // ── Map region ─────────────────────────────────────────────────────────────

  const mapRegion = (() => {
    if (myLocation) return { ...myLocation, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    const locs = Object.values(memberLocations)
    if (locs.length) return { latitude: locs[0].latitude, longitude: locs[0].longitude, latitudeDelta: 0.04, longitudeDelta: 0.04 }
    return { latitude: 1.2921, longitude: 36.8219, latitudeDelta: 30, longitudeDelta: 30 }
  })()

  // ── Render ─────────────────────────────────────────────────────────────────

  const firstName = user?.name?.split(' ')[0] || 'there'

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}>

        {/* ── Hero Header ── */}
        <LinearGradient
          colors={['#042918', '#0A5C35', '#020C05']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroHeader, { paddingTop: insets.top + 20 }]}>

          {/* Greeting */}
          <View style={styles.greetingRow}>
            <View style={styles.greetingLeft}>
              <Text style={styles.greetingText}>{getGreeting()}, {firstName} 👋</Text>
              <Text style={styles.dateText}>{formatTime(now)} · {formatDate(now)}</Text>
            </View>
            {activeCircle && (
              <View style={styles.circleChip}>
                <Ionicons name="people" size={13} color={Colors.accent} />
                <Text style={styles.circleChipText} numberOfLines={1}>{activeCircle.name}</Text>
              </View>
            )}
          </View>
        </LinearGradient>

        {/* ── Today's Activity ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Activity</Text>
          <View style={styles.statsRow}>
            <StatCard
              icon="🚶"
              label="Distance"
              value={stats?.distance != null ? `${stats.distance} km` : '—'}
              loading={statsLoading}
            />
            <StatCard
              icon="🛡️"
              label="Safe Zones"
              value={stats?.safeZones != null ? String(stats.safeZones) : '—'}
              loading={statsLoading}
            />
            <StatCard
              icon="👥"
              label="Check-ins"
              value={stats?.checkins != null ? String(stats.checkins) : '—'}
              loading={statsLoading}
            />
          </View>
        </View>

        {/* ── Mini Family Map ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Family Map</Text>
          <Pressable
            onPress={() => navigation.navigate('Map')}
            style={styles.mapContainer}>
            {loading ? (
              <Shimmer style={styles.mapShimmer} />
            ) : (
              <MapView
                ref={mapRef}
                provider={PROVIDER_GOOGLE}
                style={styles.miniMap}
                customMapStyle={DARK_MAP_STYLE}
                region={mapRegion}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                showsUserLocation={false}
                showsCompass={false}
                toolbarEnabled={false}
                pointerEvents="none">
                {/* Own location */}
                {myLocation && (
                  <Marker coordinate={myLocation} anchor={{ x: 0.5, y: 0.5 }} title="You">
                    <View style={styles.myDot}>
                      <LinearGradient colors={['#00E676', '#00C853']} style={styles.myDotInner}>
                        <Ionicons name="person" size={10} color="#fff" />
                      </LinearGradient>
                    </View>
                  </Marker>
                )}
                {/* Member locations */}
                {members
                  .filter(m => m.id !== user?.id && memberLocations[m.id])
                  .map(member => (
                    <Marker
                      key={member.id}
                      coordinate={memberLocations[member.id]}
                      anchor={{ x: 0.5, y: 0.5 }}
                      title={member.name}>
                      <View style={styles.memberDot}>
                        <View style={styles.memberDotInner}>
                          <Text style={styles.memberDotInitial}>
                            {member.name?.[0]?.toUpperCase() || '?'}
                          </Text>
                        </View>
                      </View>
                    </Marker>
                  ))}
              </MapView>
            )}

            {/* "View Full Map" overlay */}
            <View style={styles.mapOverlayBtn} pointerEvents="none">
              <LinearGradient colors={['rgba(10,92,53,0.85)', 'rgba(4,41,24,0.85)']} style={styles.mapOverlayGrad}>
                <Text style={styles.mapOverlayText}>View Full Map</Text>
                <Ionicons name="arrow-forward" size={13} color={Colors.accent} />
              </LinearGradient>
            </View>
          </Pressable>
        </View>

        {/* ── Family Status ── */}
        {members.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Family Status</Text>
            {loading ? (
              <View style={styles.shimmerRow}>
                {[0, 1, 2].map(i => <Shimmer key={i} style={styles.memberChipShimmer} />)}
              </View>
            ) : (
              <FlatList
                horizontal
                data={members}
                keyExtractor={m => m.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.memberList}
                renderItem={({ item }) => (
                  <MemberChip member={item} memberLocations={memberLocations} />
                )}
              />
            )}
          </View>
        )}

        {/* ── Quick SOS ── */}
        <View style={styles.section}>
          <Pressable
            onPress={handleSOS}
            disabled={sosSending}
            style={({ pressed }) => [styles.sosBtn, pressed && { opacity: 0.85 }]}>
            <LinearGradient
              colors={['#E53935', '#B71C1C']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.sosBtnGrad}>
              {sosSending ? (
                <>
                  <View style={styles.sosBtnIconWrap}>
                    <Ionicons name="time-outline" size={24} color="#fff" />
                  </View>
                  <Text style={styles.sosBtnText}>Sending SOS…</Text>
                </>
              ) : (
                <>
                  <View style={styles.sosBtnIconWrap}>
                    <Ionicons name="warning" size={24} color="#fff" />
                  </View>
                  <Text style={styles.sosBtnText}>🚨 Send SOS</Text>
                  <Text style={styles.sosBtnSub}>Alerts all family members</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>

      </Animated.ScrollView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: Colors.bgDeep },
  scrollContent: { flexGrow: 1 },

  // Hero Header
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  greetingLeft:  { flex: 1 },
  greetingText:  { fontSize: 22, fontWeight: '800', color: Colors.textWhite, flexShrink: 1 },
  dateText:      { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  circleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.bgGlassStrong,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
    flexShrink: 0,
    maxWidth: 130,
  },
  circleChipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },

  // Sections
  section:      { paddingHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary, marginBottom: 12 },

  // Stat Cards
  statsRow: { flexDirection: 'row', gap: 10 },
  statCard: { flex: 1, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  statGrad: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 8, gap: 4 },
  statIcon:  { fontSize: 22 },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.textWhite },
  statLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textAlign: 'center' },

  // Mini Map
  mapContainer: {
    height: 200,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    position: 'relative',
  },
  miniMap:      { ...StyleSheet.absoluteFillObject },
  mapShimmer:   { flex: 1, borderRadius: 20 },
  mapOverlayBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mapOverlayGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  mapOverlayText: { color: Colors.accent, fontSize: 12, fontWeight: '700' },

  // Map markers
  myDot:        { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  myDotInner:   { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  memberDot:    { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  memberDotInner: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.info, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  memberDotInitial: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Family Status
  memberList:        { paddingRight: 4, gap: 12 },
  memberChip:        { alignItems: 'center', gap: 6, width: 72 },
  memberChipName:    { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  shimmerRow:        { flexDirection: 'row', gap: 12 },
  memberChipShimmer: { width: 72, height: 90, borderRadius: 16 },

  // SOS Button
  sosBtn:     { borderRadius: 20, overflow: 'hidden', shadowColor: '#E53935', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 14, elevation: 14 },
  sosBtnGrad: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20, gap: 14 },
  sosBtnIconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosBtnText: { fontSize: 20, fontWeight: '800', color: '#fff', flex: 1 },
  sosBtnSub:  { fontSize: 12, color: 'rgba(255,255,255,0.75)', position: 'absolute', bottom: 12, right: 24 },
})
